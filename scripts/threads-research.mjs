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
 *  4) 키워드별로 /api/threads/research/ingest 에 POST
 *
 * env (또는 .env.local 파일):
 *  THREADS_SESSION_COOKIES  storageState JSON (필수) — scripts/threads-login.mjs로 생성
 *  THREADS_SESSION_FILE     storageState 파일 경로 (대안, 권장: scripts/threads-session.json)
 *  CRON_SECRET              ingest 인증 (필수)
 *  INGEST_URL               기본 https://prephone-tstry-back.vercel.app/api/threads/research/ingest
 *  RESEARCH_KEYWORDS        쉼표구분. 기본: 선불폰,알뜰폰,유심,비대면개통,선불유심
 *  OUR_USERNAME             우리 계정(제외). 기본 safe_ntel
 *  MIN_LIKES                기본 10
 *  MIN_REPLIES              기본 2
 *  MAX_AGE_HOURS            기본 48
 *  TOP_PER_KEYWORD          기본 8
 *  HEADLESS                 기본 "true". "false"로 두면 브라우저 창 보이기 (디버그용)
 */

import { readFileSync, existsSync } from "fs";
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
try {
  if (existsSync(".env.local")) {
    const env = readFileSync(".env.local", "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^"|"$/g, "").replace(/\\n/g, "\n");
      }
    }
  }
} catch {
  /* ignore */
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
const KEYWORDS = (
  process.env.RESEARCH_KEYWORDS || "선불폰,알뜰폰,유심,비대면개통,선불유심"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const OUR_USERNAME = (process.env.OUR_USERNAME || "safe_ntel").toLowerCase();
const MIN_LIKES = parseInt(process.env.MIN_LIKES || "10", 10);
const MIN_REPLIES = parseInt(process.env.MIN_REPLIES || "2", 10);
const MAX_AGE_HOURS = parseInt(process.env.MAX_AGE_HOURS || "48", 10);
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

/** 객체 트리를 재귀적으로 돌며 '게시글처럼 보이는' 노드를 수집. */
function collectPosts(root, out, seen) {
  if (!root || typeof root !== "object") return;
  if (seen.has(root)) return;
  seen.add(root);

  if (Array.isArray(root)) {
    for (const el of root) collectPosts(el, out, seen);
    return;
  }

  // 게시글 노드 판별: code(permalink) + caption.text 또는 text_post_app_info 보유
  const hasCode = typeof root.code === "string";
  const captionText =
    root.caption && typeof root.caption.text === "string"
      ? root.caption.text
      : undefined;
  const tpa = root.text_post_app_info;
  if (hasCode && (captionText !== undefined || tpa)) {
    const username = root.user?.username || root.owner?.username;
    out.push({
      code: root.code,
      author: username,
      text: captionText || "",
      likes:
        typeof root.like_count === "number" ? root.like_count : 0,
      replies:
        typeof tpa?.direct_reply_count === "number"
          ? tpa.direct_reply_count
          : 0,
      reposts:
        typeof tpa?.repost_count === "number" ? tpa.repost_count : 0,
      taken_at: typeof root.taken_at === "number" ? root.taken_at : 0,
    });
  }

  for (const k of Object.keys(root)) {
    collectPosts(root[k], out, seen);
  }
}

async function scrapeKeyword(context, keyword) {
  const page = await context.newPage();
  const captured = [];

  page.on("response", async (res) => {
    try {
      const ct = res.headers()["content-type"] || "";
      if (!ct.includes("application/json")) return;
      const url = res.url();
      // Threads/IG 내부 API 응답만 (graphql / api)
      if (!/graphql|\/api\//.test(url)) return;
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

  // 인기글 더 로드되도록 사람처럼 스크롤 — 양·간격 랜덤
  const scrollRounds = 4 + Math.floor(Math.random() * 3); // 4~6번
  for (let i = 0; i < scrollRounds; i++) {
    const dy = 2200 + Math.floor(Math.random() * 1600); // 2200~3800
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(1200 + Math.floor(Math.random() * 1800)); // 1.2~3s
  }
  await page.waitForTimeout(1500);

  // 캡처된 JSON에서 게시글 추출
  const posts = [];
  const seen = new Set();
  for (const json of captured) {
    collectPosts(json, posts, seen);
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
      // taken_at 있으면 시간 필터 (없으면 통과 — 일부 응답엔 없음)
      if (p.taken_at && nowSec - p.taken_at > maxAgeSec) return false;
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
    `  캡처 JSON ${captured.length}건 · 후보 ${byCode.size}개 · 필터 후 ${filtered.length}개`,
  );
  await page.close();
  return filtered;
}

async function ingest(keyword, posts) {
  if (posts.length === 0) return { created: 0, skipped: true };
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

async function main() {
  const HEADLESS = (process.env.HEADLESS ?? "true").toLowerCase() !== "false";
  log(`키워드 ${KEYWORDS.length}개: ${KEYWORDS.join(", ")} | headless=${HEADLESS}`);

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

  let totalCreated = 0;
  for (const kw of KEYWORDS) {
    try {
      const posts = await scrapeKeyword(context, kw);
      const r = await ingest(kw, posts);
      log(`  ingest(${kw}):`, JSON.stringify(r));
      totalCreated += r.created || 0;
    } catch (err) {
      log(`  키워드 실패 (계속): ${kw} — ${err.message}`);
    }
    // 키워드 간 5~15초 랜덤 텀 (사람처럼)
    const wait = 5000 + Math.floor(Math.random() * 10000);
    await new Promise((r) => setTimeout(r, wait));
  }

  await browser.close();
  log(`완료 — 총 초안 ${totalCreated}건 생성`);
}

main().catch((e) => {
  log("치명적 오류:", e.message);
  process.exit(1);
});
