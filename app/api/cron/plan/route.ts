import { NextResponse } from "next/server";
import {
  getActiveKeywords,
  pickKeywordsForToday,
  type KeywordRow,
} from "@/lib/sheets";
import { ACTIVE_PATTERN_IDS } from "@/lib/title-diversity";

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

  // 2. 사용자 제공 키워드(source !== "auto")만 사용 — 자동 발굴(GSG) 폐기.
  //    제목 다양성 문제 때문에 발굴 키워드를 더 이상 쓰지 않음.
  const TARGET_TOTAL = 10;
  const manualKeywords = allKeywords.filter((k) => k.source !== "auto");

  if (manualKeywords.length === 0) {
    return NextResponse.json(
      {
        error:
          "사용 가능한 사용자 키워드가 없습니다 (source !== 'auto', status active). keywords 시트를 확인하세요.",
      },
      { status: 500 },
    );
  }

  // 7일 제외 우선 → 부족하면 재사용까지 허용해 최대한 채움
  let picks = pickKeywordsForToday(manualKeywords, TARGET_TOTAL);

  // 고유 키워드 총량이 10개 미만이면 같은 키워드를 순환 재사용해 10개 보장.
  if (picks.length < TARGET_TOTAL && picks.length > 0) {
    const base = picks.length;
    let i = 0;
    while (picks.length < TARGET_TOTAL) {
      picks.push(picks[i % base]);
      i++;
    }
    errors.push(
      `고유 키워드 ${base}개 < ${TARGET_TOTAL} → 일부 키워드 재사용으로 ${TARGET_TOTAL}개 채움`,
    );
  }

  // 모두 Track 1(사용자 키워드)로 취급
  const track1Picks = picks;
  const track2Picks: Array<{ keyword: string; category: string }> = [];

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
    forcedPattern: number;
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
      forcedPattern: 0, // 아래서 일괄 배정
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
      forcedPattern: 0,
    });
  });

  // 후킹 패턴을 슬롯별로 distinct 배정 → 하루 안에 같은 패턴 2개 이상 금지.
  // 활성 패턴(제외 패턴 뺀 것)만 슬롯별 distinct 배정 → 하루 안 패턴 중복 금지.
  // 날짜 오프셋으로 매일 다른 패턴 세트 사용 (KST 기준 일 단위 회전).
  // plan 길이 ≤ 10 ≤ ACTIVE_PATTERN_IDS 개수 이므로 모두 서로 다른 패턴 보장.
  const activeCount = ACTIVE_PATTERN_IDS.length;
  const kstDayIndex = Math.floor((Date.now() + 9 * 3600 * 1000) / 86400000);
  const dayOffset = kstDayIndex % activeCount;
  plan.forEach((item, i) => {
    item.forcedPattern = ACTIVE_PATTERN_IDS[(i + dayOffset) % activeCount];
  });

  return NextResponse.json({
    runAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    count: plan.length,
    plan,
    errors,
  });
}
