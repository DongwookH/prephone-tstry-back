import { getMultiBlogStats, aggregateOverview, type BlogStats } from "@/lib/ga4";
import { getGaProperties } from "@/lib/sheets";
import { auth } from "@/auth";
import Link from "next/link";
import {
  AlertTriangle,
  ExternalLink,
  TrendingUp,
  Users,
  Eye,
  Activity,
  CircleDot,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 등록된 GA properties (블로그) 5개를 병렬 조회 → 합계 + 블로그별 비교 표시.
 * 등록된 게 없으면 null 반환 → 페이지의 옛 단일 property 섹션이 fallback.
 */
export async function MultiBlogAnalytics({ days = 7 }: { days?: number }) {
  const props = await getGaProperties().catch(() => []);
  if (props.length === 0) return null;

  const session = await auth();
  if (!session?.accessToken) {
    return (
      <div className="bg-white rounded-2xl shadow-card p-5">
        <div className="flex items-center gap-2 text-rose-600 text-[13px] font-bold mb-2">
          <AlertTriangle size={14} />
          GA 인증 필요
        </div>
        <p className="text-[12px] text-ink-600">
          로그아웃 후 재로그인 시 analytics.readonly 권한 동의 필요
        </p>
      </div>
    );
  }

  const stats = await getMultiBlogStats({
    accessToken: session.accessToken,
    properties: props.map((p) => ({
      id: p.property_id,
      label: p.label,
      tistory_url: p.tistory_url,
    })),
    days,
  });

  const total = aggregateOverview(stats);
  const totalRealtime = stats.reduce(
    (s, b) => s + b.realtimeActiveUsers,
    0,
  );

  return (
    <section className="space-y-4">
      {/* 합계 KPI */}
      <div className="bg-white rounded-2xl shadow-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-[15px] font-extrabold text-ink-900">
              📊 전체 합계 — 최근 {days}일
            </h2>
            <p className="text-[12px] text-ink-500 mt-0.5">
              등록된 {stats.length}개 블로그 합산
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[12px] font-bold text-mint-700 bg-mint-50 rounded-full px-3 py-1">
            <CircleDot size={11} className="animate-pulse" />
            지금 {totalRealtime}명
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <KPI
            label="페이지뷰"
            value={total.pageviews}
            icon={<Eye size={13} />}
          />
          <KPI
            label="사용자"
            value={total.activeUsers}
            icon={<Users size={13} />}
          />
          <KPI
            label="세션"
            value={total.sessions}
            icon={<Activity size={13} />}
          />
          <KPI
            label="평균 체류 (초)"
            value={Math.round(total.avgSessionDuration)}
            icon={<TrendingUp size={13} />}
          />
        </div>
      </div>

      {/* 블로그별 비교 카드 */}
      <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
        {stats.map((s) => (
          <BlogCard key={s.propertyId} stats={s} />
        ))}
      </div>
    </section>
  );
}

function KPI({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-ink-200 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-bold text-ink-500 tracking-wider mb-1">
        {icon}
        {label}
      </div>
      <div className="text-[20px] font-extrabold tabular-nums text-ink-900">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function BlogCard({ stats }: { stats: BlogStats }) {
  const o = stats.overview;
  return (
    <div className="bg-white rounded-2xl shadow-card p-4 space-y-3">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[14px] font-extrabold text-ink-900 truncate">
            {stats.label}
          </div>
          {stats.tistoryUrl && (
            <a
              href={stats.tistoryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-brand-600 hover:underline inline-flex items-center gap-0.5 mt-0.5"
            >
              {stats.tistoryUrl.replace(/^https?:\/\//, "").slice(0, 40)}
              <ExternalLink size={9} />
            </a>
          )}
        </div>
        {stats.error ? (
          <span className="text-[10px] font-bold bg-rose-50 text-rose-600 rounded-full px-2 py-0.5 flex items-center gap-1">
            <AlertTriangle size={9} /> 오류
          </span>
        ) : (
          <span
            className={cn(
              "text-[10px] font-bold rounded-full px-2 py-0.5 flex items-center gap-1",
              stats.realtimeActiveUsers > 0
                ? "bg-mint-50 text-mint-700"
                : "bg-ink-50 text-ink-500",
            )}
          >
            <CircleDot
              size={9}
              className={
                stats.realtimeActiveUsers > 0 ? "animate-pulse" : ""
              }
            />
            지금 {stats.realtimeActiveUsers}명
          </span>
        )}
      </div>

      {stats.error ? (
        <div className="text-[11px] text-rose-700 bg-rose-50 rounded-lg p-2.5 leading-relaxed">
          {stats.error}
        </div>
      ) : (
        <>
          {/* KPI 4개 */}
          <div className="grid grid-cols-4 gap-2">
            <SmallKPI label="조회" value={o.pageviews} />
            <SmallKPI label="유저" value={o.activeUsers} />
            <SmallKPI label="세션" value={o.sessions} />
            <SmallKPI
              label="체류"
              value={Math.round(o.avgSessionDuration)}
              suffix="s"
            />
          </div>

          {/* Top 페이지 5개 */}
          {stats.topPages.length > 0 && (
            <div className="pt-2 border-t border-ink-100">
              <div className="text-[10px] font-bold text-ink-500 tracking-wider mb-1.5">
                인기 페이지 TOP {stats.topPages.length}
              </div>
              <div className="space-y-1">
                {stats.topPages.slice(0, 5).map((p, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-[11px]"
                  >
                    <span className="text-ink-400 font-bold w-4">
                      {i + 1}
                    </span>
                    <Link
                      href={
                        stats.tistoryUrl
                          ? `${stats.tistoryUrl}${p.path}`
                          : p.path
                      }
                      target="_blank"
                      className="flex-1 truncate text-ink-700 hover:text-brand-600"
                      title={p.title || p.path}
                    >
                      {p.title || p.path}
                    </Link>
                    <span className="text-ink-500 tabular-nums font-bold">
                      {p.pageviews.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SmallKPI({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <div className="rounded-lg bg-ink-50 px-2 py-1.5">
      <div className="text-[9px] font-bold text-ink-500 tracking-wider">
        {label}
      </div>
      <div className="text-[14px] font-extrabold tabular-nums text-ink-900 leading-tight">
        {value.toLocaleString()}
        {suffix && (
          <span className="text-[10px] font-bold text-ink-500 ml-0.5">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}
