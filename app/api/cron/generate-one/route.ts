import { NextResponse } from "next/server";
import { appendPosts, bumpKeywordsUsage } from "@/lib/sheets";
import { generatePost } from "@/lib/post-generator";

export const maxDuration = 60;

/**
 * POST /api/cron/generate-one
 *
 * 1편 생성 + posts 시트 저장 + used_count 갱신.
 * Vercel Hobby plan의 60초 한도 안에서 완료.
 *
 * 인증: Authorization: Bearer <CRON_SECRET>
 *
 * body:
 *   {
 *     track: 1 | 2,
 *     keyword: string,
 *     category: string,
 *     subKeywords?: string[],
 *     persona?: string,
 *     slot: number  // 1~10 (id 생성용)
 *   }
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    track?: 1 | 2;
    keyword?: string;
    category?: string;
    subKeywords?: string[];
    persona?: string;
    slot?: number;
  };

  if (!body.keyword) {
    return NextResponse.json(
      { error: "keyword가 필요합니다" },
      { status: 400 },
    );
  }

  const t0 = Date.now();
  try {
    const post = await generatePost({
      keyword: body.keyword,
      category: body.category || "일반",
      subKeywords: body.subKeywords || [],
      persona: body.persona || "일반",
    });

    const now = new Date().toISOString();
    const today = now.slice(0, 10).replace(/-/g, "");
    const slot = String(body.slot ?? 0).padStart(3, "0");
    const id = `p-${today}-${slot}`;

    await appendPosts([
      {
        id,
        title: post.title,
        keyword: body.keyword,
        category: body.category || "일반",
        persona: body.persona || "일반",
        content_md: "",
        content_html: post.content_html,
        char_count: post.char_count,
        seo_score: post.seo_score,
        status: "ready",
        utm_campaign: post.utm_campaign,
        created_at: now,
        updated_at: now,
      },
    ]);

    // Track 1만 used_count 갱신 (Track 2는 방금 추가된 거라 굳이 X)
    if (body.track === 1) {
      try {
        await bumpKeywordsUsage([body.keyword]);
      } catch (err) {
        console.warn("[generate-one] used_count 갱신 실패:", err);
      }
    }

    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - t0,
      id,
      title: post.title,
      charCount: post.char_count,
      seoScore: post.seo_score,
      keyword: body.keyword,
      track: body.track,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        durationMs: Date.now() - t0,
        keyword: body.keyword,
        error: (err as Error).message,
      },
      { status: 500 },
    );
  }
}
