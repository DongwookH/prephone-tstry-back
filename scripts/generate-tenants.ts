/**
 * scripts/generate-tenants.ts
 *
 * 멀티테넌트 글 생성 크론 — 활성 테넌트(멤버)를 순회하며 각자 전용 시트에
 * 글을 생성·저장한다. (오너 파이프라인 generate-daily.ts와 완전 분리)
 *
 * 테넌트별 실행 조건 (하나라도 안 되면 그 테넌트는 스킵 + 사유 로그):
 *   1. status=active, role=member, spreadsheet_id 있음
 *   2. guide 탭 필수 섹션(brand_name·links·company·plans) 작성됨
 *   3. settings 탭에 본인 Gemini 키 등록됨 (오너 키 절대 대체 사용 안 함)
 *   4. keywords 탭에 active 키워드 있음
 *
 * ⚠️ env 오버라이드 패턴: lib/sheets.ts의 모든 함수가 호출 시점에
 *    GOOGLE_SHEETS_ID를 읽으므로, 테넌트 순회 중 env를 그 테넌트 시트로
 *    바꿔치기한다. 반드시 ① 테넌트 목록은 오버라이드 "전에" 읽고
 *    ② gemini 키 캐시를 invalidate하고 ③ finally에서 원복한다.
 *    (memory: multitenant-architecture)
 *
 * 실행: npx --yes tsx scripts/generate-tenants.ts [--dry-run]
 *   --dry-run: 테넌트별 실행 가능 여부 진단만 출력, 생성 없음.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

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
    if (!key || process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
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

const DRY_RUN = process.argv.includes("--dry-run");
/**
 * 테넌트 1인당 하루 생성 편수 (env TENANT_DAILY_COUNT, 기본 3).
 *
 * 상한 30 — 무한정 열어두면 오타 하나로 수백 편이 생성돼 키워드 재고와
 * API 할당량이 하루에 소진된다. 30은 GHA 잡 제한시간 안에서 이미지까지
 * 끝낼 수 있는 현실적 상한이다 (편당 생성+이미지 약 1분).
 * 상한을 올릴 땐 워크플로 timeout-minutes도 같이 올려야 한다.
 */
const DAILY_COUNT = Math.max(
  1,
  Math.min(30, parseInt(process.env.TENANT_DAILY_COUNT ?? "3", 10) || 3),
);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function todayKstCompact(): string {
  const kst = new Date(Date.now() + 9 * 3600_000);
  return kst.toISOString().slice(0, 10).replace(/-/g, "").slice(2); // YYMMDD
}

async function main(): Promise<void> {
  // env 로드 "후" import (gemini.ts 등이 로드 시점에 env를 읽음)
  const { listTenants } = await import("../lib/tenants");
  const {
    loadTenantGuide,
    loadTenantGeminiKeys,
    missingRequiredGuideSections,
  } = await import("../lib/tenant-config");
  const sheets = await import("../lib/sheets");
  const { generatePost } = await import("../lib/post-generator");
  const { invalidateGeminiKeyCache } = await import("../lib/gemini");

  // ① 테넌트 목록은 env 오버라이드 전에 (마스터 시트에서) 읽는다
  const tenants = (await listTenants()).filter(
    (t) => t.status === "active" && t.role === "member" && t.spreadsheet_id,
  );
  console.log(`활성 멤버 테넌트: ${tenants.length}명 (하루 ${DAILY_COUNT}건씩)`);
  if (tenants.length === 0) {
    console.log("실행할 테넌트 없음 — 종료");
    return;
  }

  const MASTER_SHEET_ID = process.env.GOOGLE_SHEETS_ID;
  const MASTER_KEYWORDS_ID = process.env.KEYWORDS_SHEET_ID;

  const summary: Array<{
    email: string;
    saved: number;
    skipped?: string;
    errors: string[];
  }> = [];

  for (const t of tenants) {
    const entry: (typeof summary)[number] = {
      email: t.email,
      saved: 0,
      errors: [],
    };
    summary.push(entry);

    // ── 실행 조건 진단 (테넌트 시트 직접 읽기 — env 오버라이드 불필요) ──
    const guide = await loadTenantGuide(t.spreadsheet_id);
    const missing = missingRequiredGuideSections(guide);
    if (missing.length > 0) {
      entry.skipped = `guide 필수 섹션 미작성: ${missing.join(", ")}`;
      console.log(`⏭️  ${t.email} — ${entry.skipped}`);
      continue;
    }
    const keys = await loadTenantGeminiKeys(t.spreadsheet_id);
    if (keys.length === 0) {
      entry.skipped = "Gemini 키 미등록 (settings 탭)";
      console.log(`⏭️  ${t.email} — ${entry.skipped}`);
      continue;
    }

    if (DRY_RUN) {
      entry.skipped = "(dry-run) 실행 가능";
      console.log(
        `🔍 ${t.email} — 실행 가능 (키 ${keys.length}개, 브랜드 "${guide.brand_name}")`,
      );
      continue;
    }

    // ── ② env 오버라이드: 이후 sheets/gemini 호출은 전부 테넌트 시트 대상 ──
    process.env.GOOGLE_SHEETS_ID = t.spreadsheet_id;
    delete process.env.KEYWORDS_SHEET_ID; // keywords도 테넌트 시트로 폴백
    invalidateGeminiKeyCache(); // 테넌트 settings 탭 키를 다시 읽게

    try {
      // 키워드 선정 — 덜 쓴 순으로 N개
      const activeKeywords = await sheets
        .getActiveKeywords()
        .catch(() => [] as Awaited<ReturnType<typeof sheets.getActiveKeywords>>);
      if (activeKeywords.length === 0) {
        entry.skipped = "active 키워드 없음 (keywords 탭)";
        console.log(`⏭️  ${t.email} — ${entry.skipped}`);
        continue;
      }
      const picked = [...activeKeywords]
        .sort(
          (a, b) =>
            (parseInt(a.used_count || "0", 10) || 0) -
            (parseInt(b.used_count || "0", 10) || 0),
        )
        .slice(0, DAILY_COUNT);

      // 오늘 이미 만든 키워드는 건너뛴다 (재실행 멱등성)
      const existing = await sheets.getAllPosts().catch(() => []);
      const todayKST = todayKstCompact();
      const todayIds = existing.filter((p) =>
        (p.id || "").startsWith(`p-${todayKST}-`),
      );
      const doneKeywords = new Set(todayIds.map((p) => p.keyword));

      // ⚠️ 하루 총량 상한 — 키워드 중복 검사만으로는 재실행을 막지 못한다.
      //    picked는 used_count 오름차순으로 매 호출 재계산되므로, 어제 쓴
      //    키워드의 used_count가 올라가면 오늘 뽑히는 20개가 이미 저장된
      //    19개와 겹치지 않는다 → "전부 누락"으로 보여 20개를 더 만든다.
      //    (2026-07-30 실측: 19편 + 재실행 17편 = 36편. 오너 파이프라인은
      //     같은 사고를 2026-07-26에 겪고 이 상한을 넣어 막고 있었다.)
      const remainingToday = Math.max(0, DAILY_COUNT - todayIds.length);
      if (remainingToday === 0) {
        // entry는 루프 진입 시 이미 summary에 넣었으므로 다시 push하지 않는다.
        entry.skipped = `오늘 이미 ${todayIds.length}편 저장됨 (상한 ${DAILY_COUNT}) — 생성 없음`;
        console.log(`   ↩️ ${t.email} — ${entry.skipped}`);
        continue;
      }
      if (todayIds.length > 0) {
        console.log(
          `   ⚠️ 하루 상한 적용: 오늘 이미 ${todayIds.length}편 → ${remainingToday}편만 생성`,
        );
      }
      const usedSlots = new Set<number>(
        todayIds
          .map((p) => parseInt((p.id || "").split("-")[2] || "0", 10))
          .filter((n) => n > 0),
      );

      let madeToday = 0;
      for (const kw of picked) {
        // 상한 도달 — 남은 키워드는 내일로 넘긴다 (재실행 과잉 생성 방지)
        if (madeToday >= remainingToday) {
          console.log(
            `   ⏹️ 하루 상한 ${DAILY_COUNT}편 도달 — 남은 키워드는 다음 실행으로`,
          );
          break;
        }
        if (doneKeywords.has(kw.keyword)) {
          console.log(`   ↩️ ${kw.keyword} — 오늘 이미 생성됨, 스킵`);
          continue;
        }

        let lastGuardError: string | undefined;
        let ok = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const recentTitles = await sheets
              .getRecentPostTitles(25)
              .catch(() => []);
            const post = await generatePost({
              keyword: kw.keyword,
              category: kw.category || "일반",
              persona: "일반",
              recentTitles,
              retryFeedback: lastGuardError,
              tenantGuide: guide,
            });

            let slot = 1;
            while (usedSlots.has(slot)) slot++;
            usedSlots.add(slot);
            const id = `p-${todayKST}-${String(slot).padStart(3, "0")}`;
            const now = new Date().toISOString();
            await sheets.appendPosts([
              {
                id,
                title: post.title,
                keyword: kw.keyword,
                category: kw.category || "일반",
                persona: "일반",
                content_html: post.content_html,
                char_count: post.char_count,
                seo_score: post.seo_score,
                status: "ready",
                // 썸네일 문구 메타 — generate-tenant-images.ts가 이 값을 읽어
                // 썸네일 PNG를 만든다. 안 넣으면 "메타 없음"으로 썸네일만 실패한다
                // (2026-07-28: 카드뉴스는 3/3 성공, 썸네일만 0/1로 드러남).
                image_urls: post.thumbnail ? JSON.stringify(post.thumbnail) : "",
                utm_campaign: post.utm_campaign,
                created_at: now,
                updated_at: now,
                tags: post.tags,
              },
            ]);
            await sheets.bumpKeywordsUsage([kw.keyword]).catch(() => {});
            console.log(
              `   ✅ ${t.email} | ${kw.keyword} → ${id} | ${post.title} (시도 ${attempt})`,
            );
            entry.saved++;
            madeToday++;
            ok = true;
            break;
          } catch (err) {
            const msg = (err as Error).message || String(err);
            if (/가드/.test(msg)) lastGuardError = msg;
            console.log(
              `   ⚠️ ${t.email} | ${kw.keyword} 시도 ${attempt}/3 실패: ${msg.slice(0, 160)}`,
            );
            if (attempt < 3) await sleep(5_000);
          }
        }
        if (!ok) entry.errors.push(kw.keyword);
      }
    } finally {
      // ── ③ env 원복 ──
      if (MASTER_SHEET_ID) process.env.GOOGLE_SHEETS_ID = MASTER_SHEET_ID;
      if (MASTER_KEYWORDS_ID !== undefined) {
        process.env.KEYWORDS_SHEET_ID = MASTER_KEYWORDS_ID;
      }
      invalidateGeminiKeyCache();
    }
  }

  console.log("\n=== 요약 ===");
  console.log(JSON.stringify({ dailyCount: DAILY_COUNT, tenants: summary }));

  const totalErrors = summary.reduce((n, s) => n + s.errors.length, 0);
  if (totalErrors > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("generate-tenants 실패:", err);
  process.exitCode = 1;
});
