/**
 * scripts/check-copy-quality.ts
 *
 * Threads 초안(threads_drafts 시트) 카피 품질을 "발행 전"에 오프라인으로 점검한다.
 * Gemini 등 LLM 호출 없이, 순수 정규식/문자열 패턴만으로 검사한다. 시트는 읽기 전용.
 *
 * 배경:
 *   Gemini가 생성한 한국어 Threads 초안은 (1) AI 티가 나는 상투적 표현,
 *   (2) 초안 간 획일화(같은 후킹/문장 반복), (3) 형식 규칙 위반(글자수·금지어 등)
 *   문제가 생기기 쉽다. humanizer 스킬(영어 기준 "signs of AI writing")의 패턴을
 *   한국어 카피 상황에 맞게 번안하고, lib/threads-research.ts의 출력 규칙
 *   (280자 제한, 금지된 옛 망 선택 문구 등)을 형식 검사로 옮겼다.
 *
 * 실행: npx --yes tsx scripts/check-copy-quality.ts [--all]
 *   --all: 최근 30일 발행분(published)까지 포함해서 검사.
 *          기본은 미발행(pending/scheduled) + scheduled_at이 지금 이후인 초안만.
 *
 * 종료 코드: 이슈 0건이면 0, 1건 이상이면 1 (CI 경고 게이트로 사용 가능).
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── .env.local 폴백 로드 (generate-daily.ts와 동일 패턴) ────────────
function loadEnvLocal(): void {
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
    if (process.env[key] !== undefined) continue; // 이미 있으면(GHA 주입 등) 유지
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

loadEnvLocal();

// ⚠️ env 로드 "후"에 lib을 import해야 하므로 dynamic import 사용.
type LibModules = {
  getThreadsDrafts: typeof import("../lib/sheets")["getThreadsDrafts"];
};

async function loadLibs(): Promise<LibModules> {
  const sheets = await import("../lib/sheets");
  return { getThreadsDrafts: sheets.getThreadsDrafts };
}

// ── 이슈 타입 ────────────────────────────────────────────────────
type IssueCategory = "ai_tone" | "duplication" | "format";

type Issue = {
  category: IssueCategory;
  field: "draft_text" | "self_replies";
  message: string;
};

type DraftRow = {
  id: string;
  keyword: string;
  status: string;
  scheduled_at: string;
  draft_text: string;
  self_replies: string; // JSON 문자열
};

// ══════════════════════════════════════════════════════════════════
// a. AI 티 나는 표현 (humanizer 영어 패턴 → 한국어 Threads 카피 번안)
// ══════════════════════════════════════════════════════════════════

type AiTonePattern = {
  name: string;
  regex: RegExp;
};

const AI_TONE_PATTERNS: AiTonePattern[] = [
  // §4 과장/광고체 어휘 (promotional language)
  {
    name: "과장 홍보체 어휘(게임체인저/혁명적 등)",
    regex: /게임\s*체인저|혁명적|놀라운\s*변화|압도적인|타의\s*추종을\s*불허/,
  },
  {
    name: "최상급 남발(완벽한/최고의/궁극의)",
    regex: /완벽한|최고의|궁극의|역대급|필수템/,
  },
  // §1 의의/중요성 과잉 부여
  {
    name: "의의 과잉 부여(핵심 역할/터닝포인트 등)",
    regex: /핵심적인\s*역할|중요한\s*의미|전환점이|새로운\s*기준을\s*제시/,
  },
  // §7 AI 특유 어휘(한국어 번역투)
  {
    name: "AI 번역투 어휘(강조하다/보여주다 남용)",
    regex: /핵심을\s*짚어|강조할\s*필요가\s*있|다시\s*한\s*번\s*강조/,
  },
  // §10 rule of three — 기계적 3연속 나열 ("A, B, C까지")
  {
    name: "기계적 3연속 나열(A, B, C까지)",
    regex: /[가-힣A-Za-z0-9]+,\s*[가-힣A-Za-z0-9]+,\s*[가-힣A-Za-z0-9]+까지/,
  },
  // §9 negative parallelism — "단순히 ~가 아니라"
  {
    name: "부정 대구(단순히 ~가 아니라)",
    regex: /단순히\s*.{1,20}(가|이)\s*아니라/,
  },
  // §9 "~일 뿐만 아니라 ~도"
  {
    name: "부정 대구(~뿐만 아니라 ~도)",
    regex: /뿐만\s*아니라\s*.{0,15}도/,
  },
  // §14 em dash — 한국어 카피에도 그대로 적용되는 하드 tell
  {
    name: "em/en dash 사용(—/–)",
    regex: /[—–]/,
  },
  // §18 이모지 과다 (4개 이상) — tsconfig target이 ES2017이라 dotAll(s) 플래그 불가,
  // 이모지 4개가 텍스트 어디에 흩어져 있어도 잡히도록 gu만 사용해 개수를 센다(별도 함수).
  // 느낌표 3연속 이상 (과장된 톤)
  {
    name: "느낌표 3연속 이상",
    regex: /!{3,}/,
  },
  // 물음표 3연속 이상
  {
    name: "물음표 3연속 이상",
    regex: /\?{3,}/,
  },
  // §20 챗봇 잔재(대화형 클로징)
  {
    name: "챗봇 잔재 문구(도움이 되길/궁금하면 댓글로 등)",
    regex: /도움이\s*되길|궁금하신\s*분들은|댓글로\s*남겨\s*주세요|알려\s*드릴게요\s*[.!]?$/,
  },
  // §28 시그널링/선언형 오프너 ("~해볼까요", "~알아봅시다")
  {
    name: "AI 선언형 오프너(~해볼까요/~알아봅시다)",
    regex: /알아볼까요|살펴볼까요|정리해\s*드릴게요|시작해\s*볼게요/,
  },
  // §33 가짜 솔직체 오프너
  {
    name: "가짜 솔직체 오프너(솔직히 말하면/사실은 등 클리셰 훅)",
    regex: /^(솔직히\s*말하면|사실\s*말하면|진짜\s*솔직히)/,
  },
  // 옛 코드에서 금지한 "핵심은 망 선택" 정형문 — 획일화·AI 정형문 겸용
  {
    name: "정형화된 핵심 요약체(핵심은 ~예요)",
    regex: /핵심은\s*.{0,10}(이에요|예요|입니다)/,
  },
];

// 이모지 카운트용 정규식 (dotAll 불필요 — matchAll로 전체 개수만 센다)
const EMOJI_REGEX = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

/** 텍스트 내 이모지 개수가 4개 이상이면 메시지 반환. */
function checkEmojiOveruse(text: string): string | null {
  const count = [...text.matchAll(EMOJI_REGEX)].length;
  return count >= 4 ? `이모지 과다: ${count}개` : null;
}

/** 같은 어미가 4연속 반복되는지 검사 (해요체/합니다체 등 문장 종결이 계속 같은 경우). */
function checkRepeatedEnding(text: string): string | null {
  // 문장 끝 어미 후보: "~해요", "~돼요", "~예요", "~네요", "~죠", "~습니다" 등
  const endings = [...text.matchAll(/([가-힣]{1,3}(?:해요|돼요|예요|네요|죠|습니다|합니다))[.!?\n]/g)].map(
    (m) => m[1].slice(-2), // 마지막 2글자(어미 유형)만 비교
  );
  if (endings.length < 4) return null;
  let run = 1;
  for (let i = 1; i < endings.length; i++) {
    if (endings[i] === endings[i - 1]) {
      run++;
      if (run >= 4) return `같은 어미(...${endings[i]}) 4연속 반복`;
    } else {
      run = 1;
    }
  }
  return null;
}

function checkAiTone(text: string, field: Issue["field"]): Issue[] {
  const issues: Issue[] = [];
  if (!text) return issues;
  for (const p of AI_TONE_PATTERNS) {
    if (p.regex.test(text)) {
      issues.push({ category: "ai_tone", field, message: `AI 티 패턴: ${p.name}` });
    }
  }
  const repeated = checkRepeatedEnding(text);
  if (repeated) {
    issues.push({ category: "ai_tone", field, message: `AI 티 패턴: ${repeated}` });
  }
  const emoji = checkEmojiOveruse(text);
  if (emoji) {
    issues.push({ category: "ai_tone", field, message: `AI 티 패턴: ${emoji}` });
  }
  return issues;
}

// ══════════════════════════════════════════════════════════════════
// c. 형식 규칙 (threads-research.ts 출력 규칙 기반)
// ══════════════════════════════════════════════════════════════════

const MAIN_MAX_LEN = 280;
const REPLY_MAX_LEN = 500;
const WALL_OF_TEXT_MIN_LEN = 120; // 줄바꿈 없이 이 길이 이상이면 "벽글"

// 옛 잘못된 망 선택 문구 — threads-research.ts §163~172 금지 사항
const BAD_MANG_PATTERN =
  /이력이\s*따라|같은\s*(통신사\s*)?망.{0,20}(막히|안\s*되|막힌|안돼)/;

function checkFormat(
  text: string,
  field: Issue["field"],
  maxLen: number,
): Issue[] {
  const issues: Issue[] = [];
  if (!text) return issues;

  if (text.length > maxLen) {
    issues.push({
      category: "format",
      field,
      message: `글자수 초과: ${text.length}자 (한도 ${maxLen}자)`,
    });
  }

  if (!text.includes("\n") && text.length >= WALL_OF_TEXT_MIN_LEN) {
    issues.push({
      category: "format",
      field,
      message: `줄바꿈 없는 벽글: ${text.length}자 (한도 없이 이어짐)`,
    });
  }

  if (/https?:\/\/|www\./i.test(text)) {
    issues.push({ category: "format", field, message: "금지어: URL/http/www 노출" });
  }
  // 흔한 도메인 확장자 노출 (ntelecomsafe.com 등 직접 링크)
  if (/[a-z0-9-]+\.(com|co\.kr|kr|net|io)\b/i.test(text)) {
    issues.push({ category: "format", field, message: "금지어: 도메인 노출" });
  }

  if (BAD_MANG_PATTERN.test(text)) {
    issues.push({
      category: "format",
      field,
      message: "금지 문구: 옛 잘못된 망 선택 공식(이력이 따라붙어 막힌다 류)",
    });
  }

  return issues;
}

// ══════════════════════════════════════════════════════════════════
// b. 초안 간 획일화 검사 (전체 목록 대상 — draft 단위가 아니라 배치 단위)
// ══════════════════════════════════════════════════════════════════

type DuplicationFinding = {
  draftIds: string[];
  message: string;
};

const HOOK_PREFIX_LEN = 15;
const SENTENCE_DUP_MIN_LEN = 20;
const ENDING_REPEAT_THRESHOLD = 3;

/** 텍스트에서 문장 단위(마침표/느낌표/물음표/줄바꿈 기준)로 분리. */
function splitSentences(text: string): string[] {
  return text
    .split(/[\n.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 문장의 마지막 어미 패턴(끝맺음 스타일) 추출 — 대략 마지막 2~4글자. */
function extractEnding(sentence: string): string | null {
  const m = sentence.match(/([가-힣]{2,4})$/);
  return m ? m[1] : null;
}

function checkDuplicationAcrossDrafts(rows: DraftRow[]): DuplicationFinding[] {
  const findings: DuplicationFinding[] = [];

  // ── 첫 줄(후킹) 앞 15자 중복 ──
  const hookMap = new Map<string, string[]>(); // prefix -> draft ids
  for (const r of rows) {
    const firstLine = (r.draft_text.split("\n")[0] || "").trim();
    if (firstLine.length < HOOK_PREFIX_LEN) continue;
    const prefix = firstLine.slice(0, HOOK_PREFIX_LEN);
    const list = hookMap.get(prefix) ?? [];
    list.push(r.id);
    hookMap.set(prefix, list);
  }
  for (const [prefix, ids] of hookMap) {
    if (ids.length >= 2) {
      findings.push({
        draftIds: ids,
        message: `후킹(첫 줄) 앞 ${HOOK_PREFIX_LEN}자 중복: "${prefix}..." (${ids.length}건)`,
      });
    }
  }

  // ── 동일 문장(20자+) 중복 ──
  const sentenceMap = new Map<string, string[]>();
  for (const r of rows) {
    const allText = [r.draft_text, ...parseSelfReplies(r.self_replies)].join("\n");
    const sentences = splitSentences(allText).filter(
      (s) => s.length >= SENTENCE_DUP_MIN_LEN,
    );
    const uniqueInDraft = new Set(sentences);
    for (const s of uniqueInDraft) {
      const list = sentenceMap.get(s) ?? [];
      if (!list.includes(r.id)) list.push(r.id);
      sentenceMap.set(s, list);
    }
  }
  for (const [sentence, ids] of sentenceMap) {
    if (ids.length >= 2) {
      findings.push({
        draftIds: ids,
        message: `동일 문장(${sentence.length}자) 중복: "${sentence.slice(0, 30)}${sentence.length > 30 ? "..." : ""}" (${ids.length}건)`,
      });
    }
  }

  // ── 같은 끝맺음 패턴 3회 이상 반복 (초안 전체 기준) ──
  const endingMap = new Map<string, string[]>();
  for (const r of rows) {
    const firstText = r.draft_text.trim();
    if (!firstText) continue;
    const lastSentence = splitSentences(firstText).pop();
    if (!lastSentence) continue;
    const ending = extractEnding(lastSentence);
    if (!ending) continue;
    const list = endingMap.get(ending) ?? [];
    list.push(r.id);
    endingMap.set(ending, list);
  }
  for (const [ending, ids] of endingMap) {
    if (ids.length >= ENDING_REPEAT_THRESHOLD) {
      findings.push({
        draftIds: ids,
        message: `같은 끝맺음 패턴("...${ending}") ${ids.length}회 반복`,
      });
    }
  }

  return findings;
}

// ── self_replies 파싱 헬퍼 ──
function parseSelfReplies(raw: string): string[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string");
    return [];
  } catch {
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════
// 대상 필터링
// ══════════════════════════════════════════════════════════════════

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function selectTargets(
  all: DraftRow[],
  includeAll: boolean,
): DraftRow[] {
  const now = Date.now();
  return all.filter((r) => {
    if (r.status === "pending") return true;
    if (r.status === "scheduled") {
      // scheduled_at이 없거나 파싱 불가하면 안전하게 대상 포함(검사 누락 방지)
      if (!r.scheduled_at) return true;
      const t = Date.parse(r.scheduled_at);
      if (isNaN(t)) return true;
      return t > now;
    }
    if (includeAll && r.status === "published") {
      // published_at 대신 created_at 기반 필터링은 상위에서 이미 정렬됨.
      // 여기서는 scheduled_at 또는 없으면 통과시키고, 30일 필터는 호출부에서 처리.
      return true;
    }
    return false;
  });
}

// ══════════════════════════════════════════════════════════════════
// 메인
// ══════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const includeAll = process.argv.includes("--all");

  const { getThreadsDrafts } = await loadLibs();
  console.log("▶ threads_drafts 시트 조회 중...");
  const allDrafts = await getThreadsDrafts();
  console.log(`  전체 ${allDrafts.length}건 로드`);

  const now = Date.now();
  let targets = selectTargets(allDrafts as unknown as DraftRow[], includeAll);

  if (includeAll) {
    // 발행분은 최근 30일로 한정 (published_at 없으면 created_at 사용)
    targets = targets.filter((r) => {
      const row = r as unknown as import("../lib/sheets").ThreadsDraftRow;
      if (row.status !== "published") return true;
      const ref = row.published_at || (row as { created_at?: string }).created_at;
      if (!ref) return true;
      const t = Date.parse(ref);
      if (isNaN(t)) return true;
      return now - t <= THIRTY_DAYS_MS;
    });
  }

  console.log(
    `▶ 검사 대상: ${targets.length}건 (${includeAll ? "미발행 + 최근 30일 발행분" : "미발행(pending/scheduled, 예약시각 미래)만"})`,
  );

  if (targets.length === 0) {
    console.log("검사할 초안이 없습니다.");
    console.log(
      JSON.stringify({
        checked: 0,
        clean: 0,
        flagged: 0,
        issues: { ai_tone: 0, duplication: 0, format: 0 },
      }),
    );
    return;
  }

  // ── 초안별 검사 (AI 티 + 형식) ──
  const perDraftIssues = new Map<string, Issue[]>();
  for (const r of targets) {
    const issues: Issue[] = [];
    issues.push(...checkAiTone(r.draft_text, "draft_text"));
    issues.push(...checkFormat(r.draft_text, "draft_text", MAIN_MAX_LEN));

    const replies = parseSelfReplies(r.self_replies);
    for (const reply of replies) {
      issues.push(...checkAiTone(reply, "self_replies"));
      issues.push(...checkFormat(reply, "self_replies", REPLY_MAX_LEN));
    }

    perDraftIssues.set(r.id, issues);
  }

  // ── 획일화 검사 (배치 전체 대상) ──
  const dupFindings = checkDuplicationAcrossDrafts(targets);
  const dupByDraft = new Map<string, string[]>(); // draft id -> 메시지 목록
  for (const f of dupFindings) {
    for (const id of f.draftIds) {
      const list = dupByDraft.get(id) ?? [];
      list.push(f.message);
      dupByDraft.set(id, list);
    }
  }

  // ── 결과 표 출력 ──
  let flaggedCount = 0;
  const categoryCounts: Record<IssueCategory, number> = {
    ai_tone: 0,
    duplication: 0,
    format: 0,
  };

  console.log("\n" + "=".repeat(70));
  for (const r of targets) {
    const issues = perDraftIssues.get(r.id) ?? [];
    const dupMsgs = dupByDraft.get(r.id) ?? [];
    const totalIssueCount = issues.length + dupMsgs.length;

    console.log(
      `\n[${r.id}] 키워드: ${r.keyword || "(없음)"} | 상태: ${r.status || "(없음)"} | 예약: ${r.scheduled_at || "-"}`,
    );

    if (totalIssueCount === 0) {
      console.log("  ✅ 이슈 없음");
      continue;
    }

    flaggedCount++;
    for (const issue of issues) {
      categoryCounts[issue.category]++;
      console.log(`  ⚠ [${issue.category}/${issue.field}] ${issue.message}`);
    }
    for (const msg of dupMsgs) {
      categoryCounts.duplication++;
      console.log(`  ⚠ [duplication] ${msg}`);
    }
  }
  console.log("\n" + "=".repeat(70));

  const summary = {
    checked: targets.length,
    clean: targets.length - flaggedCount,
    flagged: flaggedCount,
    issues: categoryCounts,
  };
  console.log(JSON.stringify(summary));

  if (flaggedCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("치명적 오류:", err);
  process.exit(1);
});
