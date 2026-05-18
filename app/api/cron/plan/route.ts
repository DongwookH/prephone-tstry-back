import { NextResponse } from "next/server";
import {
  getActiveKeywords,
  pickKeywordsForToday,
  appendRows,
  keywordsSheetId,
  type KeywordRow,
} from "@/lib/sheets";
import { discoverKeywords } from "@/lib/keyword-discovery";

export const maxDuration = 60;

/**
 * POST /api/cron/plan
 *
 * 매일 cron의 1단계 — 키워드 픽 + GSG 발굴 (글 생성 X).
 * Vercel Hobby plan의 60초 한도 안에서 완료.
 *
 * 응답: 10개 plan items [{keyword, category, subKeywords, persona, track}]
 * GitHub Actions가 이 plan을 받아서 generate-one을 N번 호출.
 *
 * 인증: Authorization: Bearer <CRON_SECRET>
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const t0 = Date.now();
  const errors: string[] = [];

  // 1. 모든 active 키워드 로드
  let allKeywords: KeywordRow[] = [];
  try {
    allKeywords = await getActiveKeywords();
  } catch (err) {
    return NextResponse.json(
      {
        error: `keywords 로드 실패: ${(err as Error).message}`,
      },
      { status: 500 },
    );
  }

  // 2. Track 1: 사용자 키워드 5개 픽 (일단 5개)
  const manualKeywords = allKeywords.filter((k) => k.source !== "auto");
  let track1Picks = pickKeywordsForToday(
    manualKeywords.length ? manualKeywords : allKeywords,
    5,
  );

  // 3. Track 2: GSG 발굴 5개 (실패 시 errors에 기록하고 진행)
  let track2Picks: Array<{ keyword: string; category: string }> = [];
  try {
    const usedKw = allKeywords.map((k) => k.keyword).filter(Boolean).slice(0, 80);
    const discovered = await discoverKeywords({
      count: 5,
      excludeKeywords: usedKw,
    });
    track2Picks = discovered.map((d) => ({
      keyword: d.keyword,
      category: "auto",
    }));
    // keywords 시트에 자동 발굴 기록
    if (discovered.length > 0) {
      const now = new Date().toISOString();
      const rows = discovered.map((d, i) => [
        `auto-${Date.now()}-${i}`,
        d.keyword,
        "auto",
        "normal",
        "main",
        d.monthlyVolume ?? 0,
        d.monthlyPcVolume ?? 0,
        d.monthlyMobileVolume ?? 0,
        d.competition ?? "-",
        "0",
        "",
        "active",
        `[${d.intent}] ${d.reason}`.slice(0, 200),
        "auto",
        now,
      ]);
      await appendRows(keywordsSheetId(), "keywords", rows);
    }
  } catch (err) {
    errors.push(`Track2 발굴 실패: ${(err as Error).message}`);
  }

  // 3-A. Track2 부족 시 Track1에서 보강 — 항상 plan을 10개로 채우는 게 목표
  // (manualKeywords 풀에 여유가 있다면)
  const TARGET_TOTAL = 10;
  const shortfall = TARGET_TOTAL - (track1Picks.length + track2Picks.length);
  if (shortfall > 0) {
    // 이미 픽된 키워드 제외하고 추가 픽
    const alreadyPicked = new Set(track1Picks.map((k) => k.keyword));
    const remaining = (manualKeywords.length ? manualKeywords : allKeywords).filter(
      (k) => !alreadyPicked.has(k.keyword),
    );
    const extraPicks = pickKeywordsForToday(remaining, shortfall);
    if (extraPicks.length > 0) {
      track1Picks = [...track1Picks, ...extraPicks];
      console.info(
        `[plan] Track2 부족(${track2Picks.length}/5) → Track1에서 ${extraPicks.length}개 보강 (총 Track1=${track1Picks.length})`,
      );
    } else {
      errors.push(
        `Track1 보강 실패 — 사용 가능한 키워드 부족 (필요: ${shortfall}, 남은: ${remaining.length})`,
      );
    }
  }

  // 4. 서브 키워드 자동 매칭
  function pickSubKeywords(mainKeyword: string, mainCategory: string): string[] {
    const sameCat = allKeywords
      .filter(
        (k) =>
          k.keyword &&
          k.keyword !== mainKeyword &&
          (k.category === mainCategory || mainCategory === "auto"),
      )
      .sort((a, b) => {
        const va = parseInt(a.search_volume || "0", 10);
        const vb = parseInt(b.search_volume || "0", 10);
        return vb - va;
      });
    const region = allKeywords.filter(
      (k) => k.category === "지역" && k.keyword !== mainKeyword,
    );
    const subs: string[] = [];
    for (let i = 0; i < Math.min(2, sameCat.length); i++) {
      subs.push(sameCat[i].keyword);
    }
    if (region.length > 0) {
      const r = region[Math.floor(Math.random() * region.length)];
      if (r?.keyword && !subs.includes(r.keyword)) subs.push(r.keyword);
    }
    const general = allKeywords.filter(
      (k) =>
        k.keyword &&
        k.keyword !== mainKeyword &&
        !subs.includes(k.keyword) &&
        parseInt(k.search_volume || "0", 10) > 100,
    );
    if (general.length > 0) {
      subs.push(general[Math.floor(Math.random() * general.length)].keyword);
    }
    return subs.slice(0, 4);
  }

  const personas = ["IT", "자영업자", "대학생", "일반"];
  const plan: Array<{
    track: 1 | 2;
    keyword: string;
    category: string;
    subKeywords: string[];
    persona: string;
    slot: number;
  }> = [];

  // slot은 plan에 들어가는 순서대로 1부터 부여 — 보강 픽도 빈 슬롯 자동 사용
  track1Picks.forEach((k) => {
    plan.push({
      track: 1,
      keyword: k.keyword,
      category: k.category || "일반",
      subKeywords: pickSubKeywords(k.keyword, k.category || "일반"),
      persona: personas[plan.length % personas.length],
      slot: plan.length + 1,
    });
  });
  track2Picks.forEach((k) => {
    plan.push({
      track: 2,
      keyword: k.keyword,
      category: k.category,
      subKeywords: pickSubKeywords(k.keyword, k.category),
      persona: personas[plan.length % personas.length],
      slot: plan.length + 1,
    });
  });

  return NextResponse.json({
    runAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    count: plan.length,
    plan,
    errors,
  });
}
