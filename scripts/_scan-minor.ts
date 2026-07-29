/** 오너·테넌트 전체 글에서 미성년자 개통 가능 오정보를 훑는다 (제목 포함). */
import { readFileSync, existsSync } from "node:fs";

function loadEnv() {
  const p = ".env.local";
  if (!existsSync(p)) return;
  for (const l of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (process.env[k] !== undefined) continue;
    let v = t.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    process.env[k] = v;
  }
}
loadEnv();

async function scan(label: string, sheetId?: string) {
  const { getAllPosts } = await import("../lib/sheets");
  const { findMinorEligibilityClaims } = await import("../lib/content-guards");
  const posts: any[] = await getAllPosts(sheetId);

  const bad: Array<{ id: string; status: string; where: string; hit: string }> = [];
  for (const p of posts) {
    const titleHits = findMinorEligibilityClaims(p.title || "");
    const bodyHits = findMinorEligibilityClaims(p.content_html || "");
    if (titleHits.length) bad.push({ id: p.id, status: p.status, where: "제목", hit: titleHits[0] });
    else if (bodyHits.length)
      bad.push({ id: p.id, status: p.status, where: "본문", hit: bodyHits[0] });
  }
  console.log(`\n=== ${label} — 전체 ${posts.length}편 중 위반 ${bad.length}편 ===`);
  for (const b of bad) {
    console.log(`  ${b.id.padEnd(18)} [${b.status}] ${b.where}: «${b.hit}»`);
  }
  return bad;
}

async function main() {
  await scan("오너 (앤텔레콤)");
  const { listTenants } = await import("../lib/tenants");
  for (const t of (await listTenants()).filter(
    (x) => x.role !== "owner" && x.status === "active" && x.spreadsheet_id,
  )) {
    await scan(`테넌트 ${t.email}`, t.spreadsheet_id);
  }
}
main().catch((e) => console.error(e instanceof Error ? e.message : e));
