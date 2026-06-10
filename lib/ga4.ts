/**
 * Google Analytics Data API v1 클라이언트
 *
 * 사용자의 OAuth access token으로 GA4 데이터를 조회합니다.
 * (서비스 계정 X — Tistory 블로그 GA 속성에 사용자 추가가 안 되는 이슈 우회)
 *
 * 필요 scope: https://www.googleapis.com/auth/analytics.readonly
 *   → auth.ts에서 이미 요청 중
 *
 * env:
 *   GA_PROPERTY_ID — GA4 속성 ID (9~10자리 숫자, "G-..." 아님!)
 *     관리 → 속성 설정 → 속성 ID 에서 확인
 */

const GA_API_BASE = "https://analyticsdata.googleapis.com/v1beta";

export interface GAOverview {
  pageviews: number;
  activeUsers: number;
  sessions: number;
  bounceRate: number; // 0~1
  avgSessionDuration: number; // 초
}

export interface GATopPage {
  path: string;
  title: string;
  pageviews: number;
  activeUsers: number;
}

export interface GAChannelRow {
  channel: string; // Organic Search, Direct, Referral, ...
  sessions: number;
  pageviews: number;
}

export interface GADailyRow {
  date: string; // YYYY-MM-DD
  pageviews: number;
  activeUsers: number;
}

class GA4Error extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
    this.name = "GA4Error";
  }
}

function propertyId(): string {
  const id = process.env.GA_PROPERTY_ID;
  if (!id) {
    throw new GA4Error(500, "GA_PROPERTY_ID env 미설정 또는 property_id 인자 누락");
  }
  return id;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return isoDate(d);
}

interface RunReportResponse {
  rows?: Array<{
    dimensionValues?: Array<{ value: string }>;
    metricValues?: Array<{ value: string }>;
  }>;
}

async function runReport(
  accessToken: string,
  body: Record<string, unknown>,
  propertyIdOverride?: string,
): Promise<RunReportResponse> {
  const pid = (propertyIdOverride || propertyId()).replace(/^properties\//, "");
  const url = `${GA_API_BASE}/properties/${pid}:runReport`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new GA4Error(
      res.status,
      `GA Data API runReport 실패 (HTTP ${res.status}): ${text.slice(0, 300)}`,
      text,
    );
  }
  return (await res.json()) as RunReportResponse;
}

/**
 * 실시간 데이터 — 지난 30분 내 활성 사용자/이벤트.
 * 일반 runReport는 24-48시간 지연되지만, runRealtimeReport는 거의 즉시 (1-2분 내).
 */
async function runRealtimeReport(
  accessToken: string,
  body: Record<string, unknown>,
  propertyIdOverride?: string,
): Promise<RunReportResponse> {
  const pid = (propertyIdOverride || propertyId()).replace(/^properties\//, "");
  const url = `${GA_API_BASE}/properties/${pid}:runRealtimeReport`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new GA4Error(
      res.status,
      `GA Data API runRealtimeReport 실패 (HTTP ${res.status}): ${text.slice(0, 300)}`,
      text,
    );
  }
  return (await res.json()) as RunReportResponse;
}

/** 기간 KPI 요약. days=7이면 최근 7일. */
export async function getOverview(
  accessToken: string,
  days = 7,
  propertyIdOverride?: string,
): Promise<GAOverview> {
  const data = await runReport(
    accessToken,
    {
      dateRanges: [{ startDate: daysAgo(days - 1), endDate: "today" }],
      metrics: [
        { name: "screenPageViews" },
        { name: "activeUsers" },
        { name: "sessions" },
        { name: "bounceRate" },
        { name: "averageSessionDuration" },
      ],
    },
    propertyIdOverride,
  );
  const m = data.rows?.[0]?.metricValues ?? [];
  return {
    pageviews: parseInt(m[0]?.value ?? "0", 10),
    activeUsers: parseInt(m[1]?.value ?? "0", 10),
    sessions: parseInt(m[2]?.value ?? "0", 10),
    bounceRate: parseFloat(m[3]?.value ?? "0"),
    avgSessionDuration: parseFloat(m[4]?.value ?? "0"),
  };
}

/** 일자별 페이지뷰 / 활성 사용자. */
export async function getDailyTrend(
  accessToken: string,
  days = 7,
  propertyIdOverride?: string,
): Promise<GADailyRow[]> {
  const data = await runReport(
    accessToken,
    {
      dateRanges: [{ startDate: daysAgo(days - 1), endDate: "today" }],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
    },
    propertyIdOverride,
  );
  return (data.rows ?? []).map((r) => {
    const raw = r.dimensionValues?.[0]?.value ?? ""; // YYYYMMDD
    const date =
      raw.length === 8
        ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
        : raw;
    return {
      date,
      pageviews: parseInt(r.metricValues?.[0]?.value ?? "0", 10),
      activeUsers: parseInt(r.metricValues?.[1]?.value ?? "0", 10),
    };
  });
}

/** TOP 페이지. */
export async function getTopPages(
  accessToken: string,
  days = 7,
  limit = 10,
  propertyIdOverride?: string,
): Promise<GATopPage[]> {
  const data = await runReport(
    accessToken,
    {
      dateRanges: [{ startDate: daysAgo(days - 1), endDate: "today" }],
      dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
      metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: String(limit),
    },
    propertyIdOverride,
  );
  return (data.rows ?? []).map((r) => ({
    path: r.dimensionValues?.[0]?.value ?? "",
    title: r.dimensionValues?.[1]?.value ?? "",
    pageviews: parseInt(r.metricValues?.[0]?.value ?? "0", 10),
    activeUsers: parseInt(r.metricValues?.[1]?.value ?? "0", 10),
  }));
}

/** 유입 채널 (Organic Search, Direct, Referral, Social, ...). */
export async function getChannels(
  accessToken: string,
  days = 7,
): Promise<GAChannelRow[]> {
  const data = await runReport(accessToken, {
    dateRanges: [{ startDate: daysAgo(days - 1), endDate: "today" }],
    dimensions: [{ name: "sessionDefaultChannelGroup" }],
    metrics: [{ name: "sessions" }, { name: "screenPageViews" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
  });
  return (data.rows ?? []).map((r) => ({
    channel: r.dimensionValues?.[0]?.value ?? "(unknown)",
    sessions: parseInt(r.metricValues?.[0]?.value ?? "0", 10),
    pageviews: parseInt(r.metricValues?.[1]?.value ?? "0", 10),
  }));
}

/**
 * 글별 페이지뷰 매핑 — posts 시트의 id (URL path) 기준으로 모아서 반환.
 * Tistory URL 형식: https://ntelecomsafe.tistory.com/123 → pagePath = /123
 *
 * 우리 시트의 id는 p-YYYYMMDD-NNN 같은 자체 ID라 매핑이 어려움.
 * 일단 path 그대로 반환 — 호출 측에서 매핑 처리.
 */
export async function getPagePathPageviews(
  accessToken: string,
  days = 30,
  limit = 200,
): Promise<Record<string, number>> {
  const data = await runReport(accessToken, {
    dateRanges: [{ startDate: daysAgo(days - 1), endDate: "today" }],
    dimensions: [{ name: "pagePath" }],
    metrics: [{ name: "screenPageViews" }],
    orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
    limit: String(limit),
  });
  const out: Record<string, number> = {};
  for (const r of data.rows ?? []) {
    const path = r.dimensionValues?.[0]?.value ?? "";
    const pv = parseInt(r.metricValues?.[0]?.value ?? "0", 10);
    if (path) out[path] = pv;
  }
  return out;
}

// ─── 실시간 (Realtime) API ─────────────────────────
// 지난 30분 내 데이터만 가능하지만 거의 즉시 (1-2분 내 반영).
// 일반 runReport의 24-48시간 지연 회피.

export interface GARealtimeOverview {
  activeUsers: number;
  /** 지난 30분 총 페이지뷰 (event count from page_view) */
  pageviews: number;
}

export interface GARealtimeTopPage {
  path: string;
  activeUsers: number;
}

/** 지난 30분 활성 사용자 + 페이지뷰. */
export async function getRealtimeOverview(
  accessToken: string,
  propertyIdOverride?: string,
): Promise<GARealtimeOverview> {
  const data = await runRealtimeReport(
    accessToken,
    {
      metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
    },
    propertyIdOverride,
  );
  const m = data.rows?.[0]?.metricValues ?? [];
  return {
    activeUsers: parseInt(m[0]?.value ?? "0", 10),
    pageviews: parseInt(m[1]?.value ?? "0", 10),
  };
}

/** 지난 30분 활성 사용자가 본 인기 페이지. */
export async function getRealtimeTopPages(
  accessToken: string,
  limit = 5,
  propertyIdOverride?: string,
): Promise<GARealtimeTopPage[]> {
  const data = await runRealtimeReport(
    accessToken,
    {
      dimensions: [{ name: "unifiedScreenName" }],
      metrics: [{ name: "activeUsers" }],
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
      limit: String(limit),
    },
    propertyIdOverride,
  );
  return (data.rows ?? []).map((r) => ({
    path: r.dimensionValues?.[0]?.value ?? "(unknown)",
    activeUsers: parseInt(r.metricValues?.[0]?.value ?? "0", 10),
  }));
}

// ─── Multi-property helpers ─────────────────────────────────
// 여러 GA4 속성(블로그)을 병렬 조회 + 부분 실패 허용.

export interface BlogStats {
  propertyId: string;
  label: string;
  tistoryUrl: string;
  overview: GAOverview;
  topPages: GATopPage[];
  daily: GADailyRow[];
  realtimeActiveUsers: number;
  error: string | null;
}

/** 여러 GA property를 병렬 조회 — 실패한 건 error 필드에 담아 반환. */
export async function getMultiBlogStats(opts: {
  accessToken: string;
  properties: { id: string; label: string; tistory_url?: string }[];
  days?: number;
  topPagesLimit?: number;
}): Promise<BlogStats[]> {
  const { accessToken, properties } = opts;
  const days = opts.days ?? 7;
  const topPagesLimit = opts.topPagesLimit ?? 5;

  return Promise.all(
    properties.map(async (p): Promise<BlogStats> => {
      try {
        const [overview, topPages, daily, realtime] = await Promise.all([
          getOverview(accessToken, days, p.id),
          getTopPages(accessToken, days, topPagesLimit, p.id),
          getDailyTrend(accessToken, days, p.id),
          getRealtimeOverview(accessToken, p.id).catch(() => ({
            activeUsers: 0,
            pageviews: 0,
          })),
        ]);
        return {
          propertyId: p.id,
          label: p.label,
          tistoryUrl: p.tistory_url || "",
          overview,
          topPages,
          daily,
          realtimeActiveUsers: realtime.activeUsers,
          error: null,
        };
      } catch (e) {
        return {
          propertyId: p.id,
          label: p.label,
          tistoryUrl: p.tistory_url || "",
          overview: {
            pageviews: 0,
            activeUsers: 0,
            sessions: 0,
            bounceRate: 0,
            avgSessionDuration: 0,
          },
          topPages: [],
          daily: [],
          realtimeActiveUsers: 0,
          error: (e as Error).message.slice(0, 200),
        };
      }
    }),
  );
}

/** 블로그별 stats에서 합계 KPI. */
export function aggregateOverview(stats: BlogStats[]): GAOverview {
  let pageviews = 0,
    activeUsers = 0,
    sessions = 0;
  let weightedBounce = 0,
    weightedDuration = 0,
    weightSum = 0;
  for (const s of stats) {
    pageviews += s.overview.pageviews;
    activeUsers += s.overview.activeUsers;
    sessions += s.overview.sessions;
    weightedBounce += s.overview.bounceRate * s.overview.sessions;
    weightedDuration += s.overview.avgSessionDuration * s.overview.sessions;
    weightSum += s.overview.sessions;
  }
  return {
    pageviews,
    activeUsers,
    sessions,
    bounceRate: weightSum > 0 ? weightedBounce / weightSum : 0,
    avgSessionDuration: weightSum > 0 ? weightedDuration / weightSum : 0,
  };
}

export { GA4Error };
