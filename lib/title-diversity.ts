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
 * 사용 금지 패턴 — 자극적/광고성/클릭베이트라 제외 (사용자 요청).
 *  1(돈/절약), 3(위험/위약금), 12(시간/타이밍), 13(무료/혜택),
 *  17(Before-After), 18(FOMO/마감), 20(극단/충격)
 */
export const EXCLUDED_PATTERNS: HookPatternId[] = [1, 3, 12, 13, 17, 18, 20];

/** 실제로 사용할 패턴 id 목록 (제외 패턴 뺀 것). */
export const ACTIVE_PATTERN_IDS: HookPatternId[] = HOOK_PATTERNS.map(
  (p) => p.id,
).filter((id) => !EXCLUDED_PATTERNS.includes(id));

/**
 * 돈/금액(통신비 절약) 후크 허용 패턴.
 * 돈 관련 패턴(#1·#13·#17) 전부 EXCLUDED → 빈 배열.
 * 즉 모든 활성 패턴에서 돈/금액 후크 금지.
 */
export const MONEY_ALLOWED_PATTERNS: HookPatternId[] = [];

/**
 * 제목이 '통신비/금액 절약' 후크인지 감지.
 * (월 통신비, X만→Y만, 144만원, 무제한, 절약/아끼는 등)
 * 무료/0원/공짜(=혜택 후크)는 별개라 제외.
 */
const MONEY_SIGNAL_RE =
  /통신비|만\s*원|만\s*→|→\s*\d|[0-9]\s*만\b|무제한|아끼|절약|얼마|할인|반값/;

export function isMoneyHookTitle(title: string): boolean {
  return MONEY_SIGNAL_RE.test(title);
}

/**
 * 키워드 핵심 용어 사전 — 제목-키워드 매칭 검증용.
 * 복합 키워드(예: "알뜰폰선불폰무약정장점")에서 핵심어를 뽑아낸다.
 */
const KEYWORD_TERMS = [
  "선불폰",
  "알뜰폰",
  "유심",
  "eSIM",
  "이심",
  "esim",
  "바로유심",
  "원칩",
  "무약정",
  "약정",
  "번호이동",
  "개통",
  "충전",
  "요금제",
  "로밍",
  "데이터",
  "공기계",
  "법인",
  "서브폰",
  "세컨폰",
  "투폰",
  "미성년",
  "외국인",
  "신불자",
  "신용",
  "본인인증",
  "셀프개통",
  "비대면",
  "KT",
  "케이티",
  "LG",
  "엘지",
  "SKT",
  "유플러스",
  "앤텔레콤",
  "K망",
  "L망",
  "테더링",
];

/** 키워드에서 제목에 들어가야 할 핵심 용어들을 추출. */
export function extractKeywordTerms(keyword: string): string[] {
  const terms = new Set<string>();
  const compact = keyword.replace(/\s+/g, "");
  if (compact.length >= 2) terms.add(compact);
  // 공백 분리 토큰
  for (const t of keyword.split(/\s+/)) {
    if (t.length >= 2) terms.add(t);
  }
  // 사전 스캔 (복합어 내부 핵심어)
  for (const term of KEYWORD_TERMS) {
    if (keyword.includes(term)) terms.add(term);
  }
  return [...terms];
}

/**
 * 제목이 메인 키워드로 "시작"하는지 검증.
 *
 * 규칙: 제목 맨 앞이 키워드(또는 공백 풀이형)로 시작해야 OK.
 *  - 키워드 "편의점선불유심" → 제목 "편의점선불유심 이렇게…" ✓
 *  - 키워드 "편의점선불유심" → 제목 "편의점 선불 유심 이렇게…" ✓ (공백 풀이)
 *  - 키워드 "춘천선불폰" → 제목 "춘천 선불폰, …" ✓ (공백 정규화 후 비교)
 *  - 키워드 "선불폰" → 제목 "약정 없이 선불폰 사용법" ✗ (앞에 다른 단어)
 *
 * SEO + 사용자 인지 모두 키워드 prefix가 가장 강력.
 */
export function titleStartsWithKeyword(title: string, keyword: string): boolean {
  const t = (title || "").trim();
  const compact = keyword.replace(/\s+/g, "");
  if (!t || compact.length < 2) return true;

  // 1) 원형 그대로 시작
  if (t.startsWith(compact)) return true;
  // 2) 공백 풀이형 시작 (예: "알뜰폰 선불폰 무약정 장점")
  const tCompact = t.replace(/[\s,·:/]+/g, "").toLowerCase();
  const kCompact = compact.toLowerCase();
  if (tCompact.startsWith(kCompact)) return true;
  return false;
}

/**
 * 제목이 키워드와 매칭되는지 검증.
 *
 * 규칙:
 *  1) 키워드 원형(또는 공백 풀이형)이 제목에 들어 있으면 OK.
 *  2) 그게 아니면, 키워드의 **고유한 단어**(니치 일반어 제외) 중 하나라도 들어 있어야 OK.
 *     - "선불폰" 같은 niche 일반어는 너무 흔해서 매칭 신호로 부족
 *     - "무약정", "장점", "충전방법" 같은 고유 단어가 들어가야 진짜 매칭
 */
export function titleMatchesKeyword(title: string, keyword: string): boolean {
  const compact = keyword.replace(/\s+/g, "");
  if (compact.length < 2) return true;

  // 1차: 키워드 원형 또는 공백 풀이형 매칭
  if (title.includes(compact)) return true;
  const spaced = keyword.trim();
  if (spaced !== compact && title.includes(spaced)) return true;

  // 2차: 키워드의 고유 단어 검사 (niche 일반어 제외)
  const terms = extractKeywordTerms(keyword);
  const uniqueTerms = terms.filter(
    (t) => !NICHE_ALLOWLIST.has(t) && t !== compact && t !== spaced,
  );
  if (uniqueTerms.length === 0) {
    // 키워드가 niche 일반어로만 구성된 경우 → 그 niche 단어 중 하나라도 있으면 OK
    return terms.some((t) => title.includes(t));
  }
  return uniqueTerms.some((t) => title.includes(t));
}

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
  for (const id of ACTIVE_PATTERN_IDS) counts[id] = 0;
  for (const t of recentTitles) {
    const p = detectPatternInTitle(t);
    if (p !== null && ACTIVE_PATTERN_IDS.includes(p)) counts[p]++;
  }
  let minCount = Infinity;
  let minId: HookPatternId = ACTIVE_PATTERN_IDS[0];
  for (const id of ACTIVE_PATTERN_IDS) {
    if (counts[id] < minCount) {
      minCount = counts[id];
      minId = id;
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
