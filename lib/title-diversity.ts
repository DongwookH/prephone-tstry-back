/**
 * 제목 다양성 강제 도구.
 *
 * 1) analyzeOverusedWords — 최근 제목에서 과사용 단어 추출 (니치 필수어 제외)
 * 2) detectPatternInTitle — 제목이 8가지 후킹 패턴 중 어디 속하는지 추정
 * 3) pickLeastUsedPattern — 최근 제목 패턴 분포 → 가장 안 쓴 패턴 추천
 * 4) containsBannedWords — 새 제목이 과사용 단어 포함하는지 검증
 */

/**
 * 8가지 후킹 패턴 정의 — 코드와 프롬프트가 같은 번호 공유.
 */
export const HOOK_PATTERNS = [
  { id: 1, name: "돈/절약", hint: "통신비/요금/절약 금액으로 후킹" },
  { id: 2, name: "신용/심사", hint: "신용불량/거절/심사 통과로 후킹" },
  { id: 3, name: "위험/주의", hint: "위약금/함정/실수 경고로 후킹" },
  { id: 4, name: "타겟 호명", hint: "외국인/미성년자/자영업자 등 특정 대상" },
  { id: 5, name: "숨겨진 정보", hint: "직원도 모르는/안 알려주는/내부자" },
  { id: 6, name: "질문형", hint: "왜~/~할까?/~가능할까? 호기심 자극" },
  { id: 7, name: "비교/대조", hint: "A vs B, K망 vs L망, 선불 vs 후불" },
  { id: 8, name: "수치/시간", hint: "분/원/% 등 수치 (표현 다양하게)" },
] as const;

export type HookPatternId = (typeof HOOK_PATTERNS)[number]["id"];

/**
 * 니치 필수 단어 — 과사용 분석에서 제외 (어쩔 수 없이 반복됨).
 * 추가로 현재 키워드도 동적 추가.
 */
const NICHE_ALLOWLIST = new Set([
  "선불폰",
  "알뜰폰",
  "유심",
  "개통",
  "eSIM",
  "USIM",
  "KT",
  "LG",
  "SKT",
  "망",
  "K망",
  "L망",
  "KT망",
  "LG망",
  "U+",
  "유플러스",
  "통신사",
  "통신",
  "요금제",
  "데이터",
]);

/** 한국어 2+ 글자 단어, 영문, 영문+숫자, 숫자+단위 토큰 추출. */
function tokenize(title: string): string[] {
  return title.match(/[가-힣]{2,}|[A-Za-z]+[0-9]*|\d+분|\d+초|\d+년/g) || [];
}

/**
 * 최근 제목들에서 과사용 단어 top N 반환.
 *
 * @param titles 최근 제목 리스트
 * @param currentKeyword 이번 글 키워드 — 금지 대상에서 제외
 * @param threshold 최소 등장 횟수 (이 횟수 이상이면 과사용)
 * @param topN 반환할 단어 수
 */
export function analyzeOverusedWords(
  titles: string[],
  currentKeyword: string,
  threshold = 3,
  topN = 8,
): { word: string; count: number }[] {
  if (titles.length === 0) return [];

  const counts: Record<string, number> = {};
  for (const t of titles) {
    const words = tokenize(t);
    const unique = new Set(words);
    for (const w of unique) counts[w] = (counts[w] || 0) + 1;
  }

  // 현재 키워드의 토큰들도 allowlist에 추가 (이번 글에서 사용 필수)
  const kwTokens = new Set(tokenize(currentKeyword));

  const banned: { word: string; count: number }[] = [];
  for (const [word, count] of Object.entries(counts)) {
    if (count < threshold) continue;
    if (NICHE_ALLOWLIST.has(word)) continue;
    if (kwTokens.has(word)) continue;
    banned.push({ word, count });
  }
  banned.sort((a, b) => b.count - a.count);
  return banned.slice(0, topN);
}

/**
 * 제목 텍스트로 패턴 추정 (heuristic).
 * 매칭 안 되면 null.
 */
export function detectPatternInTitle(title: string): HookPatternId | null {
  const t = title;
  // 우선순위: 가장 구체적인 시그널부터
  if (/신용|불량|거절|미납|심사|블랙리스트|직권해지/.test(t)) return 2;
  if (/위약금|함정|실수|손해|폭탄|주의|모르면|놓치/.test(t)) return 3;
  if (/외국인|미성년|자영업|학생|군인|어르신|여권|등록증/.test(t)) return 4;
  if (/직원도|안\s*알려주|숨겨진|내부|모르는|비밀/.test(t)) return 5;
  if (/\?|할까|일까|있을까|가능할까|이유는|무엇/.test(t)) return 6;
  if (/vs\b| 대 |비교|차이|다른점/.test(t)) return 7;
  if (/(\d+만원|\d+원|\d+%|월\s*\d+|연\s*\d+|절약|아껴|싸|저렴)/.test(t)) return 1;
  if (/\d+분|\d+초|\d+가지|\d+단계|\d+회|\d+개/.test(t)) return 8;
  return null;
}

/**
 * 최근 제목 패턴 분포를 보고 가장 안 쓴 패턴 1개 반환.
 * 동률이면 가장 작은 id.
 */
export function pickLeastUsedPattern(recentTitles: string[]): HookPatternId {
  const counts: Record<number, number> = {};
  for (const p of HOOK_PATTERNS) counts[p.id] = 0;
  for (const t of recentTitles) {
    const p = detectPatternInTitle(t);
    if (p !== null) counts[p]++;
  }
  let minCount = Infinity;
  let minId: HookPatternId = 1;
  for (const p of HOOK_PATTERNS) {
    if (counts[p.id] < minCount) {
      minCount = counts[p.id];
      minId = p.id;
    }
  }
  return minId;
}

/**
 * 새로 생성된 제목이 banned 단어 중 하나라도 포함하면 그 단어 반환.
 * 모두 통과하면 null.
 */
export function containsBannedWords(
  title: string,
  bannedWords: string[],
): string | null {
  for (const w of bannedWords) {
    if (title.includes(w)) return w;
  }
  return null;
}
