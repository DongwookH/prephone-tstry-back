import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  knowledgeStatus,
  getGlobalContext,
  getCategoryContext,
} from "@/lib/knowledge";

/**
 * GET /api/knowledge/status
 *   → KB 파일 목록 + 글로벌 컨텍스트 길이
 *
 * GET /api/knowledge/status?category=개통핵심
 *   → 카테고리별 컨텍스트 길이 + 내용 일부 미리보기
 *
 * dev 모드 인증 우회.
 */
export async function GET(req: Request) {
  const isDev = process.env.NODE_ENV !== "production";
  const session = await auth();
  if (!session?.user && !isDev) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = knowledgeStatus();
  const url = new URL(req.url);
  const category = url.searchParams.get("category");

  const globalCtx = getGlobalContext();
  const catCtx = category ? getCategoryContext(category) : "";

  return NextResponse.json({
    ...status,
    globalContextLength: globalCtx.length,
    globalContextPreview: globalCtx.slice(0, 300) + "…",
    categoryContext: category
      ? {
          category,
          length: catCtx.length,
          preview: catCtx.slice(0, 300) + "…",
        }
      : null,
  });
}
