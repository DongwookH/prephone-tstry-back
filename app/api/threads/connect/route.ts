import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildAuthorizeUrl } from "@/lib/threads";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

/**
 * GET /api/threads/connect
 *
 * 백오피스 사용자가 클릭 → Threads OAuth 인증 페이지로 리다이렉트.
 * state 쿠키에 저장 → 콜백에서 CSRF 검증.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
  }
  if (!process.env.THREADS_APP_ID || !process.env.THREADS_REDIRECT_URI) {
    return NextResponse.json(
      { error: "THREADS_APP_ID / THREADS_REDIRECT_URI env 미설정" },
      { status: 500 },
    );
  }

  const state = randomBytes(16).toString("hex");
  const url = buildAuthorizeUrl(state);

  const res = NextResponse.redirect(url);
  // 10분 유효 httpOnly 쿠키
  res.cookies.set("threads_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
