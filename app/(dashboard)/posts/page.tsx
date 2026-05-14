import { Topbar } from "@/components/topbar";
import { PostRow, PostRowHeader, EmptyPostsState } from "@/components/post-row";
import { getAllPosts } from "@/lib/sheets";
import { Plus, Search, SlidersHorizontal, ChevronDown } from "lucide-react";

export const revalidate = 60;

export default async function PostsPage() {
  const all = await getAllPosts();

  // 최신순 정렬
  const sorted = [...all].sort((a, b) => {
    const ta = new Date(a.created_at).getTime() || 0;
    const tb = new Date(b.created_at).getTime() || 0;
    return tb - ta;
  });

  // 통계
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

  // 페이지네이션 (1페이지에 15개)
  const PAGE_SIZE = 15;
  const visible = sorted.slice(0, PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 h-10 px-3 rounded-xl bg-ink-50 flex-1 min-w-[280px]">
              <Search size={16} className="text-ink-500" />
              <input
                type="text"
                placeholder="제목, 키워드로 검색"
                className="flex-1 bg-transparent outline-none text-[13px] font-medium placeholder-ink-400"
              />
            </div>
            <div className="flex items-center gap-1 p-1 rounded-xl bg-ink-100">
              <button className="px-3 h-8 rounded-lg bg-white shadow-card text-[12px] font-bold text-ink-900">
                전체 {total}
              </button>
              <button className="px-3 h-8 rounded-lg text-[12px] font-semibold text-ink-600 hover:text-ink-900 transition">
                대기 {ready}
              </button>
              <button className="px-3 h-8 rounded-lg text-[12px] font-semibold text-ink-600 hover:text-ink-900 transition">
                완료 {published}
              </button>
              {failed > 0 && (
                <button className="px-3 h-8 rounded-lg text-[12px] font-semibold text-ink-600 hover:text-ink-900 transition">
                  실패 {failed}
                </button>
              )}
            </div>
            <button className="h-10 px-3 rounded-xl text-[13px] font-semibold text-ink-700 hover:bg-ink-100 transition flex items-center gap-1.5">
              <SlidersHorizontal size={14} />
              필터
            </button>
            <button className="h-10 px-3 rounded-xl text-[13px] font-semibold text-ink-700 hover:bg-ink-100 transition flex items-center gap-1.5">
              <ChevronDown size={14} />
              최신순
            </button>
          </div>
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
              <div className="px-5 py-4 border-t border-ink-100 bg-ink-50/40 flex items-center justify-between">
                <span className="text-[13px] text-ink-500 font-medium">
                  <span className="font-bold text-ink-800">
                    1-{visible.length}
                  </span>{" "}
                  / {total}개
                </span>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(totalPages, 5) }).map(
                    (_, i) => (
                      <button
                        key={i}
                        className={
                          i === 0
                            ? "w-9 h-9 rounded-lg bg-brand-500 text-white text-[13px] font-bold"
                            : "w-9 h-9 rounded-lg hover:bg-ink-100 transition text-[13px] font-bold text-ink-700"
                        }
                      >
                        {i + 1}
                      </button>
                    ),
                  )}
                </div>
              </div>
            </>
          ) : (
            <EmptyPostsState
              message="아직 생성된 글이 없습니다"
              hint="매일 KST 09:00에 자동으로 10편이 생성됩니다."
            />
          )}
        </section>
      </div>
    </>
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
