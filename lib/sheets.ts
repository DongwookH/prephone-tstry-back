import { google } from "googleapis";
import type { sheets_v4 } from "googleapis";

/**
 * Google Sheets API 클라이언트.
 *
 * 환경변수:
 *  - GOOGLE_SHEETS_CLIENT_EMAIL : 서비스 계정 client_email
 *  - GOOGLE_SHEETS_PRIVATE_KEY  : 서비스 계정 private_key (JSON 그대로, \n 포함)
 *  - GOOGLE_SHEETS_ID           : 메인 시트 ID (posts/users/publish_logs/daily_quota)
 *  - KEYWORDS_SHEET_ID          : (선택) 키워드 전용 시트 ID. 없으면 GOOGLE_SHEETS_ID 사용
 */

let cachedClient: sheets_v4.Sheets | null = null;

function getClient(): sheets_v4.Sheets {
  if (cachedClient) return cachedClient;

  const email = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const rawKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new Error(
      "GOOGLE_SHEETS_CLIENT_EMAIL / GOOGLE_SHEETS_PRIVATE_KEY 가 설정되지 않았습니다.",
    );
  }
  // .env에 \n으로 들어있는 줄바꿈을 실제 줄바꿈으로
  const privateKey = rawKey.replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  cachedClient = google.sheets({ version: "v4", auth });
  return cachedClient;
}

export function mainSheetId(): string {
  const id = process.env.GOOGLE_SHEETS_ID;
  if (!id) throw new Error("GOOGLE_SHEETS_ID가 설정되지 않았습니다.");
  return id;
}

export function keywordsSheetId(): string {
  return process.env.KEYWORDS_SHEET_ID || mainSheetId();
}

/**
 * 원시 행 데이터를 가져옴. range 예: "posts!A:Z" 또는 "keywords!A1:K100"
 */
export async function readRange(
  spreadsheetId: string,
  range: string,
): Promise<string[][]> {
  const sheets = getClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return (res.data.values ?? []) as string[][];
}

/**
 * 헤더+데이터를 객체 배열로 변환.
 * 첫 행이 "💡"로 시작하면 코멘트 행으로 보고 그 다음 행을 헤더로 사용.
 */
export async function readSheetAsObjects<T = Record<string, string>>(
  spreadsheetId: string,
  sheetName: string,
): Promise<T[]> {
  const rows = await readRange(spreadsheetId, `${sheetName}!A:Z`);
  if (rows.length < 2) return [];
  let headerIdx = 0;
  if (rows[0]?.[0]?.startsWith("💡")) headerIdx = 1;
  const headers = rows[headerIdx] ?? [];
  return rows.slice(headerIdx + 1).map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (row[i] ?? "").toString();
    });
    return obj as T;
  });
}

/**
 * 시트에 행 추가 (append).
 */
export async function appendRow(
  spreadsheetId: string,
  sheetName: string,
  values: (string | number | boolean)[],
): Promise<void> {
  const sheets = getClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:Z`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [values.map((v) => v ?? "")] },
  });
}

/**
 * 시트에 여러 행 한 번에 추가.
 */
export async function appendRows(
  spreadsheetId: string,
  sheetName: string,
  rows: (string | number | boolean)[][],
): Promise<void> {
  if (rows.length === 0) return;
  const sheets = getClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:Z`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: rows.map((r) => r.map((v) => v ?? "")),
    },
  });
}

/**
 * 특정 셀 업데이트 (예: keywords 시트의 used_count 증가).
 */
export async function updateCell(
  spreadsheetId: string,
  range: string,
  value: string | number | boolean,
): Promise<void> {
  const sheets = getClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[value]] },
  });
}

// ─── 도메인 모델 ───────────────────────────────────────────

export type KeywordRow = {
  id?: string;
  keyword: string;
  category?: string;
  priority?: "high" | "normal" | "low" | "";
  role?: "main" | "sub" | "";
  search_volume?: string;
  search_volume_pc?: string;
  search_volume_mobile?: string;
  competition?: string;
  used_count?: string;
  last_used?: string;
  status?: "active" | "paused" | "archived" | "used" | "blacklisted" | "";
  notes?: string;
  source?: "manual" | "auto" | "";
  created_at?: string;
};

/**
 * keywords 시트에서 특정 키워드의 status를 'blacklisted'로 변경.
 * 같은 키워드가 여러 row면 모두 처리. 다음 cron부터 픽 안 됨.
 *
 * @returns 변경된 row 개수
 */
export async function blacklistKeyword(
  keyword: string,
): Promise<{ updated: number }> {
  if (!keyword.trim()) return { updated: 0 };
  const sheets = getClient();
  const id = keywordsSheetId();

  const raw = await readRange(id, "keywords!A1:Z");
  if (raw.length < 2) return { updated: 0 };

  // 헤더 위치 (💡 코멘트 행 자동 감지)
  let headerRowIdx = 0;
  if (raw[0]?.[0]?.startsWith("💡")) headerRowIdx = 1;
  const headers = raw[headerRowIdx] ?? [];

  const kwCol = headers.findIndex((h) => h === "keyword");
  const statusCol = headers.findIndex((h) => h === "status");
  if (kwCol < 0 || statusCol < 0) {
    throw new Error(
      `keywords 시트 헤더에 keyword/status 컬럼 없음: keyword(${kwCol}) status(${statusCol})`,
    );
  }
  const statusColLetter = String.fromCharCode(
    "A".charCodeAt(0) + statusCol,
  );

  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const target = norm(keyword);

  const requests: { range: string; values: string[][] }[] = [];
  for (let i = headerRowIdx + 1; i < raw.length; i++) {
    const row = raw[i];
    const cellKw = (row[kwCol] ?? "").toString();
    if (!cellKw || norm(cellKw) !== target) continue;
    const sheetRow = i + 1;
    requests.push({
      range: `keywords!${statusColLetter}${sheetRow}`,
      values: [["blacklisted"]],
    });
  }

  if (requests.length === 0) return { updated: 0 };
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: id,
    requestBody: { valueInputOption: "USER_ENTERED", data: requests },
  });
  return { updated: requests.length };
}

/**
 * keywords 시트에서 status=active(또는 비어있음) + keyword 비어있지 않은 행만.
 */
export async function getActiveKeywords(opts?: {
  source?: "manual" | "auto";
}): Promise<KeywordRow[]> {
  const all = await readSheetAsObjects<KeywordRow>(
    keywordsSheetId(),
    "keywords",
  );
  return all.filter((r) => {
    if (!r.keyword?.trim()) return false;
    if (r.status && r.status !== "active") return false;
    if (opts?.source && r.source && r.source !== opts.source) return false;
    return true;
  });
}

/**
 * 키워드 N개 선택. 다양성 + 안전망 우선.
 *
 * 정렬 기준 (위에서 아래로):
 *  1. priority (high > normal > low)
 *  2. used_count 낮은 순 (덜 쓴 키워드 우선)
 *  3. 동률이면 무작위 shuffle — 매일 다른 키워드 보장
 *
 * 필터:
 *  - 최근 N일(default 7) 내 사용한 키워드는 1차 후보에서 제외
 *  - 후보가 부족하면 (count보다 적으면) 제외 풀어서 다시 시도
 */
export function pickKeywordsForToday(
  keywords: KeywordRow[],
  count: number,
  options: { excludeRecentDays?: number } = {},
): KeywordRow[] {
  const excludeRecentDays = options.excludeRecentDays ?? 7;
  const order = { high: 0, normal: 1, low: 2 };

  // KST 기준 today
  const todayKST = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  // N일 전 KST 날짜 (cutoff) — last_used 이게 이거보다 새것이면 "최근 사용"
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - excludeRecentDays);
  const cutoffKST = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(cutoffDate);

  function isRecentlyUsed(k: KeywordRow): boolean {
    const lu = (k.last_used || "").slice(0, 10);
    if (!lu) return false;
    // YYYY-MM-DD 형식 문자열 비교 (사전순 = 시간순)
    return lu >= cutoffKST;
  }

  // 동률 시 deterministic 순서 X → seeded 해시로 매일 다르게
  // 키워드 문자열 + 오늘 날짜로 해시 → 같은 날엔 안정적이지만 매일 다른 순서
  function tiebreakHash(kw: string): number {
    const s = `${kw}-${todayKST}`;
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) | 0;
    }
    return h;
  }

  function sortPool(pool: KeywordRow[]): KeywordRow[] {
    return [...pool].sort((a, b) => {
      const pa = order[(a.priority || "normal") as keyof typeof order] ?? 1;
      const pb = order[(b.priority || "normal") as keyof typeof order] ?? 1;
      if (pa !== pb) return pa - pb;
      const ua = parseInt(a.used_count || "0", 10);
      const ub = parseInt(b.used_count || "0", 10);
      if (ua !== ub) return ua - ub;
      // 동률 — 매일 다른 순서 (date 기반 hash로 결정)
      return tiebreakHash(a.keyword) - tiebreakHash(b.keyword);
    });
  }

  // 1차: 최근 N일 사용한 키워드 제외
  const freshPool = keywords.filter((k) => !isRecentlyUsed(k));
  const fresh = sortPool(freshPool).slice(0, count);

  if (fresh.length >= count) {
    return fresh;
  }

  // 부족하면 풀 풀기 — 최근 사용 키워드도 후보로 (단 우선순위 떨어지게)
  const usedKwSet = new Set(fresh.map((k) => k.keyword));
  const restPool = keywords.filter((k) => !usedKwSet.has(k.keyword));
  const filler = sortPool(restPool).slice(0, count - fresh.length);

  return [...fresh, ...filler];
}

// ─── posts ────────────────────────────────────────────

export type PostStatus = "ready" | "published" | "failed" | "archived" | "";

export type PostRow = {
  id: string;
  title: string;
  keyword: string;
  category: string;
  persona: string;
  content_md: string;
  content_html: string;
  char_count: string;
  seo_score: string;
  status: PostStatus;
  scheduled_at: string;
  published_at: string;
  tistory_url: string;
  image_urls: string;
  ga_pageviews: string;
  ga_clicks: string;
  ga_conversions: string;
  utm_campaign: string;
  created_at: string;
  updated_at: string;
  tags?: string; // 쉼표 구분 문자열 ("선불폰, 비대면개통, KT바로유심" 등)
};

/** posts 시트 전체 (예시/빈 행 자동 필터). */
export async function getAllPosts(): Promise<PostRow[]> {
  const all = await readSheetAsObjects<PostRow>(mainSheetId(), "posts");
  return all.filter((p) => p.id?.trim() && p.title?.trim());
}

/**
 * 최근 글 N개의 제목을 반환 (제목 클리셰 회피용 — Gemini 프롬프트에 주입).
 * 최신순 정렬 (id desc 가정).
 */
export async function getRecentPostTitles(limit = 25): Promise<string[]> {
  const all = await getAllPosts();
  // id는 p-YYYYMMDD-NNN 형태 — 단순 sort로 최신순
  const sorted = all.slice().sort((a, b) => (b.id || "").localeCompare(a.id || ""));
  return sorted
    .map((p) => (p.title || "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

export async function getPostByIdFromSheet(
  id: string,
): Promise<PostRow | null> {
  const all = await getAllPosts();
  return all.find((p) => p.id === id) ?? null;
}

/**
 * posts 시트에서 특정 ID 행을 찾아 status (+ tistory_url) 업데이트.
 * 행 번호를 찾기 위해 전체 시트 1열을 읽어서 매칭.
 */
export async function updatePostStatus(
  postId: string,
  newStatus: PostStatus,
  tistoryUrl?: string,
): Promise<{ ok: boolean; row?: number }> {
  const sheets = getClient();
  const id = mainSheetId();

  // 1) id 컬럼만 읽어서 행 번호 찾기 (1행 헤더, 2행 첫 데이터)
  const idCol = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: "posts!A:A",
  });
  const rows = (idCol.data.values ?? []) as string[][];
  let targetRow = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === postId) {
      targetRow = i + 1; // 1-indexed
      break;
    }
  }
  if (targetRow < 0) return { ok: false };

  // 2) status 컬럼(J=10번째), tistory_url 컬럼(M=13번째) 위치 — posts 헤더 기준
  // headers: id(A) title(B) keyword(C) category(D) persona(E) content_md(F)
  //          content_html(G) char_count(H) seo_score(I) status(J) scheduled_at(K)
  //          published_at(L) tistory_url(M) image_urls(N) ga_pageviews(O)
  //          ga_clicks(P) ga_conversions(Q) utm_campaign(R) created_at(S) updated_at(T)
  const requests: { range: string; values: string[][] }[] = [
    {
      range: `posts!J${targetRow}`,
      values: [[newStatus]],
    },
    {
      range: `posts!T${targetRow}`,
      values: [[new Date().toISOString()]],
    },
  ];
  if (newStatus === "published") {
    requests.push({
      range: `posts!L${targetRow}`,
      values: [[new Date().toISOString()]],
    });
  }
  if (tistoryUrl !== undefined) {
    requests.push({
      range: `posts!M${targetRow}`,
      values: [[tistoryUrl]],
    });
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: id,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: requests,
    },
  });

  return { ok: true, row: targetRow };
}

/**
 * posts 시트에 새 글들을 한 번에 추가.
 * 컬럼 순서는 시트 헤더와 동일.
 */
export async function appendPosts(
  posts: Array<{
    id: string;
    title: string;
    keyword: string;
    category?: string;
    persona?: string;
    content_md?: string;
    content_html?: string;
    char_count?: number;
    seo_score?: number;
    status?: PostStatus;
    scheduled_at?: string;
    published_at?: string;
    tistory_url?: string;
    image_urls?: string;
    ga_pageviews?: number;
    ga_clicks?: number;
    ga_conversions?: number;
    utm_campaign?: string;
    created_at?: string;
    updated_at?: string;
    tags?: string | string[]; // 쉼표 구분 문자열 또는 배열
  }>,
): Promise<void> {
  if (posts.length === 0) return;
  const now = new Date().toISOString();
  const rows = posts.map((p) => [
    p.id,
    p.title,
    p.keyword,
    p.category ?? "",
    p.persona ?? "",
    p.content_md ?? "",
    p.content_html ?? "",
    p.char_count ?? 0,
    p.seo_score ?? 0,
    p.status ?? "ready",
    p.scheduled_at ?? "",
    p.published_at ?? "",
    p.tistory_url ?? "",
    p.image_urls ?? "",
    p.ga_pageviews ?? 0,
    p.ga_clicks ?? 0,
    p.ga_conversions ?? 0,
    p.utm_campaign ?? "",
    p.created_at ?? now,
    p.updated_at ?? now,
    Array.isArray(p.tags) ? p.tags.join(", ") : (p.tags ?? ""),
  ]);
  await appendRows(mainSheetId(), "posts", rows);
}

/**
 * keywords 시트의 used_count 증가 + last_used 갱신.
 * 키워드 N개를 한 번에 처리.
 *
 * ⚠️ 시트에 💡 코멘트 행이 있는지 동적으로 감지해서 정확한 row 번호 계산.
 */
export async function bumpKeywordsUsage(
  keywords: string[],
): Promise<{ updated: number }> {
  if (keywords.length === 0) return { updated: 0 };
  const sheets = getClient();
  const id = keywordsSheetId();

  // 시트 raw row를 직접 읽어서 헤더/코멘트 위치를 정확히 파악
  const raw = await readRange(id, "keywords!A1:Z");
  if (raw.length < 2) return { updated: 0 };

  // 코멘트 행 (💡로 시작) 위치 판정
  let headerRowIdx = 0;
  if (raw[0]?.[0]?.startsWith("💡")) headerRowIdx = 1;
  const headers = raw[headerRowIdx] ?? [];

  // 컬럼 인덱스를 헤더에서 직접 찾음 (하드코딩 X)
  const kwCol = headers.findIndex((h) => h === "keyword");
  const usedCol = headers.findIndex((h) => h === "used_count");
  const lastCol = headers.findIndex((h) => h === "last_used");
  if (kwCol < 0 || usedCol < 0 || lastCol < 0) {
    throw new Error(
      `keywords 시트 헤더에 필수 컬럼 누락: keyword(${kwCol}) used_count(${usedCol}) last_used(${lastCol})`,
    );
  }

  // KST 기준 today (pickKeywordsForToday와 비교 시점이 일치해야 함)
  // ⚠️ 이전엔 toISOString() = UTC date 였는데, cron이 UTC 23:45에 실행되면
  //    저장 날짜는 어제(UTC), 비교 날짜는 오늘(KST)로 1일 차이가 나서
  //    "오늘 이미 사용한 키워드 제외" 필터가 작동 안 했음.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const targetSet = new Set(keywords.map(norm));

  // 데이터 시작 행 (시트 기준 1-indexed)
  // 코멘트 없으면: 헤더=1, 데이터=2부터
  // 코멘트 있으면: 코멘트=1, 헤더=2, 데이터=3부터
  const dataStartRow = headerRowIdx + 2;
  const usedColLetter = String.fromCharCode("A".charCodeAt(0) + usedCol);
  const lastColLetter = String.fromCharCode("A".charCodeAt(0) + lastCol);

  const requests: { range: string; values: (string | number)[][] }[] = [];
  let updated = 0;

  // raw 데이터 행 순회 (헤더 다음 행부터)
  for (let i = headerRowIdx + 1; i < raw.length; i++) {
    const row = raw[i];
    const keyword = row[kwCol] ?? "";
    if (!keyword) continue;
    if (!targetSet.has(norm(keyword))) continue;
    const currentUsed = parseInt(row[usedCol] || "0", 10);
    const sheetRowNum = i + 1; // 1-indexed sheet row
    requests.push(
      {
        range: `keywords!${usedColLetter}${sheetRowNum}`,
        values: [[currentUsed + 1]],
      },
      {
        range: `keywords!${lastColLetter}${sheetRowNum}`,
        values: [[today]],
      },
    );
    updated++;
  }

  if (requests.length === 0) return { updated: 0 };
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: id,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: requests,
    },
  });
  return { updated };
}

/** 사이드바용 카운트 — 가벼운 호출. */
export async function getSidebarCounts(): Promise<{
  postsCount: number;
  keywordsCount: number;
}> {
  try {
    const [posts, keywords] = await Promise.all([
      getAllPosts(),
      getActiveKeywords(),
    ]);
    return { postsCount: posts.length, keywordsCount: keywords.length };
  } catch {
    return { postsCount: 0, keywordsCount: 0 };
  }
}

/** 임의의 Date를 KST 기준 YYYY-MM-DD 문자열로. */
export function toKstDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * KST 기준 오늘 created_at인 글만.
 *
 * ⚠️ created_at은 UTC ISO 문자열로 저장됨 (예: "2026-05-22T23:23:00.000Z").
 * 그냥 slice(0,10) 비교하면 UTC 날짜와 KST 오늘이 안 맞음.
 * (cron이 UTC 22~23시 = KST 07~08시에 실행될 때 UTC 날짜는 어제로 표시됨)
 * → Date 객체로 파싱 후 KST timezone으로 변환해서 비교.
 */
export async function getTodayPosts(): Promise<PostRow[]> {
  const all = await getAllPosts();
  const todayKST = toKstDate(new Date());
  return all.filter((p) => {
    if (!p.created_at) return false;
    return toKstDate(p.created_at) === todayKST;
  });
}

// ═══════════════════════════════════════════════════════════════
// settings 시트 — Gemini 키 관리용
// ═══════════════════════════════════════════════════════════════
// 구조 (헤더):
//   id | type | value | label | enabled | created_at | last_used | usage_count
// type:
//   - gemini_key : Gemini API 키 (value=실제 키)
//   - gemini_model : 모델 이름 (value=gemini-2.5-flash-lite 등)
// ─────────────────────────────────────────────────────────────────

export type SettingRow = {
  id: string;
  type: string;
  value: string;
  label: string;
  enabled: string; // "1" | "0"
  created_at: string;
  last_used: string;
  usage_count: string;
};

const SETTINGS_SHEET = "settings";
const SETTINGS_HEADERS = [
  "id",
  "type",
  "value",
  "label",
  "enabled",
  "created_at",
  "last_used",
  "usage_count",
];

/**
 * settings 시트가 없으면 만들고 헤더 채워둠. 1회 호출로 충분.
 */
export async function ensureSettingsSheet(): Promise<void> {
  const sheets = getClient();
  const id = mainSheetId();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: id,
    fields: "sheets.properties.title",
  });
  const exists = meta.data.sheets?.some(
    (s) => s.properties?.title === SETTINGS_SHEET,
  );
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: [
          { addSheet: { properties: { title: SETTINGS_SHEET } } },
        ],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `${SETTINGS_SHEET}!A1:H1`,
      valueInputOption: "RAW",
      requestBody: { values: [SETTINGS_HEADERS] },
    });
  }
}

/** settings 시트의 모든 행. */
export async function readSettings(): Promise<SettingRow[]> {
  try {
    return await readSheetAsObjects<SettingRow>(mainSheetId(), SETTINGS_SHEET);
  } catch {
    // 시트가 아직 없으면 빈 배열
    return [];
  }
}

/** type=gemini_key 인 활성 키만. enabled=="1". */
export async function getGeminiKeysFromSheet(): Promise<SettingRow[]> {
  const all = await readSettings();
  return all.filter(
    (r) => r.type === "gemini_key" && r.enabled === "1" && r.value,
  );
}

/** 추가 — 새 row 생성. */
export async function addGeminiKey(
  value: string,
  label: string,
): Promise<{ id: string }> {
  await ensureSettingsSheet();
  const now = new Date().toISOString();
  const newId = `gk-${Date.now()}`;
  await appendRow(mainSheetId(), SETTINGS_SHEET, [
    newId,
    "gemini_key",
    value,
    label || "",
    "1",
    now,
    "",
    "0",
  ]);
  return { id: newId };
}

// ─── GA properties (블로그별 GA4) ───────────────────────────
// settings 시트에 type=ga_property 행으로 저장.
// value = JSON: {property_id, measurement_id, tistory_url?}
// label = 사람이 보는 블로그 이름 (예: "메인 블로그", "서브1")

export type GaPropertyRow = {
  id: string;
  label: string;
  property_id: string;
  measurement_id: string;
  tistory_url: string;
  enabled: boolean;
};

/** 등록된 GA properties (활성만) — 라벨 알파벳순. */
export async function getGaProperties(): Promise<GaPropertyRow[]> {
  const all = await readSettings();
  const rows = all
    .filter((r) => r.type === "ga_property" && r.enabled === "1" && r.value)
    .map((r) => {
      try {
        const v = JSON.parse(r.value) as {
          property_id?: string;
          measurement_id?: string;
          tistory_url?: string;
        };
        const row: GaPropertyRow = {
          id: r.id,
          label: r.label || "(이름 없음)",
          property_id: v.property_id || "",
          measurement_id: v.measurement_id || "",
          tistory_url: v.tistory_url || "",
          enabled: true,
        };
        return row;
      } catch {
        return null;
      }
    })
    .filter((x): x is GaPropertyRow => x !== null && !!x.property_id);

  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

/** GA property 추가. */
export async function addGaProperty(opts: {
  label: string;
  property_id: string;
  measurement_id?: string;
  tistory_url?: string;
}): Promise<{ id: string }> {
  await ensureSettingsSheet();
  const now = new Date().toISOString();
  const newId = `ga-${Date.now()}`;
  const value = JSON.stringify({
    property_id: opts.property_id.trim(),
    measurement_id: (opts.measurement_id || "").trim(),
    tistory_url: (opts.tistory_url || "").trim(),
  });
  await appendRow(mainSheetId(), SETTINGS_SHEET, [
    newId,
    "ga_property",
    value,
    opts.label.trim(),
    "1",
    now,
    "",
    "0",
  ]);
  return { id: newId };
}

/** GA property 비활성화 (enabled=0). */
export async function disableGaProperty(id: string): Promise<boolean> {
  const sheets = getClient();
  const spreadsheetId = mainSheetId();
  const rows = await readRange(spreadsheetId, `${SETTINGS_SHEET}!A:H`);
  if (rows.length < 2) return false;
  let headerIdx = 0;
  if (rows[0]?.[0]?.startsWith("💡")) headerIdx = 1;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    if (rows[i]?.[0] === id) {
      const rowNum = i + 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SETTINGS_SHEET}!E${rowNum}`,
        valueInputOption: "RAW",
        requestBody: { values: [["0"]] },
      });
      return true;
    }
  }
  return false;
}

/** 비활성화 (실제 삭제 X — enabled=0). */
export async function disableGeminiKey(id: string): Promise<boolean> {
  const sheets = getClient();
  const spreadsheetId = mainSheetId();
  const rows = await readRange(spreadsheetId, `${SETTINGS_SHEET}!A:H`);
  if (rows.length < 2) return false;
  // header row 자동 감지
  let headerIdx = 0;
  if (rows[0]?.[0]?.startsWith("💡")) headerIdx = 1;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    if (rows[i]?.[0] === id) {
      const rowNum = i + 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SETTINGS_SHEET}!E${rowNum}`,
        valueInputOption: "RAW",
        requestBody: { values: [["0"]] },
      });
      return true;
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════
// gemini_usage 시트 — Gemini 토큰 사용량 누적
// ═══════════════════════════════════════════════════════════════
// 구조 (헤더): date(YYYY-MM-DD) | model | calls | input_tokens | output_tokens | total_tokens
// 같은 date+model 조합은 누적해서 update.
// ─────────────────────────────────────────────────────────────────

export type UsageRow = {
  date: string;
  model: string;
  calls: string;
  input_tokens: string;
  output_tokens: string;
  total_tokens: string;
};

const USAGE_SHEET = "gemini_usage";
const USAGE_HEADERS = [
  "date",
  "model",
  "calls",
  "input_tokens",
  "output_tokens",
  "total_tokens",
];

async function ensureUsageSheet(): Promise<void> {
  const sheets = getClient();
  const id = mainSheetId();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: id,
    fields: "sheets.properties.title",
  });
  const exists = meta.data.sheets?.some(
    (s) => s.properties?.title === USAGE_SHEET,
  );
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: [{ addSheet: { properties: { title: USAGE_SHEET } } }],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `${USAGE_SHEET}!A1:F1`,
      valueInputOption: "RAW",
      requestBody: { values: [USAGE_HEADERS] },
    });
  }
}

/**
 * 사용량 누적 기록 — 같은 date+model 행이 있으면 update, 없으면 append.
 * 호출 1번당 calls +1, tokens 누적.
 */
export async function bumpGeminiUsage(input: {
  model: string;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  await ensureUsageSheet();
  const todayKST = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const sheets = getClient();
  const spreadsheetId = mainSheetId();
  const rows = await readRange(spreadsheetId, `${USAGE_SHEET}!A:F`);
  let headerIdx = 0;
  if (rows[0]?.[0]?.startsWith("💡")) headerIdx = 1;

  // 같은 date + model 찾기
  for (let i = headerIdx + 1; i < rows.length; i++) {
    if (rows[i]?.[0] === todayKST && rows[i]?.[1] === input.model) {
      const rowNum = i + 1;
      const calls = parseInt(rows[i][2] || "0", 10) + 1;
      const inp = parseInt(rows[i][3] || "0", 10) + input.inputTokens;
      const out = parseInt(rows[i][4] || "0", 10) + input.outputTokens;
      const tot = inp + out;
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${USAGE_SHEET}!C${rowNum}:F${rowNum}`,
        valueInputOption: "RAW",
        requestBody: { values: [[calls, inp, out, tot]] },
      });
      return;
    }
  }
  // 없으면 append
  await appendRow(spreadsheetId, USAGE_SHEET, [
    todayKST,
    input.model,
    1,
    input.inputTokens,
    input.outputTokens,
    input.inputTokens + input.outputTokens,
  ]);
}

/** 최근 N일 사용량 (오래된 순). */
export async function getGeminiUsage(days = 14): Promise<UsageRow[]> {
  let all: UsageRow[];
  try {
    all = await readSheetAsObjects<UsageRow>(mainSheetId(), USAGE_SHEET);
  } catch {
    return [];
  }
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return all
    .filter((r) => r.date >= cutoffStr)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * posts 시트에서 ids에 해당하는 행을 모두 삭제 (중복 row 있어도 전부).
 *
 * 시트 행 인덱스가 삭제 시 변동되지 않도록 가장 큰 행 번호부터 삭제.
 */
export async function deletePostsByIds(
  ids: string[],
): Promise<{ deleted: number; matchedIds: string[]; notFound: string[] }> {
  if (ids.length === 0) {
    return { deleted: 0, matchedIds: [], notFound: [] };
  }
  const sheets = getClient();
  const spreadsheetId = mainSheetId();

  // 1) id 컬럼 읽어서 매치되는 row 번호 찾기 (1-indexed = sheet row)
  const idCol = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "posts!A:A",
  });
  const rows = (idCol.data.values ?? []) as string[][];
  const targetSet = new Set(ids);
  const matchedIds = new Set<string>();
  const matchedRowNums: number[] = []; // 1-indexed

  // 헤더는 첫 행 (코멘트 없는 가정) — 데이터는 2행부터
  for (let i = 1; i < rows.length; i++) {
    const cellId = rows[i]?.[0];
    if (cellId && targetSet.has(cellId)) {
      matchedRowNums.push(i + 1); // 1-indexed
      matchedIds.add(cellId);
    }
  }

  if (matchedRowNums.length === 0) {
    return { deleted: 0, matchedIds: [], notFound: ids };
  }

  // 2) posts 시트의 numeric sheetId 가져오기 (deleteDimension용)
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties",
  });
  const postsSheet = meta.data.sheets?.find(
    (s) => s.properties?.title === "posts",
  );
  const numericSheetId = postsSheet?.properties?.sheetId;
  if (numericSheetId === undefined || numericSheetId === null) {
    throw new Error("posts 시트 메타데이터 못 찾음");
  }

  // 3) 큰 row부터 삭제 — 인덱스 변동 방지
  const sortedDesc = [...matchedRowNums].sort((a, b) => b - a);
  const requests = sortedDesc.map((rowNum) => ({
    deleteDimension: {
      range: {
        sheetId: numericSheetId,
        dimension: "ROWS" as const,
        startIndex: rowNum - 1, // 0-indexed
        endIndex: rowNum, // exclusive
      },
    },
  }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });

  const notFound = ids.filter((id) => !matchedIds.has(id));
  return {
    deleted: matchedRowNums.length,
    matchedIds: Array.from(matchedIds),
    notFound,
  };
}

/**
 * 시트가 정상 연결됐는지 헬스체크.
 */
export async function sheetsHealthCheck() {
  const sheets = getClient();
  const id = mainSheetId();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: id,
    fields: "properties.title,sheets.properties.title",
  });
  return {
    title: meta.data.properties?.title,
    sheets: meta.data.sheets?.map((s) => s.properties?.title) ?? [],
  };
}

// ─── Threads 리서치 초안 (threads_drafts 시트) ──────────────────

export type ThreadsDraftRow = {
  id: string;
  created_at: string;
  keyword: string;
  draft_text: string;
  source_posts: string; // JSON 문자열
  insight: string;
  status:
    | "pending" // 초안 — 검토 대기
    | "scheduled" // 사용자 승인 → 시간 되면 자동 발행
    | "published" // 발행 완료
    | "rejected" // 반려
    | "failed" // 발행 시도 후 실패
    | "";
  published_id: string;
  published_at: string;
  topic_tag: string; // Threads 주제 태그 (선택)
  self_replies: string; // JSON 배열 — 셀프 댓글들 (선택)
  scheduled_at: string; // 예약 발행 시각 ISO (주간 자동화용)
  publish_error: string; // 마지막 발행 에러 (있을 때)
};

const THREADS_DRAFTS_SHEET = "threads_drafts";
const THREADS_DRAFTS_HEADERS = [
  "id",            // A
  "created_at",    // B
  "keyword",       // C
  "draft_text",    // D
  "source_posts",  // E
  "insight",       // F
  "status",        // G
  "published_id",  // H
  "published_at",  // I
  "topic_tag",     // J
  "self_replies",  // K
  "scheduled_at",  // L
  "publish_error", // M
];

/** threads_drafts 시트가 없으면 생성 + 헤더. 있어도 헤더가 옛 버전이면 갱신. */
export async function ensureThreadsDraftsSheet(): Promise<void> {
  const sheets = getClient();
  const id = mainSheetId();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: id,
    fields: "sheets.properties.title",
  });
  const exists = meta.data.sheets?.some(
    (s) => s.properties?.title === THREADS_DRAFTS_SHEET,
  );
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: [
          { addSheet: { properties: { title: THREADS_DRAFTS_SHEET } } },
        ],
      },
    });
  }
  // 헤더가 옛 버전이면 갱신 (A~M 13컬럼)
  const headerRow = await readRange(id, `${THREADS_DRAFTS_SHEET}!A1:M1`);
  const cur = headerRow[0] || [];
  const needsPatch =
    cur.length < THREADS_DRAFTS_HEADERS.length ||
    !cur.includes("topic_tag") ||
    !cur.includes("self_replies") ||
    !cur.includes("scheduled_at") ||
    !cur.includes("publish_error");
  if (needsPatch) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `${THREADS_DRAFTS_SHEET}!A1:M1`,
      valueInputOption: "RAW",
      requestBody: { values: [THREADS_DRAFTS_HEADERS] },
    });
  }
}

/** 초안 1건 추가. */
export async function appendThreadsDraft(d: {
  keyword: string;
  draft_text: string;
  source_posts: unknown;
  insight: string;
  topic_tag?: string;
  self_replies?: string[];
  scheduled_at?: string;
}): Promise<{ id: string }> {
  await ensureThreadsDraftsSheet();
  const id = `td-${Date.now()}-${Math.floor(performance.now()) % 1000}`;
  const now = new Date().toISOString();
  await appendRow(mainSheetId(), THREADS_DRAFTS_SHEET, [
    id,                                            // A id
    now,                                           // B created_at
    d.keyword,                                     // C
    d.draft_text,                                  // D
    JSON.stringify(d.source_posts ?? []),          // E
    d.insight,                                     // F
    "pending",                                     // G status
    "",                                            // H published_id
    "",                                            // I published_at
    d.topic_tag ?? "",                             // J topic_tag
    JSON.stringify(d.self_replies ?? []),          // K self_replies
    d.scheduled_at ?? "",                          // L scheduled_at
    "",                                            // M publish_error
  ]);
  return { id };
}

/** 초안 목록. status 지정 시 필터. */
export async function getThreadsDrafts(
  status?: ThreadsDraftRow["status"],
): Promise<ThreadsDraftRow[]> {
  let all: ThreadsDraftRow[] = [];
  try {
    all = await readSheetAsObjects<ThreadsDraftRow>(
      mainSheetId(),
      THREADS_DRAFTS_SHEET,
    );
  } catch {
    return [];
  }
  const valid = all.filter((r) => r.id?.trim());
  const filtered = status ? valid.filter((r) => r.status === status) : valid;
  // 최신순
  return filtered.sort((a, b) =>
    (b.created_at || "").localeCompare(a.created_at || ""),
  );
}

/** 초안 갱신 — 부분 패치. */
export async function updateThreadsDraft(
  id: string,
  patch: Partial<
    Pick<
      ThreadsDraftRow,
      | "keyword"
      | "draft_text"
      | "insight"
      | "status"
      | "published_id"
      | "published_at"
      | "topic_tag"
      | "self_replies"
      | "scheduled_at"
      | "publish_error"
    >
  >,
): Promise<boolean> {
  const sheets = getClient();
  const spreadsheetId = mainSheetId();
  const rows = await readRange(spreadsheetId, `${THREADS_DRAFTS_SHEET}!A:M`);
  if (rows.length < 2) return false;
  let headerIdx = 0;
  if (rows[0]?.[0]?.startsWith("💡")) headerIdx = 1;
  // 컬럼 인덱스: C=keyword, D=draft_text, F=insight, G=status, H=published_id,
  //              I=published_at, J=topic_tag, K=self_replies, L=scheduled_at, M=publish_error
  for (let i = headerIdx + 1; i < rows.length; i++) {
    if (rows[i]?.[0] !== id) continue;
    const rowNum = i + 1;
    const updates: { range: string; value: string }[] = [];
    if (patch.keyword !== undefined)
      updates.push({ range: `C${rowNum}`, value: patch.keyword });
    if (patch.draft_text !== undefined)
      updates.push({ range: `D${rowNum}`, value: patch.draft_text });
    if (patch.insight !== undefined)
      updates.push({ range: `F${rowNum}`, value: patch.insight });
    if (patch.status !== undefined)
      updates.push({ range: `G${rowNum}`, value: patch.status });
    if (patch.published_id !== undefined)
      updates.push({ range: `H${rowNum}`, value: patch.published_id });
    if (patch.published_at !== undefined)
      updates.push({ range: `I${rowNum}`, value: patch.published_at });
    if (patch.topic_tag !== undefined)
      updates.push({ range: `J${rowNum}`, value: patch.topic_tag });
    if (patch.self_replies !== undefined)
      updates.push({ range: `K${rowNum}`, value: patch.self_replies });
    if (patch.scheduled_at !== undefined)
      updates.push({ range: `L${rowNum}`, value: patch.scheduled_at });
    if (patch.publish_error !== undefined)
      updates.push({ range: `M${rowNum}`, value: patch.publish_error });
    for (const u of updates) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${THREADS_DRAFTS_SHEET}!${u.range}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[u.value]] },
      });
    }
    return true;
  }
  return false;
}

/** 초안 단건 조회. */
export async function getThreadsDraftById(
  id: string,
): Promise<ThreadsDraftRow | null> {
  const all = await getThreadsDrafts();
  return all.find((r) => r.id === id) ?? null;
}

// ─── Threads 전용 키워드 시트 (threads_keywords) ─────────────────
// Threads 자동화에서만 사용. 티스토리 keywords와 별개.
// 감정/페인포인트/꿀팁 톤이 강한 Threads 친화 키워드 풀.

export type ThreadsKeywordRow = {
  id: string;
  keyword: string;
  category: string; // 페인포인트 / 인증결제 / 타겟 / 꿀팁 / 핵심
  priority: "high" | "normal" | "low" | "";
  used_count: string;
  last_used: string;
  status: "active" | "paused" | "blacklisted" | "";
  created_at: string;
};

const THREADS_KEYWORDS_SHEET = "threads_keywords";
const THREADS_KEYWORDS_HEADERS = [
  "id",
  "keyword",
  "category",
  "priority",
  "used_count",
  "last_used",
  "status",
  "created_at",
];

export async function ensureThreadsKeywordsSheet(): Promise<void> {
  const sheets = getClient();
  const id = mainSheetId();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: id,
    fields: "sheets.properties.title",
  });
  const exists = meta.data.sheets?.some(
    (s) => s.properties?.title === THREADS_KEYWORDS_SHEET,
  );
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: [
          { addSheet: { properties: { title: THREADS_KEYWORDS_SHEET } } },
        ],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `${THREADS_KEYWORDS_SHEET}!A1:H1`,
      valueInputOption: "RAW",
      requestBody: { values: [THREADS_KEYWORDS_HEADERS] },
    });
  }
}

// 쓰레드에서 사용 금지 — 미성년자 관련 키워드 (정책상 차단)
const THREADS_MINOR_BLACKLIST = [
  "미성년",
  "청소년",
  "어린이",
  "아동",
  "초등",
  "중등",
  "중학생",
  "고등학생",
  "학생용",
  "자녀",
  "키즈",
  "만14세",
  "만 14세",
  "만15세",
  "만 15세",
  "만17세",
  "만 17세",
  "만18세",
  "만 18세",
  "만19세",
  "만 19세",
] as const;

export function isMinorRelatedKeyword(keyword: string): boolean {
  const k = (keyword || "").toLowerCase().replace(/\s+/g, "");
  return THREADS_MINOR_BLACKLIST.some((bad) =>
    k.includes(bad.toLowerCase().replace(/\s+/g, "")),
  );
}

/** active 키워드만. 미성년자 관련은 자동 제외. */
export async function getActiveThreadsKeywords(): Promise<ThreadsKeywordRow[]> {
  let all: ThreadsKeywordRow[] = [];
  try {
    all = await readSheetAsObjects<ThreadsKeywordRow>(
      mainSheetId(),
      THREADS_KEYWORDS_SHEET,
    );
  } catch {
    return [];
  }
  return all.filter(
    (r) =>
      r.keyword?.trim() &&
      (r.status === "active" || !r.status) &&
      !isMinorRelatedKeyword(r.keyword),
  );
}

/**
 * 7일 내 미사용 우선, 부족 시 재사용 — pickKeywordsForToday와 같은 패턴.
 */
/**
 * @param seed 동일 seed → 동일 결과 보장 (weekly plan에서 21번 호출되어도 같은 21개 픽).
 */
export function pickThreadsKeywords(
  pool: ThreadsKeywordRow[],
  count: number,
  excludeRecentDays = 7,
  seed?: string,
): ThreadsKeywordRow[] {
  const order = { high: 0, normal: 1, low: 2 } as const;
  const todayKST = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const seedStr = seed || todayKST;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - excludeRecentDays);
  const cutoffKST = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(cutoffDate);

  function isRecentlyUsed(k: ThreadsKeywordRow): boolean {
    const lu = (k.last_used || "").slice(0, 10);
    return !!lu && lu >= cutoffKST;
  }
  function tiebreakHash(kw: string): number {
    const s = `${kw}-${seedStr}`;
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  }
  // seed 모드: used_count 무시 — 같은 seed에서 항상 같은 결과 (weekly 21개 호출 일관성)
  // 기본 모드: used_count 반영 (옛 동작)
  const useSeedMode = !!seed;
  function sortPool(p: ThreadsKeywordRow[]) {
    return [...p].sort((a, b) => {
      const pa = order[(a.priority || "normal") as keyof typeof order] ?? 1;
      const pb = order[(b.priority || "normal") as keyof typeof order] ?? 1;
      if (pa !== pb) return pa - pb;
      if (!useSeedMode) {
        const ua = parseInt(a.used_count || "0", 10);
        const ub = parseInt(b.used_count || "0", 10);
        if (ua !== ub) return ua - ub;
      }
      return tiebreakHash(a.keyword) - tiebreakHash(b.keyword);
    });
  }

  const fresh = sortPool(pool.filter((k) => !isRecentlyUsed(k))).slice(0, count);
  if (fresh.length >= count) return fresh;

  const usedSet = new Set(fresh.map((k) => k.keyword));
  const filler = sortPool(pool.filter((k) => !usedSet.has(k.keyword))).slice(
    0,
    count - fresh.length,
  );
  let result = [...fresh, ...filler];

  // 그래도 부족하면 순환 재사용
  if (result.length < count && result.length > 0) {
    const base = result.length;
    let i = 0;
    while (result.length < count) {
      result.push(result[i % base]);
      i++;
    }
  }
  return result;
}

export async function appendThreadsKeyword(input: {
  keyword: string;
  category: string;
  priority?: "high" | "normal" | "low";
}): Promise<{ id: string }> {
  await ensureThreadsKeywordsSheet();
  const id = `tk-${Date.now()}-${Math.floor(performance.now()) % 1000}`;
  const now = new Date().toISOString();
  await appendRow(mainSheetId(), THREADS_KEYWORDS_SHEET, [
    id,
    input.keyword.trim(),
    input.category,
    input.priority || "normal",
    "0",
    "",
    "active",
    now,
  ]);
  return { id };
}

/** used_count +1, last_used = today KST. */
export async function bumpThreadsKeywordUsage(
  keywords: string[],
): Promise<void> {
  if (keywords.length === 0) return;
  const sheets = getClient();
  const spreadsheetId = mainSheetId();
  const rows = await readRange(spreadsheetId, `${THREADS_KEYWORDS_SHEET}!A:H`);
  if (rows.length < 2) return;

  const todayKST = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  let headerIdx = 0;
  if (rows[0]?.[0]?.startsWith("💡")) headerIdx = 1;
  const kwSet = new Set(keywords);
  for (let i = headerIdx + 1; i < rows.length; i++) {
    if (!rows[i] || !kwSet.has(rows[i][1])) continue;
    const rowNum = i + 1;
    const curUsed = parseInt(rows[i][4] || "0", 10);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${THREADS_KEYWORDS_SHEET}!E${rowNum}:F${rowNum}`,
      valueInputOption: "RAW",
      requestBody: { values: [[String(curUsed + 1), todayKST]] },
    });
  }
}
