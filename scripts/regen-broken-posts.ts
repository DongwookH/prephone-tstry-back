/**
 * scripts/regen-broken-posts.ts
 *
 * 구조 가드에 걸리는 글(본문 잘림·목차 끊김)을 찾아 같은 키워드로 재생성한다.
 * 2026-07-29 사고(모델 교체로 본문 1/3 축소) 복구용으로 만들었지만,
 * 같은 유형이 또 생기면 그대로 재사용할 수 있게 범용으로 둔다.
 *
 *   npx --yes tsx scripts/regen-broken-posts.ts                 # dry-run (기본)
 *   npx --yes tsx scripts/regen-broken-posts.ts --apply         # 실제 기록
 *   npx --yes tsx scripts/regen-broken-posts.ts --apply --tenants-only
 *   npx --yes tsx scripts/regen-broken-posts.ts --apply --owner-only
 *   npx --yes tsx scripts/regen-broken-posts.ts --apply --scheduled-only  # 예약된 글만
 *
 * 보존/갱신 원칙 — 슬롯을 흔들지 않는다:
 *   보존: id(A) keyword(C) category(D) persona(E) status(J) scheduled_at(K)
 *   갱신: title(B) content_html(G) char_count(H) seo_score(I)
 *         image_urls(N) utm_campaign(R) updated_at(T) tags(U)
 *
 * ⚠️ status가 published인 글은 손대지 않는다 (소급 수정 금지 원칙).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function loadEnvLocal(): void {
  const p = join(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    if (!k || process.env[k] !== undefined) continue;
    let v = t.slice(eq + 1).trim();
    if (
      v.length >= 2 &&
      ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
    )
      v = v.slice(1, -1);
    process.env[k] = v;
  }
}
loadEnvLocal();

const APPLY = process.argv.includes("--apply");
const OWNER_ONLY = process.argv.includes("--owner-only");
const TENANTS_ONLY = process.argv.includes("--tenants-only");
/** 예약된 글만 대상 — 미예약 옛 초안은 건드리지 않는다. */
const SCHEDULED_ONLY = process.argv.includes("--scheduled-only");
/** 글 1편당 최대 생성 시도 (구조 가드에 걸리면 재시도). */
const MAX_TRIES = 3;

type Target = { id: string; keyword: string; category?: string; persona?: string; row: number };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 해당 시트의 파손 글 + 시트 행 번호를 찾는다. */
async function findBroken(sheetId?: string): Promise<Target[]> {
  const { readRange, mainSheetId } = await import("../lib/sheets");
  const {
    findStructuralDefects,
    findMinorEligibilityClaims,
    findForeignerEligibilityClaims,
    findOfficialSelfClaims,
    findPromptLeakage,
    findCommonComplianceBannedWords,
    findFirstPersonVictimClaims,
  } = await import("../lib/content-guards");

  const rows = (await readRange(sheetId ?? mainSheetId(), "posts!A:U")) as string[][];

  // ⚠️ 헤더는 1행이라고 가정하면 안 된다. 오너 시트는 1행이 "💡 자동 생성된
  //    글 데이터…" 안내 행이고 헤더가 2행이다. 고정 오프셋을 쓰면 헤더 행을
  //    글로 착각해 통째로 덮어쓴다 (2026-07-29에 실제로 냈던 사고).
  //    A열이 정확히 "id"인 행을 헤더로 삼는다.
  const hIdx = rows.findIndex((r) => (r?.[0] ?? "").trim() === "id");
  if (hIdx < 0) throw new Error("posts 헤더 행(A열='id')을 찾지 못했습니다 — 중단");

  const out: Target[] = [];
  for (let i = hIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const [id, title, keyword, category, persona, , html, , , status, scheduledAt, publishedAt, tistoryUrl] = r;
    if (!id?.trim()) continue;
    // --scheduled-only: 예약시각이 있는 글(= 실제로 발행될 글)만 손댄다.
    // 5~6월 미예약 옛 초안까지 건드리지 말라는 지시 (2026-07-29 사업주).
    if (SCHEDULED_ONLY && !scheduledAt?.trim()) continue;
    // 소급 수정 금지 — status뿐 아니라 발행 흔적(published_at·tistory_url)도 본다.
    // status가 ready인데 published_at만 찍힌 옛 행이 실제로 있다.
    if (status === "published" || publishedAt?.trim() || tistoryUrl?.trim()) continue;
    if (!html) continue;
    // 재생성 사유 두 가지: 구조 파손 + 사실 오류(미성년자 셀프개통 가능 주장).
    // 제목만 위반인 경우도 있어 제목·본문을 함께 검사한다.
    const defects = [
      ...findStructuralDefects(html),
      ...findMinorEligibilityClaims(`${title ?? ""}\n${html}`),
      ...findForeignerEligibilityClaims(`${title ?? ""}\n${html}`),
      ...findOfficialSelfClaims(`${title ?? ""}\n${html}`),
      ...findPromptLeakage(`${title ?? ""}\n${html}`),
      ...findCommonComplianceBannedWords(`${title ?? ""}\n${html}`),
      ...findFirstPersonVictimClaims(`${title ?? ""}\n${html}`),
    ];
    if (defects.length === 0) continue;
    out.push({ id, keyword, category, persona, row: i + 1 }); // 시트는 1-based
  }
  return out;
}

/** 한 시트 분량을 재생성. */
async function regenSheet(label: string, sheetId?: string, tenantGuide?: unknown) {
  const { batchUpdateValues, mainSheetId } = await import("../lib/sheets");
  const { generatePost } = await import("../lib/post-generator");
  const {
    findStructuralDefects,
    findMinorEligibilityClaims,
    findForeignerEligibilityClaims,
    findOfficialSelfClaims,
    findPromptLeakage,
    findCommonComplianceBannedWords,
    findFirstPersonVictimClaims,
    measureBodyChars,
  } = await import("../lib/content-guards");
  const targetSheet = sheetId ?? mainSheetId();

  const targets = await findBroken(sheetId);
  console.log(`\n=== ${label} — 파손 ${targets.length}편 ===`);
  if (targets.length === 0) return { total: 0, ok: 0, failed: 0 };

  let ok = 0;
  let failed = 0;
  for (const t of targets) {
    let done = false;
    let lastErr = "";
    for (let attempt = 1; attempt <= MAX_TRIES && !done; attempt++) {
      try {
        const post = await generatePost({
          keyword: t.keyword,
          category: t.category,
          persona: t.persona,
          retryFeedback: attempt > 1 ? lastErr : undefined,
          tenantGuide: tenantGuide as never,
        });
        const defects = [
          ...findStructuralDefects(post.content_html),
          ...findMinorEligibilityClaims(`${post.title}\n${post.content_html}`),
          ...findForeignerEligibilityClaims(`${post.title}\n${post.content_html}`),
          ...findOfficialSelfClaims(`${post.title}\n${post.content_html}`),
          ...findPromptLeakage(`${post.title}\n${post.content_html}`),
          ...findCommonComplianceBannedWords(`${post.title}\n${post.content_html}`),
          ...findFirstPersonVictimClaims(`${post.title}\n${post.content_html}`),
        ];
        if (defects.length > 0) throw new Error(defects.join(" / "));

        const chars = measureBodyChars(post.content_html);
        if (APPLY) {
          await batchUpdateValues(targetSheet, [
            { range: `posts!B${t.row}`, values: [[post.title]] },
            { range: `posts!G${t.row}`, values: [[post.content_html]] },
            { range: `posts!H${t.row}`, values: [[post.char_count]] },
            { range: `posts!I${t.row}`, values: [[post.seo_score]] },
            {
              range: `posts!N${t.row}`,
              values: [[post.thumbnail ? JSON.stringify(post.thumbnail) : ""]],
            },
            { range: `posts!R${t.row}`, values: [[post.utm_campaign]] },
            { range: `posts!T${t.row}`, values: [[new Date().toISOString()]] },
            { range: `posts!U${t.row}`, values: [[(post.tags ?? []).join(", ")]] },
          ]);
        }
        console.log(
          `  ${APPLY ? "✅" : "🔍"} ${t.id} (${t.keyword}) — ${chars}자 · 시도 ${attempt} · ${post.title.slice(0, 40)}`,
        );
        ok++;
        done = true;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        if (attempt === MAX_TRIES) {
          console.log(`  ❌ ${t.id} (${t.keyword}) — ${MAX_TRIES}회 실패: ${lastErr.slice(0, 100)}`);
          failed++;
        }
      }
    }
    await sleep(1500); // 시트·API 부담 완화
  }
  return { total: targets.length, ok, failed };
}

async function main() {
  console.log(APPLY ? "⚠️  실제 기록 모드 (--apply)" : "🔍 dry-run — 시트에 쓰지 않습니다");

  const summary: Record<string, unknown> = {};

  if (!TENANTS_ONLY) {
    summary["owner"] = await regenSheet("오너 (앤텔레콤)");
  }

  if (!OWNER_ONLY) {
    const { listTenants } = await import("../lib/tenants");
    const { loadTenantGuide } = await import("../lib/tenant-config");
    const { getGeminiKeysFromSheet } = await import("../lib/sheets");
    const { invalidateGeminiKeyCache } = await import("../lib/gemini");

    const ts = (await listTenants()).filter(
      (x) => x.role !== "owner" && x.status === "active" && x.spreadsheet_id,
    );
    const ownerKeys = process.env.GEMINI_API_KEYS;
    for (const t of ts) {
      // ⚠️ 테넌트는 반드시 본인 키로만 — 오너 키가 새면 할당량이 뒤섞인다.
      const ks = await getGeminiKeysFromSheet(t.spreadsheet_id!).catch(() => []);
      if (ks.length === 0) {
        console.log(`\n⏭️  ${t.email} — Gemini 키 미등록, 건너뜀`);
        continue;
      }
      process.env.GEMINI_API_KEYS = ks.map((k) => k.value).join(",");
      invalidateGeminiKeyCache();
      try {
        const guide = await loadTenantGuide(t.spreadsheet_id!);
        summary[t.email] = await regenSheet(`테넌트 ${t.email}`, t.spreadsheet_id, guide);
      } finally {
        process.env.GEMINI_API_KEYS = ownerKeys ?? "";
        invalidateGeminiKeyCache();
      }
    }
  }

  console.log("\n=== 요약 ===");
  console.log(JSON.stringify(summary));
  if (!APPLY) console.log("\n실제 반영하려면 --apply 를 붙여 다시 실행하세요.");
}

main().catch((e) => {
  console.error("실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
