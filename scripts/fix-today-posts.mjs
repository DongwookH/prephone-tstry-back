/**
 * scripts/fix-today-posts.mjs
 *
 * 오늘(KST 기준) 생성된 글들의 시트 content_html(G열)을
 * responsify-html.mjs의 responsifyHtml 결과로 업데이트한다.
 *
 * ⚠️ 글 텍스트/내용은 절대 안 바뀐다. 오직 인라인 style 문자열만 치환.
 * ⚠️ status가 "ready"인 글만 대상 (이미 published거나 실패한 건 제외).
 *
 * 안전장치:
 *   - 기본 동작은 --dry-run (시트에 절대 쓰지 않음). 실제 기록은 --apply 필요.
 *   - dry-run이면 각 글 id/title/변환전후 길이/규칙별 적용횟수만 출력.
 *
 * 실행:
 *   npx --yes tsx scripts/fix-today-posts.mjs            # dry-run (기본)
 *   npx --yes tsx scripts/fix-today-posts.mjs --apply    # 실제 기록
 *
 * (../lib/sheets 가 .ts 라서 이 스크립트는 generate-daily.ts와 동일하게 tsx로 실행한다.)
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// responsify 로직은 반드시 재사용 (중복 금지)
import { responsifyHtml, countRules } from "./responsify-html.mjs";

// ── .env.local 폴백 로드 (generate-daily.ts의 loadEnvLocal 방식) ──
//    dotenv 없이 직접 파싱. lib 모듈이 로드 시점에 process.env를 읽으므로
//    lib import "전에" 반드시 로드해야 한다 (아래는 dynamic import 사용).
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
    if (process.env[key] !== undefined) continue; // 이미 있으면 안 덮어씀
    let value = trimmed.slice(eq + 1).trim();
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

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const mode = apply ? "apply" : "dry-run";

  loadEnvLocal();

  // env 로드 "후"에 lib import (post-generator/gemini 관례와 동일)
  const sheets = await import("../lib/sheets.ts");
  const { getTodayPosts, mainSheetId, updateCell, readRange } = sheets;

  const today = await getTodayPosts();
  // status가 "ready"인 것만 대상
  const targets = today.filter((p) => p.status === "ready");

  // apply 모드에서만 id→행번호 매칭용으로 A열을 1회 읽는다.
  let idColRows = null;
  if (apply) {
    idColRows = await readRange(mainSheetId(), "posts!A:A");
  }

  const changedIds = [];
  let changed = 0;
  let skipped = 0;

  for (const post of targets) {
    const before = post.content_html || "";
    const after = responsifyHtml(before);
    const counts = countRules(before);
    const didChange = after !== before;

    // 규칙별 적용횟수 중 0이 아닌 것만 요약 출력용으로 추림
    const appliedCounts = Object.fromEntries(
      Object.entries(counts).filter(([, n]) => n > 0),
    );

    const line = {
      id: post.id,
      title: post.title,
      status: post.status,
      beforeLen: before.length,
      afterLen: after.length,
      changed: didChange,
      counts: appliedCounts,
    };

    if (!didChange) {
      skipped++;
      console.log(JSON.stringify({ ...line, action: "skip-nochange" }));
      continue;
    }

    changed++;
    changedIds.push(post.id);

    if (!apply) {
      // dry-run: 절대 시트에 쓰지 않음
      console.log(JSON.stringify({ ...line, action: "would-update" }));
      continue;
    }

    // apply: 행 번호 찾아 G열 업데이트
    const rows = idColRows || [];
    let targetRow = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i]?.[0] === post.id) {
        targetRow = i + 1; // 1-indexed
        break;
      }
    }
    if (targetRow < 0) {
      console.log(
        JSON.stringify({ ...line, action: "error-row-not-found" }),
      );
      // 못 찾으면 changed 카운트에서 되돌림
      changed--;
      changedIds.pop();
      skipped++;
      continue;
    }

    await updateCell(mainSheetId(), `posts!G${targetRow}`, after);
    console.log(
      JSON.stringify({ ...line, action: "updated", row: targetRow }),
    );
  }

  // 마지막 요약 JSON 한 줄
  console.log(
    JSON.stringify({
      mode,
      targeted: targets.length,
      changed,
      skipped,
      ids: changedIds,
    }),
  );
}

// ESM 메인 가드
const isMain = (() => {
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error(String(err?.message || err));
    process.exit(1);
  });
}
