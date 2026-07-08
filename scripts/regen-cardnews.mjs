/**
 * scripts/regen-cardnews.mjs
 *
 * 오늘(또는 지정) 글들의 "카드뉴스"(섹션 인포카드)를 새 시스템으로 생성.
 *   - 각 섹션 카드마다 다른 상업용 모델(klein/schnell 로테이션) + 다른 장면 프롬프트 → 이미지 다양성
 *   - card-image.py 아님 → infocard.py(사진 헤더 + 자동높이 정보패널, 짤림 없음)
 *   - 저장: public/card-news/{postId}-{pageNum}.png
 *
 * 문구는 extractCardData(post, {maxItems, maxItemLen})의 섹션 카드에서:
 *   title/subtitle/bullets/bulletStyle/pageNum/totalPages
 *
 * 실행: npx tsx scripts/regen-cardnews.mjs [--ids p-...,p-...] [--limit N] [--max-cards 3]
 */
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");
const INFOCARD_PY = join(__dirname, "infocard.py");
const OUT_DIR = join(REPO, "public", "card-news");

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
  const maxCards = args["max-cards"] ? parseInt(args["max-cards"], 10) : 3;
  const skipExisting = !!args["skip-existing"]; // 이미 있는 카드는 건너뜀(백필/재실행용)

  const { getTodayPosts } = await import("../lib/sheets.ts");
  const { extractCardData } = await import("../lib/extract-card-data.ts");
  const { buildPrompt, generateBackgroundImage, pickModel } = await import("./nvidia-image.mjs");

  let posts = await getTodayPosts();
  if (typeof args.ids === "string") {
    const ids = new Set(args.ids.split(",").map((s) => s.trim()));
    posts = posts.filter((p) => ids.has(p.id));
  }
  if (args.limit) posts = posts.slice(0, parseInt(args.limit, 10));

  const results = [];
  let rot = 0; // 전역 모델 로테이션 카운터
  for (const p of posts) {
    const cards = extractCardData(
      { title: p.title, keyword: p.keyword, category: p.category, contentHtml: p.content_html },
      { maxItems: 6, maxItemLen: 75 },
    );
    const sections = cards.filter((c) => c.type === "section" && c.bullets && c.bullets.length >= 2).slice(0, maxCards);

    for (const c of sections) {
      const outPath = join(OUT_DIR, `${p.id}-${c.pageNum}.png`);
      // 백필/재실행 모드: 이미 만들어진 카드는 건너뜀 (NVIDIA 지연 사고 후 빠진 것만 채우기).
      if (skipExisting && existsSync(outPath)) {
        results.push({ id: p.id, page: c.pageNum, ok: true, skipped: true });
        console.log(JSON.stringify(results.at(-1)));
        rot++; // 로테이션 인덱스는 그대로 진행(모델 분포 유지)
        continue;
      }
      const bg = join(tmpdir(), `cardnews-bg-${p.id}-${c.pageNum}.jpg`);
      const model = pickModel(rot++);
      // 최대 4회 재시도 — CONTENT_FILTERED에 걸리는 특정 컨셉이 있으므로,
      // 재시도마다 topic을 살짝 바꿔 "다른 배경 컨셉"으로 회피한다.
      // 단, 타임아웃·네트워크·5xx·429(엔드포인트 지연/과부하)는 재시도해도 같은 벽이므로
      // 즉시 포기하고 다음 카드로 넘어간다 → 순차 생성이 잡 타임아웃까지 밀리는 것 방지.
      let bgRes = null;
      let lastErr = "";
      for (let attempt = 0; attempt < 4 && !bgRes; attempt++) {
        const topic = attempt === 0 ? c.title : `${c.title} ${attempt}`;
        const prompt = buildPrompt({ topic, keyword: p.keyword });
        try {
          bgRes = await generateBackgroundImage({ prompt, outPath: bg, model });
        } catch (e) {
          lastErr = e.message || String(e);
          if (/타임아웃|네트워크 에러|HTTP 5\d\d|HTTP 000|HTTP 429/.test(lastErr)) break;
        }
      }
      if (!bgRes) {
        results.push({ id: p.id, page: c.pageNum, ok: false, reason: `배경실패: ${lastErr}` });
        console.log(JSON.stringify(results.at(-1)));
        continue;
      }

      const input = JSON.stringify({
        bg_path: bgRes.outPath,
        page: `${c.pageNum}/${c.totalPages}`,
        title: c.title,
        subtitle: c.subtitle,
        bullets: c.bullets,
        bullet_style: c.bulletStyle,
        handle: "@ntelsafe",
        out_path: outPath,
      });
      const py = spawnSync("python3", [INFOCARD_PY], { input, encoding: "utf8", cwd: REPO });
      if (py.status !== 0) {
        results.push({ id: p.id, page: c.pageNum, ok: false, reason: `py실패: ${(py.stderr || "").slice(0, 120)}` });
      } else {
        results.push({ id: p.id, page: c.pageNum, ok: true, model: bgRes.model, out: `public/card-news/${p.id}-${c.pageNum}.png` });
      }
      console.log(JSON.stringify(results.at(-1)));
    }
  }

  const ok = results.filter((r) => r.ok).length;
  console.log(JSON.stringify({ total: results.length, ok, failed: results.length - ok }));
}

main().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
