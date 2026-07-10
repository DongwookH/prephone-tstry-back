import { NextResponse } from "next/server";
import { saveGaRefreshToken } from "@/lib/ga-token";

export const maxDuration = 15;

/**
 * POST /api/cron/persist-ga-token
 *
 * GA OAuth refresh token을 settings 시트에 저장 (auth.ts 로그인 콜백이 위임 호출).
 *
 * 왜 별도 라우트인가: middleware(edge)가 auth.ts를 번들하는데, sheets(googleapis)는
 * node 전용 모듈이라 edge 번들에 올릴 수 없다 — dynamic import조차 Vercel Edge
 * 패키징이 거부함(2026-07-10 배포 실패로 확인). 그래서 auth.ts는 fetch만 하고,
 * 실제 시트 쓰기는 이 node 라우트가 담당한다.
 *
 * 인증: 다른 cron 라우트와 동일한 Bearer CRON_SECRET (내부 위임 호출 전용).
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    refresh_token?: unknown;
  };
  if (typeof body.refresh_token !== "string" || !body.refresh_token) {
    return NextResponse.json({ error: "refresh_token 필요" }, { status: 400 });
  }

  try {
    await saveGaRefreshToken(body.refresh_token);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(
      "[persist-ga-token] 저장 실패:",
      e instanceof Error ? e.message : String(e),
    );
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}
