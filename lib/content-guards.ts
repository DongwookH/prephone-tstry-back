/**
 * 콘텐츠 사실 가드 — 생성물에 절대 나가면 안 되는 표현을 코드 레벨에서 결정적으로 차단.
 * (프롬프트 지시는 확률적이라 최종 차단선은 코드로 — stripEmoji와 같은 층의 안전장치)
 *
 * 현재 가드: "번호 유지/살림" 오정보 (2026-07-14 운영자 확정)
 *   요금 미납·정지·직권해지 상태에선 기존 번호를 살릴 수 없다.
 *   선불 개통 = 새 번호 발급이고, 재사용 가능한 건 단말기(기기)뿐.
 *
 * 정책 (엄격): 번호+유지류(그대로/유지/살리…/지키…) 결합은 부정문·욕구 묘사까지
 *   전부 차단한다. 실제 사고 사례가 "번호 못 살린다? 그거 오해예요"(부정문 미끼)와
 *   "번호 그대로 살리고 싶은데"(욕구 미끼)였기 때문. 올바른 서술은 오직
 *   "새 번호 / 번호는 새로 받아요" 방향만 통과 — 프롬프트가 이 표현을 가르치므로
 *   정상 초안은 가드에 걸리지 않는다. (오탐 비용 = 초안 1건 재생성, 저렴)
 */

// ─── 가드 2: 1인칭 고객 경험담 (2026-07-20 운영자 지시) ────────────
// 이 계정은 앤텔레콤(개통 서비스 업체)이다. "제가 개통 거절당했다",
// "지난달 제 폰이 정지됐다" 같은 1인칭 피해 경험담은 업체 계정과 모순돼
// 신뢰를 깨므로 금지 — 경험담은 반드시 "손님/문의 주신 분" 사례 시점으로.
// 문장 단위 판정: 1인칭 표지 + 피해 사건 어휘가 같은 문장에 있고,
// 손님 표지가 없으면 위반. (한국어 주어 생략형은 여기서 못 잡음 — 2차
// 비평 패스와 프롬프트 규칙이 보완. 오탐 비용 = 초안 1건 재생성, 저렴)

const FIRST_PERSON =
  /저도|제가|저는|저처럼|저\s*같은|제\s*폰|제\s*명의|제\s*상황|제\s*착각|내가|나도|내\s*폰|내\s*명의/;
const VICTIM_EVENT =
  /거절|퇴짜|정지|미납|연체|먹통|멈췄|밀려|밀렸|신용불량|막막|당황|폭탄|던질\s*뻔|그랬|겪었|겪어봤|착각|안\s*될\s*줄|못\s*했|안\s*된다고|안된다고/;
const CUSTOMER_MARKER =
  /손님|고객|문의|오신\s*분|주신\s*분|해\s*드린|해드린|드렸|드린\s*분|사례|여러분/;
/** 독자에게 묻는 2인칭 문장 표지 — 주어 생략형 판정에서 제외용. */
const READER_QUESTION =
  /있으세요|있으신가요|계신가요|셨나요|하셨어요|신가요|다고요|시죠|어때요/;
/** 시간 앵커 — 한국어 주어 생략 경험담("지난달에 폰이 먹통 됐거든요")의 단서. */
const TIME_ANCHOR = /지난\s*[주달]|어제|엊그제|그저께|얼마\s*전|요전/;

/** "화자 본인이 고객 피해 상황을 겪었다"는 문장이 있으면 true. */
export function hasFirstPersonVictimClaim(text: string): boolean {
  const t = (text || "").replace(/<[^>]+>/g, " ");
  for (const sent of t.split(/[.!?…]+|\n+/)) {
    if (CUSTOMER_MARKER.test(sent) || !VICTIM_EVENT.test(sent)) continue;
    // (a) 명시적 1인칭 + 피해 사건
    if (FIRST_PERSON.test(sent)) return true;
    // (b) 주어 생략형: 시간 앵커 + 피해 사건, 독자용 질문이 아니면 화자 경험담으로 판정
    if (TIME_ANCHOR.test(sent) && !READER_QUESTION.test(sent)) return true;
  }
  return false;
}

// ─── 가드 1: "번호 유지/살림" 오정보 ─────────────────────────────

const KEEP_WORDS = /그대로|유지|살릴|살리|살린|살려|살렸|살림|살아|지킬|지키|지켜/;
/** 번호 바로 앞이 "새 / 새로운"이면 올바른 표현 ("새 번호로 살릴…" 등). */
const NEW_BEFORE = /(새|새로운)\s*$/;
/**
 * 번호 바로 뒤가 "…는/도/를/가/만 새로(새롭게)"면 올바른 표현.
 * ("번호는 새로 받아요", "번호만 새롭게!" — 2026-07-27 오탐 수정:
 *  조사 '만'과 '새롭게' 변형을 몰라 "폰은 그대로 두고 번호만 새롭게"라는
 *  정답 문장을 차단, SKT발신정지 3/3 폐기 원인)
 */
const NEW_AFTER = /^(?:은|는|도|를|가|만)?\s*새(?:로|롭)/;

/** 검사 창 반경 (번호 앞뒤 글자 수) — 짧은 절 안의 결합만 잡는다. */
const WINDOW = 14;

// 투폰/두 번째 회선 예외 (2026-07-21 블로그 오탐 수정):
// "지금 쓰는 번호는 그대로 두고 두 번째 번호를 새로" — 정상 사용 중인 기존
// 회선의 번호 유지는 사실이라 정당. 단, 미납·정지·부활 문맥이 같이 있으면
// 원래 막으려던 오정보("미납이어도 번호 유지")이므로 예외를 주지 않는다.
const SECOND_LINE_CONTEXT =
  /두\s*번째|투\s*폰|세컨|하나\s*더|추가\s*(번호|회선|개통)|번호[를는은도가]?\s*새로/;
const DELINQUENCY_CONTEXT =
  /미납|연체|정지|직권|해지|밀린|밀려|살리|살릴|살린|살려|부활|먹통|신용불량/;
/** 예외 판단용 광역 문맥 반경 — 같은 문장/절 수준. */
const CONTEXT_WINDOW = 60;

/**
 * "번호를 유지/살린다"는 주장·암시(부정문 포함)의 위반 구간 목록.
 * 재시도 프롬프트에 "정확히 어느 문장이 걸렸는지" 보여주기 위해 스니펫을
 * 반환한다 — 일반 사유만 주면 Gemini가 같은 자리에서 반복 위반함
 * (2026-07-27: SKT발신정지·세컨폰개통 3/3 폐기 원인).
 * HTML이 섞여 있어도 동작 (태그 제거 후 검사). 최대 3개.
 */
export function findNumberKeepingClaims(text: string): string[] {
  const t = (text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const hits: string[] = [];
  let idx = t.indexOf("번호");
  while (idx !== -1 && hits.length < 3) {
    const before = t.slice(Math.max(0, idx - 5), idx);
    const after = t.slice(idx + 2, idx + 2 + 8);
    const isNewNumber = NEW_BEFORE.test(before) || NEW_AFTER.test(after);
    if (!isNewNumber) {
      const windowText = t.slice(Math.max(0, idx - WINDOW), idx + 2 + WINDOW);
      if (KEEP_WORDS.test(windowText)) {
        const ctx = t.slice(
          Math.max(0, idx - CONTEXT_WINDOW),
          idx + 2 + CONTEXT_WINDOW,
        );
        // 투폰 맥락이면서 미납·부활 문맥이 아니면 정당한 표현
        if (!(SECOND_LINE_CONTEXT.test(ctx) && !DELINQUENCY_CONTEXT.test(ctx))) {
          hits.push(ctx.trim());
        }
      }
    }
    idx = t.indexOf("번호", idx + 2);
  }
  return hits;
}

/** "번호를 유지/살린다"는 주장·암시(부정문 포함)가 있으면 true. */
export function hasNumberKeepingClaim(text: string): boolean {
  return findNumberKeepingClaims(text).length > 0;
}

// ─── 컴플라이언스 금지어 (프로젝트 공통 규칙 CLAUDE.md, 2026-07-23 사업주 확정) ───
// 게재 콘텐츠(블로그·스레드)에 절대 나오면 안 되는 단어. 대체 표현은 fix 참고.
const COMPLIANCE_BANNED: ReadonlyArray<{ word: string; fix: string }> = [
  { word: "외국인등록증", fix: "외국인 안내는 '여권 + 매장 방문' 프레임으로만" },
  { word: "더지통신", fix: "내부 상호 — 브랜드는 '앤텔레콤 안심개통'" },
  { word: "앤스마트", fix: "내부 전산명 — 언급 금지" },
  { word: "다이소", fix: "유심 안내는 KT 바로유심·LG 모두의 원칩만" },
  { word: "스카이라이프", fix: "유심 안내는 KT 바로유심·LG 모두의 원칩만" },
  { word: "24시간", fix: "개통 시간: 신규 08:00~21:50, 번호이동 10:00~19:50" },
  { word: "공식", fix: "'인증판매점'으로 바꾸거나 표현 삭제 (NRC 컴플라이언스)" },
  { word: "본사", fix: "'인증판매점'으로 (NRC 컴플라이언스)" },
  { word: "직영", fix: "'인증판매점' 또는 '매장'으로 (NRC 컴플라이언스)" },
  { word: "고객센터", fix: "'1:1 채팅 상담'으로 (NRC 컴플라이언스)" },
  { word: "개통센터", fix: "'매장'으로 (NRC 컴플라이언스)" },
];

/**
 * 컴플라이언스 금지어 검사 — 걸린 단어 목록 반환 (없으면 빈 배열).
 * HTML 태그 제거 + 공백 정규화 후 부분 문자열 매칭.
 * (공백을 통째로 제거하면 "기본 사용"→"본사" 같은 경계 오탐이 생기므로 하지 않는다)
 */
export function findComplianceBannedWords(text: string): string[] {
  const t = (text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  return COMPLIANCE_BANNED.filter((b) => t.includes(b.word)).map((b) => b.word);
}

/** 재시도 프롬프트에 넣을 수 있는 교정 힌트 문자열. */
export function complianceFixHints(words: string[]): string {
  return COMPLIANCE_BANNED.filter((b) => words.includes(b.word))
    .map((b) => `"${b.word}" → ${b.fix}`)
    .join("; ");
}
