import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { discoverKeywords } from "@/lib/keyword-discovery";

/**
 * GET /api/keywords/discover?count=5&exclude=a,b,c
 *  - Gemini Search Grounding으로 키워드 N개 발굴 (실제 호출, 시트 변경 X)
 *  - dev 모드는 인증 우회
 */
export async function GET(req: Request) {
  const isDev = process.env.NODE_ENV !== "production";
  const session = await auth();
  if (!session?.user && !isDev) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const count = Math.min(
    Math.max(parseInt(url.searchParams.get("count") ?? "5", 10), 1),
    10,
  );
  const exclude = (url.searchParams.get("exclude") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const t0 = Date.now();
  try {
    const keywords = await discoverKeywords({
      count,
      excludeKeywords: exclude,
    });
    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - t0,
      count: keywords.length,
      keywords,
    });
  } catch (err) {
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
