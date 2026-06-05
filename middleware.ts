import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // 보호되지 않는 경로
  // ⚠️ /api/cron/* 는 production에서도 Bearer 토큰 자체 인증이므로 통과
  //    (OAuth 미들웨어가 막으면 GitHub Actions cron이 307 redirect로 실패)
  // ⚠️ /api/threads/callback, /deauthorize, /data-deletion 은 Meta가 직접 호출하므로 통과
  //    (/connect 는 사용자가 백오피스에서 클릭하므로 로그인 필요 — 별도 처리 X, 라우트 안에서 auth)
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/cron") ||
    pathname.startsWith("/api/threads/callback") ||
    pathname.startsWith("/api/threads/deauthorize") ||
    pathname.startsWith("/api/threads/data-deletion") ||
    pathname.startsWith("/api/threads/research/ingest") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon");

  // dev 모드에서만 헬스체크/디버그 엔드포인트 노출
  const isDevHealthcheck =
    process.env.NODE_ENV !== "production" &&
    (pathname.startsWith("/api/gemini/status") ||
      pathname.startsWith("/api/sheets/health") ||
      pathname.startsWith("/api/keywords/discover") ||
      pathname.startsWith("/api/naver/keyword") ||
      pathname.startsWith("/api/posts/test") ||
      pathname.startsWith("/api/posts/preview") ||
      pathname.startsWith("/api/knowledge/status") ||
      pathname.startsWith("/api/cron/generate")); // GET dry-run 용도

  if (isPublic || isDevHealthcheck) return NextResponse.next();

  // 로그인되지 않은 경우 /login으로 리다이렉트
  if (!req.auth) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public).*)"],
};
