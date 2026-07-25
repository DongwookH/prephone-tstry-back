import { readRange } from "./sheets";

/**
 * 테넌트 세부 가이드 로더 — 전용 시트의 guide 탭.
 *
 * 병합 규칙 (2026-07-25 사업주 확정):
 *   세부 가이드가 공통 가이드보다 우선. 빈 섹션만 공통을 따른다.
 *   단 brand_name·links·company·plans는 "필수" — 폴백 금지 (오너 회사 정보가
 *   남의 글에 들어가는 사고 방지). 비어 있으면 그 테넌트 생성을 건너뛴다.
 *
 * guide 탭 열: A section / B 설명 / C content / D updated_at
 */

export type TenantGuide = {
  brand_name: string;
  links: Array<{ label: string; url: string }>;
  company: string;
  plans: string;
  personas: string;
  banned_words: string[];
  extra_rules: string;
  faq: string;
};

/** guide 탭의 links 섹션 파싱 — 한 줄에 '이름: URL' (이름 생략 가능). */
function parseLinks(raw: string): Array<{ label: string; url: string }> {
  const out: Array<{ label: string; url: string }> = [];
  for (const line of (raw || "").split(/\r?\n/)) {
    const m = line.match(/(https?:\/\/\S+)/i);
    if (!m) continue;
    const url = m[1].replace(/[)\].,]+$/, "");
    const label = line
      .slice(0, line.indexOf(m[1]))
      .replace(/[:\-—·]\s*$/, "")
      .trim();
    out.push({ label: label || "바로가기", url });
  }
  return out;
}

/** 전용 시트에서 세부 가이드 로드. 탭이 없으면 모든 섹션 빈 값. */
export async function loadTenantGuide(
  spreadsheetId: string,
): Promise<TenantGuide> {
  let rows: string[][] = [];
  try {
    rows = await readRange(spreadsheetId, "guide!A:D");
  } catch {
    rows = [];
  }
  const bySection = new Map<string, string>();
  for (const r of rows.slice(1)) {
    const section = (r?.[0] ?? "").trim().toLowerCase();
    if (!section) continue;
    bySection.set(section, (r?.[2] ?? "").trim());
  }
  const get = (s: string) => bySection.get(s) ?? "";
  return {
    brand_name: get("brand_name"),
    links: parseLinks(get("links")),
    company: get("company"),
    plans: get("plans"),
    personas: get("personas"),
    banned_words: get("banned_words")
      .split(/[,\n]/)
      .map((w) => w.trim())
      .filter(Boolean),
    extra_rules: get("extra_rules"),
    faq: get("faq"),
  };
}

/** 필수 섹션 검증 — 비어 있는 필수 섹션 목록 반환 (빈 배열 = 통과). */
export function missingRequiredGuideSections(g: TenantGuide): string[] {
  const missing: string[] = [];
  if (!g.brand_name) missing.push("brand_name");
  if (g.links.length === 0) missing.push("links");
  if (!g.company) missing.push("company");
  if (!g.plans) missing.push("plans");
  return missing;
}

/** 전용 시트 settings 탭의 활성 Gemini 키 값 목록. */
export async function loadTenantGeminiKeys(
  spreadsheetId: string,
): Promise<string[]> {
  let rows: string[][] = [];
  try {
    rows = await readRange(spreadsheetId, "settings!A:H");
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const r of rows.slice(1)) {
    const type = (r?.[1] ?? "").trim();
    const value = (r?.[2] ?? "").trim();
    const enabled = (r?.[4] ?? "").trim();
    if (type === "gemini_key" && value && enabled === "1") out.push(value);
  }
  return out;
}

/** URL에 utm 파라미터 부착 (이미 쿼리가 있으면 &로). */
export function withUtm(url: string, utmCampaign: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}utm_source=tistory&utm_medium=blog&utm_campaign=${utmCampaign}`;
}
