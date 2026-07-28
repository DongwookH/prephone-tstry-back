import {
  readRange,
  appendRows,
  batchUpdateValues,
  ensureSheetTab,
} from "./sheets";

/**
 * 테넌트 세부 가이드 로더 — 전용 시트의 guide 탭.
 *
 * 병합 규칙 (2026-07-25 사업주 확정):
 *   세부 가이드가 공통 가이드보다 우선. 빈 섹션만 공통을 따른다.
 *   단 brand_name·links·company는 "필수" — 폴백 금지 (오너 회사 정보가
 *   남의 글에 들어가는 사고 방지). 비어 있으면 그 테넌트 생성을 건너뛴다.
 *   요금표는 아예 받지 않는다 — 같은 상품을 파는 판매점이라 항상 공통
 *   요금표(knowledge-base/02-plans)를 쓴다 (2026-07-28 사업주 결정).
 *
 * 저장 구조 (2026-07-27 백오피스 폼 도입):
 *   시트를 단일 저장소로 유지한 채 섹션 "행"만 세분화했다
 *   (link_kakao·link_site·phone·hours 신설). 조립은 읽는 쪽인 이 파일에서만
 *   하므로 post-generator·generate-tenants는 손대지 않는다 — TenantGuide 타입
 *   자체가 그대로이기 때문. 기존 links·company 자유형식 행도 계속 읽는다
 *   (하위호환 + 폼이 못 다루는 긴 원문의 보존 창구).
 *
 * guide 탭 열: A section / B 설명 / C content / D updated_at
 */

/** 글 생성 파이프라인이 받는 최종 형태. 이 타입은 바뀌지 않는다. */
export type TenantGuide = {
  brand_name: string;
  links: Array<{ label: string; url: string }>;
  company: string;
  personas: string;
  banned_words: string[];
  extra_rules: string;
  faq: string;
};

/** 시트 guide 탭에 그대로 저장되는 원문 형태 (= 백오피스 폼의 입력 단위). */
export type TenantGuideRaw = {
  brand_name: string;
  link_kakao: string;
  link_site: string;
  phone: string;
  hours: string;
  /** 「고급: 직접 입력」 — 자동 조립 문장에 이어붙는 회사 소개 원문 */
  company: string;
  /** 「고급: 직접 입력」 — '이름: URL' 자유형식 (하위호환) */
  links: string;
  personas: string;
  banned_words: string;
  extra_rules: string;
  faq: string;
};

export type GuideSectionKey = keyof TenantGuideRaw;

export const GUIDE_TAB = "guide";
export const GUIDE_HEADERS = ["section", "설명", "content", "updated_at"] as const;

/**
 * guide 탭 스캐폴드 정의 — 신규 테넌트 시트 발급 때 이 순서로 행이 깔린다.
 * B열 설명은 시트를 직접 여는 사람을 위한 것 (백오피스 폼에는 별도 문구 사용).
 */
export const GUIDE_SECTION_DEFS: ReadonlyArray<{
  key: GuideSectionKey;
  desc: string;
}> = [
  {
    key: "brand_name",
    desc: "(필수) 글에 표기할 판매점명/브랜드명 한 줄. 예: 홍길동텔레콤",
  },
  {
    key: "link_site",
    desc: "(필수 중 택1) 개통 신청 페이지 URL. 글 상단 첫 번째 버튼이 됩니다.",
  },
  {
    key: "link_kakao",
    desc: "(필수 중 택1) 카카오톡 채널 URL. 글 상단 두 번째 버튼이 됩니다.",
  },
  {
    key: "phone",
    desc: "(회사 정보 중 택1) 상담 전화번호. 예: 010-0000-0000",
  },
  {
    key: "hours",
    desc: "(회사 정보 중 택1) 영업시간. 예: 평일 09:00~19:00, 주말 휴무",
  },
  {
    key: "company",
    desc: "(회사 정보 중 택1) 위 항목 외에 덧붙일 회사 소개. 판매점명·전화·영업시간은 자동으로 붙으므로 중복해서 적을 필요 없습니다.",
  },
  {
    key: "links",
    desc: "추가 링크. 한 줄에 하나씩 '이름: URL' 형식. 개통 신청·카카오톡 외에 더 넣고 싶을 때만 사용합니다.",
  },
  {
    key: "personas",
    desc: "글을 읽을 타깃 독자 유형. 한 줄에 하나씩. 비워두면 공통 기본 페르소나를 사용합니다.",
  },
  {
    key: "banned_words",
    desc: "글에 쓰면 안 되는 단어·표현 (콤마로 구분). 공통 품질 금지어에 추가로 적용됩니다.",
  },
  {
    key: "extra_rules",
    desc: "그 밖의 글 작성 규칙 (톤, 강조할 메시지, 피할 주제 등). 공통 가이드와 충돌하면 이 내용이 우선합니다.",
  },
  {
    key: "faq",
    desc: "자주 받는 질문과 답변. 글의 Q&A 절에 반영됩니다.",
  },
];

const EMPTY_RAW: TenantGuideRaw = {
  brand_name: "",
  link_kakao: "",
  link_site: "",
  phone: "",
  hours: "",
  company: "",
  links: "",
  personas: "",
  banned_words: "",
  extra_rules: "",
  faq: "",
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

/** 단독 URL 한 줄을 링크로. 값이 없거나 http(s)가 아니면 무시. */
function singleLink(
  raw: string,
  label: string,
): Array<{ label: string; url: string }> {
  const url = (raw || "").trim();
  if (!/^https?:\/\/\S+$/i.test(url)) return [];
  return [{ label, url }];
}

/**
 * 원문 → 글 생성용 형태로 조립.
 *
 *  links   = 개통 신청(link_site) → 카카오톡 상담(link_kakao) → links 자유형식.
 *            post-generator가 [0]을 대표 버튼, [1]을 문의 버튼으로 쓰므로 이 순서.
 *            라벨에 이모지를 넣지 않는다 (extra_rules로 이모지를 금지한
 *            테넌트가 있을 수 있음 — 자동 생성분이 그 규칙을 어기면 안 된다).
 *  company = 자동 조립 문장(판매점명·전화·영업시간) + company 원문.
 *            판매점명만 있고 연락 수단이 하나도 없으면 조립하지 않는다 —
 *            그건 "회사 정보"라고 부를 수 없고, 필수 검증도 통과하면 안 되기 때문.
 */
export function assembleGuide(raw: TenantGuideRaw): TenantGuide {
  const brand = (raw.brand_name || "").trim();
  const phone = (raw.phone || "").trim();
  const hours = (raw.hours || "").trim();
  const companyNote = (raw.company || "").trim();

  const contactParts: string[] = [];
  if (phone) contactParts.push(`전화 ${phone}`);
  if (hours) contactParts.push(`영업시간 ${hours}`);
  const autoCompany =
    contactParts.length > 0
      ? `${brand ? `${brand} — ` : ""}${contactParts.join(", ")}`
      : "";

  return {
    brand_name: brand,
    links: [
      ...singleLink(raw.link_site, "개통 신청"),
      ...singleLink(raw.link_kakao, "카카오톡 상담"),
      ...parseLinks(raw.links),
    ],
    company: [autoCompany, companyNote].filter(Boolean).join("\n"),
    personas: (raw.personas || "").trim(),
    banned_words: (raw.banned_words || "")
      .split(/[,\n]/)
      .map((w) => w.trim())
      .filter(Boolean),
    extra_rules: (raw.extra_rules || "").trim(),
    faq: (raw.faq || "").trim(),
  };
}

/** 전용 시트에서 원문 그대로 로드. 탭이 없으면 모든 섹션 빈 값. */
export async function loadTenantGuideRaw(
  spreadsheetId: string,
): Promise<TenantGuideRaw> {
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
  const out = { ...EMPTY_RAW };
  for (const { key } of GUIDE_SECTION_DEFS) {
    out[key] = bySection.get(key) ?? "";
  }
  return out;
}

/** 전용 시트에서 세부 가이드 로드 (조립본). 탭이 없으면 모든 섹션 빈 값. */
export async function loadTenantGuide(
  spreadsheetId: string,
): Promise<TenantGuide> {
  return assembleGuide(await loadTenantGuideRaw(spreadsheetId));
}

/**
 * 필수 섹션 검증 — 비어 있는 필수 섹션 목록 반환 (빈 배열 = 통과).
 * 반환 문자열은 generate-tenants 로그와 백오피스 진행률 표시에 함께 쓰인다.
 */
export function missingRequiredGuideSections(g: TenantGuide): string[] {
  const missing: string[] = [];
  if (!g.brand_name) missing.push("brand_name");
  if (g.links.length === 0) missing.push("links");
  if (!g.company) missing.push("company");
  // 요금표는 입력 항목 자체가 없다 — 항상 공통 요금표를 쓴다 (2026-07-28).
  // brand_name·links·company는 테넌트 고유 정보라 폴백하면 남의 회사 정보가
  // 글에 들어가므로 필수 유지.
  return missing;
}

/**
 * 백오피스 폼 → 시트 저장. 섹션 행이 있으면 C·D열만 갱신하고, 없으면 뒤에 추가한다.
 * 사용자가 시트에 직접 만든 알 수 없는 행은 건드리지 않는다 (파괴적 재작성 금지).
 */
export async function saveTenantGuideRaw(
  spreadsheetId: string,
  raw: TenantGuideRaw,
): Promise<void> {
  await ensureSheetTab(spreadsheetId, GUIDE_TAB, [...GUIDE_HEADERS]);

  let rows: string[][] = [];
  try {
    rows = await readRange(spreadsheetId, `${GUIDE_TAB}!A:D`);
  } catch {
    rows = [];
  }
  // section → 시트 행 번호 (1-based, 헤더가 1행)
  const rowOf = new Map<string, number>();
  rows.forEach((r, i) => {
    if (i === 0) return;
    const section = (r?.[0] ?? "").trim().toLowerCase();
    if (section && !rowOf.has(section)) rowOf.set(section, i + 1);
  });

  const now = new Date().toISOString();
  const updates: Array<{ range: string; values: string[][] }> = [];
  const appends: string[][] = [];

  for (const { key, desc } of GUIDE_SECTION_DEFS) {
    const content = (raw[key] ?? "").trim();
    const at = rowOf.get(key);
    if (at) {
      updates.push({
        range: `${GUIDE_TAB}!C${at}:D${at}`,
        values: [[content, now]],
      });
    } else {
      appends.push([key, desc, content, now]);
    }
  }

  await batchUpdateValues(spreadsheetId, updates);
  if (appends.length > 0) await appendRows(spreadsheetId, GUIDE_TAB, appends);
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
