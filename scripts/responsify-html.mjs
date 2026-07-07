/**
 * scripts/responsify-html.mjs
 *
 * 이미 생성된 티스토리 글 HTML(content_html)의 인라인 style을,
 * lib/post-generator.ts에 반영된 반응형 규칙과 동일하게 결정론적 문자열 치환으로 변환한다.
 *
 * ⚠️ 글 텍스트/내용은 절대 건드리지 않는다. 오직 인라인 style 문자열만 치환.
 *
 * 이 프로젝트의 실제 글 HTML은 프롬프트 템플릿과 마크업이 100% 동일해서
 * (같은 font-size:NNpx, 같은 grid, 같은 padding 값), 아래 순수 문자열 replaceAll로 안전하게 변환된다.
 *
 * CLI:
 *   node scripts/responsify-html.mjs <입력파일> <출력파일>
 *   → 입력을 읽어 responsifyHtml 적용 후 출력에 저장, 규칙별 적용 횟수를 JSON으로 stdout에 출력.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 각 규칙: [찾을 문자열, 바꿀 문자열, 규칙명]
 * 모두 순수 문자열 replaceAll(전역). 정규식 아님.
 *
 * 순서 주의:
 *  - (B)에서 padding:24px 28px 를 padding:20px 24px 보다 "먼저" 치환.
 *  - font-size 치환 결과의 clamp() 안 px는 "font-size:" 접두어가 없어 재매칭되지 않음.
 */
const RULES = [
  // ── (A) font-size 8종 → clamp ──────────────────────────────
  ["font-size:30px", "font-size:clamp(22px,5.5vw,30px)", "A_fontSize30"],
  ["font-size:18px", "font-size:clamp(16px,4.4vw,18px)", "A_fontSize18"],
  ["font-size:17px", "font-size:clamp(15px,4vw,17px)", "A_fontSize17"],
  ["font-size:16px", "font-size:clamp(14.5px,3.9vw,16px)", "A_fontSize16"],
  ["font-size:15px", "font-size:clamp(14px,3.7vw,15px)", "A_fontSize15"],
  ["font-size:14px", "font-size:clamp(13px,3.5vw,14px)", "A_fontSize14"],
  ["font-size:13px", "font-size:clamp(12px,3.2vw,13px)", "A_fontSize13"],
  ["font-size:12px", "font-size:clamp(11px,3vw,12px)", "A_fontSize12"],

  // ── (B) 큰 컨테이너 padding → clamp (작은 padding은 그대로) ──
  //   24px 28px 를 20px 24px 보다 먼저.
  [
    "padding:48px 40px",
    "padding:clamp(24px,6vw,48px) clamp(20px,5vw,40px)",
    "B_pad48_40",
  ],
  [
    "padding:24px 28px",
    "padding:clamp(18px,5vw,24px) clamp(18px,5vw,28px)",
    "B_pad24_28",
  ],
  // 아래 규칙은 padding:20px 24px 6px(헤더)의 접두어도 함께 바꿔
  // 뒤의 ' 6px'가 그대로 남아 올바른 결과가 된다. (별도 헤더 규칙 없음)
  [
    "padding:20px 24px",
    "padding:clamp(16px,4.5vw,20px) clamp(18px,5vw,24px)",
    "B_pad20_24",
  ],
  [
    "padding:16px 20px",
    "padding:clamp(13px,3.8vw,16px) clamp(15px,4.2vw,20px)",
    "B_pad16_20",
  ],
  [
    "padding:18px 22px",
    "padding:clamp(14px,4vw,18px) clamp(16px,4.5vw,22px)",
    "B_pad18_22",
  ],

  // ── (C) grid → flex-wrap (2종 컨테이너) ────────────────────
  [
    "display:grid;grid-template-columns:1fr 1fr;gap:12px;",
    "display:flex;flex-wrap:wrap;gap:12px;",
    "C_grid12",
  ],
  [
    "display:grid;grid-template-columns:1fr 1fr;gap:10px;",
    "display:flex;flex-wrap:wrap;gap:10px;",
    "C_grid10",
  ],

  // ── (D) 히어로 CTA 버튼 자식에 flex 추가 ───────────────────
  [
    'style="display:block;background:#FFFFFF;border-radius:12px;padding:18px;text-align:center;',
    'style="flex:1 1 calc(50% - 6px);min-width:150px;box-sizing:border-box;display:block;background:#FFFFFF;border-radius:12px;padding:18px;text-align:center;',
    "D_heroBtn",
  ],

  // ── (E) 목차 anchor 자식에 flex + 넓은 min-width 추가 ──────
  [
    'style="display:flex;justify-content:space-between;padding:12px 16px;border:1px solid #E5E8EB;border-radius:10px;text-decoration:none;background:#FFFFFF;',
    'style="flex:1 1 calc(50% - 5px);min-width:240px;box-sizing:border-box;display:flex;justify-content:space-between;gap:8px;padding:12px 16px;border:1px solid #E5E8EB;border-radius:10px;text-decoration:none;background:#FFFFFF;',
    "E_tocAnchor",
  ],
];

/**
 * 입력 HTML에 위 규칙을 순서대로 전역 치환하여 반환.
 * @param {string} html
 * @returns {string}
 */
export function responsifyHtml(html) {
  let out = html;
  for (const [find, replace] of RULES) {
    out = out.replaceAll(find, replace);
  }
  return out;
}

/**
 * 규칙별 적용 횟수를 계산해 반환 (치환 실제로는 수행하지 않고 카운트만).
 * 순차 치환을 시뮬레이션하기 위해 실제 responsifyHtml과 동일한 순서로
 * 중간 문자열을 갱신하며 각 단계의 매칭 수를 센다.
 * @param {string} html
 * @returns {Record<string, number>}
 */
export function countRules(html) {
  const counts = {};
  let cur = html;
  for (const [find, replace, name] of RULES) {
    const n = occurrences(cur, find);
    counts[name] = n;
    if (n > 0) cur = cur.replaceAll(find, replace);
  }
  return counts;
}

/** 순수 문자열 needle의 겹치지 않는 출현 횟수. */
function occurrences(haystack, needle) {
  if (needle === "") return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

// ── CLI ─────────────────────────────────────────────────────
const isMain = (() => {
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (isMain) {
  const [, , inPath, outPath] = process.argv;
  if (!inPath || !outPath) {
    console.error(
      "Usage: node scripts/responsify-html.mjs <input.html> <output.html>",
    );
    process.exit(1);
  }
  const src = readFileSync(inPath, "utf8");
  const counts = countRules(src);
  const result = responsifyHtml(src);
  writeFileSync(outPath, result, "utf8");
  console.log(
    JSON.stringify(
      {
        input: inPath,
        output: outPath,
        inputLength: src.length,
        outputLength: result.length,
        changed: src !== result,
        counts,
      },
      null,
      2,
    ),
  );
}
