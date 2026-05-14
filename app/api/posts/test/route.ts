import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { generatePost } from "@/lib/post-generator";

/**
 * POST /api/posts/test
 *   body: { keyword, category?, subKeywords?, persona? }
 *
 * 또는 GET ?keyword=...&category=...&persona=...
 *
 * 시트에 저장 X — 단일 글 생성 + 결과 즉시 반환 (디버그용).
 * dev 모드 인증 우회.
 */

async function generateOne(req: Request, body: Record<string, unknown>) {
  const t0 = Date.now();
  const keyword = String(body.keyword || "").trim();
  if (!keyword) {
    return NextResponse.json(
      { error: "keyword 파라미터가 필요합니다" },
      { status: 400 },
    );
  }
  const category = body.category ? String(body.category) : "일반";
  const persona = body.persona ? String(body.persona) : "일반";
  const subKeywords = Array.isArray(body.subKeywords)
    ? (body.subKeywords as string[])
    : [];

  try {
    const post = await generatePost({ keyword, category, persona, subKeywords });
    const url = new URL(req.url);
    const previewUrl = `${url.origin}/api/posts/preview?id=last`;

    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - t0,
      previewUrl: `${url.origin}/api/posts/preview?html=${encodeURIComponent(
        post.content_html,
      ).slice(0, 50)}…`,
      keyword,
      category,
      persona,
      post,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        durationMs: Date.now() - t0,
        error: (err as Error).message,
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const isDev = process.env.NODE_ENV !== "production";
  const session = await auth();
  if (!session?.user && !isDev) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return generateOne(req, body);
}

export async function GET(req: Request) {
  const isDev = process.env.NODE_ENV !== "production";
  const session = await auth();
  if (!session?.user && !isDev) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const body: Record<string, unknown> = {
    keyword: url.searchParams.get("keyword") || "",
    category: url.searchParams.get("category") || undefined,
    persona: url.searchParams.get("persona") || undefined,
  };
  const sub = url.searchParams.get("subKeywords");
  if (sub) body.subKeywords = sub.split(",").map((s) => s.trim()).filter(Boolean);
  return generateOne(req, body);
}
