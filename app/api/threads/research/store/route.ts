import { NextResponse } from "next/server";
import { appendResearchPosts, type ResearchPost } from "@/lib/sheets";

export const maxDuration = 30; // 저장만 (Gemini 호출 없음)

/**
 * POST /api/threads/research/store
 *
 * Mac 스크래퍼가 매일 06:00 수집한 Threads 인기글을 시트에 "축적만" 한다.
 * (초안 생성은 하지 않음 — 주간 24개 자동 생성이 이 축적분을 참고자료로 사용)
 *
 * 인증: Authorization: Bearer <CRON_SECRET>
 *
 * body:
 * {
 *   items: [
 *     { keyword: "선불폰", posts: ScrapedPost[] },
 *     ...
 *   ]
 * }
 *
 * 응답: { ok: true, stored, skipped }
 *   - stored/skipped는 모든 item 합산 (중복 방지로 skip된 수 포함)
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    items?: { keyword: string; posts: ResearchPost[] }[];
  };

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return NextResponse.json(
      { ok: false, error: "items가 비어있습니다 (수집된 인기글 없음)" },
      { status: 400 },
    );
  }

  // 스크래퍼 실행 시각을 모든 item에 동일 적용 (같은 배치는 같은 scraped_at)
  const scrapedAtIso = new Date().toISOString();

  let stored = 0;
  let skipped = 0;
  const perKeyword: {
    keyword: string;
    stored: number;
    skipped: number;
    error?: string;
  }[] = [];

  for (const item of items) {
    const keyword = (item.keyword || "").trim();
    const posts = Array.isArray(item.posts) ? item.posts : [];
    if (!keyword) {
      perKeyword.push({
        keyword: "(빈 키워드)",
        stored: 0,
        skipped: posts.length,
        error: "keyword 없음",
      });
      skipped += posts.length;
      continue;
    }
    try {
      const res = await appendResearchPosts(keyword, posts, scrapedAtIso);
      stored += res.stored;
      skipped += res.skipped;
      perKeyword.push({ keyword, stored: res.stored, skipped: res.skipped });
    } catch (err) {
      perKeyword.push({
        keyword,
        stored: 0,
        skipped: 0,
        error: (err as Error).message.slice(0, 200),
      });
    }
  }

  return NextResponse.json({ ok: true, stored, skipped, keywords: perKeyword });
}
