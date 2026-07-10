/**
 * Threads 경쟁 리서치 스크레이퍼 — 내 Mac에서 launchd로 매일 실행.
 *
 * 봇 감지 회피:
 *  - playwright-extra + stealth 플러그인 (navigator.webdriver 등 숨김)
 *  - 진짜 Chrome 사용 (channel: 'chrome', 번들 chromium은 지문이 다름)
 *  - 한국 timezone/locale/UA, 현실적 viewport
 *  - 키워드 간 랜덤 5~15초 딜레이, 스크롤도 랜덤
 *
 * 동작:
 *  1) 저장된 로그인 세션(storageState)으로 Threads 접속
 *  2) 키워드별 검색 결과 페이지에서 네트워크 JSON 응답 캡처
 *  3) 인기글 후보 추출 → 필터(최근/타인/참여도) → 랭킹
 *  4) 키워드별로 전송:
 *     - INGEST_MODE=store  (기본) → /api/threads/research/store 에 POST, 시트에 축적만
 *       (초안 생성은 주간 자동 생성이 이 데이터를 참고해 처리)
 *     - INGEST_MODE=drafts (예전 동작) → /api/threads/research/ingest 에 POST, 즉시 Gemini 초안 생성
 *     - SCRAPE_ONLY=1이면 두 모드 모두 전송 없이 수집 로그만 출력
 *
 * env (또는 .env.local 파일):
 *  THREADS_SESSION_COOKIES  storageState JSON (필수) — scripts/threads-login.mjs로 생성
 *  THREADS_SESSION_FILE     storageState 파일 경로 (대안, 권장: scripts/threads-session.json)
 *  CRON_SECRET              ingest/store 인증 (필수)
 *  INGEST_MODE              "store"(기본) | "drafts" — 수집 결과 전송 방식
 *  INGEST_URL               기본 https://prephone-tstry-back.vercel.app/api/threads/research/ingest (drafts 모드용)
 *  STORE_URL                기본 https://prephone-tstry-back.vercel.app/api/threads/research/store (store 모드용)
 *  RESEARCH_KEYWORDS        쉼표구분. 기본: 선불폰,알뜰폰,유심,비대면개통,선불유심
 *  OUR_USERNAME             우리 계정(제외). 기본 safe_ntel
 *  MIN_LIKES                기본 10
 *  MIN_REPLIES              기본 2
 *  MAX_AGE_HOURS            기본 48
 *  TOP_PER_KEYWORD          기본 8
 *  HEADLESS                 기본 "true". "false"로 두면 브라우저 창 보이기 (디버그용)
 *  TELEGRAM_BOT_TOKEN       텔레그램 알림용 봇 토큰 (없으면 알림 skip)
 *  TELEGRAM_CHAT_ID         알림 받을 채팅 ID
 *  MIN_TOTAL_ALERT          총 수확이 이 값 미만이면 텔레그램 경고. 기본 5
 *
 * 플래그:
 *  --notify-test            텔레그램 알림 발송만 테스트하고 즉시 종료 (Threads 무접속, 세션 불필요)
 */

import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "node:url";
import { chromium as rawChromium } from "playwright";

// stealth 플러그인 — 설치돼 있으면 사용, 없으면 raw playwright 사용 (점진적 강화)
let chromium = rawChromium;
try {
  const extra = await import("playwright-extra");
  const stealth = (await import("puppeteer-extra-plugin-stealth")).default();
  extra.chromium.use(stealth);
  chromium = extra.chromium;
  console.log("[threads-research] stealth plugin 적용됨");
} catch {
  console.log(
    "[threads-research] stealth plugin 없음 (raw playwright 사용). " +
      "안정성 위해 'npm run threads:setup' 한 번 실행 권장.",
  );
}

// .env.local 자동 로드 (Mac launchd에서 환경변수 주입 편의)
function loadEnvFile(p) {
  if (!existsSync(p)) return false;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    if (!k || process.env[k] !== undefined) continue;
    let v = t.slice(eq + 1).trim();
    if (
      v.length >= 2 &&
      ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))
    )
      v = v.slice(1, -1);
    process.env[k] = v.replace(/\\n/g, "\n"); // GOOGLE_SHEETS_PRIVATE_KEY 등 \n 이스케이프 호환
  }
  return true;
}
try {
  // 스크립트 위치 기준 우선 (launchd cwd 무관), 없으면 cwd 폴백
  const loaded = loadEnvFile(
    fileURLToPath(new URL("../.env.local", import.meta.url)),
  );
  if (!loaded) loadEnvFile(".env.local");
} catch {
  /* ignore */
}

const MIN_TOTAL_ALERT = parseInt(process.env.MIN_TOTAL_ALERT || "5", 10);

/** 텔레그램 알림 (best-effort, 실패해도 throw 안 함). */
async function notifyTelegram(text) {
  const tk = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!tk || !chat) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${tk}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000) }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log(`텔레그램 발송 실패: HTTP ${res.status} — ${body.slice(0, 200)}`);
    }
    return res.ok;
  } catch (e) {
    log(`텔레그램 발송 에러: ${e.message}`);
    return false;
  }
}

// --notify-test: 알림 발송만 확인하고 즉시 종료.
// SESSION/CRON_SECRET 가드보다 먼저 실행돼야 함 — 세션이 죽은 상황(진단 대상)에서도 동작해야 하므로.
if (process.argv.includes("--notify-test")) {
  const ok = await notifyTelegram("✅ 스크래퍼 텔레그램 알림 테스트");
  log(ok ? "알림 테스트 발송됨" : "알림 실패 (env 확인)");
  process.exit(ok ? 0 : 1);
}

// 세션은 (1) env JSON 또는 (2) 파일 경로 둘 다 지원.
// Mac 운영 시엔 scripts/threads-session.json 파일 방식이 더 편함.
let SESSION = process.env.THREADS_SESSION_COOKIES;
const SESSION_FILE =
  process.env.THREADS_SESSION_FILE || "scripts/threads-session.json";
if (!SESSION && existsSync(SESSION_FILE)) {
  try {
    SESSION = readFileSync(SESSION_FILE, "utf8");
  } catch {
    /* ignore */
  }
}
const CRON_SECRET = process.env.CRON_SECRET;
const INGEST_URL =
  process.env.INGEST_URL ||
  "https://prephone-tstry-back.vercel.app/api/threads/research/ingest";
const STORE_URL =
  process.env.STORE_URL ||
  "https://prephone-tstry-back.vercel.app/api/threads/research/store";
// INGEST_MODE: "store"(기본, 시트 축적) | "drafts"(예전 동작, 즉시 초안 생성)
const INGEST_MODE = (process.env.INGEST_MODE || "store").toLowerCase();
const KEYWORDS = (
  process.env.RESEARCH_KEYWORDS || "선불폰,알뜰폰,유심,비대면개통,선불유심"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const OUR_USERNAME = (process.env.OUR_USERNAME || "safe_ntel").toLowerCase();
const MIN_LIKES = parseInt(process.env.MIN_LIKES || "3", 10);
const MIN_REPLIES = parseInt(process.env.MIN_REPLIES || "0", 10);
const MAX_AGE_HOURS = parseInt(process.env.MAX_AGE_HOURS || "0", 10); // 0=시간 필터 끔 (DOM에선 timestamp 추출 어려움)
const TOP_PER_KEYWORD = parseInt(process.env.TOP_PER_KEYWORD || "8", 10);

function log(...a) {
  console.log("[threads-research]", ...a);
}

if (!SESSION) {
  log("THREADS_SESSION_COOKIES 없음 — 스크레이핑 불가. 종료.");
  process.exit(0); // 실패가 아닌 skip (CI 빨강 방지)
}
if (!CRON_SECRET) {
  log("CRON_SECRET 없음 — ingest 불가. 종료.");
  process.exit(1);
}

let storageState;
try {
  storageState = JSON.parse(SESSION);
} catch {
  log("THREADS_SESSION_COOKIES JSON 파싱 실패. 종료.");
  process.exit(1);
}

/** 객체 트리를 재귀적으로 돌며 '게시글처럼 보이는' 노드를 수집 (유연한 판별). */
function collectPosts(root, out, seen) {
  if (!root || typeof root !== "object") return;
  if (seen.has(root)) return;
  seen.add(root);

  if (Array.isArray(root)) {
    for (const el of root) collectPosts(el, out, seen);
    return;
  }

  // 게시글 노드 판별 — Threads API 변형 대응:
  //  - id: code / pk / id 중 하나
  //  - content: caption.text / text / text_post_app_info / caption(string)
  //  - user: user.username / owner.username / user.pk
  const code =
    (typeof root.code === "string" && root.code) ||
    (typeof root.pk === "string" && root.pk) ||
    (typeof root.id === "string" && root.id) ||
    null;

  const captionText =
    (root.caption && typeof root.caption.text === "string"
      ? root.caption.text
      : null) ||
    (typeof root.text === "string" ? root.text : null) ||
    (typeof root.caption === "string" ? root.caption : null);

  const tpa = root.text_post_app_info || root.text_post_app_post;
  const user = root.user || root.owner;
  const username = user && (user.username || user.pk);

  // 셋 다 있어야 게시글로 인정 (id + content + user)
  if (code && captionText && username) {
    out.push({
      code,
      author: typeof username === "string" ? username : String(username),
      text: captionText,
      likes:
        typeof root.like_count === "number"
          ? root.like_count
          : typeof root.likes_count === "number"
            ? root.likes_count
            : 0,
      replies:
        typeof tpa?.direct_reply_count === "number"
          ? tpa.direct_reply_count
          : typeof root.reply_count === "number"
            ? root.reply_count
            : typeof tpa?.reply_count === "number"
              ? tpa.reply_count
              : 0,
      reposts:
        typeof tpa?.repost_count === "number"
          ? tpa.repost_count
          : typeof root.repost_count === "number"
            ? root.repost_count
            : 0,
      taken_at:
        typeof root.taken_at === "number"
          ? root.taken_at
          : typeof root.timestamp === "number"
            ? root.timestamp
            : 0,
    });
  }

  for (const k of Object.keys(root)) {
    collectPosts(root[k], out, seen);
  }
}

// 로그인벽 감지 시 true — scrapeKeyword(키워드 루프 지역 스코프) 밖 main()까지 전달하기 위한 모듈 레벨 플래그.
let sawLoginWall = false;

async function scrapeKeyword(context, keyword) {
  const page = await context.newPage();
  const captured = [];

  const responseUrls = []; // 디버그: 모든 JSON 응답 URL 카운트
  page.on("response", async (res) => {
    try {
      const ct = res.headers()["content-type"] || "";
      if (!ct.includes("application/json")) return;
      const u = res.url();
      responseUrls.push(u);
      // 필터를 더 넓혀서 captured에 담기 (그래프QL, /api/, threads, ajax, instagram 다 포함)
      if (!/graphql|\/api\/|ajax|instagram|threads/.test(u)) return;
      const json = await res.json().catch(() => null);
      if (json) captured.push(json);
    } catch {
      /* ignore */
    }
  });

  const q = encodeURIComponent(keyword);
  const url = `https://www.threads.net/search?q=${q}&serp_type=default`;
  log(`검색: ${keyword} → ${url}`);

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  } catch {
    log(`  goto 타임아웃(계속): ${keyword}`);
  }

  // 디버그: 최종 페이지 정보
  try {
    const finalUrl = page.url();
    const title = await page.title().catch(() => "");
    log(`  최종 URL: ${finalUrl}`);
    log(`  페이지 타이틀: ${title}`);
  } catch {
    /* ignore */
  }

  // ⚠️ 로그인 벽 감지 — Threads 검색결과는 SSR HTML로 오므로, 세션이 만료/degraded면
  //    로그아웃 화면("Log in or sign up ...")이 렌더돼 게시글이 거의 안 잡힌다.
  //    (2026-07-08 관측: 오전 6시 자동실행 때 일부 키워드가 이 상태 → 수확 급감)
  //    감지되면 크게 경고 — 운영자가 threads-login.mjs로 세션을 갱신해야 함.
  const bodyText = await page
    .evaluate(() => document.body?.innerText?.slice(0, 3000) || "")
    .catch(() => "");
  const loggedOut =
    /Log in or sign up|Continue with Instagram|Log in with username|로그인 또는 가입/.test(
      bodyText,
    );
  if (loggedOut) {
    log(
      `  ⚠️⚠️ 로그인 벽 감지 (세션 만료 의심) — '${keyword}' 게시글이 거의 안 잡힐 수 있음. ` +
        `scripts/threads-login.mjs로 세션 갱신 필요.`,
    );
    sawLoginWall = true;
  }

  // 인기글 더 로드되도록 사람처럼 스크롤 — 양·간격 랜덤
  const scrollRounds = 4 + Math.floor(Math.random() * 3); // 4~6번
  for (let i = 0; i < scrollRounds; i++) {
    const dy = 2200 + Math.floor(Math.random() * 1600); // 2200~3800
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(1200 + Math.floor(Math.random() * 1800)); // 1.2~3s
  }
  await page.waitForTimeout(1500);

  // SSR 게시글이 늦게/적게 뜨면 추가 스크롤로 더 로드 (오전 저수확·타이밍 편차 대응).
  // 로그인 벽이면 재시도해도 소용없으니 건너뜀.
  if (!loggedOut) {
    for (let tries = 0; tries < 2; tries++) {
      const linkCount = await page
        .evaluate(() => document.querySelectorAll('a[href*="/post/"]').length)
        .catch(() => 0);
      if (linkCount >= 5) break;
      log(`  게시글 링크 ${linkCount}개 — 추가 스크롤 재시도(${tries + 1}/2)`);
      for (let i = 0; i < 3; i++) {
        await page.mouse.wheel(0, 3000);
        await page.waitForTimeout(1800);
      }
    }
  }

  // 1차: 캡처된 JSON에서 게시글 추출
  const posts = [];
  const seen = new Set();
  for (const json of captured) {
    collectPosts(json, posts, seen);
  }

  // 2차: JSON에서 못 찾으면 DOM 셀렉터로 fallback 추출
  //  → Threads 검색 결과는 SSR(HTML 임베드)로 와서 GraphQL API 응답이 없음
  if (posts.length === 0) {
    // Threads 검색결과는 SSR HTML로만 옴(게시글 담은 JSON API 응답 없음) → DOM 파싱이 정식 경로.
    log(`  게시글 추출: SSR HTML → DOM 파싱`);
    const domPosts = await page
      .evaluate(() => {
        const results = [];
        const seenCodes = new Set();
        const links = document.querySelectorAll('a[href*="/post/"]');

        for (const a of links) {
          const href = a.getAttribute("href") || "";
          const m = href.match(/\/@([^/]+)\/post\/([^/?#]+)/);
          if (!m) continue;
          const [, username, code] = m;
          if (seenCodes.has(code)) continue;
          seenCodes.add(code);

          // 게시글 카드 컨테이너 찾기 — link 위로 올라가며 큰 컨테이너 찾기
          let container = a;
          for (let i = 0; i < 12; i++) {
            if (!container.parentElement) break;
            container = container.parentElement;
            const txt = container.innerText || "";
            // 보통 게시글 카드는 본문+메타 합쳐 80자 이상
            if (txt.length > 80) break;
          }
          const fullText = container?.innerText || "";

          // 본문은 username 뒤, 숫자/메타 앞까지 best effort
          // username으로 split 후 첫 큰 텍스트 덩어리 = 본문
          let body = fullText;
          const afterUser = fullText.split(username)[1];
          if (afterUser) body = afterUser;
          // 본문 정리 — 앞뒤 공백/짧은 메타 제거
          body = body.replace(/^[\s·•|–—\d일주달월년시분초.,/\-:]+/, "").trim();

          // 숫자 추출 — 좋아요/댓글/리포스트 (텍스트 끝에 모여 있음)
          // 패턴: "5 28 1" 같이 공백 구분된 숫자 3-4개 모음
          const numMatch = fullText.match(
            /(\d+(?:[.,]\d+)?[KkMm]?)\s+(\d+(?:[.,]\d+)?[KkMm]?)\s+(\d+(?:[.,]\d+)?[KkMm]?)/,
          );
          const parseNum = (s) => {
            if (!s) return 0;
            const n = parseFloat(s.replace(",", "."));
            if (/K/i.test(s)) return Math.round(n * 1000);
            if (/M/i.test(s)) return Math.round(n * 1000000);
            return Math.round(n);
          };

          let replies = 0,
            reposts = 0,
            likes = 0;
          if (numMatch) {
            // Threads 표시 순서: 댓글 / 리포스트 / 공유? / 좋아요
            // 보통 마지막이 좋아요. 정확치 않을 수 있어 best effort
            replies = parseNum(numMatch[1]);
            reposts = parseNum(numMatch[2]);
            likes = parseNum(numMatch[3]);
          }

          results.push({
            code,
            author: username,
            text: body.slice(0, 500),
            likes,
            replies,
            reposts,
            taken_at: 0, // DOM에서 정확한 timestamp 추출 어려움
          });
        }
        return results;
      })
      .catch(() => []);

    log(`  DOM 추출: ${domPosts.length}개`);
    for (const p of domPosts) posts.push(p);
  }

  // code 기준 dedup
  const byCode = new Map();
  for (const p of posts) {
    if (!byCode.has(p.code)) byCode.set(p.code, p);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const maxAgeSec = MAX_AGE_HOURS * 3600;

  const filtered = [...byCode.values()]
    .filter((p) => {
      if (!p.author) return false;
      if (p.author.toLowerCase() === OUR_USERNAME) return false;
      if (p.likes < MIN_LIKES) return false;
      if (p.replies < MIN_REPLIES) return false;
      // 시간 필터 — MAX_AGE_HOURS=0이면 끔, taken_at=0(DOM)이면 통과
      if (maxAgeSec > 0 && p.taken_at && nowSec - p.taken_at > maxAgeSec)
        return false;
      return true;
    })
    .map((p) => ({
      author: p.author,
      text: (p.text || "").slice(0, 500),
      likes: p.likes,
      replies: p.replies,
      reposts: p.reposts,
      permalink: `https://www.threads.net/@${p.author}/post/${p.code}`,
      timestamp: p.taken_at
        ? new Date(p.taken_at * 1000).toISOString()
        : "",
    }))
    .sort(
      (a, b) =>
        b.replies * 3 + b.reposts * 2 + b.likes -
        (a.replies * 3 + a.reposts * 2 + a.likes),
    )
    .slice(0, TOP_PER_KEYWORD);

  log(
    `  후보 ${byCode.size}개 · 필터 후 ${filtered.length}개${loggedOut ? " · ⚠️로그인벽(세션갱신 필요)" : ""}`,
  );

  // 디버그: 후보 0이면 응답 URL 호스트별 카운트 + 본문 일부 dump + 응답 JSON 저장
  if (byCode.size === 0) {
    // captured[0]을 /tmp에 저장 — 우리가 직접 구조 분석 가능
    if (captured.length > 0) {
      try {
        const dumpPath = `/tmp/threads-debug-${keyword}.json`;
        const { writeFileSync } = await import("fs");
        writeFileSync(dumpPath, JSON.stringify(captured[0], null, 2));
        log(`  [디버그] 첫 응답 JSON: ${dumpPath}`);
      } catch {
        /* ignore */
      }
    }
    const hostCount = {};
    for (const u of responseUrls) {
      try {
        const h = new URL(u).host;
        hostCount[h] = (hostCount[h] || 0) + 1;
      } catch {
        /* ignore */
      }
    }
    log(`  [디버그] 전체 JSON 응답: ${responseUrls.length}건`);
    log(`  [디버그] 호스트별: ${JSON.stringify(hostCount)}`);
    // graphql 관련 URL만 추려서 일부
    const interesting = responseUrls
      .filter((u) => /graphql|api|threads/.test(u))
      .slice(0, 5);
    log(`  [디버그] 흥미로운 URL 샘플:`);
    for (const u of interesting) log(`    - ${u.slice(0, 140)}`);
    // 페이지 본문 첫 부분 (로그인 페이지인지 확인)
    try {
      const bodyText = (await page.locator("body").innerText())
        .replace(/\s+/g, " ")
        .slice(0, 250);
      log(`  [디버그] body 첫 250자: ${bodyText}`);
    } catch {
      /* ignore */
    }
  }

  await page.close();
  return filtered;
}

// SCRAPE_ONLY=1 이면 수집 결과만 출력하고 전송(store/ingest 무관)은 하지 않음 — 테스트/점검용
const SCRAPE_ONLY = (process.env.SCRAPE_ONLY ?? "") === "1";

// store 모드: 시트 축적 API로 전송 (초안 생성은 주간 자동 생성이 이 데이터를 참고)
async function storeToSheet(keyword, posts) {
  const res = await fetch(STORE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CRON_SECRET}`,
    },
    body: JSON.stringify({
      items: [{ keyword, posts }],
    }),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ...json };
}

// drafts 모드(예전 동작): ingest API로 전송해 즉시 Gemini 초안 생성
async function ingestDrafts(keyword, posts) {
  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CRON_SECRET}`,
    },
    body: JSON.stringify({
      items: [{ keyword, posts }],
      draftsPerKeyword: 2,
    }),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ...json };
}

async function ingest(keyword, posts) {
  if (posts.length === 0) return { created: 0, stored: 0, skipped: true };
  if (SCRAPE_ONLY) {
    for (const p of posts.slice(0, 5)) {
      log(`  [scrape-only] (좋아요 ${p.likes ?? 0}·댓글 ${p.replies ?? 0}) ${(p.text || "").replace(/\s+/g, " ").slice(0, 80)}`);
    }
    return { created: 0, stored: 0, scrapeOnly: true, collected: posts.length };
  }
  if (INGEST_MODE === "drafts") {
    return ingestDrafts(keyword, posts);
  }
  return storeToSheet(keyword, posts);
}

async function main() {
  const HEADLESS = (process.env.HEADLESS ?? "true").toLowerCase() !== "false";
  log(
    `키워드 ${KEYWORDS.length}개: ${KEYWORDS.join(", ")} | headless=${HEADLESS} | mode=${SCRAPE_ONLY ? "scrape-only" : INGEST_MODE}`,
  );

  // 진짜 Chrome 사용 시도 → 실패 시 번들 chromium fallback (지문 차이 큼)
  let browser;
  try {
    browser = await chromium.launch({
      headless: HEADLESS,
      channel: "chrome",
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
      ],
    });
  } catch {
    log("진짜 Chrome 채널 없음 → 번들 chromium 사용");
    browser = await chromium.launch({
      headless: HEADLESS,
      args: ["--disable-blink-features=AutomationControlled"],
    });
  }

  const context = await browser.newContext({
    storageState,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    viewport: { width: 1440, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    deviceScaleFactor: 2,
    hasTouch: false,
  });

  const modeLabel = INGEST_MODE === "drafts" ? "ingest(초안)" : "store";
  let totalCreated = 0;
  let totalStored = 0;
  for (const kw of KEYWORDS) {
    try {
      const posts = await scrapeKeyword(context, kw);
      const r = await ingest(kw, posts);
      log(`  ${modeLabel}(${kw}):`, JSON.stringify(r));
      totalCreated += r.created || 0;
      totalStored += r.stored || 0;
    } catch (err) {
      log(`  키워드 실패 (계속): ${kw} — ${err.message}`);
    }
    // 키워드 간 5~15초 랜덤 텀 (사람처럼)
    const wait = 5000 + Math.floor(Math.random() * 10000);
    await new Promise((r) => setTimeout(r, wait));
  }

  await browser.close();

  let totalHarvest = 0;
  if (SCRAPE_ONLY) {
    log(`완료 — scrape-only 모드 (전송 없음)`);
  } else if (INGEST_MODE === "drafts") {
    totalHarvest = totalCreated;
    log(`완료 — 총 초안 ${totalCreated}건 생성`);
  } else {
    totalHarvest = totalStored;
    log(`완료 — 총 ${totalStored}건 축적`);
  }

  // scrape-only(테스트/점검용)는 알림 대상 아님. 그 외 로그인벽 감지되었거나 수확이 기준 미달이면 1회 알림.
  if (!SCRAPE_ONLY && (sawLoginWall || totalHarvest < MIN_TOTAL_ALERT)) {
    await notifyTelegram(
      `⚠️ Threads 스크래퍼 상태 이상\n` +
        (sawLoginWall ? "· 로그인벽 감지 — 세션 만료 의심\n" : "") +
        `· 오늘 수확 ${totalHarvest}건 (기준 ${MIN_TOTAL_ALERT})\n` +
        (sawLoginWall
          ? "조치: cd web && node scripts/threads-login.mjs 로 세션 갱신"
          : "조치: 로그 확인 (세션은 정상 감지됨)"),
    );
  }
}

main().catch((e) => {
  log("치명적 오류:", e.message);
  process.exit(1);
});
