import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { generatePost } from "@/lib/post-generator";

/**
 * GET /api/posts/preview?keyword=선불폰개통방법&category=개통핵심&persona=IT
 *
 * 글을 생성하고 HTML 페이지(content_html을 그대로 보여주는)를 반환.
 * 브라우저에서 바로 미리보기 가능.
 *
 * dev 모드 인증 우회.
 */
export async function GET(req: Request) {
  const isDev = process.env.NODE_ENV !== "production";
  const session = await auth();
  if (!session?.user && !isDev) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const keyword = url.searchParams.get("keyword") || "";
  if (!keyword) {
    return new NextResponse("keyword query param required", { status: 400 });
  }
  const category = url.searchParams.get("category") || "일반";
  const persona = url.searchParams.get("persona") || "일반";
  const subKeywords = (url.searchParams.get("subKeywords") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const t0 = Date.now();
  let post;
  try {
    post = await generatePost({ keyword, category, persona, subKeywords });
  } catch (err) {
    return new NextResponse(
      `<h1>생성 실패</h1><pre>${(err as Error).message}</pre>`,
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
  const duration = Date.now() - t0;

  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${post.title}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
<style>
  * { box-sizing: border-box; }
  html, body {
    font-family: "Pretendard Variable", Pretendard, -apple-system, system-ui, sans-serif;
    letter-spacing: -0.01em;
    color: #191F28;
    background: #F9FAFB;
    margin: 0;
  }
  .container {
    max-width: 760px;
    margin: 0 auto;
    padding: 32px 20px;
  }
  details > summary { list-style: none; }
  details > summary::-webkit-details-marker { display: none; }
  /* details 열림/닫힘 마이너스 → 플러스 */
  details:not([open]) summary span:last-child::after { content: "+"; }
  details[open] summary span:last-child::after { content: "−"; }
  details:not([open]) summary span:last-child { font-size: 0 !important; }
  details:not([open]) summary span:last-child::after { font-size: 24px; color: #8B95A1; }
  .meta-bar {
    position: sticky;
    top: 0;
    background: rgba(255,255,255,0.85);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid #E5E8EB;
    padding: 12px 20px;
    z-index: 100;
    font-size: 12px;
    color: #4E5968;
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    align-items: center;
  }
  .meta-bar strong { color: #191F28; }
  .meta-bar .score {
    background: #3182F6;
    color: white;
    padding: 4px 8px;
    border-radius: 6px;
    font-weight: 700;
  }
</style>
</head>
<body>
<div class="meta-bar">
  <span>키워드: <strong>${keyword}</strong></span>
  <span>·</span>
  <span>카테고리: <strong>${category}</strong></span>
  <span>·</span>
  <span>페르소나: <strong>${persona}</strong></span>
  <span>·</span>
  <span>글자수: <strong>${post.char_count.toLocaleString()}</strong></span>
  <span>·</span>
  <span class="score">SEO ${post.seo_score}</span>
  <span>·</span>
  <span>생성: ${(duration / 1000).toFixed(1)}초</span>
  <span>·</span>
  <span>제목: <strong>${post.title}</strong></span>
</div>
<div class="container">
${post.content_html}
</div>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
