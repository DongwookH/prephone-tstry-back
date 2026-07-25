import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getChatLogsSummary } from "@/lib/sheets";

/**
 * GET /api/chat-logs?limit=100
 *  - chat_logs 탭(챗봇 질문 로그)을 최신순으로 반환 — 읽기 전용
 *  - 각 row에 F열 answer(챗봇 답변, 마스킹·최대 1000자, 실패 시 빈 값) 포함
 *  - 로그인 필요 (미들웨어 + 라우트 이중 확인)
 *  - 탭이 아직 없거나 비어 있으면 rows: [] (에러 아님)
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = parseInt(url.searchParams.get("limit") ?? "100", 10);
  const limit = Math.min(Math.max(isNaN(parsed) ? 100 : parsed, 1), 500);

  try {
    const summary = await getChatLogsSummary(limit);
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
