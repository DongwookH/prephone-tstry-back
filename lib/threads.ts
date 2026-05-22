/**
 * Meta Threads API 클라이언트 (OAuth + 게시).
 *
 * env (Vercel + .env.local 모두 등록):
 *   THREADS_APP_ID         — Meta 앱 ID
 *   THREADS_APP_SECRET     — Meta 앱 시크릿
 *   THREADS_REDIRECT_URI   — 콜백 URL (앱 설정과 일치)
 *
 * 토큰은 settings 시트에 type='threads_token' row로 저장.
 */

import {
  readSettings,
  appendRow,
  mainSheetId,
  updateCell,
} from "./sheets";

const THREADS_API = "https://graph.threads.net/v1.0";
const THREADS_OAUTH = "https://threads.net/oauth/authorize";
const THREADS_TOKEN = "https://graph.threads.net/oauth/access_token";
const THREADS_LONG_LIVED =
  "https://graph.threads.net/access_token";

/** Threads 공식 권장 scope. */
export const THREADS_SCOPES = [
  "threads_basic",
  "threads_content_publish",
  "threads_manage_insights",
].join(",");

export interface ThreadsToken {
  user_id: string;
  access_token: string;
  expires_at: string; // ISO 8601 (long-lived 만료 — 보통 60일)
  refreshed_at: string;
}

/** OAuth 인증 시작 URL 생성. */
export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.THREADS_APP_ID || "",
    redirect_uri: process.env.THREADS_REDIRECT_URI || "",
    scope: THREADS_SCOPES,
    response_type: "code",
    state,
  });
  return `${THREADS_OAUTH}?${params.toString()}`;
}

/** 콜백에서 받은 code를 short-lived access_token으로 교환. */
export async function exchangeCodeForToken(code: string): Promise<{
  access_token: string;
  user_id: string;
}> {
  const body = new URLSearchParams({
    client_id: process.env.THREADS_APP_ID || "",
    client_secret: process.env.THREADS_APP_SECRET || "",
    grant_type: "authorization_code",
    redirect_uri: process.env.THREADS_REDIRECT_URI || "",
    code,
  });
  const res = await fetch(THREADS_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Threads token 교환 실패 (${res.status}): ${t.slice(0, 200)}`);
  }
  return (await res.json()) as { access_token: string; user_id: string };
}

/** Short-lived → long-lived (60일) 토큰 교환. */
export async function exchangeForLongLivedToken(
  shortToken: string,
): Promise<{ access_token: string; expires_in: number }> {
  const url = new URL(THREADS_LONG_LIVED);
  url.searchParams.set("grant_type", "th_exchange_token");
  url.searchParams.set("client_secret", process.env.THREADS_APP_SECRET || "");
  url.searchParams.set("access_token", shortToken);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Threads long-lived 교환 실패 (${res.status}): ${t.slice(0, 200)}`);
  }
  return (await res.json()) as { access_token: string; expires_in: number };
}

/** settings 시트에 threads_token 저장. 이미 있으면 갱신. */
export async function saveThreadsToken(token: ThreadsToken): Promise<void> {
  const sheets = await import("googleapis").then((m) => m.google.sheets);
  void sheets; // placeholder — 아래서 직접 readSettings/append/update 사용

  const all = await readSettings();
  const existing = all.findIndex((r) => r.type === "threads_token");
  const value = JSON.stringify(token);
  const now = new Date().toISOString();

  if (existing >= 0) {
    // settings 시트 헤더 인덱스 가정: value=C, last_used=G
    // existing 위치 = settings row idx (헤더 다음부터 0-indexed)
    // 시트 row 번호는 헤더 자동 감지 후 row = existing + 2 (헤더 1줄 가정) ... 단순화:
    // updateCell 헬퍼는 정확한 row 알아야 함 — 시트 raw 다시 읽어서 row 계산
    const { readRange } = await import("./sheets");
    const raw = await readRange(mainSheetId(), "settings!A:H");
    let headerIdx = 0;
    if (raw[0]?.[0]?.startsWith("💡")) headerIdx = 1;
    for (let i = headerIdx + 1; i < raw.length; i++) {
      if (raw[i]?.[1] === "threads_token") {
        const rowNum = i + 1; // 1-indexed
        // 컬럼 C(value) = index 2
        await updateCell(mainSheetId(), `settings!C${rowNum}`, value);
        await updateCell(mainSheetId(), `settings!F${rowNum}`, now);
        await updateCell(mainSheetId(), `settings!G${rowNum}`, now);
        return;
      }
    }
  }
  // 새로 append
  await appendRow(mainSheetId(), "settings", [
    `threads-${Date.now()}`,
    "threads_token",
    value,
    `Threads ${token.user_id}`,
    "1",
    now, // created_at
    now, // last_used
    "0", // usage_count
  ]);
}

/** 저장된 Threads 토큰 가져오기. 없으면 null. */
export async function getThreadsToken(): Promise<ThreadsToken | null> {
  const all = await readSettings();
  const row = all.find((r) => r.type === "threads_token" && r.value);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as ThreadsToken;
  } catch {
    return null;
  }
}

/** Threads 사용자가 권한 취소 시 시트의 토큰 삭제 마킹 (settings row enabled=0). */
export async function disableThreadsToken(userId: string): Promise<boolean> {
  const { readRange } = await import("./sheets");
  const raw = await readRange(mainSheetId(), "settings!A:H");
  let headerIdx = 0;
  if (raw[0]?.[0]?.startsWith("💡")) headerIdx = 1;
  for (let i = headerIdx + 1; i < raw.length; i++) {
    if (raw[i]?.[1] !== "threads_token") continue;
    try {
      const tok = JSON.parse(raw[i][2] || "{}");
      if (tok.user_id !== userId) continue;
      const rowNum = i + 1;
      await updateCell(mainSheetId(), `settings!E${rowNum}`, "0");
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * Threads에 글 게시 (2단계 프로세스: container 생성 → 게시).
 * text는 500자 제한.
 */
export async function postToThreads(opts: {
  accessToken: string;
  userId: string;
  text: string;
  imageUrl?: string;
}): Promise<{ id: string }> {
  // 1) container 생성
  const containerBody = new URLSearchParams({
    media_type: opts.imageUrl ? "IMAGE" : "TEXT",
    text: opts.text.slice(0, 500),
    access_token: opts.accessToken,
  });
  if (opts.imageUrl) containerBody.set("image_url", opts.imageUrl);

  const c = await fetch(`${THREADS_API}/${opts.userId}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: containerBody.toString(),
  });
  if (!c.ok) {
    const t = await c.text();
    throw new Error(`Threads container 생성 실패 (${c.status}): ${t.slice(0, 200)}`);
  }
  const { id: creationId } = (await c.json()) as { id: string };

  // 2) container를 published 상태로 (보통 30초 권장 — 이미지 처리)
  if (opts.imageUrl) {
    await new Promise((r) => setTimeout(r, 5000));
  }
  const p = await fetch(`${THREADS_API}/${opts.userId}/threads_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      creation_id: creationId,
      access_token: opts.accessToken,
    }).toString(),
  });
  if (!p.ok) {
    const t = await p.text();
    throw new Error(`Threads publish 실패 (${p.status}): ${t.slice(0, 200)}`);
  }
  return (await p.json()) as { id: string };
}
