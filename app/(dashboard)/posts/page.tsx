import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { PostRow, PostRowHeader, EmptyPostsState } from "@/components/post-row";
import { getAllPosts, type PostRow as PostRowType } from "@/lib/sheets";
import { Plus, Search, SlidersHorizontal, ChevronDown } from "lucide-react";

export const revalidate = 60;

type FilterStatus = "all" | "ready" | "published" | "failed";

// Next.js 16: searchParams는 Promise
type PageProps = {
  searchParams: Promise<{
    page?: string;
    status?: string;
    q?: string;
  }>;
};

export default async function PostsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const currentPage = Math.max(1, parseInt(sp.page || "1", 10) || 1);
  const status: FilterStatus =
    sp.status === "ready" ||
    sp.status === "published" ||
    sp.status === "failed"
      ? sp.status
      : "all";
  const q = (sp.q || "").trim().toLowerCase();

  const all = await getAllPosts();

  // ── 통계 (필터 무관) ──
  const total = all.length;
  const published = all.filter((p) => p.status === "published").length;
  const ready = all.filter((p) => p.status === "ready").length;
  const failed = all.filter((p) => p.status === "failed").length;
  const seoScores = all
    .map((p) => parseInt(p.seo_score || "0", 10))
    .filter((s) => s > 0);
  const avgSeo =
    seoScores.length > 0
      ? Math.round(
          (seoScores.reduce((a, b) => a + b, 0) / seoScores.length) * 10,
        ) / 10
      : 0;

  // ── 필터 + 검색 + 정렬 ──
  let filtered: PostRowType[] = all;
  if (status !== "all") {
    filtered = filtered.filter((p) => p.status === status);
  }
  if (q) {
    filtered = filtered.filter(
      (p) =>
        p.title?.toLowerCase().includes(q) ||
        p.keyword?.toLowerCase().includes(q) ||
        p.category?.toLowerCase().includes(q),
    );
  }
  const sorted = filtered.sort((a, b) => {
    const ta = new Date(a.created_at).getTime() || 0;
    const tb = new Date(b.created_at).getTime() || 0;
    return tb - ta;
  });

  // ── 페이지네이션 ──
  const PAGE_SIZE = 15;
  const filteredCount = sorted.length;
  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const visible = sorted.slice(startIdx, startIdx + PAGE_SIZE);

  function buildHref(opts: { page?: number; status?: FilterStatus; q?: string }) {
    const params = new URLSearchParams();
    const p = opts.page ?? safePage;
    const s = opts.status ?? status;
    const query = opts.q ?? q;
    if (p > 1) params.set("page", String(p));
    if (s !== "all") params.set("status", s);
    if (query) params.set("q", query);
    const qs = params.toString();
    return qs ? `/posts?${qs}` : "/posts";
  }

  // 페이지 번호 windowing (최대 5개 + 첫/끝)
  const pageNumbers = paginationWindow(safePage, totalPages, 5);

  return (
    <>
      <Topbar
        crumbs={[{ label: "워크스페이스" }, { label: "글 목록", bold: true }]}
        right={
          <button className="h-9 px-4 rounded-xl bg-ink-900 hover:bg-ink-800 transition text-white text-[13px] font-bold flex items-center gap-1.5">
            <Plus size={13} strokeWidth={2.4} />
            새 글 만들기
          </button>
        }
      />
      <div className="px-8 py-8 max-w-[1400px] mx-auto">
        <section className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-mint-500 opacity-60"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-mint-500"></span>
            </span>
            <span className="text-[12px] font-bold text-mint-700">
              Google Sheet 실시간 연동
            </span>
          </div>
          <h1 className="text-[28px] font-extrabold text-ink-900 tracking-tight">
            전체 글
          </h1>
          <p className="mt-1 text-[14px] text-ink-600">
            {total > 0
              ? "지금까지 자동 생성된 모든 글을 확인하고 관리할 수 있어요."
              : "아직 자동 생성된 글이 없습니다. 매일 KST 09:00에 자동 추가됩니다."}
          </p>
        </section>

        <section className="grid grid-cols-4 gap-3 mb-6">
          <SmallStat label="전체 글" value={`${total}`} />
          <SmallStat
            label="발행 완료"
            value={`${published}`}
            sub={total > 0 ? `${Math.round((published / total) * 100)}% 발행률` : undefined}
            tone="mint"
          />
          <SmallStat label="발행 대기" value={`${ready}`} tone="amber" />
          <SmallStat
            label="평균 SEO 점수"
            value={avgSeo > 0 ? `${avgSeo}` : "-"}
            sub={failed > 0 ? `실패 ${failed}건` : undefined}
          />
        </section>

        <section className="bg-white rounded-2xl shadow-card p-4 mb-4">
          {/* GET form — 검색은 페이지 리로드로 ?q= 적용 */}
          <form
            action="/posts"
            method="GET"
            className="flex items-center gap-3 flex-wrap"
          >
            <div className="flex items-center gap-2 h-10 px-3 rounded-xl bg-ink-50 flex-1 min-w-[280px]">
              <Search size={16} className="text-ink-500" />
              <input
                type="text"
                name="q"
                defaultValue={q}
                placeholder="제목, 키워드, 카테고리로 검색"
                className="flex-1 bg-transparent outline-none text-[13px] font-medium placeholder-ink-400"
              />
              {q && (
                <Link
                  href={buildHref({ q: "", page: 1 })}
                  className="text-[11px] font-bold text-ink-500 hover:text-rose-600"
                >
                  ✕ 초기화
                </Link>
              )}
            </div>
            {/* 필터 상태가 검색 시에도 유지되도록 hidden input */}
            {status !== "all" && (
              <input type="hidden" name="status" value={status} />
            )}

            <div className="flex items-center gap-1 p-1 rounded-xl bg-ink-100">
              <FilterTab
                label="전체"
                count={total}
                active={status === "all"}
                href={buildHref({ status: "all", page: 1 })}
              />
              <FilterTab
                label="대기"
                count={ready}
                active={status === "ready"}
                href={buildHref({ status: "ready", page: 1 })}
              />
              <FilterTab
                label="완료"
                count={published}
                active={status === "published"}
                href={buildHref({ status: "published", page: 1 })}
              />
              {failed > 0 && (
                <FilterTab
                  label="실패"
                  count={failed}
                  active={status === "failed"}
                  href={buildHref({ status: "failed", page: 1 })}
                />
              )}
            </div>
            <button
              type="button"
              className="h-10 px-3 rounded-xl text-[13px] font-semibold text-ink-700 hover:bg-ink-100 transition flex items-center gap-1.5"
            >
              <SlidersHorizontal size={14} />
              필터
            </button>
            <button
              type="button"
              className="h-10 px-3 rounded-xl text-[13px] font-semibold text-ink-700 hover:bg-ink-100 transition flex items-center gap-1.5"
            >
              <ChevronDown size={14} />
              최신순
            </button>
          </form>
        </section>

        <section className="bg-white rounded-2xl shadow-card overflow-hidden">
          {visible.length > 0 ? (
            <>
              <PostRowHeader />
              <div className="divide-y divide-ink-100">
                {visible.map((p) => (
                  <PostRow key={p.id} post={p} />
                ))}
              </div>
              <div className="px-5 py-4 border-t border-ink-100 bg-ink-50/40 flex items-center justify-between flex-wrap gap-3">
                <span className="text-[13px] text-ink-500 font-medium">
                  <span className="font-bold text-ink-800">
                    {startIdx + 1}-{startIdx + visible.length}
                  </span>{" "}
                  / {filteredCount}개
                  {filteredCount !== total && (
                    <span className="ml-2 text-ink-400">
                      (전체 {total}개 중 필터링)
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-1">
                  <PageLink
                    href={buildHref({ page: safePage - 1 })}
                    disabled={safePage <= 1}
                  >
                    ‹
                  </PageLink>
                  {pageNumbers[0] > 1 && (
                    <>
                      <PageLink href={buildHref({ page: 1 })}>1</PageLink>
                      {pageNumbers[0] > 2 && (
                        <span className="px-1 text-ink-400 text-[13px]">…</span>
                      )}
                    </>
                  )}
                  {pageNumbers.map((n) => (
                    <PageLink
                      key={n}
                      href={buildHref({ page: n })}
                      active={n === safePage}
                    >
                      {n}
                    </PageLink>
                  ))}
                  {pageNumbers[pageNumbers.length - 1] < totalPages && (
                    <>
                      {pageNumbers[pageNumbers.length - 1] < totalPages - 1 && (
                        <span className="px-1 text-ink-400 text-[13px]">…</span>
                      )}
                      <PageLink href={buildHref({ page: totalPages })}>
                        {totalPages}
                      </PageLink>
                    </>
                  )}
                  <PageLink
                    href={buildHref({ page: safePage + 1 })}
                    disabled={safePage >= totalPages}
                  >
                    ›
                  </PageLink>
                </div>
              </div>
            </>
          ) : (
            <EmptyPostsState
              message={
                q || status !== "all"
                  ? "검색 결과가 없습니다"
                  : "아직 생성된 글이 없습니다"
              }
              hint={
                q || status !== "all"
                  ? "다른 키워드로 검색하거나 필터를 초기화해보세요."
                  : "매일 KST 09:00에 자동으로 10편이 생성됩니다."
              }
            />
          )}
        </section>
      </div>
    </>
  );
}

/** 현재 페이지를 중심으로 window 개수만큼 페이지 번호 반환 */
function paginationWindow(
  current: number,
  total: number,
  windowSize: number,
): number[] {
  if (total <= windowSize) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const half = Math.floor(windowSize / 2);
  let start = Math.max(1, current - half);
  const end = Math.min(total, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

function FilterTab({
  label,
  count,
  active,
  href,
}: {
  label: string;
  count: number;
  active: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "px-3 h-8 rounded-lg bg-white shadow-card text-[12px] font-bold text-ink-900 flex items-center"
          : "px-3 h-8 rounded-lg text-[12px] font-semibold text-ink-600 hover:text-ink-900 transition flex items-center"
      }
    >
      {label} {count}
    </Link>
  );
}

function PageLink({
  href,
  children,
  active,
  disabled,
}: {
  href: string;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <span className="w-9 h-9 rounded-lg text-[13px] font-bold text-ink-300 flex items-center justify-center cursor-not-allowed select-none">
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={
        active
          ? "w-9 h-9 rounded-lg bg-brand-500 text-white text-[13px] font-bold flex items-center justify-center"
          : "w-9 h-9 rounded-lg hover:bg-ink-100 transition text-[13px] font-bold text-ink-700 flex items-center justify-center"
      }
    >
      {children}
    </Link>
  );
}

function SmallStat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "mint" | "amber";
}) {
  const valueClass =
    tone === "mint"
      ? "text-mint-700"
      : tone === "amber"
        ? "text-amber-700"
        : "text-ink-900";
  return (
    <div className="bg-white rounded-2xl shadow-card p-5">
      <div className="text-[11px] font-bold text-ink-500 tracking-wider mb-2">
        {label}
      </div>
      <div className={`text-[24px] font-extrabold ${valueClass}`}>{value}</div>
      {sub && (
        <div className="text-[11px] font-bold text-mint-700 mt-0.5">{sub}</div>
      )}
    </div>
  );
}
