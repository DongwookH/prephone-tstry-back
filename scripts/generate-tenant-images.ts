/**
 * 테넌트 글 썸네일·카드뉴스 생성 — 테넌트를 순회하며 각자 본인 NVIDIA 키로 만든다.
 *   npx --yes tsx scripts/generate-tenant-images.ts [--dry-run]
 *
 * ⚠️ 키 격리가 이 스크립트의 존재 이유다.
 *    NVIDIA_API_KEY는 프로세스 전역 env로 읽히므로, 테넌트별로 spawn 하면서
 *    그 테넌트의 키만 주입한다. 부모 프로세스의 오너 키는 자식에게 물려주지
 *    않는다 — 물려주면 테넌트 이미지가 오너 할당량으로 나가고, 반대로 오너
 *    작업이 테넌트 키를 쓰는 사고가 난다 (2026-07-28 GA 토큰 사고와 같은 유형).
 *
 * 실행 조건 (하나라도 없으면 그 테넌트는 스킵 + 사유 로그):
 *   1. status=active + 전용 시트 발급됨
 *   2. settings 탭에 nvidia_key 등록됨
 *   3. 오늘 생성된 글이 있음 (없으면 만들 게 없음)
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function loadEnvLocal() {
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
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    process.env[k] = v;
  }
}
loadEnvLocal();

const DRY_RUN = process.argv.includes("--dry-run");
const MAX_CARDS = process.env.TENANT_MAX_CARDS ?? "4";
/** --date YYMMDD : 그 날짜 글만 (백필용). 생략 시 오늘. */
const DATE_ARG = (() => {
  const i = process.argv.indexOf("--date");
  return i >= 0 ? process.argv[i + 1] : undefined;
})();

/** 브랜드명 → 이미지 하단 핸들. 이모지·특수문자를 걷어내고 한 줄로. */
function handleFor(brandName: string): string {
  const clean = (brandName || "").replace(/\s+/g, " ").trim();
  return clean || "블로그";
}

type Summary = {
  email: string;
  brand?: string;
  thumbs?: unknown;
  cards?: unknown;
  skipped?: string;
};

async function main() {
  const { listTenants } = await import("../lib/tenants");
  const { loadTenantGuide } = await import("../lib/tenant-config");
  const { getNvidiaKeysFromSheet, getTodayPosts } = await import("../lib/sheets");

  const tenants = (await listTenants()).filter(
    (t) => t.role !== "owner" && t.status === "active" && t.spreadsheet_id,
  );
  console.log(`활성 멤버 테넌트: ${tenants.length}명`);

  const out: Summary[] = [];
  for (const t of tenants) {
    const entry: Summary = { email: t.email };

    const keys = await getNvidiaKeysFromSheet(t.spreadsheet_id).catch(() => []);
    if (keys.length === 0) {
      entry.skipped = "NVIDIA 키 미등록 (settings 탭)";
      console.log(`⏭️  ${t.email} — ${entry.skipped}`);
      out.push(entry);
      continue;
    }

    const { getAllPosts } = await import("../lib/sheets");
    const posts = DATE_ARG
      ? (await getAllPosts(t.spreadsheet_id).catch(() => [])).filter((p: any) =>
          (p.id || "").startsWith(`p-${DATE_ARG}-`),
        )
      : await getTodayPosts(t.spreadsheet_id).catch(() => []);
    if (posts.length === 0) {
      entry.skipped = "오늘 생성된 글 없음";
      console.log(`⏭️  ${t.email} — ${entry.skipped}`);
      out.push(entry);
      continue;
    }

    const guide = await loadTenantGuide(t.spreadsheet_id).catch(() => null);
    const handle = handleFor(guide?.brand_name ?? t.name);
    entry.brand = handle;

    if (DRY_RUN) {
      entry.skipped = `(dry-run) 실행 가능 — 글 ${posts.length}건, 핸들 "${handle}"`;
      console.log(`▶ ${t.email} — ${entry.skipped}`);
      out.push(entry);
      continue;
    }

    // 자식 프로세스 env — 오너 NVIDIA 키는 일부러 물려주지 않는다.
    const childEnv = { ...process.env, NVIDIA_API_KEY: keys[0].value };

    for (const [label, script, extra] of [
      ["썸네일", "scripts/regen-thumbnails.mjs", [] as string[]],
      ["카드뉴스", "scripts/regen-cardnews.mjs", ["--max-cards", MAX_CARDS]],
    ] as const) {
      const r = spawnSync(
        "npx",
        [
          "--yes",
          "tsx",
          script,
          "--sheet-id",
          t.spreadsheet_id,
          "--handle",
          handle,
          ...(DATE_ARG ? ["--date", DATE_ARG] : []),
          ...extra,
        ],
        { env: childEnv, encoding: "utf8", cwd: process.cwd() },
      );
      const lines = (r.stdout || "").trim().split("\n");
      const last = lines.at(-1) ?? "";
      console.log(`  [${t.email}] ${label}: ${last}`);
      if (r.status !== 0) {
        console.log(
          `  ⚠️ ${label} 종료코드 ${r.status} — ${(r.stderr || "").slice(0, 200)}`,
        );
      }
      try {
        const parsed = JSON.parse(last);
        if (label === "썸네일") entry.thumbs = parsed;
        else entry.cards = parsed;
      } catch {
        /* 요약 JSON을 못 찾으면 로그만 남긴다 */
      }
    }
    out.push(entry);
  }

  console.log("\n=== 요약 ===");
  console.log(JSON.stringify({ tenants: out }));
}

main().catch((e) => {
  console.error("실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
