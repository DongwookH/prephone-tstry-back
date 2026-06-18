import { notFound } from "next/navigation";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { getPostByIdFromSheet } from "@/lib/sheets";
import { CheckCircle2 } from "lucide-react";
import { PostContentViewer } from "@/components/post-content-viewer";
import { CardNewsCards } from "@/components/card-news-cards";
import { ThumbnailCard } from "@/components/thumbnail-card";
import { TagsBlock } from "@/components/tags-block";
import { PublishForm } from "@/components/publish-form";
import { DangerZone } from "@/components/danger-zone";

export const revalidate = 60;

export default async function PostDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const post = await getPostByIdFromSheet(id);
  if (!post) notFound();

  const seo = parseInt(post.seo_score || "0", 10);
  const chars = parseInt(post.char_count || "0", 10);
  const pageviews = parseInt(post.ga_pageviews || "0", 10);
  const clicks = parseInt(post.ga_clicks || "0", 10);
  const conversions = parseInt(post.ga_conversions || "0", 10);
  const ctr =
    pageviews > 0 ? Math.round((clicks / pageviews) * 1000) / 10 : 0;
  const cvr = clicks > 0 ? Math.round((conversions / clicks) * 1000) / 10 : 0;

  // 메타 description 추출 (content_html 텍스트 첫 150자)
  const metaDesc =
    (post.content_html || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 150);

  const ringDash = 314;
  const ringOffset = ringDash - (ringDash * Math.max(seo, 0)) / 100;

  return (
    <>
      <Topbar
        crumbs={[
          { label: "대시보드", href: "/" },
          { label: "글 목록", href: "/posts" },
          { label: post.title, bold: true },
        ]}
      />

      <div className="px-8 py-6 max-w-[1400px] w-full mx-auto">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] font-bold bg-brand-50 text-brand-700 rounded-md px-2 py-1">
              {post.keyword || "-"}
            </span>
            {post.status === "published" ? (
              <span className="text-[11px] font-bold text-mint-700 bg-mint-50 rounded-md px-2 py-1 flex items-center gap-1">
                <CheckCircle2 size={11} strokeWidth={2.5} />
                발행 완료
              </span>
            ) : post.status === "failed" ? (
              <span className="text-[11px] font-bold text-rose-700 bg-rose-50 rounded-md px-2 py-1 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                생성 실패
              </span>
            ) : (
              <span className="text-[11px] font-bold text-amber-700 bg-amber-50 rounded-md px-2 py-1 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                발행 대기
              </span>
            )}
            <span className="text-[11px] font-medium text-ink-500">
              · {post.created_at?.slice(0, 16) || "-"} 생성
            </span>
          </div>
          <h1 className="text-[28px] font-extrabold text-ink-900 leading-tight tracking-tight">
            {post.title}
          </h1>
          {metaDesc && (
            <p className="mt-2 text-[14px] text-ink-600 line-clamp-2">
              메타: {metaDesc}
            </p>
          )}
        </div>

        <div className="grid grid-cols-12 gap-6">
          {/* Editor — client component */}
          <section className="col-span-7">
            <PostContentViewer
              contentHtml={post.content_html || ""}
              charCount={chars}
            />
          </section>

          {/* Sidebar */}
          <aside className="col-span-5 flex flex-col gap-4">
            <div className="bg-white rounded-2xl shadow-card p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[15px] font-extrabold text-ink-900">
                  SEO 분석
                </h3>
                <span
                  className={
                    seo >= 90
                      ? "text-[11px] font-bold text-mint-700 bg-mint-50 rounded-md px-2 py-1"
                      : seo >= 80
                        ? "text-[11px] font-bold text-brand-700 bg-brand-50 rounded-md px-2 py-1"
                        : seo >= 70
                          ? "text-[11px] font-bold text-amber-700 bg-amber-50 rounded-md px-2 py-1"
                          : "text-[11px] font-bold text-ink-600 bg-ink-100 rounded-md px-2 py-1"
                  }
                >
                  {seo >= 90
                    ? "매우 좋음"
                    : seo >= 80
                      ? "좋음"
                      : seo >= 70
                        ? "보통"
                        : "측정 필요"}
                </span>
              </div>
              <div className="flex items-center gap-6">
                <div className="relative w-28 h-28 flex-shrink-0">
                  <svg
                    width="112"
                    height="112"
                    style={{ transform: "rotate(-90deg)" }}
                  >
                    <circle
                      cx="56"
                      cy="56"
                      r="50"
                      fill="none"
                      stroke="#F2F4F6"
                      strokeWidth="10"
                    />
                    <circle
                      cx="56"
                      cy="56"
                      r="50"
                      fill="none"
                      stroke="#3182F6"
                      strokeWidth="10"
                      strokeLinecap="round"
                      strokeDasharray={ringDash}
                      strokeDashoffset={ringOffset}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-[28px] font-extrabold text-ink-900 leading-none">
                      {seo > 0 ? seo : "-"}
                    </span>
                    <span className="text-[11px] font-bold text-ink-500 mt-0.5">
                      / 100
                    </span>
                  </div>
                </div>
                <div className="flex-1 space-y-3">
                  <SubMetric
                    label="카테고리"
                    value={post.category || "-"}
                  />
                  <SubMetric
                    label="페르소나"
                    value={post.persona || "-"}
                  />
                  <SubMetric
                    label="UTM 캠페인"
                    value={post.utm_campaign || "-"}
                  />
                </div>
              </div>
            </div>

            {/* 태그 (티스토리 발행용) — tags 없으면 자동 fallback */}
            <TagsBlock
              tagsRaw={post.tags}
              fallback={{
                keyword: post.keyword,
                category: post.category,
                persona: post.persona,
              }}
            />

            {/* 자동 생성 썸네일 (대표이미지) */}
            <ThumbnailCard postId={post.id} title={post.title} />

            {/* 카드뉴스 (1080×1080 5장: 표지 + 섹션 4) */}
            <CardNewsCards
              title={post.title}
              keyword={post.keyword}
              category={post.category}
              contentHtml={post.content_html || ""}
              idForFilename={post.id}
            />

            {/* Publish (client component — server action 연결) */}
            <PublishForm
              postId={post.id}
              initialPublished={post.status === "published"}
              initialUrl={post.tistory_url || ""}
            />

            {/* 위험 영역 — 글 삭제 + 키워드 블랙리스트 */}
            <DangerZone
              postId={post.id}
              keyword={post.keyword || ""}
              title={post.title}
            />

            {/* GA stats */}
            <div className="bg-white rounded-2xl shadow-card p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[15px] font-extrabold text-ink-900">
                  실시간 성과 (GA4)
                </h3>
                <span
                  className={
                    pageviews > 0
                      ? "text-[10px] font-bold text-brand-700 bg-brand-50 rounded px-1.5 py-0.5"
                      : "text-[10px] font-bold text-ink-500 bg-ink-100 rounded px-1.5 py-0.5"
                  }
                >
                  {pageviews > 0 ? "LIVE" : "GA4 연동 필요"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className="text-[11px] font-bold text-ink-500 mb-1">
                    페이지뷰
                  </div>
                  <div className="text-[20px] font-extrabold text-ink-900">
                    {pageviews}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-bold text-ink-500 mb-1">
                    클릭
                  </div>
                  <div className="text-[20px] font-extrabold text-ink-900">
                    {clicks}
                  </div>
                  <div className="text-[10px] font-bold text-mint-700 mt-0.5">
                    {ctr > 0 ? `${ctr}% CTR` : "-"}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-bold text-ink-500 mb-1">
                    전환
                  </div>
                  <div className="text-[20px] font-extrabold text-brand-600">
                    {conversions}
                  </div>
                  <div className="text-[10px] font-bold text-mint-700 mt-0.5">
                    {cvr > 0 ? `${cvr}% CVR` : "-"}
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>

        <div className="mt-6">
          <Link
            href="/posts"
            className="text-[13px] font-bold text-brand-600 hover:text-brand-700"
          >
            ← 글 목록으로
          </Link>
        </div>
      </div>
    </>
  );
}

function SubMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-[12px] font-semibold text-ink-700">{label}</span>
        <span className="text-[12px] font-bold text-ink-900 truncate ml-2">
          {value}
        </span>
      </div>
    </div>
  );
}
