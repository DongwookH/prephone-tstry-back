import { NextResponse } from "next/server";
import {
  getActiveKeywords,
  pickKeywordsForToday,
  appendRows,
  appendPosts,
  bumpKeywordsUsage,
  keywordsSheetId,
  type KeywordRow,
} from "@/lib/sheets";
import { discoverKeywords } from "@/lib/keyword-discovery";
import { generatePosts } from "@/lib/post-generator";

export const maxDuration = 300; // 5분 (Vercel hobby 한도)

/**
 * 매일 KST 09:00 cron이 호출.
 * Track1(사용자 5) + Track2(GSG 5) → 10편 글 생성 → posts 시트에 저장.
 *
 * 인증: Authorization: Bearer <CRON_SECRET>
 */
export async function POST(req: Request) {
  // 인증
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const t0 = Date.now();
  const summary: {
    track1: { keyword: string; category: string; ok: boolean; error?: string }[];
    track2: { keyword: string; category: string; ok: boolean; error?: string }[];
    errors: string[];
  } = { track1: [], track2: [], errors: [] };

  // ─── 0. 모든 active 키워드 미리 로드 (서브키워드용) ──
  let allKeywords: KeywordRow[] = [];
  try {
    allKeywords = await getActiveKeywords();
  } catch (err) {
    summary.errors.push(`keywords 로드 실패: ${(err as Error).message}`);
    return NextResponse.json({ summary }, { status: 500 });
  }

  // ─── 1. Track 1: 사용자 키워드 5개 선별 ──────────────
  const manualKeywords = allKeywords.filter((k) => k.source !== "auto");
  const track1Picks = pickKeywordsForToday(manualKeywords, 5);

  // ─── 2. Track 2: GSG 자동 발굴 5개 ──────────────────
  let track2Picks: Array<{
    keyword: string;
    category: string;
    subKeywords?: string[];
  }> = [];
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
    // keywords 시트에 자동 발굴 키워드 기록
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
    summary.errors.push(`Track2 발굴 실패: ${(err as Error).message}`);
  }

  // ─── 3. 서브 키워드 자동 매칭 (같은 카테고리에서) ────
  function pickSubKeywords(
    mainKeyword: string,
    mainCategory: string,
    n = 4,
  ): string[] {
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
    // 우선순위 높은 동일 카테고리 2개 + 지역 1개 + 그 외 일반 1개
    const subs: string[] = [];
    for (let i = 0; i < Math.min(2, sameCat.length); i++) {
      subs.push(sameCat[i].keyword);
    }
    if (region.length > 0) {
      const random = region[Math.floor(Math.random() * region.length)];
      if (random?.keyword && !subs.includes(random.keyword)) {
        subs.push(random.keyword);
      }
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
    return subs.slice(0, n);
  }

  // ─── 4. 글 생성 (Track1 + Track2 합쳐서 10편) ───────
  type GenInput = {
    keyword: string;
    category: string;
    subKeywords: string[];
    persona: string;
    track: 1 | 2;
  };
  const personas = ["IT", "자영업자", "대학생", "일반"];
  const inputs: GenInput[] = [];
  for (const k of track1Picks) {
    inputs.push({
      keyword: k.keyword,
      category: k.category || "일반",
      subKeywords: pickSubKeywords(k.keyword, k.category || "일반"),
      persona: personas[inputs.length % personas.length],
      track: 1,
    });
  }
  for (const k of track2Picks) {
    inputs.push({
      keyword: k.keyword,
      category: k.category,
      subKeywords: pickSubKeywords(k.keyword, k.category),
      persona: personas[inputs.length % personas.length],
      track: 2,
    });
  }

  const generated = await generatePosts(inputs, {
    onProgress: (i, total, kw) => {
      console.log(`[cron] ${i}/${total} 생성 중: ${kw}`);
    },
  });

  // ─── 5. posts 시트에 저장 ────────────────────────────
  const now = new Date().toISOString();
  const today = now.slice(0, 10).replace(/-/g, "");
  const rowsToAppend: Parameters<typeof appendPosts>[0] = [];
  const usedKeywords: string[] = [];

  for (let i = 0; i < generated.length; i++) {
    const input = inputs[i];
    const r = generated[i];
    if (r.ok) {
      rowsToAppend.push({
        id: `p-${today}-${String(i + 1).padStart(3, "0")}`,
        title: r.post.title,
        keyword: input.keyword,
        category: input.category,
        persona: input.persona,
        content_md: "", // 더 이상 사용 안 함, content_html만 사용
        content_html: r.post.content_html,
        char_count: r.post.char_count,
        seo_score: r.post.seo_score,
        status: "ready",
        utm_campaign: r.post.utm_campaign,
        created_at: now,
        updated_at: now,
      });
      usedKeywords.push(input.keyword);
      const slot = input.track === 1 ? summary.track1 : summary.track2;
      slot.push({ keyword: input.keyword, category: input.category, ok: true });
    } else {
      const slot = input.track === 1 ? summary.track1 : summary.track2;
      slot.push({
        keyword: input.keyword,
        category: input.category,
        ok: false,
        error: r.error,
      });
    }
  }

  // 한 번에 시트에 추가
  try {
    await appendPosts(rowsToAppend);
  } catch (err) {
    summary.errors.push(`posts 시트 저장 실패: ${(err as Error).message}`);
  }

  // 사용된 키워드의 used_count + last_used 갱신
  try {
    await bumpKeywordsUsage(usedKeywords);
  } catch (err) {
    summary.errors.push(`키워드 used_count 갱신 실패: ${(err as Error).message}`);
  }

  return NextResponse.json({
    runAt: now,
    durationMs: Date.now() - t0,
    summary: {
      track1Count: summary.track1.filter((x) => x.ok).length,
      track2Count: summary.track2.filter((x) => x.ok).length,
      failedCount: [...summary.track1, ...summary.track2].filter((x) => !x.ok)
        .length,
      errorCount: summary.errors.length,
    },
    saved: rowsToAppend.length,
    ...summary,
  });
}

/**
 * GET — dry-run (글 생성 X). 어떤 키워드 5+5가 픽될지 미리보기.
 */
export async function GET() {
  const isDev = process.env.NODE_ENV !== "production";
  if (!isDev) {
    return NextResponse.json(
      { error: "GET dry-run is only available in dev" },
      { status: 405 },
    );
  }
  try {
    const all = await getActiveKeywords();
    const track1Preview = pickKeywordsForToday(
      all.filter((k) => k.source !== "auto"),
      5,
    );
    return NextResponse.json({
      mode: "dry-run",
      track1Preview: track1Preview.map((k) => ({
        keyword: k.keyword,
        category: k.category,
        priority: k.priority || "normal",
        usedCount: parseInt(k.used_count || "0", 10),
        searchVolume: parseInt(k.search_volume || "0", 10),
      })),
      track2Note:
        "Track2(AI 발굴)은 실제 호출 시에만 동작. POST /api/cron/generate 또는 /api/keywords/discover로 단독 테스트.",
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
