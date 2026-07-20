/**
 * threads-login.mjs의 자동 감지 버전 (Claude Code 세션용 1회 실행).
 * 헤드풀 크롬을 열고, 사용자가 창에서 직접 로그인하면
 * sessionid 쿠키 등장을 감지해 scripts/threads-session.json에 자동 저장한다.
 * (터미널 Enter 불필요 — 원본은 대화형 stdin이 필요해서 이 환경에선 못 씀)
 */
import { chromium } from "playwright";
import { writeFileSync } from "fs";

const OUT = "scripts/threads-session.json";
const TIMEOUT_MIN = 60;

function log(...a) {
  console.log(new Date().toISOString().slice(11, 19), ...a);
}

async function main() {
  log("크롬을 엽니다 — 창에서 Threads에 로그인하세요.");
  // channel: "chrome" — Chromium 대신 실제 설치된 Google Chrome 실행
  const browser = await chromium.launch({ headless: false, channel: "chrome" });
  const context = await browser.newContext({
    locale: "ko-KR",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("https://www.threads.net/login");

  const deadline = Date.now() + TIMEOUT_MIN * 60 * 1000;
  let loggedIn = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    let cookies = [];
    try {
      cookies = await context.cookies();
    } catch {
      log("브라우저가 닫혔습니다 — 저장 없이 종료.");
      process.exit(2);
    }
    const sess = cookies.find(
      (c) => c.name === "sessionid" && (c.value || "").length > 5,
    );
    if (sess) {
      loggedIn = true;
      log(`로그인 감지 (sessionid @ ${sess.domain}) — 5초 후 저장`);
      // 로그인 직후 리다이렉트·추가 쿠키 세팅이 끝나도록 잠시 대기
      await new Promise((r) => setTimeout(r, 5000));
      break;
    }
  }

  if (!loggedIn) {
    log(`${TIMEOUT_MIN}분 내 로그인 감지 실패 — 저장 없이 종료.`);
    await browser.close();
    process.exit(1);
  }

  const state = await context.storageState();
  writeFileSync(OUT, JSON.stringify(state, null, 2));
  log(`✅ 저장 완료: ${OUT} (쿠키 ${state.cookies.length}개)`);
  await browser.close();
}

main().catch((e) => {
  console.error("오류:", e.message);
  process.exit(1);
});
