import { NextResponse } from "next/server";
import { getAllPosts } from "@/lib/sheets";

export const maxDuration = 30;

/**
 * GET /api/cron/posts-today
 *
 * 오늘(KST) 생성된 글 중 썸네일 메타(image_urls에 JSON 저장됨)가 있는 글 목록 반환.
 * thumbnails 워크플로우 job이 호출 → Python으로 PNG 생성.
 *
 * 응답: { posts: [{ id, thumbnail: {...} }] }
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const todayKST = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .replace(/-/g, "");

  const all = await getAllPosts().catch(() => []);
  const todayPosts = all.filter((p) => p.id?.startsWith(`p-${todayKST}`));

  // 오늘 저장된 모든 글의 키워드 (fill-missing 잡이 plan과 비교해 누락 판단)
  const keywords = todayPosts.map((p) => p.keyword).filter(Boolean);

  // 썸네일 메타 있는 글 (thumbnails 잡이 PNG 생성)
  const posts = todayPosts
    .filter((p) => p.image_urls?.trim())
    .map((p) => {
      let thumbnail: unknown = null;
      try {
        thumbnail = JSON.parse(p.image_urls);
      } catch {
        thumbnail = null;
      }
      return { id: p.id, keyword: p.keyword, thumbnail };
    })
    .filter((p) => p.thumbnail);

  return NextResponse.json({
    ok: true,
    todayKST,
    count: posts.length,
    posts,
    keywords,
  });
}
