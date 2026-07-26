import { google, searchconsole_v1 } from "googleapis";

/**
 * Google Search Console API (Search Analytics) 클라이언트.
 *
 * lib/sheets.ts와 동일한 서비스 계정 자격증명을 재사용한다
 * (GOOGLE_SHEETS_CLIENT_EMAIL / GOOGLE_SHEETS_PRIVATE_KEY — Sheets용으로 이미
 * 등록된 서비스 계정). GA4(lib/ga4.ts)와 달리 사용자 OAuth가 아니라 서비스
 * 계정을 쓰는 이유는, GSC는 "속성에 사용자/서비스 계정을 추가"하는 방식으로
 * 권한을 주기 때문에 앱 소유자가 한 번만 등록해두면 별도 로그인 동의 없이
 * 항상 조회 가능하기 때문.
 *
 * ⚠️ 선행 조건: Search Console → 설정 → 사용자 및 권한에서 이 서비스 계정
 *    (GOOGLE_SHEETS_CLIENT_EMAIL 값)을 "전체" 권한으로 추가해야 함.
 *    추가 전에는 API가 403을 반환한다 — 호출부에서 GSCError(403)로 던짐.
 *
 * 대상 속성: https://ntelecomsafe.com/ (URL-prefix 속성으로 등록되어 있다고
 * 가정). 만약 GSC에 도메인 속성(sc-domain:)으로 등록되어 있다면 아래
 * SITE_URL을 "sc-domain:ntelecomsafe.com"으로 바꿔야 한다.
 */

const SITE_URL = "sc-domain:ntelecomsafe.com"; // 도메인 속성 확인됨(sites.list, 2026-07-26)
// 대안(URL 접두어 속성인 경우): const SITE_URL = "https://ntelecomsafe.com/";

// GSC 데이터는 통상 2~3일 지연 반영됨 — 최신 날짜를 그대로 endDate로 쓰면
// 데이터가 비어 보일 수 있어 3일 버퍼를 둔다.
const DATA_LAG_DAYS = 3;

export class GSCError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "GSCError";
  }
}

let cachedClient: searchconsole_v1.Searchconsole | null = null;

function getClient(): searchconsole_v1.Searchconsole {
  if (cachedClient) return cachedClient;

  const email = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const rawKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new GSCError(
      500,
      "GOOGLE_SHEETS_CLIENT_EMAIL / GOOGLE_SHEETS_PRIVATE_KEY 가 설정되지 않았습니다.",
    );
  }
  const privateKey = rawKey.replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });

  cachedClient = google.searchconsole({ version: "v1", auth });
  return cachedClient;
}

function toGSCError(err: unknown): GSCError {
  if (err instanceof GSCError) return err;
  const e = err as {
    code?: number;
    response?: { status?: number };
    message?: string;
  };
  const status = e.response?.status ?? e.code ?? 500;
  if (status === 403 || status === 401) {
    return new GSCError(403, "no_access");
  }
  return new GSCError(status, e.message || "GSC 조회 실패");
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** days일 구간의 [startDate, endDate] (지연 버퍼 반영). */
function dateRange(days: number): { startDate: string; endDate: string } {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - DATA_LAG_DAYS);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  return { startDate: fmtDate(start), endDate: fmtDate(end) };
}

export type GscRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

async function runQuery(opts: {
  days: number;
  dimensions?: string[];
  rowLimit?: number;
}): Promise<GscRow[]> {
  const sc = getClient();
  const { startDate, endDate } = dateRange(opts.days);
  try {
    const res = await sc.searchanalytics.query({
      siteUrl: SITE_URL,
      requestBody: {
        startDate,
        endDate,
        dimensions: opts.dimensions ?? [],
        rowLimit: opts.rowLimit ?? 1000,
      },
    });
    const rows = res.data.rows ?? [];
    return rows.map((r) => ({
      keys: r.keys ?? [],
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      ctr: r.ctr ?? 0,
      position: r.position ?? 0,
    }));
  } catch (err) {
    throw toGSCError(err);
  }
}

export type QueryRow = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

/** dimension=query — 검색어 TOP (클릭 많은 순). */
export async function queryTop(days = 28, limit = 50): Promise<QueryRow[]> {
  const rows = await runQuery({ days, dimensions: ["query"], rowLimit: limit });
  return rows
    .map((r) => ({
      query: r.keys[0] ?? "",
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    }))
    .sort((a, b) => b.clicks - a.clicks);
}

export type PageRow = {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

/** dimension=page — 페이지 TOP (클릭 많은 순). */
export async function pageTop(days = 28, limit = 50): Promise<PageRow[]> {
  const rows = await runQuery({ days, dimensions: ["page"], rowLimit: limit });
  return rows
    .map((r) => ({
      page: r.keys[0] ?? "",
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    }))
    .sort((a, b) => b.clicks - a.clicks);
}

/**
 * 제목 개선 후보 — 노출은 많은데 CTR이 낮은 쿼리.
 * 조건: impressions >= 50 && ctr < 0.02 && position <= 20
 * (상위 20위 안에 노출되고 있는데도 클릭이 거의 안 나온다 = 제목/설명이
 *  검색 의도와 안 맞을 가능성 → 제목 개선 1순위 후보)
 */
export async function titleCandidates(days = 28): Promise<QueryRow[]> {
  // 필터링 전에 넓게 뽑아야 하니 rowLimit을 크게 잡는다 (API 최대 25,000).
  const rows = await runQuery({ days, dimensions: ["query"], rowLimit: 5000 });
  return rows
    .filter(
      (r) => r.impressions >= 50 && r.ctr < 0.02 && r.position <= 20,
    )
    .map((r) => ({
      query: r.keys[0] ?? "",
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    }))
    .sort((a, b) => b.impressions - a.impressions);
}

/** 기간 전체 합산 (dimension 없이 조회하면 1행짜리 사이트 전체 합계가 온다). */
export async function getTotals(
  days = 28,
): Promise<{ clicks: number; impressions: number }> {
  const rows = await runQuery({ days, dimensions: [], rowLimit: 1 });
  const row = rows[0];
  return {
    clicks: row?.clicks ?? 0,
    impressions: row?.impressions ?? 0,
  };
}
