import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getViewerContext } from "@/lib/tenant-context";
import { queryTop, pageTop, titleCandidates, getTotals, GSCError } from "@/lib/gsc";

export const dynamic = "force-dynamic";

/**
 * GET /api/gsc?days=28
 *  - Search Console 검색어/페이지 TOP + 제목 개선 후보 + 기간 합계
 *  - 오너 전용 (사이트 전체 검색 성과는 멤버에게 노출하지 않음)
 *  - 서비스 계정이 GSC 속성에 아직 추가되지 않았으면 {ok:false, error:'no_access'}
 *    (이건 서버 에러가 아니라 "설정 안내"가 필요한 정상 상태라 200으로 응답)
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const ctx = await getViewerContext();
  if (ctx && !ctx.isOwner) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const parsedDays = parseInt(url.searchParams.get("days") ?? "28", 10);
  const days = [7, 28, 90].includes(parsedDays) ? parsedDays : 28;

  try {
    const [queries, pages, candidates, totals] = await Promise.all([
      queryTop(days, 50),
      pageTop(days, 50),
      titleCandidates(days),
      getTotals(days),
    ]);
    return NextResponse.json({ ok: true, queries, pages, candidates, totals });
  } catch (err) {
    if (err instanceof GSCError && err.status === 403) {
      // 서비스 계정 미등록/권한 없음 — 안내 UI를 위한 정상 응답
      return NextResponse.json({ ok: false, error: "no_access" });
    }
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
