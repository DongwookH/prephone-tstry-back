import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sheetsHealthCheck } from "@/lib/sheets";

/**
 * GET /api/sheets/health
 * - 서비스 계정으로 시트에 접근 가능한지, 시트 탭 목록 반환
 * - dev 모드는 인증 우회, prod는 로그인 필요
 */
export async function GET() {
  const isDev = process.env.NODE_ENV !== "production";
  const session = await auth();
  if (!session?.user && !isDev) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sheetsHealthCheck();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
