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
  status?: "active" | "paused" | "archived" | "used" | "";
  notes?: string;
  source?: "manual" | "auto" | "";
  created_at?: string;
};

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
 * priority(high>normal>low) → used_count 낮은 순 → search_volume 높은 순으로 정렬 후 N개 선택.
 *
 * 안전망:
 *  - last_used가 오늘(KST) 인 키워드는 제외 (동일 cron 재실행 대비)
 *  - 최근 7일 내 사용한 키워드는 후순위 (used_count 가산)
 */
export function pickKeywordsForToday(
  keywords: KeywordRow[],
  count: number,
): KeywordRow[] {
  const order = { high: 0, normal: 1, low: 2 };
  const todayKST = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return [...keywords]
    .filter((k) => k.last_used !== todayKST) // 오늘 이미 사용한 키워드는 후보에서 제외
    .sort((a, b) => {
      const pa = order[(a.priority || "normal") as keyof typeof order] ?? 1;
      const pb = order[(b.priority || "normal") as keyof typeof order] ?? 1;
      if (pa !== pb) return pa - pb;
      const ua = parseInt(a.used_count || "0", 10);
      const ub = parseInt(b.used_count || "0", 10);
      if (ua !== ub) return ua - ub;
      const sa = parseInt(a.search_volume || "0", 10);
      const sb = parseInt(b.search_volume || "0", 10);
      return sb - sa;
    })
    .slice(0, count);
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
};

/** posts 시트 전체 (예시/빈 행 자동 필터). */
export async function getAllPosts(): Promise<PostRow[]> {
  const all = await readSheetAsObjects<PostRow>(mainSheetId(), "posts");
  return all.filter((p) => p.id?.trim() && p.title?.trim());
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

  const today = new Date().toISOString().slice(0, 10);
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

/** KST 기준 오늘 created_at인 글만. */
export async function getTodayPosts(): Promise<PostRow[]> {
  const all = await getAllPosts();
  const todayKST = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()); // YYYY-MM-DD
  return all.filter((p) => (p.created_at || "").slice(0, 10) === todayKST);
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
