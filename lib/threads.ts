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
  ensureSettingsSheet,
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
  "threads_keyword_search", // 키워드 검색 (경쟁 글 리서치)
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
  // settings 탭이 없으면 먼저 생성 (없으면 append/read가 "Unable to parse range" 에러)
  await ensureSettingsSheet();

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
        // 컬럼: C=value, E=enabled, G=last_used
        await updateCell(mainSheetId(), `settings!C${rowNum}`, value);
        await updateCell(mainSheetId(), `settings!E${rowNum}`, "1"); // 재연결 시 다시 활성화
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

/** 저장된 Threads 토큰 가져오기. 없거나 비활성(enabled=0)이면 null. */
export async function getThreadsToken(): Promise<ThreadsToken | null> {
  const all = await readSettings();
  // enabled !== "0" 인 가장 최근 토큰. (해제 시 enabled=0 → null 반환되어야 함)
  const row = all.find(
    (r) => r.type === "threads_token" && r.value && r.enabled !== "0",
  );
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
  await ensureSettingsSheet();
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

export type ReplyControl =
  | "everyone"
  | "accounts_you_follow"
  | "mentioned_only"
  | "parent_post_author_only"
  | "followers_only";

/**
 * topic_tag 정규화 — Threads 규칙: 1~50자, '.'와 '&' 불가.
 * 입력에서 금지문자 제거 + 길이 컷. 빈 문자열 → undefined 반환.
 */
function normalizeTopicTag(raw?: string): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[.&]/g, "").trim().slice(0, 50);
  return cleaned.length >= 1 ? cleaned : undefined;
}

/**
 * Threads에 글 게시 (2단계 프로세스: container 생성 → 게시).
 *
 * Threads API 파라미터:
 *  - text       본문 (500자 제한)
 *  - imageUrl   이미지 첨부 시 IMAGE 모드
 *  - topicTag   주제 태그 (1~50자, '.'와 '&' 불가) — 같은 주제 사용자에게 노출
 *  - replyToId  부모 글 id — 셀프 댓글/스레드 잇기용
 *  - replyControl  누가 댓글 달 수 있나
 */
export async function postToThreads(opts: {
  accessToken: string;
  userId: string;
  text: string;
  imageUrl?: string;
  topicTag?: string;
  replyToId?: string;
  replyControl?: ReplyControl;
}): Promise<{ id: string }> {
  // 1) container 생성
  const containerBody = new URLSearchParams({
    media_type: opts.imageUrl ? "IMAGE" : "TEXT",
    text: opts.text.slice(0, 500),
    access_token: opts.accessToken,
  });
  if (opts.imageUrl) containerBody.set("image_url", opts.imageUrl);
  const tag = normalizeTopicTag(opts.topicTag);
  if (tag) containerBody.set("topic_tag", tag);
  if (opts.replyToId) containerBody.set("reply_to_id", opts.replyToId);
  if (opts.replyControl) containerBody.set("reply_control", opts.replyControl);

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

  // 2) container를 published 상태로.
  //    Threads는 컨테이너 생성 직후 서버 인덱싱 전에 publish하면 "Media Not Found"
  //    (code 24 / subcode 4279009)로 간헐 거부함. 이미지뿐 아니라 텍스트도 짧은 대기 필요.
  const initialWait = opts.imageUrl ? 5000 : 2500;
  await new Promise((r) => setTimeout(r, initialWait));

  // publish — Media Not Found 등 일시적 에러는 backoff 재시도 (최대 4회).
  let lastErr = "";
  let lastStatus = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 2500 * attempt)); // 2.5s, 5s, 7.5s
    }
    const p = await fetch(`${THREADS_API}/${opts.userId}/threads_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        creation_id: creationId,
        access_token: opts.accessToken,
      }).toString(),
    });
    if (p.ok) {
      return (await p.json()) as { id: string };
    }
    lastErr = await p.text();
    lastStatus = p.status;
    // 컨테이너 아직 미인덱싱(일시적)일 때만 재시도. 권한/형식 등 영구 에러면 즉시 중단.
    const transient =
      /4279009|Media Not Found|does not exist|"is_transient":\s*true|media_id/i.test(
        lastErr,
      );
    if (!transient) break;
  }
  throw new Error(`Threads publish 실패 (${lastStatus}): ${lastErr.slice(0, 200)}`);
}

/**
 * 메인 글 + 셀프 댓글들을 묶음으로 발행 (Threads 알고리즘 부스트).
 *
 * 알고리즘: 본인이 본인 글에 댓글로 대화를 이어가면 참여 속도(velocity) 신호가
 * 크게 올라가서 도달이 증가함. 발행 직후 30~60분 안 활동이 결정적이라
 * 메인 직후에 댓글까지 자동 게시.
 *
 * 흐름:
 *   1. 메인글 게시 (topicTag 첨부)
 *   2. 첫 셀프 댓글: reply_to_id = 메인글 id
 *   3. 두번째 셀프 댓글: reply_to_id = 첫 댓글 id (스레드 잇기)
 *   4. ...
 *
 * 각 단계 사이에 짧은 딜레이 → 봇 감지 완화 + Threads 측 처리 시간.
 */
export async function postThreadWithReplies(opts: {
  accessToken: string;
  userId: string;
  mainText: string;
  selfReplies?: string[];
  topicTag?: string;
  replyControl?: ReplyControl;
}): Promise<{
  mainId: string;
  replyIds: string[];
  replyErrors: string[];
}> {
  const { accessToken, userId, mainText, topicTag, replyControl } = opts;
  const replies = (opts.selfReplies ?? [])
    .map((r) => (r || "").trim())
    .filter(Boolean);

  // 1) 메인글 발행
  const main = await postToThreads({
    accessToken,
    userId,
    text: mainText,
    topicTag,
    replyControl,
  });

  // 2) 셀프 댓글들 — 직전 글에 답글로 체이닝.
  //    메인글 publish 직후 잠깐 대기 (Threads가 reply 가능 상태로 인덱싱 완료까지).
  //    너무 빠르면 reply_to_id가 invalid로 거부됨.
  const replyIds: string[] = [];
  const replyErrors: string[] = [];
  let parentId = main.id;

  for (let i = 0; i < replies.length; i++) {
    const replyText = replies[i];
    // 첫 댓글은 5초, 이후는 3초 (Threads의 처리 시간 확보)
    const wait = i === 0 ? 5000 : 3000 + Math.random() * 1500;
    await new Promise((r) => setTimeout(r, wait));
    try {
      const child = await postToThreads({
        accessToken,
        userId,
        text: replyText,
        replyToId: parentId,
      });
      replyIds.push(child.id);
      parentId = child.id;
    } catch (e) {
      const msg = (e as Error).message || "unknown";
      console.warn(`[threads] 셀프 댓글 ${i + 1} 실패:`, msg);
      replyErrors.push(`댓글 ${i + 1}: ${msg.slice(0, 150)}`);
      // 한 댓글이 실패해도 다음 댓글은 시도 (메인글 id로 다시 reply)
      parentId = main.id;
    }
  }

  return { mainId: main.id, replyIds, replyErrors };
}

export interface ThreadsSearchPost {
  id: string;
  text?: string;
  username?: string;
  permalink?: string;
  timestamp?: string;
  media_type?: string;
}

/**
 * Threads 키워드 검색 — 공개 글 리서치용.
 * threads_keyword_search 권한 필요.
 *
 * @param keyword 검색어
 * @param searchType TOP(인기순) | RECENT(최신순)
 * @param limit 최대 결과 수 (기본 25)
 */
export async function searchThreadsKeyword(opts: {
  accessToken: string;
  keyword: string;
  searchType?: "TOP" | "RECENT";
  limit?: number;
}): Promise<ThreadsSearchPost[]> {
  const fields = "id,text,username,permalink,timestamp,media_type";
  const params = new URLSearchParams({
    q: opts.keyword,
    search_type: opts.searchType ?? "TOP",
    fields,
    limit: String(opts.limit ?? 25),
    access_token: opts.accessToken,
  });
  const res = await fetch(`${THREADS_API}/keyword_search?${params.toString()}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Threads 키워드 검색 실패 (${res.status}): ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { data?: ThreadsSearchPost[] };
  return data.data ?? [];
}
