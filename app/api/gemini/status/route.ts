import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { geminiKeyStatus, generateText } from "@/lib/gemini";

/**
 * GET /api/gemini/status
 *   → 등록된 키 개수와 마스킹된 미리보기 반환 (실제 호출 안 함)
 *
 * GET /api/gemini/status?test=1
 *   → 첫 번째 정상 키로 짧은 핑 테스트 호출
 *
 * 로그인 필요. 운영자만 접근 가능.
 */
export async function GET(req: Request) {
  const isDev = process.env.NODE_ENV !== "production";
  const session = await auth();
  if (!session?.user && !isDev) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = geminiKeyStatus();
  const url = new URL(req.url);
  const shouldTest = url.searchParams.get("test") === "1";

  if (!shouldTest) {
    return NextResponse.json(status);
  }

  // 실제 호출 테스트
  try {
    const reply = await generateText(
      "한 단어로만 답하세요: 안녕",
      { generationConfig: { maxOutputTokens: 16 } },
    );
    return NextResponse.json({
      ...status,
      test: { ok: true, reply: reply.trim() },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ...status,
        test: {
          ok: false,
          error: (err as Error).message,
        },
      },
      { status: 500 },
    );
  }
}
