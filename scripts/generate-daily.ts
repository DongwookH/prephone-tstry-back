/**
 * scripts/generate-daily.ts
 *
 * GitHub Actions 러너에서 오늘 블로그 글을 "직접" 생성·저장하는 스크립트.
 *
 * 배경:
 *   기존엔 GHA가 Vercel의 /api/cron/generate-one을 10회 HTTP 호출했는데,
 *   글 1개 생성이 30~50초라 Vercel Hobby 60초 벽에 걸려 504가 대량 발생했다.
 *   → 생성 자체를 러너에서 실행하고 시트 저장까지 러너에서 직접 수행한다.
 *     (Vercel은 계획 조회 등 가벼운 API만 담당)
 *
 * 흐름:
 *   a. Plan 조회       — POST /api/cron/plan (Bearer CRON_SECRET) → 오늘 계획 10건
 *   b. 기존 저장 조회  — GET  /api/cron/posts-today → 이미 저장된 오늘 키워드
 *   c. 누락 항목 생성  — generate-one route와 동일 로직을 lib 함수 직접 import로 재현
 *                        (HTTP 호출 아님). 항목당 최대 3회 재시도(사이 5초 대기).
 *   d. 항목마다 진행 로그 + 마지막에 요약 JSON 한 줄
 *   e. 하나라도 최종 실패면 exit 1 (단, 모든 항목 처리 후)
 *
 * 실행: npx --yes tsx scripts/generate-daily.ts [--dry-run]
 *   --dry-run: 계획 조회 + 누락 계산까지만, 생성/저장 없이 목록 출력 후 종료.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── .env.local 폴백 로드 (로컬 테스트용) ────────────────────────
// GHA에서는 env로 시크릿이 이미 주입되므로 파일이 없어도 무방.
// dotenv 의존성 없이 직접 파싱한다.
function loadEnvLocal(): void {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    // 이미 process.env에 있으면(=GHA에서 주입) 덮어쓰지 않음
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    // 감싼 따옴표 제거 (양끝이 같은 따옴표일 때만)
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvLocal();

// ⚠️ .env.local 로드 "후"에 lib 모듈을 import해야 한다.
//    (gemini.ts 등이 모듈 로드 시점에 process.env를 읽으므로)
//    top-level import는 env 로드보다 먼저 실행되므로 dynamic import 사용.
type LibModules = {
  appendPosts: typeof import("../lib/sheets")["appendPosts"];
  bumpKeywordsUsage: typeof import("../lib/sheets")["bumpKeywordsUsage"];
  getRecentPostTitles: typeof import("../lib/sheets")["getRecentPostTitles"];
  getAllPosts: typeof import("../lib/sheets")["getAllPosts"];
  generatePost: typeof import("../lib/post-generator")["generatePost"];
  ACTIVE_PATTERN_IDS: typeof import("../lib/title-diversity")["ACTIVE_PATTERN_IDS"];
};

async function loadLibs(): Promise<LibModules> {
  const sheets = await import("../lib/sheets");
  const gen = await import("../lib/post-generator");
  const td = await import("../lib/title-diversity");
  return {
    appendPosts: sheets.appendPosts,
    bumpKeywordsUsage: sheets.bumpKeywordsUsage,
    getRecentPostTitles: sheets.getRecentPostTitles,
    getAllPosts: sheets.getAllPosts,
    generatePost: gen.generatePost,
    ACTIVE_PATTERN_IDS: td.ACTIVE_PATTERN_IDS,
  };
}

// ── plan item 타입 (plan route 응답 형태와 동일) ────────────────
type PlanItem = {
  track?: 1 | 2;
  keyword: string;
  category?: string;
  subKeywords?: string[];
  persona?: string;
  slot?: number;
  forcedPattern?: number;
};

// ── HTTP 헬퍼 ──────────────────────────────────────────────────
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`환경변수 ${name} 가 설정되지 않았습니다.`);
  }
  return v.trim();
}

/** Plan 조회 — 워크플로 Plan 잡이 호출하는 것과 동일한 endpoint. */
async function fetchPlan(
  productionUrl: string,
  cronSecret: string,
): Promise<PlanItem[]> {
  const res = await fetch(`${productionUrl}/api/cron/plan`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cronSecret}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Plan 호출 실패 (HTTP ${res.status}): ${body.slice(0, 300)}`,
    );
  }
  const json = (await res.json()) as { plan?: PlanItem[]; count?: number };
  if (!Array.isArray(json.plan)) {
    throw new Error("Plan 응답에 plan 배열이 없습니다.");
  }
  return json.plan;
}

/** 오늘 이미 저장된 키워드 목록 — posts-today endpoint. */
async function fetchExistingKeywords(
  productionUrl: string,
  cronSecret: string,
): Promise<string[]> {
  const res = await fetch(`${productionUrl}/api/cron/posts-today`, {
    method: "GET",
    headers: { Authorization: `Bearer ${cronSecret}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `posts-today 호출 실패 (HTTP ${res.status}): ${body.slice(0, 300)}`,
    );
  }
  const json = (await res.json()) as { keywords?: string[] };
  return Array.isArray(json.keywords) ? json.keywords.filter(Boolean) : [];
}

// ── id 채번 (KST) — generate-one route와 동일 의미 ──────────────
function todayKstCompact(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .replace(/-/g, "");
}

/**
 * 한 항목을 생성 + 저장. generate-one route의 POST 본문 로직을 그대로 재현.
 *
 * @returns 저장된 글의 { id, title }
 */
async function generateAndSaveOne(
  libs: LibModules,
  item: PlanItem,
): Promise<{ id: string; title: string; charCount: number; seoScore: number }> {
  const {
    appendPosts,
    bumpKeywordsUsage,
    getRecentPostTitles,
    getAllPosts,
    generatePost,
    ACTIVE_PATTERN_IDS,
  } = libs;

  // 최근 25개 제목 — Gemini가 클리셰 패턴 회피하도록 프롬프트에 주입
  const recentTitles = await getRecentPostTitles(25).catch(() => []);

  // plan이 배정한 슬롯별 distinct 패턴 사용 (하루 안 패턴 중복 방지).
  // 없으면 generatePost가 자동으로 least-used 패턴 선택.
  const fp =
    typeof item.forcedPattern === "number" &&
    (ACTIVE_PATTERN_IDS as number[]).includes(item.forcedPattern)
      ? item.forcedPattern
      : undefined;

  const post = await generatePost({
    keyword: item.keyword,
    category: item.category || "일반",
    subKeywords: item.subKeywords || [],
    persona: item.persona || "일반",
    recentTitles,
    // ACTIVE_PATTERN_IDS로 이미 검증했으므로 HookPatternId로 안전 캐스팅
    forcedPattern: fp as Parameters<typeof generatePost>[0]["forcedPattern"],
  });

  const now = new Date().toISOString();
  // KST 날짜로 id 부여 (UTC 23:15~24:00에 돌 때 UTC date면 어제로 찍힘)
  const todayKST = todayKstCompact();

  // id 충돌 방지 — 저장 직전 시트를 재확인해서 이미 쓰인 슬롯을 회피.
  // (동시 실행/수동 트리거 대비 — route와 동일 의미, 저장 직전 재확인 포함)
  const existingPosts = await getAllPosts().catch(() => []);
  const usedSlots = new Set<number>(
    existingPosts
      .map((p) => p.id || "")
      .filter((id) => id.startsWith(`p-${todayKST}-`))
      .map((id) => parseInt(id.slice(-3), 10))
      .filter((n) => !isNaN(n)),
  );
  let slotNum = item.slot ?? 0;
  // 요청한 슬롯이 비어 있으면 그대로 사용, 충돌하면 다음 빈 번호 (1~999)
  if (usedSlots.has(slotNum)) {
    for (let n = 1; n <= 999; n++) {
      if (!usedSlots.has(n)) {
        slotNum = n;
        break;
      }
    }
  }
  const slot = String(slotNum).padStart(3, "0");
  const id = `p-${todayKST}-${slot}`;

  await appendPosts([
    {
      id,
      title: post.title,
      keyword: item.keyword,
      category: item.category || "일반",
      persona: item.persona || "일반",
      content_md: "",
      content_html: post.content_html,
      char_count: post.char_count,
      seo_score: post.seo_score,
      status: "ready",
      utm_campaign: post.utm_campaign,
      created_at: now,
      updated_at: now,
      tags: post.tags,
      // 썸네일 메타를 image_urls 컬럼에 JSON으로 저장 (thumbnails job이 읽어 PNG 생성)
      image_urls: post.thumbnail ? JSON.stringify(post.thumbnail) : "",
    },
  ]);

  // Track 1만 used_count 갱신 (Track 2는 방금 추가된 거라 굳이 X)
  if (item.track === 1) {
    try {
      await bumpKeywordsUsage([item.keyword]);
    } catch (err) {
      console.warn("[generate-daily] used_count 갱신 실패:", err);
    }
  }

  return {
    id,
    title: post.title,
    charCount: post.char_count,
    seoScore: post.seo_score,
  };
}

// ── 키워드 정규화 (누락 판정용 — 공백 무시) ──────────────────────
function normKeyword(s: string): string {
  return (s || "").replace(/\s+/g, "").toLowerCase();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── 텔레그램 HTML 이스케이프 (키워드 등 가변 텍스트에만 적용) ──────
// lib/telegram-nlu.ts의 escapeHtml과 동일한 3줄 규칙.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * 생성 결과 요약을 텔레그램으로 보고.
 * telegramEnabled()가 false면 조용히 스킵. 전송 실패해도 throw하지 않음
 * (호출부에서 try/catch로 한 번 더 감싸 exit code에 영향 없게 함).
 */
async function reportToTelegram(summary: {
  total: number;
  saved: number;
  alreadySaved: number;
  failed: string[];
  // 오늘 저장 완료된 전체 키워드 (이번 실행 신규분 + 기존 alreadySaved분 포함)
  allSavedKeywords: string[];
}): Promise<void> {
  const { telegramEnabled, sendTelegram } = await import("../lib/telegram");
  if (!telegramEnabled()) return;

  const { total, saved, failed, allSavedKeywords } = summary;

  let text: string;
  if (failed.length === 0) {
    const keywordLines = allSavedKeywords.map((k) => escapeHtml(k)).join("\n");
    text = `✅ 오늘 블로그 ${total}/${total} 저장 완료`;
    if (keywordLines) text += `\n\n${keywordLines}`;
  } else {
    const failedLines = failed.map((k) => escapeHtml(k)).join("\n");
    text =
      `⚠️ 오늘 블로그 ${saved}/${total} 저장 · 실패 ${failed.length}건\n\n` +
      `${failedLines}\n\n` +
      `쿼터/일시 오류면 GitHub Actions에서 Generate Daily Posts를 다시 실행하면 이미 저장된 건 건너뛰고 누락만 재생성됩니다.`;
  }

  try {
    await sendTelegram(text);
  } catch (err) {
    console.warn("[generate-daily] 텔레그램 전송 실패:", err);
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  const productionUrl = requireEnv("PRODUCTION_URL").replace(/\/+$/, "");
  const cronSecret = requireEnv("CRON_SECRET");

  console.log(`▶ Plan 조회: ${productionUrl}/api/cron/plan`);
  const plan = await fetchPlan(productionUrl, cronSecret);
  console.log(`  계획 ${plan.length}건 수신`);

  console.log(`▶ 기존 저장 키워드 조회: ${productionUrl}/api/cron/posts-today`);
  const existingKeywords = await fetchExistingKeywords(
    productionUrl,
    cronSecret,
  );
  console.log(`  이미 저장된 오늘 키워드 ${existingKeywords.length}개`);

  // 누락 계산 — 이미 저장된 키워드(공백 무시)는 건너뜀
  const existingSet = new Set(existingKeywords.map(normKeyword));
  const missing = plan.filter((item) => !existingSet.has(normKeyword(item.keyword)));

  console.log(
    `▶ 누락 ${missing.length}건 / 전체 ${plan.length}건 (이미 ${plan.length - missing.length}건 저장됨)`,
  );

  if (dryRun) {
    console.log("── [dry-run] 생성/저장 없이 누락 목록만 출력 ──");
    missing.forEach((item, i) => {
      console.log(
        `  ${i + 1}. [Track ${item.track ?? "?"}] ${item.keyword} (${item.category ?? "?"}) [${item.persona ?? "?"}] slot=${item.slot ?? "?"} pattern=${item.forcedPattern ?? "?"}`,
      );
    });
    const summary = {
      dryRun: true,
      total: plan.length,
      alreadySaved: plan.length - missing.length,
      missing: missing.map((m) => m.keyword),
    };
    console.log(JSON.stringify(summary));
    return;
  }

  // ── 실제 생성 (dry-run 아닐 때만 lib 로드) ────────────────────
  const libs = await loadLibs();

  let saved = 0;
  const failed: string[] = [];
  const savedKeywords: string[] = [];

  for (let i = 0; i < missing.length; i++) {
    const item = missing[i];
    console.log(
      `\n▶ (${i + 1}/${missing.length}) ${item.keyword} — [Track ${item.track ?? "?"}] ${item.category ?? "?"}`,
    );

    let ok = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await generateAndSaveOne(libs, item);
        console.log(
          `✅ ${item.keyword} → ${r.id} | ${r.title} | ${r.charCount}자 | SEO ${r.seoScore} (시도 ${attempt})`,
        );
        saved++;
        savedKeywords.push(item.keyword);
        ok = true;
        break;
      } catch (err) {
        const msg = (err as Error).message || String(err);
        console.log(`  …시도 ${attempt}/3 실패: ${msg}`);
        if (attempt < 3) {
          await sleep(5_000); // 사이 5초 대기
        }
      }
    }

    if (!ok) {
      console.log(`❌ ${item.keyword} — 3회 재시도 후에도 실패`);
      failed.push(item.keyword);
    }
  }

  // 마지막에 요약 JSON 한 줄
  const summary = {
    total: plan.length,
    saved,
    alreadySaved: plan.length - missing.length,
    failed,
  };
  console.log("\n" + JSON.stringify(summary));

  // 텔레그램 보고 (dry-run 아닐 때만, 전송 실패해도 exit code에 영향 없음)
  try {
    await reportToTelegram({
      total: plan.length,
      saved,
      alreadySaved: plan.length - missing.length,
      failed,
      // 이번 실행 신규분 + 실행 전 이미 저장돼 있던 분 (오늘 저장된 전체 키워드)
      allSavedKeywords: [...existingKeywords, ...savedKeywords],
    });
  } catch (err) {
    console.warn("[generate-daily] 텔레그램 보고 중 예외:", err);
  }

  // 하나라도 최종 실패면 exit 1 (모든 항목 처리 후)
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("치명적 오류:", err);
  process.exit(1);
});
