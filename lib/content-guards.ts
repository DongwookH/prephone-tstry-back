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

const FIRST_PERSON = /저도|제가|저는|제\s*폰|제\s*명의|제\s*상황|제\s*착각|내가|나도|내\s*폰|내\s*명의/;
const VICTIM_EVENT =
  /거절|퇴짜|정지|미납|연체|먹통|멈췄|밀려|밀렸|신용불량|막막|당황|던질\s*뻔|그랬|겪었|겪어봤|착각|안\s*될\s*줄|못\s*했|안\s*된다고|안된다고/;
const CUSTOMER_MARKER =
  /손님|고객|문의|오신\s*분|주신\s*분|해\s*드린|해드린|드렸|드린\s*분|사례|여러분/;

/** "화자 본인이 고객 피해 상황을 겪었다"는 문장이 있으면 true. */
export function hasFirstPersonVictimClaim(text: string): boolean {
  const t = (text || "").replace(/<[^>]+>/g, " ");
  for (const sent of t.split(/[.!?…]+|\n+/)) {
    if (
      FIRST_PERSON.test(sent) &&
      VICTIM_EVENT.test(sent) &&
      !CUSTOMER_MARKER.test(sent)
    ) {
      return true;
    }
  }
  return false;
}

// ─── 가드 1: "번호 유지/살림" 오정보 ─────────────────────────────

const KEEP_WORDS = /그대로|유지|살릴|살리|살린|살려|살렸|살림|살아|지킬|지키|지켜/;
/** 번호 바로 앞이 "새 / 새로운"이면 올바른 표현 ("새 번호로 살릴…" 등). */
const NEW_BEFORE = /(새|새로운)\s*$/;
/** 번호 바로 뒤가 "…는/도/를/가 새로"면 올바른 표현 ("번호는 새로 받아요"). */
const NEW_AFTER = /^(?:은|는|도|를|가)?\s*새로/;

/** 검사 창 반경 (번호 앞뒤 글자 수) — 짧은 절 안의 결합만 잡는다. */
const WINDOW = 14;

/**
 * "번호를 유지/살린다"는 주장·암시(부정문 포함)가 있으면 true.
 * HTML이 섞여 있어도 동작 (태그 제거 후 검사).
 */
export function hasNumberKeepingClaim(text: string): boolean {
  const t = (text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  let idx = t.indexOf("번호");
  while (idx !== -1) {
    const before = t.slice(Math.max(0, idx - 5), idx);
    const after = t.slice(idx + 2, idx + 2 + 8);
    const isNewNumber = NEW_BEFORE.test(before) || NEW_AFTER.test(after);
    if (!isNewNumber) {
      const windowText = t.slice(Math.max(0, idx - WINDOW), idx + 2 + WINDOW);
      if (KEEP_WORDS.test(windowText)) return true;
    }
    idx = t.indexOf("번호", idx + 2);
  }
  return false;
}
