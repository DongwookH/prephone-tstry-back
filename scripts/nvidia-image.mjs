/**
 * scripts/nvidia-image.mjs
 *
 * NVIDIA build.nvidia.com NIM API(flux.2-klein-4b)로 텍스트→이미지 배경 생성.
 * 1차 모델 실패 시 flux.1-schnell로 자동 폴백.
 *
 * 실측: 응답 artifacts[0].base64를 디코딩하면 실제로는 JPEG 바이트 (확장자와 무관).
 *
 * env:
 *   NVIDIA_API_KEY      필수. build.nvidia.com API 키.
 *   NVIDIA_IMAGE_MODEL   선택. 기본 black-forest-labs/flux.2-klein-4b
 *
 * CLI:
 *   node scripts/nvidia-image.mjs --prompt "..." --out path/to/file.jpg
 *   node scripts/nvidia-image.mjs --topic "선불폰 개통" --keyword "선불폰" --out path/to/file.jpg
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ── .env.local 폴백 로드 ────────────────────────
// generate-daily.ts의 loadEnvLocal()과 동일한 방식 — dotenv 의존성 없이 직접 파싱.
function loadEnvLocal() {
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
    // 이미 process.env에 있으면 덮어쓰지 않음
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

const API_URL_BASE = "https://ai.api.nvidia.com/v1/genai";

// ⚠️ 상업용 라이선스 모델만 사용 (블로그는 사업용).
//    flux.2-klein-4b: commercial/non-commercial 허용 · flux.1-schnell: Apache 2.0
//    flux.1-dev, stable-diffusion-3.5-large 는 non-commercial 라이선스 → 사용 금지(로테이션 제외).
//
// 로테이션 풀 — 현재 klein만 활성.
//   flux.1-schnell 은 상업용(Apache 2.0)이나 2026-07-07 기준 API가 무응답(HTTP 000, 90s 타임아웃)이라 잠정 제외.
//   → 응답 정상화되면 아래 배열에 다시 추가하면 자동으로 로테이션에 합류.
export const COMMERCIAL_MODELS = [
  "black-forest-labs/flux.2-klein-4b",
  // "black-forest-labs/flux.1-schnell", // 무응답 상태라 잠정 비활성 (복구 시 주석 해제)
];

/** 로테이션 인덱스로 상업용 모델 하나 선택 (카드마다 다른 모델 → 다양성). */
export function pickModel(i = 0) {
  const n = COMMERCIAL_MODELS.length;
  return COMMERCIAL_MODELS[((i % n) + n) % n];
}

/** NIM 이미지 생성 엔드포인트 1회 호출. 실패 시 에러 throw(상태코드·본문 일부 포함). */
async function callNimModel({ model, prompt, width, height, steps, seed }) {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    throw new Error(
      "NVIDIA_API_KEY 환경변수가 없습니다. .env.local에 설정하거나 env로 주입하세요.",
    );
  }

  const url = `${API_URL_BASE}/${model}`;
  // 응답 없이 매달리는 모델(예: 한때 무응답이던 schnell) 대비 타임아웃 — 빨리 실패 후 폴백.
  // 정상 응답은 ~3초. 30초를 넘기면 엔드포인트가 지연/과부하 상태이므로 빨리 포기해
  // 순차 생성이 잡 타임아웃(GHA)까지 밀리는 사태를 막는다. (2026-07-08 klein 지연 사고 대응)
  const TIMEOUT_MS = Number(process.env.NVIDIA_TIMEOUT_MS) || 30000;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ prompt, width, height, steps, seed }),
      signal: ctl.signal,
    });
  } catch (err) {
    throw new Error(
      `[${model}] ${err.name === "AbortError" ? `타임아웃(${Math.round(TIMEOUT_MS / 1000)}s)` : "네트워크 에러"}: ${err.message}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(
      `[${model}] HTTP ${res.status} ${res.statusText}: ${bodyText.slice(0, 500)}`,
    );
  }

  const data = await res.json();
  const artifact = data?.artifacts?.[0];
  if (!artifact?.base64) {
    throw new Error(
      `[${model}] 응답에 artifacts[0].base64가 없습니다: ${JSON.stringify(data).slice(0, 500)}`,
    );
  }
  return artifact;
}

/**
 * 배경 이미지 생성 — flux.2-klein-4b 우선, 실패 시 flux.1-schnell 폴백 1회.
 * 성공 시 outPath에 저장하고 { outPath, seed, model } 반환.
 */
export async function generateBackgroundImage({
  prompt,
  width = 1024,
  height = 1024,
  steps = 4,
  seed = 0,
  outPath,
  model, // 선호 모델(로테이션용). 실패 시 나머지 상업용 모델로 폴백.
}) {
  if (!prompt || !prompt.trim()) {
    throw new Error("prompt가 필요합니다.");
  }
  if (!outPath) {
    throw new Error("outPath가 필요합니다.");
  }

  // 선호 모델을 먼저 시도, 실패하면 나머지 상업용 모델로 폴백.
  const preferred = COMMERCIAL_MODELS.includes(model)
    ? model
    : COMMERCIAL_MODELS[0];
  const attempts = [
    preferred,
    ...COMMERCIAL_MODELS.filter((m) => m !== preferred),
  ];

  const errors = [];
  for (const model of attempts) {
    try {
      const artifact = await callNimModel({
        model,
        prompt,
        width,
        height,
        steps,
        seed,
      });
      const buf = Buffer.from(artifact.base64, "base64");
      writeFileSync(outPath, buf);
      return {
        outPath,
        seed: artifact.seed ?? seed,
        model,
      };
    } catch (err) {
      errors.push(err.message || String(err));
    }
  }

  throw new Error(
    `이미지 생성 실패 (모델 ${attempts.length}개 모두 실패):\n${errors.join("\n")}`,
  );
}

// ─── 프롬프트 빌더 ────────────────────────────────

// 배경 컨셉 후보 — 스마트폰·유심을 "실물 그대로" 보이게 하는 제품 사진 위주.
//
// ⚠️ 이 모델(flux.2-klein-4b)은 negative_prompt를 지원하지 않는다 (2026-07-28 실측: HTTP 422).
//    그래서 "no text, no people" 같은 부정문을 프롬프트에 넣으면 오히려 그 단어들이
//    그려진다(확산 모델의 알려진 특성). 원하지 않는 것은 언급하지 말고,
//    원하는 상태를 긍정문으로 못박는다:
//      "글자 없음" → "unbranded plain surfaces" / "screen switched off, pure black"
//      "사람 없음" → "empty desk", "unoccupied"
//
// 실물감 포인트 — 확산 모델이 스마트폰·유심을 자주 뭉갠다. 이를 줄이는 조건:
//    ① 정면/톱다운처럼 단순한 각도 (사각 비스듬한 각도는 형태가 깨짐)
//    ② 화면은 꺼진 상태(검정) — 켜면 알아볼 수 없는 가짜 UI·글자가 생김
//    ③ 유심은 규격을 명시 (nano-SIM, 금색 접점, 모서리 컷)
const BACKGROUND_CONCEPTS = [
  "a single nano-SIM card with fine gold contact pads and one clipped corner, resting flat on a light oak desk beside a matte black smartphone lying face down, top-down flat lay",
  "a modern black slab smartphone lying flat on a pale grey desk, screen switched off and pure black, a slim SIM ejector pin resting beside it, straight top-down view",
  "an open aluminium SIM tray partly pulled out from the side of a matte black smartphone lying flat on a desk, viewed from above at a moderate distance, the tray small in the frame",
  "a smartphone standing upright in a simple wooden stand on a clean desk, screen switched off and pure black, a plain notebook and a ceramic mug beside it",
  "a plain white plastic SIM card carrier with a nano-SIM punched out, lying on a smooth concrete surface, top-down flat lay, even soft light",
  "two smartphones lying side by side flat on a light wooden table, both screens switched off and pure black, one slightly rotated, straight top-down view",
  "a nano-SIM card and a small ejector pin arranged neatly on a matte white surface with generous empty space around them, top-down flat lay",
  "a smartphone lying face up on a linen cloth with the screen switched off and pure black, soft morning window light from the left, calm still life",
  "a tidy desk corner with a matte black smartphone, a plain unbranded SIM card carrier, and a fountain pen, top-down flat lay on light wood",
  "a smartphone resting on a stack of two plain paper notebooks on a bright desk, screen switched off and pure black, soft diffused daylight",
  "a light wooden desk seen from directly above with a matte black smartphone lying face down and a small blank white SIM card carrier placed near the edge, generous empty desk space",
  "an unbranded telecom shop counter surface with a matte black smartphone and a small card tray, blurred shelves far behind, empty of customers",
];

// 사진 품질·실물감 — 카메라 언어로 못박는다 (모델이 가장 잘 반응하는 축).
const REALISM_SUFFIX =
  "professional product photography, shot on a 50mm lens at f/4, realistic true-to-life proportions, " +
  "accurate material rendering with real plastic and aluminium and glass textures, " +
  "soft diffused natural window light, gentle shadows, neutral white balance, " +
  "sharp focus on the subject, fine surface detail, subtle reflections, high dynamic range, " +
  "smooth blank unprinted card surfaces, plain matte finishes, "
  "calm minimal composition with generous smooth empty space " +
  "in the upper area for later caption placement, muted natural colour palette, " +
  "clean uncluttered still life, empty and unoccupied scene";

/** 키워드 문자열 해시 → 배열 인덱스 (threads-research.ts의 pickCopyStyle과 동일 방식). */
function hashPick(seedStr, arr) {
  let h = 0;
  for (const ch of seedStr) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return arr[h % arr.length];
}

/**
 * 카드 이미지용 배경 사진 프롬프트 빌더.
 * topic/keyword 해시로 배경 컨셉을 결정론적으로 선택한다.
 */
export function buildPrompt({ topic = "", keyword = "", mood = "" }) {
  const seedStr = `${topic}|${keyword}|${mood}`;
  const concept = hashPick(seedStr || "default", BACKGROUND_CONCEPTS);
  const moodPart = mood ? `, ${mood} mood` : "";
  return `${concept}${moodPart}. ${REALISM_SUFFIX}`;
}

// ─── CLI 진입점 ────────────────────────────────

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

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.out) {
    console.error(
      "사용법: node scripts/nvidia-image.mjs --prompt \"...\" --out path/to/file.jpg\n" +
        "     또는 --topic \"...\" --keyword \"...\" --out path/to/file.jpg",
    );
    process.exit(1);
  }

  const prompt =
    typeof args.prompt === "string"
      ? args.prompt
      : buildPrompt({
          topic: typeof args.topic === "string" ? args.topic : "",
          keyword: typeof args.keyword === "string" ? args.keyword : "",
          mood: typeof args.mood === "string" ? args.mood : "",
        });

  const width = args.width ? parseInt(args.width, 10) : 1024;
  const height = args.height ? parseInt(args.height, 10) : 1024;
  const steps = args.steps ? parseInt(args.steps, 10) : 4;
  const seed = args.seed ? parseInt(args.seed, 10) : 0;

  try {
    const result = await generateBackgroundImage({
      prompt,
      width,
      height,
      steps,
      seed,
      outPath: args.out,
    });
    console.log(JSON.stringify({ ok: true, prompt, ...result }));
  } catch (err) {
    console.log(
      JSON.stringify({ ok: false, error: err.message || String(err) }),
    );
    process.exit(1);
  }
}

// 직접 실행될 때만 CLI 동작 (다른 모듈에서 import 시엔 실행 안 됨)
const isMain =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main();
}
