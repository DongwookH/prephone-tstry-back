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

/**
 * 블록 태그를 개행으로 바꾼 뒤 태그 제거.
 *
 * ⚠️ 그냥 모든 태그를 공백으로 지우면 문단 경계가 사라져 인접한 두 문장이
 *    하나로 붙는다. 그러면 "…내 명의로 진행하는 순서</h2><p>통신 미납이나…"
 *    처럼 1인칭 표지와 피해 어휘가 서로 다른 문단에 있는데도 같은 문장으로
 *    판정돼 오탐이 난다 (2026-07-28 실측). 문장 단위 판정을 하는 가드는
 *    반드시 블록 경계를 살려서 넘겨야 한다.
 */
function htmlToSentences(html: string): string {
  return (html || "")
    .replace(/<\/?(?:p|div|h[1-6]|li|ul|ol|tr|td|th|br|section|article)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

/** "화자 본인이 고객 피해 상황을 겪었다"는 문장이 있으면 true. */
export function hasFirstPersonVictimClaim(text: string): boolean {
  const t = htmlToSentences(text);
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

/**
 * 올바른 단정 부정문 — "번호는 유지되지 않(습니다)" / "번호는 유지 안 돼요/됩니다".
 * 조사는 는/은만 (‘유지가 안’ 같은 변형은 불허), 반드시 '유지' 직결.
 */
const CORRECT_NEGATION =
  /^번호[는은]?\s*(?:유지되지\s*않|유지\s*안\s*(?:돼|됩))/;

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
    // 올바른 단정 부정문("번호는 유지되지 않습니다/유지 안 돼요")만 허용 —
    // 발신정지류 주제는 이 말 없이 글이 안 됨 (2026-07-27 정책 정밀 완화).
    // '그대로/살리다'류·의문형·"유지가 안"(조사 낀 변형)은 미끼 위험으로 계속 차단.
    const isCorrectNegation = CORRECT_NEGATION.test(t.slice(idx, idx + 16));
    if (!isNewNumber && !isCorrectNegation) {
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

// ─── 가드 4: 구조 결함 (본문 잘림·목차 끊김) ──────────────────────
//
// 2026-07-29 사고: 모델을 바꿨더니 본문이 1/3로 줄고 목차가 가리키는 섹션이
// 통째로 사라진 글 10편이 그대로 발행됐다. 금지어·번호이동 가드는 다 통과했고
// (내용 자체는 문제없으니) 로그에도 "✅ 2680자 | 시도 1"로 찍혔다.
// char_count가 모델의 자기 신고값이었기 때문이다 — 실측은 859자였다.
//
// 교훈: "무엇을 썼는가"만 검사하고 "제대로 다 썼는가"는 아무도 안 봤다.
// 이 가드가 그 구멍을 막는다. 모델 교체·프롬프트 변경 때 조용히 품질이
// 무너지는 걸 잡는 최종 방어선이다.

/**
 * 실측 하한 — "잘린 글"과 "짧지만 멀쩡한 글" 사이의 빈 구간에 둔다.
 *
 *   파손분(7/29 사고, 섹션 누락 동반)   635 ~ 1,269자
 *   ── 여기 1,500 ──
 *   테넌트 정상분(3.5-flash-lite)       1,676 ~ 2,350자
 *   오너 정상분(2.5-flash)              2,368 ~ 3,062자
 *
 * 1,800으로 잡았다가 멀쩡한 테넌트 글(1,676자·섹션 6/6)을 폐기시켜 내렸다.
 * 사고분은 최고 1,269자라 1,500이어도 10/10 전부 걸러진다.
 * 분량은 어디까지나 보조 지표다 — 진짜 판정은 목차/섹션 대조 쪽이다.
 */
export const MIN_BODY_CHARS = 1500;

/** 태그·엔티티·공백을 걷어낸 실측 글자 수 — 모델 신고값을 믿지 않기 위한 척도. */
export function measureBodyChars(html: string): number {
  if (!html) return 0;
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, "")
    .length;
}

/**
 * 구조 결함 목록 (없으면 빈 배열).
 *   1) 목차가 가리키는 #section-N이 본문에 없음 → 죽은 링크 + 내용 누락
 *   2) 실측 분량이 하한 미만 → 응답이 중간에 잘림
 */
export function findStructuralDefects(html: string): string[] {
  const out: string[] = [];
  const h = html || "";

  const toc = [...new Set([...h.matchAll(/href="#(section-\d+)"/g)].map((m) => m[1]))];
  const body = [...new Set([...h.matchAll(/id="(section-\d+)"/g)].map((m) => m[1]))];
  const missing = toc.filter((id) => !body.includes(id));
  if (missing.length > 0) {
    out.push(
      `목차가 가리키는 섹션이 본문에 없음 [${missing.join(", ")}] — 목차 ${toc.length}개 / 본문 ${body.length}개`,
    );
  }

  const chars = measureBodyChars(h);
  if (chars < MIN_BODY_CHARS) {
    out.push(`본문 분량 미달 — 실측 ${chars}자 (하한 ${MIN_BODY_CHARS}자)`);
  }
  return out;
}

// ─── 가드 5: 미성년자 개통 가능 오정보 ─────────────────────────────
//
// 운영 규정 Q8: "미성년자도 셀프개통 되나요? → 아니요, 부모님과 동반해서
// 센터에서 개통하셔야 합니다."
//
// 키워드 블랙리스트(CONTENT_MINOR_BLACKLIST)는 "미성년" 계열 키워드로
// 글을 못 만들게 막지만, 키워드가 "투폰"이어도 모델이 본문·제목에
// "학생도 5분 만에"라고 쓰는 건 못 막는다 (2026-07-29 실제 발행 사례:
// "투폰, 학생도 직장인도 5분 만에 하나 더 만드는 법").
//
// 판정: 미성년 표지 + 가능하다는 주장이 같은 문장에 있고, 올바른 프레임
// (불가·보호자 동반·매장 방문)이 없으면 위반.

/** 미성년 표지. 대학생·유학생은 성인이므로 제외하고 검사한다. */
const MINOR_MARKER =
  /미성년|청소년|어린이|아동|초등|중등|중학생|고등학생|자녀|키즈|만\s*1[3-8]\s*세|학생/;
/**
 * ⚠️ 막아야 하는 건 "미성년자 개통 가능"이 아니라 "미성년자 **셀프**개통 가능"이다.
 *
 * 규정 Q8: "미성년자도 셀프개통 되나요? → 아니요, 부모님과 동반해서 센터에서
 * 개통하셔야 합니다." 즉 개통 자체는 되고 비대면·셀프 경로만 막힌다.
 *
 * 처음엔 `가능|됩니다` 같은 범용 표현까지 넣었다가 "미성년자는 선불·후불 각
 * 1회선까지 가능" 같은 **사실 안내**를 무더기로 오탐했다 (2026-07-29 실측
 * 12편 중 8편이 오탐). 셀프·비대면·즉시성 표지로 좁힌다.
 */
const ELIGIBILITY_CLAIM =
  /셀프|비대면|온라인\s*개통|집에서|업로드|간편인증|5분|3분|즉시|만드는\s*법|만들\s*수/;
/**
 * 올바른 프레임 — 이게 있으면 정확한 안내다.
 * ⚠️ 한국어 활용형을 어간으로 잡아야 한다. "어렵"만 넣으면 실제로 가장 많이
 *    쓰이는 "어려워요/어려우니"를 놓쳐 정답 문장을 위반으로 찍는다
 *    (2026-07-29 실측: 정상 글 3편이 이 이유로 오탐).
 */
const MINOR_CORRECT_FRAME =
  /불가|안\s*됩니다|안\s*돼|아니요|아니오|어렵|어려|힘들|제한|조건부|보호자|부모님|법정\s*대리인|동반|방문\s*개통|매장|센터/;

/**
 * 질문형 종결 — "미성년자도 개통 가능한가요?"는 주장이 아니라 Q&A의 질문이다.
 * 이런 문장은 그 자체로 위반이 아니고 "바로 다음 문장(답변)"을 봐야 한다.
 */
const QUESTION_FORM = /(?:나요|가요|까요|런가|는지)\s*$/;
/** 긍정 답변 표지 — Q&A 답변이 "된다"고 하면 위반. */
const AFFIRMATIVE_ANSWER = /^\s*(?:네|예|맞아|가능|됩니다|돼요|물론)/;

/**
 * "미성년자도 (셀프)개통 된다"는 취지의 문장 목록 (최대 3개).
 *
 * 두 가지 형태를 구분한다:
 *   (a) 서술형 — "미성년자도 간편인증서가 있으면 셀프개통 가능해요" → 위반
 *   (b) Q&A 질문 — "미성년자도 개통 가능한가요?" 자체는 정상.
 *       바로 다음 문장(답변)이 긍정이고 올바른 프레임이 없을 때만 위반.
 *
 * 대학생·유학생은 성인이라 검사 대상에서 뺀다.
 */
export function findMinorEligibilityClaims(text: string): string[] {
  // '대학생'·'유학생'을 먼저 지워 '학생' 부분 매칭 오탐을 막는다.
  const t = htmlToSentences(text).replace(/[대유]학생/g, "");
  const sents = t
    .split(/[.!?…]+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const hits: string[] = [];
  for (let i = 0; i < sents.length && hits.length < 3; i++) {
    const sent = sents[i];
    if (!MINOR_MARKER.test(sent)) continue;

    if (QUESTION_FORM.test(sent)) {
      // Q&A 질문 — 답변을 봐야 판정할 수 있다.
      const answer = sents[i + 1] ?? "";
      if (!answer) continue;
      // ⚠️ "미성년자도 개통 가능한가요? → 네, 가능합니다"는 사실이다(개통 자체는 됨).
      //    질문이나 답변에 셀프·비대면 표지가 있을 때만 위반으로 본다.
      if (!ELIGIBILITY_CLAIM.test(sent) && !ELIGIBILITY_CLAIM.test(answer)) continue;
      if (MINOR_CORRECT_FRAME.test(answer)) continue; // "아니요, 보호자 동반 방문" → 정상
      if (AFFIRMATIVE_ANSWER.test(answer)) hits.push(`${sent} → ${answer}`.slice(0, 140));
      continue;
    }

    if (!ELIGIBILITY_CLAIM.test(sent)) continue;
    if (MINOR_CORRECT_FRAME.test(sent)) continue; // 올바른 안내
    hits.push(sent.slice(0, 120));
  }
  return hits;
}
