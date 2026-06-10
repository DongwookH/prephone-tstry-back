import { NextResponse } from "next/server";
import {
  generateThreadsDraftsFromPosts,
  engagementScore,
  type ScrapedPost,
} from "@/lib/threads-research";
import { appendThreadsDraft } from "@/lib/sheets";

export const maxDuration = 300; // 5분 (여러 키워드 × Gemini)

/**
 * POST /api/threads/research/ingest
 *
 * GHA Playwright 스크레이퍼가 수집한 인기글을 받아
 * Gemini로 초안 생성 → threads_drafts 시트 저장.
 *
 * 인증: Authorization: Bearer <CRON_SECRET>
 *
 * body:
 * {
 *   items: [
 *     { keyword: "선불폰", posts: ScrapedPost[] },
 *     ...
 *   ],
 *   draftsPerKeyword?: number  // 기본 2
 * }
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    items?: { keyword: string; posts: ScrapedPost[] }[];
    draftsPerKeyword?: number;
  };

  const items = Array.isArray(body.items) ? body.items : [];
  const perKeyword = Math.max(1, Math.min(body.draftsPerKeyword ?? 2, 3));

  if (items.length === 0) {
    return NextResponse.json(
      { ok: false, error: "items가 비어있습니다 (수집된 인기글 없음)" },
      { status: 400 },
    );
  }

  let created = 0;
  const perKeywordResults: { keyword: string; drafts: number; error?: string }[] =
    [];

  for (const item of items) {
    const keyword = (item.keyword || "").trim();
    const posts = Array.isArray(item.posts) ? item.posts : [];
    if (!keyword || posts.length === 0) {
      perKeywordResults.push({
        keyword: keyword || "(빈 키워드)",
        drafts: 0,
        error: "posts 없음",
      });
      continue;
    }

    try {
      const drafts = await generateThreadsDraftsFromPosts({
        keyword,
        posts,
        count: perKeyword,
      });

      // 근거 인기글 — 점수순 상위 5개만 저장 (시트 용량 절약)
      const topSource = [...posts]
        .sort((a, b) => engagementScore(b) - engagementScore(a))
        .slice(0, 5);

      for (const d of drafts) {
        await appendThreadsDraft({
          keyword,
          draft_text: d.draft_text,
          insight: d.insight,
          source_posts: topSource,
          topic_tag: d.topic_tag,
          self_replies: d.self_replies,
        });
        created++;
      }
      perKeywordResults.push({ keyword, drafts: drafts.length });
    } catch (err) {
      perKeywordResults.push({
        keyword,
        drafts: 0,
        error: (err as Error).message.slice(0, 200),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    created,
    keywords: perKeywordResults,
  });
}
