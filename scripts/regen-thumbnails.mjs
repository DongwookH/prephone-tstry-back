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
  const { getTodayPosts } = await import("../lib/sheets.ts");
  const { buildPrompt, generateBackgroundImage } = await import("./nvidia-image.mjs");

  let posts = await getTodayPosts();
  if (typeof args.ids === "string") {
    const ids = new Set(args.ids.split(",").map((s) => s.trim()));
    posts = posts.filter((p) => ids.has(p.id));
  }
  if (args.limit) posts = posts.slice(0, parseInt(args.limit, 10));

  const results = [];
  for (const p of posts) {
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
      // 1회 재시도
      try { bgRes = await generateBackgroundImage({ prompt, outPath: bg }); }
      catch (e2) {
        results.push({ id: p.id, ok: false, reason: `배경실패: ${e2.message}` });
        console.log(JSON.stringify(results.at(-1)));
        continue;
      }
    }

    const outPath = join(OUT_DIR, `${p.id}.png`);
    const input = JSON.stringify({
      bg_path: bgRes.outPath,
      title_lines: meta.lines,
      hashtags: meta.tags || [],
      highlight_line_index: meta.highlight ?? [0],
      handle: "@ntelsafe",
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
