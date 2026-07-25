import { NextResponse } from "next/server";
import { isEmailAllowed } from "@/lib/tenants";

export const maxDuration = 15;

/**
 * POST /api/cron/allowlist-check
 *
 * 로그인 허용 여부 조회 (auth.ts signIn 콜백이 위임 호출).
 * 허용 = tenants 탭 status=active ∪ env ALLOWED_EMAILS.
 *
 * 왜 별도 라우트인가: persist-ga-token과 동일 — auth.ts는 middleware(edge)에
 * 번들되므로 googleapis(sheets)를 import할 수 없다. fetch 위임만 가능.
 *
 * 인증: Bearer CRON_SECRET (내부 위임 호출 전용 — 이메일 존재 여부가
 * 외부에 노출되면 안 되므로 반드시 시크릿 검증).
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { email?: unknown };
  if (typeof body.email !== "string" || !body.email) {
    return NextResponse.json({ error: "email 필요" }, { status: 400 });
  }

  try {
    const allowed = await isEmailAllowed(body.email);
    return NextResponse.json({ ok: true, allowed });
  } catch (e) {
    console.error(
      "[allowlist-check] 조회 실패:",
      e instanceof Error ? e.message : String(e),
    );
    // 조회 실패는 500 — auth.ts가 env 폴백으로 처리한다
    return NextResponse.json({ error: "조회 실패" }, { status: 500 });
  }
}
