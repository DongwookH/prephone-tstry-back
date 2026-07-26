import { redirect } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { queryTop, pageTop, titleCandidates, getTotals, GSCError } from "@/lib/gsc";
import {
  SearchPerformanceLive,
  type SearchPerformancePayload,
} from "@/components/search-performance-live";
import { Search } from "lucide-react";
import { getViewerContext } from "@/lib/tenant-context";

// 매 요청 실시간 조회 (GSC 데이터는 일 단위 갱신이라 자동 폴링은 불필요 —
// 사용자가 수동 새로고침 버튼으로 갱신).
export const dynamic = "force-dynamic";

const DEFAULT_DAYS = 28;

async function loadInitial(days: number): Promise<SearchPerformancePayload> {
  try {
    const [queries, pages, candidates, totals] = await Promise.all([
      queryTop(days, 50),
      pageTop(days, 50),
      titleCandidates(days),
      getTotals(days),
    ]);
    return { ok: true, queries, pages, candidates, totals };
  } catch (err) {
    if (err instanceof GSCError && err.status === 403) {
      return {
        ok: false,
        error: "no_access",
        queries: [],
        pages: [],
        candidates: [],
        totals: { clicks: 0, impressions: 0 },
      };
    }
    return {
      ok: false,
      error: (err as Error).message,
      queries: [],
      pages: [],
      candidates: [],
      totals: { clicks: 0, impressions: 0 },
    };
  }
}

export default async function SearchPerformancePage() {
  // 오너 전용 페이지 — 멤버가 직접 URL로 접근하면 대시보드로 돌려보낸다.
  const ctx = await getViewerContext();
  if (ctx && !ctx.isOwner) redirect("/");

  const initial = await loadInitial(DEFAULT_DAYS);

  return (
    <>
      <Topbar
        crumbs={[
          { label: "워크스페이스" },
          { label: "검색 성과", bold: true },
        ]}
      />

      <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-[1400px] mx-auto space-y-5 sm:space-y-6 animate-fade-up">
        <section>
          <div className="flex items-center gap-2 mb-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-mint-500 opacity-60"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-mint-500"></span>
            </span>
            <span className="text-[12px] font-bold text-mint-700">
              Google Search Console 연동
            </span>
            <span className="text-[12px] text-ink-500">
              · ntelecomsafe.com
            </span>
          </div>
          <h1 className="text-[20px] sm:text-[28px] font-extrabold text-ink-900 tracking-tight flex items-center gap-2">
            <Search size={22} className="text-brand-600" />
            검색 성과
          </h1>
          <p className="mt-1 text-[13px] sm:text-[14px] text-ink-600">
            구글 검색에서 어떤 검색어로 유입되는지, 어떤 글이 노출되는지,
            그리고 어떤 글의 제목을 바꾸면 클릭이 늘어날지 확인하세요.
          </p>
        </section>

        <SearchPerformanceLive initial={initial} initialDays={DEFAULT_DAYS} />

        <section className="pt-4 pb-8 text-center">
          <p className="text-[12px] text-ink-400">
            데이터 출처: Google Search Console Search Analytics API (서비스
            계정 연동)
          </p>
        </section>
      </div>
    </>
  );
}
