/**
 * scripts/regen-thumbnails.mjs
 *
 * 오늘(또는 지정) 글들의 썸네일을 새 카드 시스템(NVIDIA 배경 + card-image.py 오버레이)으로
 * 다시 생성해 public/thumbnails/{id}.png 에 저장한다.
 *
 * 썸네일 문구는 posts 시트 image_urls 컬럼(N)에 저장된 메타(JSON: {lines, highlight, tags})를 사용.
 *   title_lines ← meta.lines, highlight ← meta.highlight, hashtags ← meta.tags
 *   배경 프롬프트 ← 글 keyword
 *
 * 실행: npx tsx scripts/regen-thumbnails.mjs [--ids p-...,p-...] [--limit N]
 *   플래그 없으면 오늘 글 전체.
 */
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");
const CARD_PY = join(__dirname, "card-image.py");
const OUT_DIR = join(REPO, "public", "thumbnails");

// .env.local 로드 (generate-daily.ts와 동일 방식)
function loadEnvLocal() {
  const p = join(REPO, ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    if (process.env[k] !== undefined) continue;
    let v = t.slice(eq + 1).trim();
    if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'"))))
      v = v.slice(1, -1);
    process.env[k] = v;
  }
}
loadEnvLocal();

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const k = argv[i].slice(2);
    const nx = argv[i + 1];
    if (nx === undefined || nx.startsWith("--")) out[k] = true;
    else { out[k] = nx; i++; }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // 이미지 하단 핸들 — 테넌트 카드에 오너 계정(@ntelsafe)이 박히면 브랜드 사고다.
  // --handle 로 테넌트 브랜드를 넘기고, 없으면 기존 오너 기본값.
  const HANDLE = typeof args.handle === "string" ? args.handle : "@ntelsafe";
  const skipExisting = !!args["skip-existing"]; // 이미 있는 썸네일은 건너뜀(백필/재실행용)
  const { getTodayPosts } = await import("../lib/sheets.ts");
  const { buildPrompt, generateBackgroundImage } = await import("./nvidia-image.mjs");

  // 테넌트 모드: --sheet-id 로 그 테넌트 시트의 오늘 글만 대상으로 한다.
  //   (인자가 없으면 기존 동작 = 오너 메인 시트, 무회귀)
  const sheetId = typeof args["sheet-id"] === "string" ? args["sheet-id"] : undefined;
  let posts = await getTodayPosts(sheetId);
  if (typeof args.ids === "string") {
    const ids = new Set(args.ids.split(",").map((s) => s.trim()));
    posts = posts.filter((p) => ids.has(p.id));
  }
  if (args.limit) posts = posts.slice(0, parseInt(args.limit, 10));

  const results = [];
  for (const p of posts) {
    const outPath = join(OUT_DIR, `${p.id}.png`);
    // 백필/재실행 모드: 이미 만들어진 썸네일은 건너뜀 (NVIDIA 지연 사고 후 빠진 것만 채우기).
    if (skipExisting && existsSync(outPath)) {
      results.push({ id: p.id, ok: true, skipped: true });
      console.log(JSON.stringify(results.at(-1)));
      continue;
    }

    let meta = null;
    try { meta = JSON.parse(p.image_urls || ""); } catch {}
    if (!meta || !meta.lines) {
      results.push({ id: p.id, ok: false, reason: "메타 없음" });
      console.log(JSON.stringify(results.at(-1)));
      continue;
    }

    const bg = join(tmpdir(), `thumb-bg-${p.id}.jpg`);
    const prompt = buildPrompt({ topic: p.keyword, keyword: p.keyword });
    let bgRes;
    try {
      bgRes = await generateBackgroundImage({ prompt, outPath: bg });
    } catch (e1) {
      // 타임아웃·네트워크·5xx·429(엔드포인트 지연)면 재시도해도 같은 벽 → 즉시 포기.
      // 그 외(콘텐츠 필터 등)만 1회 재시도.
      const down = /타임아웃|네트워크 에러|HTTP 5\d\d|HTTP 000|HTTP 429/.test(e1.message || "");
      let e2 = e1;
      if (!down) {
        try { bgRes = await generateBackgroundImage({ prompt, outPath: bg }); }
        catch (err) { e2 = err; }
      }
      if (!bgRes) {
        results.push({ id: p.id, ok: false, reason: `배경실패: ${e2.message}` });
        console.log(JSON.stringify(results.at(-1)));
        continue;
      }
    }

    const input = JSON.stringify({
      bg_path: bgRes.outPath,
      title_lines: meta.lines,
      hashtags: meta.tags || [],
      highlight_line_index: meta.highlight ?? [0],
      handle: HANDLE,
      out_path: outPath,
    });
    const py = spawnSync("python3", [CARD_PY], { input, encoding: "utf8", cwd: REPO });
    if (py.status !== 0) {
      results.push({ id: p.id, ok: false, reason: `py실패: ${(py.stderr || "").slice(0, 120)}` });
    } else {
      results.push({ id: p.id, ok: true, seed: bgRes.seed, out: `public/thumbnails/${p.id}.png` });
    }
    console.log(JSON.stringify(results.at(-1)));
  }

  const ok = results.filter((r) => r.ok).length;
  console.log(JSON.stringify({ total: results.length, ok, failed: results.length - ok }));
}

main().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
