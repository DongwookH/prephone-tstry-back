/**
 * Threads 로그인 세션 추출 (1회용, 로컬에서 실행).
 *
 * 사용법:
 *   cd web
 *   node scripts/threads-login.mjs
 *
 * 1) 헤드풀 크롬이 열림 → Threads/Instagram 계정으로 로그인
 * 2) 로그인 완료 후 터미널에서 Enter
 * 3) scripts/threads-session.json 저장됨
 * 4) 그 파일 내용 전체를 GitHub Secret THREADS_SESSION_COOKIES 에 붙여넣기
 *    (Settings → Secrets and variables → Actions → New repository secret)
 *
 * 쿠키 만료되면 (ingest 0건 지속) 이 과정 재실행 후 secret 갱신.
 */

import { chromium } from "playwright";
import { writeFileSync } from "fs";
import { createInterface } from "readline";

function ask(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(q, (a) => {
      rl.close();
      resolve(a);
    }),
  );
}

async function main() {
  console.log("크롬을 엽니다. Threads에 로그인하세요...");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    locale: "ko-KR",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("https://www.threads.net/login");

  await ask(
    "\n로그인 완료 후 이 터미널에서 Enter를 누르세요 (검색이 보이는 상태까지)...\n",
  );

  const state = await context.storageState();
  const path = "scripts/threads-session.json";
  writeFileSync(path, JSON.stringify(state, null, 2));
  console.log(`\n✅ 저장: ${path}`);
  console.log(
    "이 파일 내용 전체를 GitHub Secret THREADS_SESSION_COOKIES 에 붙여넣으세요.",
  );
  console.log("⚠️ 이 파일은 절대 git에 커밋하지 마세요 (.gitignore 등록됨).");

  await browser.close();
}

main().catch((e) => {
  console.error("오류:", e.message);
  process.exit(1);
});
