import { getMultiBlogStats, aggregateOverview, type BlogStats } from "@/lib/ga4";
import { getGaProperties, getAllPosts } from "@/lib/sheets";
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

/** 글 제목 정리 — 사이트명 접미사 제거 (" | 앤텔레콤 안심개통" 등). */
function cleanTitle(t: string): string {
  return t
    .replace(/\s*[|·\-–—]\s*(?:앤텔레콤\s*안심개통(?:\s*케어(?:통신)?)?|앤텔레콤|안심개통|케어통신).*$/i, "")
    .trim();
}

/**
 * GA4 pagePath → 우리 시트의 글 title 매칭용 맵 빌더.
 *
 * 사용자가 한 글을 5개 블로그에 복붙해서 올리므로, posts 시트엔 한 블로그 URL만 저장돼 있음.
 * → 도메인 무관하게 path만으로 매칭. 같은 path(예: /1)면 같은 글로 추정.
 * (티스토리 글 ID는 발행 순서로 부여되므로 5개 블로그가 거의 같은 path 갖는 경우 많음)
 */
function buildPathTitleMap(
  posts: Awaited<ReturnType<typeof getAllPosts>>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of posts) {
    if (!p.tistory_url || !p.title) continue;
    let path = "";
    try {
      const u = new URL(p.tistory_url);
      path = u.pathname;
    } catch {
      if (p.tistory_url.startsWith("/")) path = p.tistory_url;
    }
    if (!path || path === "/") continue;
    if (!map.has(path)) {
      map.set(path, cleanTitle(p.title));
    }
  }
  return map;
}

/** GA pageTitle이 우리 사이트 공통명만 있는지 판단. */
function isSiteNameOnly(t: string): boolean {
  if (!t) return true;
  const cleaned = t.trim();
  // 정확히 사이트명 또는 그 변형
  if (/^앤텔레콤\s*안심개통(\s*케어(\s*통신)?)?$/i.test(cleaned)) return true;
  if (/^앤텔레콤$/i.test(cleaned)) return true;
  return false;
}

/**
 * 티스토리 페이지의 og:title(실제 글 제목) 추출.
 *   - 티스토리 <title>은 블로그명만 담겨 GA pageTitle이 무용 → og:title로 보완.
 *   - Next fetch 캐시(1h) + 8초 타임아웃. 실패 시 null.
 */
async function fetchOgTitle(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ntelecom-analytics/1.0; +https://ntelecomsafe.com)",
      },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m =
      html.match(
        /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      ) ||
      html.match(
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
      );
    if (!m) return null;
    const t = cleanTitle(m[1].trim());
    return t && !isSiteNameOnly(t) ? t : null;
  } catch {
    return null;
  }
}

/** stats의 인기페이지 URL들 → og:title 맵 (fullUrl → 제목). */
async function buildOgTitleMap(
  stats: Awaited<ReturnType<typeof getMultiBlogStats>>,
): Promise<Map<string, string>> {
  const urls = new Set<string>();
  for (const s of stats) {
    if (!s.tistoryUrl) continue;
    const base = s.tistoryUrl.replace(/\/$/, "");
    for (const p of s.topPages.slice(0, 5)) {
      if (p.path && p.path !== "/") urls.add(base + p.path);
    }
  }
  const list = [...urls];
  const titles = await Promise.all(list.map((u) => fetchOgTitle(u)));
  const map = new Map<string, string>();
  list.forEach((u, i) => {
    if (titles[i]) map.set(u, titles[i] as string);
  });
  return map;
}

/**
 * 등록된 GA properties (블로그) 5개를 병렬 조회 → 합계 + 블로그별 비교 표시.
 * 등록된 게 없으면 null 반환 → 페이지의 옛 단일 property 섹션이 fallback.
 */
export async function MultiBlogAnalytics({ days = 7 }: { days?: number }) {
  const props = await getGaProperties().catch(() => []);
  if (props.length === 0) return null;

  const session = await auth();
  // refresh token 만료/무효 → access token 갱신 실패 시 옛 토큰이 남아 401이 남.
  // accessToken 유무뿐 아니라 refresh 에러도 함께 체크해 깔끔히 재로그인 안내.
  if (!session?.accessToken || session.error === "RefreshAccessTokenError") {
    const expired = session?.error === "RefreshAccessTokenError";
    return (
      <div className="bg-white rounded-2xl shadow-card p-5">
        <div className="flex items-center gap-2 text-rose-600 text-[13px] font-bold mb-2">
          <AlertTriangle size={14} />
          {expired ? "GA 인증 만료 — 재로그인 필요" : "GA 인증 필요"}
        </div>
        <p className="text-[12px] text-ink-600">
          {expired
            ? "Google 인증이 만료됐습니다. 왼쪽 아래 프로필(ft99900@gmail.com) 클릭 → 로그아웃 → 다시 Google 로그인하면 복구됩니다."
            : "로그아웃 후 재로그인 시 analytics.readonly 권한 동의 필요"}
        </p>
      </div>
    );
  }

  const [stats, posts] = await Promise.all([
    getMultiBlogStats({
      accessToken: session.accessToken,
      properties: props.map((p) => ({
        id: p.property_id,
        label: p.label,
        tistory_url: p.tistory_url,
      })),
      days,
    }),
    getAllPosts().catch(() => []),
  ]);

  // GA4 pagePath → 우리 시트의 글 title 매핑 (보조)
  const pathTitleMap = buildPathTitleMap(posts);
  // 인기페이지 URL → og:title(실제 글 제목) 매핑 (주 — 블로그·경로별 정확)
  const ogTitleMap = await buildOgTitleMap(stats);

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
          <BlogCard
            key={s.propertyId}
            stats={s}
            pathTitleMap={pathTitleMap}
            ogTitleMap={ogTitleMap}
          />
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

function BlogCard({
  stats,
  pathTitleMap,
  ogTitleMap,
}: {
  stats: BlogStats;
  pathTitleMap: Map<string, string>;
  ogTitleMap: Map<string, string>;
}) {
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
              <div className="space-y-1.5">
                {stats.topPages.slice(0, 5).map((p, i) => {
                  // 우선순위: og:title(블로그·경로별 정확) → 시트 매칭 → GA pageTitle → pagePath
                  const fullUrl = stats.tistoryUrl
                    ? `${stats.tistoryUrl.replace(/\/$/, "")}${p.path}`
                    : "";
                  const ogTitle = fullUrl ? ogTitleMap.get(fullUrl) : undefined;
                  const sheetTitle = pathTitleMap.get(p.path);
                  const gaTitle = (p.title || "").trim();
                  const cleanedGaTitle = gaTitle ? cleanTitle(gaTitle) : "";
                  const usefulGaTitle =
                    cleanedGaTitle && !isSiteNameOnly(cleanedGaTitle)
                      ? cleanedGaTitle
                      : "";
                  const display =
                    ogTitle || sheetTitle || usefulGaTitle || p.path;
                  const showSubPath = Boolean(
                    ogTitle || sheetTitle || usefulGaTitle,
                  );
                  return (
                    <div
                      key={i}
                      className="flex items-start gap-2 text-[11px] py-0.5"
                    >
                      <span className="text-ink-400 font-bold w-4 mt-0.5">
                        {i + 1}
                      </span>
                      <Link
                        href={
                          stats.tistoryUrl
                            ? `${stats.tistoryUrl.replace(/\/$/, "")}${p.path}`
                            : p.path
                        }
                        target="_blank"
                        className="flex-1 min-w-0 text-ink-700 hover:text-brand-600 leading-tight"
                        title={display}
                      >
                        <div className="truncate font-medium">{display}</div>
                        {showSubPath && (
                          <div className="text-[10px] text-ink-400 font-mono truncate">
                            {p.path}
                          </div>
                        )}
                      </Link>
                      <span className="text-ink-500 tabular-nums font-bold mt-0.5 flex-shrink-0">
                        {p.pageviews.toLocaleString()}
                      </span>
                    </div>
                  );
                })}
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
