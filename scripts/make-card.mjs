/**
 * scripts/make-card.mjs
 *
 * nvidia-image.mjs(배경 생성) + card-image.py(텍스트 합성)를 한 번에 묶어서
 * 완성된 카드 이미지를 생성하는 CLI.
 *
 * 흐름:
 *   1. buildPrompt + generateBackgroundImage로 임시 배경 이미지 생성 (os.tmpdir())
 *   2. card-image.py에 JSON을 stdin으로 넘겨 배경 위에 제목/해시태그/핸들 합성
 *   3. 최종 결과(out_path, seed, model)를 JSON 한 줄로 stdout에 출력
 *
 * CLI:
 *   node scripts/make-card.mjs \
 *     --topic "선불폰 유심 교체" --keyword "선불유심" \
 *     --title "유심 교체 전 꼭 확인하세요|분실 위약금 0원" \
 *     --hashtags "유심교체,선불유심,앤텔레콤" \
 *     --highlight 1 --handle "@ntelsafe" \
 *     --out /path/to/card.png
 *
 * 옵션:
 *   --topic <string>      필수. buildPrompt에 넘길 주제
 *   --keyword <string>    필수. buildPrompt에 넘길 키워드
 *   --mood <string>       선택. buildPrompt에 넘길 무드
 *   --title <string>      "|"로 구분된 제목 줄들
 *   --hashtags <string>   ","로 구분된 해시태그 (# 없어도 됨)
 *   --highlight <int>     선택. highlight_line_index로 전달
 *   --handle <string>     선택. 기본 "@ntelsafe"
 *   --out <path>          필수. 최종 카드 이미지 저장 경로
 *   --width / --height / --steps / --seed  선택. nvidia-image.mjs로 그대로 전달
 *
 * 제약: nvidia-image.mjs / card-image.py 원본은 수정하지 않고 import/spawn으로만 사용.
 */

import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { buildPrompt, generateBackgroundImage } from "./nvidia-image.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARD_IMAGE_PY = join(__dirname, "card-image.py");

// ─── CLI 인자 파싱 (nvidia-image.mjs와 동일한 방식, 의존성 없이 직접 파싱) ───
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const topic = typeof args.topic === "string" ? args.topic : "";
  const keyword = typeof args.keyword === "string" ? args.keyword : "";
  const mood = typeof args.mood === "string" ? args.mood : "";
  const out = typeof args.out === "string" ? args.out : "";

  if (!topic) fail("--topic 인자가 필요합니다.");
  if (!keyword) fail("--keyword 인자가 필요합니다.");
  if (!out) fail("--out 인자가 필요합니다.");

  const titleLines =
    typeof args.title === "string"
      ? args.title.split("|").map((s) => s.trim()).filter(Boolean)
      : [];

  const hashtags =
    typeof args.hashtags === "string"
      ? args.hashtags.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

  const handle = typeof args.handle === "string" ? args.handle : "@ntelsafe";

  let highlightLineIndex;
  if (typeof args.highlight === "string" && args.highlight.trim() !== "") {
    const parsed = parseInt(args.highlight, 10);
    if (!Number.isNaN(parsed)) highlightLineIndex = parsed;
  }

  const width = args.width ? parseInt(args.width, 10) : undefined;
  const height = args.height ? parseInt(args.height, 10) : undefined;
  const steps = args.steps ? parseInt(args.steps, 10) : undefined;
  const seed = args.seed ? parseInt(args.seed, 10) : undefined;

  // 1) 배경 이미지 생성 (임시 파일)
  const bgPath = join(
    tmpdir(),
    `make-card-bg-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`,
  );

  const prompt = buildPrompt({ topic, keyword, mood });

  let bgResult;
  try {
    bgResult = await generateBackgroundImage({
      prompt,
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      ...(steps !== undefined ? { steps } : {}),
      ...(seed !== undefined ? { seed } : {}),
      outPath: bgPath,
    });
  } catch (err) {
    fail(`배경 이미지 생성 실패: ${err.message || String(err)}`);
    return;
  }

  // 2) card-image.py로 텍스트 합성
  const cardInput = {
    bg_path: bgResult.outPath,
    title_lines: titleLines,
    hashtags,
    handle,
    out_path: out,
  };
  if (highlightLineIndex !== undefined) {
    cardInput.highlight_line_index = highlightLineIndex;
  }

  const pyResult = spawnSync("python3", [CARD_IMAGE_PY], {
    input: JSON.stringify(cardInput),
    encoding: "utf8",
    cwd: process.cwd(),
  });

  if (pyResult.error) {
    fail(`card-image.py 실행 실패: ${pyResult.error.message}`);
    return;
  }

  if (pyResult.status !== 0) {
    console.error(pyResult.stderr || `card-image.py가 종료 코드 ${pyResult.status}로 실패했습니다.`);
    process.exit(1);
  }

  // 3) 최종 결과 출력
  console.log(
    JSON.stringify({
      ok: true,
      out_path: out,
      bg_path: bgResult.outPath,
      seed: bgResult.seed,
      model: bgResult.model,
    }),
  );
}

main().catch((err) => {
  fail(err && err.message ? err.message : String(err));
});
