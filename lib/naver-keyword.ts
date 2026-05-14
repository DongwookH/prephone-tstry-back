import crypto from "crypto";

/**
 * 네이버 검색광고 API · 키워드 도구 클라이언트.
 *
 * 환경변수:
 *  - NAVER_AD_CUSTOMER_ID  광고주 고객번호 (숫자)
 *  - NAVER_AD_API_KEY      Access License (긴 문자열)
 *  - NAVER_AD_SECRET_KEY   Secret Key (한 번만 표시, 분실 시 재발급)
 *
 * 인증: HMAC-SHA256(`${timestamp}.${method}.${uri}`, secretKey) → base64
 *
 * 호출 한도: 시간당 약 5,000회 (우리 케이스 충분)
 * 키워드: 한 호출당 최대 5개 (자동 청크 처리)
 */

// 2026년 기준 네이버 검색광고 API 베이스 URL.
// 기존 api.naver.com 은 308 Permanent Redirect 됨.
const BASE_URL = "https://api.searchad.naver.com";
const KEYWORDSTOOL_PATH = "/keywordstool";

export type NaverKeywordRow = {
  keyword: string;
  monthlyPcVolume: number;
  monthlyMobileVolume: number;
  monthlyTotalVolume: number;
  /** 광고 경쟁 강도. 검색량과 별개의 지표. */
  competition: "낮음" | "중간" | "높음" | "-";
  avgClickPc: number;
  avgClickMobile: number;
  /** 검색결과 1페이지 평균 노출 광고 수 */
  plAvgDepth: number;
};

function envOrThrow(): {
  customerId: string;
  apiKey: string;
  secretKey: string;
} {
  const customerId = process.env.NAVER_AD_CUSTOMER_ID;
  const apiKey = process.env.NAVER_AD_API_KEY;
  const secretKey = process.env.NAVER_AD_SECRET_KEY;
  if (!customerId || !apiKey || !secretKey) {
    throw new Error(
      "NAVER_AD_CUSTOMER_ID / NAVER_AD_API_KEY / NAVER_AD_SECRET_KEY 가 설정되지 않았습니다.",
    );
  }
  return { customerId, apiKey, secretKey };
}

export function isNaverAdConfigured(): boolean {
  return !!(
    process.env.NAVER_AD_CUSTOMER_ID &&
    process.env.NAVER_AD_API_KEY &&
    process.env.NAVER_AD_SECRET_KEY
  );
}

function makeSignature(
  timestamp: string,
  method: string,
  uri: string,
  secretKey: string,
): string {
  const message = `${timestamp}.${method}.${uri}`;
  return crypto.createHmac("sha256", secretKey).update(message).digest("base64");
}

/**
 * 검색량 응답이 "< 10" 같은 문자열로 올 수 있어 숫자로 정규화.
 *  - "< 10" → 5 (대략 중간값)
 *  - 숫자면 그대로
 */
function parseVolume(v: number | string | undefined | null): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    if (v.includes("<")) {
      const m = v.match(/\d+/);
      return m ? Math.floor(parseInt(m[0], 10) / 2) : 0;
    }
    const n = parseInt(v.replace(/[^\d]/g, ""), 10);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

/**
 * 키워드 N개의 월간 PC/모바일 검색량 + 경쟁도를 가져옴.
 * - 입력 키워드 N개에 대해 응답에는 N개 + 연관 키워드까지 포함될 수 있음
 * - 우리는 입력한 키워드만 정확히 매칭해서 반환 (옵션으로 연관 포함 가능)
 *
 * @param keywords 조회할 키워드 (최대 5개씩 자동 청크)
 * @param opts.includeRelated 연관 키워드도 함께 반환할지 (기본 false)
 */
export async function fetchKeywordVolumes(
  keywords: string[],
  opts: { includeRelated?: boolean } = {},
): Promise<NaverKeywordRow[]> {
  if (keywords.length === 0) return [];
  const { customerId, apiKey, secretKey } = envOrThrow();

  // 네이버는 공백 제거된 키워드를 권장
  const cleaned = Array.from(
    new Set(
      keywords
        .map((k) => k.trim())
        .filter(Boolean)
        .map((k) => k.replace(/\s+/g, "")),
    ),
  );
  const inputSet = new Set(cleaned);

  const chunks: string[][] = [];
  for (let i = 0; i < cleaned.length; i += 5) {
    chunks.push(cleaned.slice(i, i + 5));
  }

  const all: NaverKeywordRow[] = [];

  for (const chunk of chunks) {
    const url = new URL(BASE_URL + KEYWORDSTOOL_PATH);
    url.searchParams.set("hintKeywords", chunk.join(","));
    url.searchParams.set("showDetail", "1");

    const timestamp = String(Date.now());
    const signature = makeSignature(
      timestamp,
      "GET",
      KEYWORDSTOOL_PATH,
      secretKey,
    );

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "X-Timestamp": timestamp,
        "X-API-KEY": apiKey,
        "X-Customer": customerId,
        "X-Signature": signature,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `네이버 광고 API 실패 (${res.status} ${res.statusText}): ${body.slice(0, 300)}`,
      );
    }

    const data = (await res.json()) as {
      keywordList?: Array<{
        relKeyword: string;
        monthlyPcQcCnt: number | string;
        monthlyMobileQcCnt: number | string;
        monthlyAvePcClkCnt?: number;
        monthlyAveMobileClkCnt?: number;
        compIdx?: string;
        plAvgDepth?: number;
      }>;
    };

    const rows = data.keywordList ?? [];
    for (const row of rows) {
      const pc = parseVolume(row.monthlyPcQcCnt);
      const mo = parseVolume(row.monthlyMobileQcCnt);
      const isInput = inputSet.has(row.relKeyword);
      if (!opts.includeRelated && !isInput) continue;
      all.push({
        keyword: row.relKeyword,
        monthlyPcVolume: pc,
        monthlyMobileVolume: mo,
        monthlyTotalVolume: pc + mo,
        competition: (row.compIdx || "-") as NaverKeywordRow["competition"],
        avgClickPc: row.monthlyAvePcClkCnt ?? 0,
        avgClickMobile: row.monthlyAveMobileClkCnt ?? 0,
        plAvgDepth: row.plAvgDepth ?? 0,
      });
    }
  }

  return all;
}

/**
 * 키워드 1개를 받아 연관 키워드 + 검색량까지 모두 반환.
 * GSG 발굴 결과 보강 또는 시드 키워드 확장에 활용.
 */
export async function fetchRelatedKeywords(
  seed: string,
  limit = 30,
): Promise<NaverKeywordRow[]> {
  const all = await fetchKeywordVolumes([seed], { includeRelated: true });
  return all
    .sort((a, b) => b.monthlyTotalVolume - a.monthlyTotalVolume)
    .slice(0, limit);
}

/**
 * 키 마스킹 헬스체크.
 */
export function naverAdKeyStatus() {
  const customerId = process.env.NAVER_AD_CUSTOMER_ID;
  const apiKey = process.env.NAVER_AD_API_KEY;
  const secretKey = process.env.NAVER_AD_SECRET_KEY;
  return {
    configured: isNaverAdConfigured(),
    customerId: customerId ? `${customerId.slice(0, 3)}***` : null,
    apiKey: apiKey ? `${apiKey.slice(0, 8)}…${apiKey.slice(-4)}` : null,
    secretKey: secretKey ? `${secretKey.slice(0, 4)}…` : null,
  };
}
