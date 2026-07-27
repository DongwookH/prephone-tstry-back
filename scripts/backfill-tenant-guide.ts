/**
 * 기존 테넌트 시트의 guide 탭에 누락된 섹션 행을 채운다 (1회성 마이그레이션).
 *   npx tsx scripts/backfill-tenant-guide.ts          # 미리보기
 *   npx tsx scripts/backfill-tenant-guide.ts --apply  # 실제 반영
 *
 * 2026-07-27 폼 도입으로 link_kakao·link_site·phone·hours 행이 추가됐다.
 * 기존 값은 읽어서 그대로 다시 쓰므로 내용 손실이 없다 (saveTenantGuideRaw는
 * 있는 행의 C·D열만 갱신하고 없는 행만 append).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function loadEnvLocal() {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    process.env[key] = value;
  }
}
loadEnvLocal();

const apply = process.argv.includes("--apply");

async function main() {
  const { listTenants } = await import("../lib/tenants");
  const {
    loadTenantGuideRaw,
    saveTenantGuideRaw,
    GUIDE_SECTION_DEFS,
    assembleGuide,
    missingRequiredGuideSections,
  } = await import("../lib/tenant-config");
  const { readRange } = await import("../lib/sheets");

  const tenants = (await listTenants()).filter(
    (t) => t.role !== "owner" && t.spreadsheet_id,
  );
  if (tenants.length === 0) {
    console.log("대상 테넌트 없음");
    return;
  }

  for (const t of tenants) {
    const sid = t.spreadsheet_id;
    let existing: string[] = [];
    try {
      const rows = await readRange(sid, "guide!A:A");
      existing = rows
        .slice(1)
        .map((r) => (r?.[0] ?? "").trim().toLowerCase())
        .filter(Boolean);
    } catch {
      existing = [];
    }
    const want = GUIDE_SECTION_DEFS.map((d) => d.key as string);
    const missingRows = want.filter((k) => !existing.includes(k));

    console.log(`\n[${t.name || t.email}]`);
    console.log(`  현재 섹션 행: ${existing.length}개`);
    console.log(
      `  추가 필요: ${missingRows.length ? missingRows.join(", ") : "없음"}`,
    );

    if (missingRows.length === 0) continue;

    if (!apply) {
      console.log("  → (미리보기) --apply 를 붙이면 반영합니다");
      continue;
    }

    const raw = await loadTenantGuideRaw(sid);
    await saveTenantGuideRaw(sid, raw);
    const after = assembleGuide(await loadTenantGuideRaw(sid));
    const still = missingRequiredGuideSections(after);
    console.log(
      `  ✅ 반영 완료 — 필수 미작성: ${still.length ? still.join(", ") : "없음(작성 완료)"}`,
    );
  }
}

main().catch((e) => {
  console.error("실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
