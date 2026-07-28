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
    email?: unknown;
  };
  if (typeof body.refresh_token !== "string" || !body.refresh_token) {
    return NextResponse.json({ error: "refresh_token 필요" }, { status: 400 });
  }

  // ⚠️ 오너 계정만 저장한다 (2026-07-28 실사고).
  //    이 토큰은 GA 조회와 "테넌트 시트 발급(오너 소유 Drive 파일 생성)"에
  //    함께 쓰이는 단일 공용 토큰이다. 게이트가 없던 동안 멤버가 로그인하자
  //    멤버 토큰이 오너 것을 덮어써 GA 6개 속성이 전부 403이 됐고, 그 상태로
  //    시트를 발급했다면 멤버 계정 소유 파일이 만들어질 뻔했다.
  //    auth.ts(edge)는 시트를 못 읽으므로 판정은 여기(node)에서 한다.
  const email = typeof body.email === "string" ? body.email : "";
  if (!email) {
    return NextResponse.json({ error: "email 필요" }, { status: 400 });
  }
  const { isAdminEmail } = await import("@/lib/tenants");
  let isOwner: boolean;
  try {
    isOwner = await isAdminEmail(email);
  } catch (e) {
    // 판정 실패를 "오너 아님"으로 흘리면, 오너가 복구하려고 재로그인해도
    // 조용히 저장이 안 된 채 넘어간다 — 500으로 올려 auth.ts가 로그를 남기게 한다.
    console.error(
      "[persist-ga-token] 오너 판정 실패:",
      e instanceof Error ? e.message : String(e),
    );
    return NextResponse.json({ error: "오너 판정 실패" }, { status: 500 });
  }
  if (!isOwner) {
    // 멤버 로그인은 정상 흐름이므로 200으로 조용히 건너뛴다 (로그인 실패 아님)
    return NextResponse.json({ ok: true, skipped: "not-owner" });
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
