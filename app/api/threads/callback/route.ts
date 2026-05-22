import { NextResponse } from "next/server";
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  saveThreadsToken,
} from "@/lib/threads";

export const dynamic = "force-dynamic";

/**
 * GET /api/threads/callback?code=...&state=...
 *
 * Meta Threads가 OAuth 인증 후 사용자를 이 URL로 리다이렉트.
 * 1) state CSRF 검증
 * 2) code → short-lived access_token 교환
 * 3) short → long-lived (60일) 토큰 교환
 * 4) settings 시트에 저장
 * 5) 백오피스 설정 페이지로 redirect (성공/실패 표시)
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorReason = url.searchParams.get("error_reason");

  const base =
    process.env.NEXTAUTH_URL ||
    "https://prephone-tstry-back.vercel.app";

  // 사용자가 동의 취소한 경우
  if (error) {
    return NextResponse.redirect(
      `${base}/settings?threads=denied&reason=${encodeURIComponent(errorReason || error)}`,
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(`${base}/settings?threads=missing-params`);
  }

  // state CSRF 검증
  const cookieState = req.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)threads_oauth_state=([^;]+)/)?.[1];
  if (!cookieState || cookieState !== state) {
    return NextResponse.redirect(`${base}/settings?threads=state-mismatch`);
  }

  try {
    // 1) short-lived 토큰 교환
    const { access_token: shortToken, user_id } = await exchangeCodeForToken(
      code,
    );

    // 2) long-lived (60일) 교환
    const longLived = await exchangeForLongLivedToken(shortToken);

    // 3) 시트 저장
    const now = Date.now();
    const expiresAt = new Date(
      now + longLived.expires_in * 1000,
    ).toISOString();
    await saveThreadsToken({
      user_id,
      access_token: longLived.access_token,
      expires_at: expiresAt,
      refreshed_at: new Date(now).toISOString(),
    });

    // 성공 — 설정 페이지로
    const res = NextResponse.redirect(`${base}/settings?threads=connected`);
    // state 쿠키 삭제
    res.cookies.delete("threads_oauth_state");
    return res;
  } catch (err) {
    const msg = (err as Error).message ?? "unknown";
    return NextResponse.redirect(
      `${base}/settings?threads=error&msg=${encodeURIComponent(msg.slice(0, 100))}`,
    );
  }
}
