/**
 * 제목 다양성 강제 도구.
 *
 * 1) analyzeOverusedWords — 최근 제목에서 과사용 단어 추출 (니치 필수어 제외)
 * 2) detectPatternInTitle — 제목이 8가지 후킹 패턴 중 어디 속하는지 추정
 * 3) pickLeastUsedPattern — 최근 제목 패턴 분포 → 가장 안 쓴 패턴 추천
 * 4) containsBannedWords — 새 제목이 과사용 단어 포함하는지 검증
 */

/**
 * 20가지 후킹 패턴 정의 — 코드와 프롬프트가 같은 번호 공유.
 * 검증된 헤드라인 카피라이팅 프레임워크에서 추출.
 */
export const HOOK_PATTERNS = [
  { id: 1, name: "돈/절약", hint: "통신비/요금 절약 액수 (월 5만→1만, 3년 144만원)" },
  { id: 2, name: "신용/심사", hint: "신용불량/거절/심사 통과로 후킹" },
  { id: 3, name: "위험/위약금", hint: "위약금/함정/실수 경고 (5명 중 3명 당하는)" },
  { id: 4, name: "타겟 호명", hint: "외국인/미성년/자영업자/학생/주부 등 특정 대상" },
  { id: 5, name: "숨겨진 정보", hint: "직원도 모르는/안 알려주는/내부자" },
  { id: 6, name: "질문형", hint: "~할까?/~가능할까? 호기심 자극" },
  { id: 7, name: "비교/대조", hint: "A vs B, K망 vs L망, 선불 vs 후불" },
  { id: 8, name: "수치형", hint: "3가지/7단계/5회 등 갯수 수치" },
  { id: 9, name: "체크리스트", hint: "반드시 확인할 N가지/체크포인트/꼭 확인" },
  { id: 10, name: "반전/통념 깨기", hint: "다들 X라는데 실제론 정반대/알고 보니/사실은" },
  { id: 11, name: "개인 후기/실측", hint: "직접 해봤더니/경험자가 말하는/실측 결과" },
  { id: 12, name: "시간/타이밍", hint: "이번 달 가입 손해/다음 달 기다려야/지금이 적기" },
  { id: 13, name: "무료/혜택", hint: "유심비 0원/보너스/공짜/쿠폰/증정" },
  { id: 14, name: "단계별 가이드", hint: "사진 N장으로/단계별/차근차근/순서대로" },
  { id: 15, name: "트렌드/사회증명", hint: "요즘 20대가/N명이 선택/많이 가입한/유행" },
  { id: 16, name: "자격/조건 진단", hint: "이 조건이면/당신도 해당/진단 N가지" },
  { id: 17, name: "Before-After", hint: "8만→1만/N개월 후기/바꾼 후 효과" },
  { id: 18, name: "FOMO/마감", hint: "단종 임박/마지노선/곧 종료/마지막" },
  { id: 19, name: "부정 명령형", hint: "~하지 마세요/절대 ~/X 가지 마세요" },
  { id: 20, name: "극단/충격 단정", hint: "호구입니다/폭리/충격 가격/진실" },
] as const;

export type HookPatternId = (typeof HOOK_PATTERNS)[number]["id"];

export const PATTERN_COUNT = HOOK_PATTERNS.length; // 20

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
 * 매칭 안 되면 null. 우선순위: 가장 구체적인 시그널부터.
 */
export function detectPatternInTitle(title: string): HookPatternId | null {
  const t = title;

  // === 우선순위 1: 가장 강한 고유 시그널 ===
  if (/호구|폭리|충격(?:\s*가격|\s*폭로)?|진실|폭로/.test(t)) return 20;
  if (/(?:하지|마)\s*마(?:세요)?|가지\s*마|절대\s*마(?:세요)?|놓치지\s*마/.test(t)) return 19;
  if (/단종|마지노선|곧\s*종료|마감\s*임박|마지막\s*기회|이번\s*달\s*만/.test(t))
    return 18;
  if (/\d+(?:만|만원|원)\s*[→\->]\s*\d+|after|N개월\s*후기|바꾼\s*(?:후|뒤)\s*효과/.test(t))
    return 17;
  if (/(?:이|당신|당신도)\s*조건|자격|진단\s*\d+|해당\s*여부/.test(t)) return 16;
  if (/요즘|\d+\s*대(?:가|는)|많이\s*가입|유행|트렌드|\d+\s*명이/.test(t)) return 15;
  if (/사진\s*\d+장|단계별|step\s*\d+|차근차근|순서대로|순서\s*정리/.test(t))
    return 14;
  if (/무료|공짜|0\s*원|보너스|증정|쿠폰|적립|혜택/.test(t)) return 13;
  if (/지금\s*가입|이번\s*달|다음\s*달|기다려|기한|적기|타이밍/.test(t)) return 12;
  if (/직접\s*(?:해봤|써봤|사용)|경험자|후기|실측|체험|사용해/.test(t)) return 11;
  if (/정반대|알고\s*보니|사실은|의외로|놀랍게도|반대로/.test(t)) return 10;
  if (/반드시\s*확인|체크포인트|꼭\s*확인|N가지\s*꼭|필수\s*확인/.test(t))
    return 9;

  // === 우선순위 2: 기존 8패턴 ===
  if (/신용|불량|거절|미납|심사|블랙리스트|직권해지/.test(t)) return 2;
  if (/위약금|함정|실수|손해|폭탄|당하는|주의|놓치/.test(t)) return 3;
  if (/외국인|미성년|자영업|학생|군인|어르신|여권|등록증|주부/.test(t))
    return 4;
  if (/직원도|안\s*알려주|숨겨진|내부|모르는|비밀|비공개/.test(t)) return 5;
  if (/\?|할까|일까|있을까|가능할까|이유는|무엇/.test(t)) return 6;
  if (/vs\b| 대 |비교|차이|다른점|어느\s*쪽/.test(t)) return 7;
  if (/(\d+만원|\d+원|\d+%|월\s*\d+|연\s*\d+|절약|아껴|싸|저렴|할인)/.test(t))
    return 1;
  if (/\d+분|\d+초|\d+가지|\d+단계|\d+회|\d+개|\d+종/.test(t)) return 8;
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
