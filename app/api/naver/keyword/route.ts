import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  fetchKeywordVolumes,
  fetchRelatedKeywords,
  naverAdKeyStatus,
  isNaverAdConfigured,
} from "@/lib/naver-keyword";

/**
 * GET /api/naver/keyword
 *   → 키 등록 상태만 (마스킹)
 *
 * GET /api/naver/keyword?q=선불폰,KT,LG U+
 *   → 입력 키워드의 PC/Mobile 월간 검색량 + 경쟁도
 *
 * GET /api/naver/keyword?q=선불폰&related=1&limit=20
 *   → 시드 키워드 1개로 연관 키워드까지 (검색량 높은 순)
 *
 * dev 모드는 인증 우회.
 */
export async function GET(req: Request) {
  const isDev = process.env.NODE_ENV !== "production";
  const session = await auth();
  if (!session?.user && !isDev) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  const related = url.searchParams.get("related") === "1";
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "30", 10), 1),
    100,
  );

  // 키 상태만 보고 싶을 때
  if (!q) {
    return NextResponse.json(naverAdKeyStatus());
  }

  if (!isNaverAdConfigured()) {
    return NextResponse.json(
      {
        error:
          "NAVER_AD_CUSTOMER_ID / NAVER_AD_API_KEY / NAVER_AD_SECRET_KEY 가 .env.local에 필요합니다.",
        status: naverAdKeyStatus(),
      },
      { status: 400 },
    );
  }

  const t0 = Date.now();
  try {
    const keywords = q
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (related) {
      // 첫 번째 키워드로 연관 검색어 가져오기
      const rows = await fetchRelatedKeywords(keywords[0], limit);
      return NextResponse.json({
        ok: true,
        durationMs: Date.now() - t0,
        seed: keywords[0],
        count: rows.length,
        keywords: rows,
      });
    }

    const rows = await fetchKeywordVolumes(keywords);
    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - t0,
      input: keywords,
      count: rows.length,
      keywords: rows,
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
