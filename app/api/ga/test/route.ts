import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getOverview,
  getDailyTrend,
  getTopPages,
  getChannels,
  GA4Error,
} from "@/lib/ga4";

export const dynamic = "force-dynamic";

/**
 * GET /api/ga/test
 *
 * GA4 OAuth 연결 헬스체크.
 * 로그인된 사용자의 access token으로 7일 기준 KPI/추이/TOP페이지/채널을 조회.
 *
 * 요구사항:
 *   - 로그인 + analytics.readonly scope 동의 (auth.ts에서 자동)
 *   - GA_PROPERTY_ID env 등록
 *   - GA4 속성에 본인 계정이 "조회자" 이상 권한 (티스토리 자동 생성 속성은 본인이 소유자)
 */
export async function GET() {
  const session = await auth();

  if (!session) {
    return NextResponse.json(
      { ok: false, error: "로그인 필요" },
      { status: 401 },
    );
  }
  if (session.error === "RefreshAccessTokenError") {
    return NextResponse.json(
      {
        ok: false,
        error: "refresh token 만료/취소 — 로그아웃 후 재로그인 필요",
      },
      { status: 401 },
    );
  }
  const accessToken = session.accessToken;
  if (!accessToken) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "access token 없음 — 로그아웃 후 재로그인 (analytics scope 동의 필요)",
      },
      { status: 401 },
    );
  }
  if (!process.env.GA_PROPERTY_ID) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "GA_PROPERTY_ID env 미설정 — GA4 관리 > 속성 설정 > 속성 ID 등록",
      },
      { status: 500 },
    );
  }

  const t0 = Date.now();
  try {
    const [overview, daily, topPages, channels] = await Promise.all([
      getOverview(accessToken, 7),
      getDailyTrend(accessToken, 7),
      getTopPages(accessToken, 7, 10),
      getChannels(accessToken, 7),
    ]);

    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - t0,
      propertyId: process.env.GA_PROPERTY_ID,
      user: session.user?.email,
      overview,
      daily,
      topPages,
      channels,
    });
  } catch (err) {
    if (err instanceof GA4Error) {
      return NextResponse.json(
        {
          ok: false,
          durationMs: Date.now() - t0,
          error: err.message,
          status: err.status,
        },
        { status: err.status >= 400 && err.status < 600 ? err.status : 500 },
      );
    }
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
