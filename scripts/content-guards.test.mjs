/**
 * content-guards 회귀 테스트.
 *   node --test scripts/content-guards.test.mjs
 *
 * 배경: "미납이어도 번호 그대로" 오정보가 반복 생성됨 (2026-07-14 운영자 확정:
 * 미납·정지·직권해지 시 번호 유지 불가 — 새 번호 발급, 단말기만 재사용).
 * 정책: 번호+유지류 표현은 부정문·욕구 묘사 포함 전부 차단 (엄격) —
 * 올바른 서술은 "번호는 새로 받아요" 형태만.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasNumberKeepingClaim,
  hasFirstPersonVictimClaim,
  findComplianceBannedWords,
  complianceFixHints,
} from "../lib/content-guards.ts";

test("실제 발행됐던 오정보 문구 — 전부 차단", () => {
  assert.equal(hasNumberKeepingClaim("이 방법만 알면 기존 번호 그대로 쓸 수 있고"), true);
  assert.equal(hasNumberKeepingClaim("기존 번호 그대로 살릴 수 있는 경우가 생각보다 많아요"), true);
  assert.equal(hasNumberKeepingClaim("정지된 폰 번호 그대로, 본인 명의로 다시 개통"), true);
  assert.equal(hasNumberKeepingClaim("쓰던 번호 그대로 살리고 싶은데"), true); // 욕구 묘사(미끼)도 차단
});

test("부정문도 차단 (엄격 정책 — '번호 못 살린다? 오해예요' 패턴 방지)", () => {
  assert.equal(hasNumberKeepingClaim("직권해지된 폰은 번호 못 살린다? 그거 오해예요."), true);
  assert.equal(hasNumberKeepingClaim("번호 유지가 안 됩니다"), true);
});

test("올바른 표현('새 번호' / '번호는 새로')은 통과", () => {
  assert.equal(hasNumberKeepingClaim("폰은 그대로 쓰고 번호는 새로 받아요"), false);
  assert.equal(hasNumberKeepingClaim("정지폰 그대로 살리면서 새 번호도 바로 쓸 수 있어요"), false);
  assert.equal(hasNumberKeepingClaim("그 폰 그대로 새 번호로 살릴 방법이 있어요"), false);
  assert.equal(hasNumberKeepingClaim("새 번호도 내 명의로 쓸 수 있는 핵심이죠"), false);
});

test("투폰/두 번째 회선 맥락 — 정상 회선 번호 유지는 사실이므로 통과 (7/21 블로그 오탐 사례)", () => {
  assert.equal(
    hasNumberKeepingClaim("투폰 개통해도 지금 쓰는 번호는 그대로 유지됩니다"),
    false,
  );
  assert.equal(
    hasNumberKeepingClaim("기존 번호는 그대로 두고 두 번째 번호를 하나 더 만드는 거예요"),
    false,
  );
  assert.equal(
    hasNumberKeepingClaim("세컨폰이라 원래 번호 그대로 쓰면서 업무용 번호를 새로 받아요"),
    false,
  );
});

test("투폰 맥락이라도 미납·정지·부활 문맥이 근처면 여전히 차단", () => {
  assert.equal(
    hasNumberKeepingClaim("미납 있어도 투폰으로 기존 번호 그대로 쓸 수 있어요"),
    true,
  );
  assert.equal(
    hasNumberKeepingClaim("정지된 번호도 투폰 개통하면 그대로 살릴 수 있다니까요"),
    true,
  );
});

test("번호와 무관한 문장·일반 문구는 통과", () => {
  assert.equal(hasNumberKeepingClaim("선불폰은 신용조회 없이 개통돼요"), false);
  assert.equal(hasNumberKeepingClaim("유심번호 입력 후 요금제 선택"), false);
  assert.equal(hasNumberKeepingClaim("전화번호 안내를 확인하세요"), false);
  assert.equal(hasNumberKeepingClaim(""), false);
  // 2026-07-27 오탐 수정 — '폰은 그대로'가 앞에 있어도 번호 뒤가 새로/새롭게면 정답
  assert.equal(hasNumberKeepingClaim("폰은 그대로 두고 번호만 새롭게! 5분이면 끝"), false);
  assert.equal(hasNumberKeepingClaim("폰은 그대로, 번호만 새로 발급받아 즉시 사용"), false);
  // '그대로'류 표현은 부정문이어도 계속 차단 (미끼 위험)
  assert.equal(hasNumberKeepingClaim("기존 번호 그대로 유지하는 것은 불가능합니다"), true);
  // 2026-07-27 정책 정밀 완화 — 올바른 "유지되지 않/유지 안 됨" 단정 부정문만 허용
  //   (발신정지류 주제는 이 말 없이 글이 안 됨. 살리다·그대로·의문형·'유지가 안'은 계속 차단)
  assert.equal(
    hasNumberKeepingClaim("기존 번호는 유지되지 않지만, 휴대폰 기기는 계속 쓸 수 있어요"),
    false,
  );
  assert.equal(
    hasNumberKeepingClaim("기존 번호는 유지 안 돼요, 새 번호로 바로 개통해요"),
    false,
  );
  assert.equal(hasNumberKeepingClaim("번호는 못 살려요, 새로 받으세요"), true); // 살리류는 여전히 차단
});

// ─── 1인칭 고객 경험담 가드 (2026-07-20 운영자 지시: 경험담은 손님 사례 시점) ───

test("1인칭 피해 경험담 — 차단 (실제 발생 사례)", () => {
  assert.equal(
    hasFirstPersonVictimClaim("지난주에 4대 통신사 다 돌았는데, 전부 제 명의로는 개통 안 된다고 퇴짜 맞았어요."),
    true,
  );
  assert.equal(hasFirstPersonVictimClaim("저도 예전에 그랬는데, 통신사마다 기준이 달라요"), true);
  assert.equal(hasFirstPersonVictimClaim("근데 제 착각이었어요. 당연히 안 될 줄 알았거든요"), true);
  assert.equal(hasFirstPersonVictimClaim("제가 요금 밀려서 폰 정지당했을 때 알게 된 방법이에요"), true);
});

test("손님 사례 시점 — 통과 (올바른 프레이밍)", () => {
  assert.equal(
    hasFirstPersonVictimClaim("어제 개통 문의 주신 손님이 4대 통신사에서 다 거절당하셨다더라고요."),
    false,
  );
  assert.equal(
    hasFirstPersonVictimClaim("손님 중에 요금 미납으로 정지된 폰 때문에 막막해하시던 분이 계셨어요"),
    false,
  );
  assert.equal(
    hasFirstPersonVictimClaim("개통해 드린 분 사례인데, 신용불량 이력이 있어도 5분 만에 끝났어요"),
    false,
  );
});

test("주어 생략형·저처럼 변형 — 차단 (7/20 감사에서 가드가 놓친 실사례)", () => {
  assert.equal(
    hasFirstPersonVictimClaim("지난달에 쓰던 폰이 갑자기 먹통 돼서 엄청 당황했어요. 급하게 새 폰 찾아봤거든요"),
    true,
  );
  assert.equal(
    hasFirstPersonVictimClaim("지난달에 SKT 요금 밀려서 폰이 갑자기 멈췄거든요"),
    true,
  );
  assert.equal(
    hasFirstPersonVictimClaim("저처럼 소액결제 실수로 통신비 폭탄 맞아본 분들 많으실 것 같은데"),
    true,
  );
});

test("시간 앵커라도 손님 사례·독자 질문이면 통과", () => {
  assert.equal(
    hasFirstPersonVictimClaim("지난주에 오신 손님, 폰이 갑자기 먹통 됐다더라고요"),
    false,
  );
  assert.equal(
    hasFirstPersonVictimClaim("지난달에 요금 밀려서 정지되셨나요? 해결 방법이 있어요"),
    false,
  );
  assert.equal(
    hasFirstPersonVictimClaim("어제 개통해 드린 분도 미납 이력이 있었지만 5분 만에 끝났어요"),
    false,
  );
});

test("업체 1인칭(피해 아님)·일반 정보 문장 — 통과", () => {
  assert.equal(hasFirstPersonVictimClaim("이런 문의 진짜 많이 받아요. 제가 바로 도와드릴게요"), false);
  assert.equal(hasFirstPersonVictimClaim("요금 밀려서 폰 정지됐다고요? 해결 방법이 있어요"), false);
  assert.equal(hasFirstPersonVictimClaim("선불폰은 신용조회 없이 개통돼요"), false);
  assert.equal(hasFirstPersonVictimClaim(""), false);
});

test("HTML이 섞여 있어도 감지 (블로그 본문)", () => {
  assert.equal(
    hasNumberKeepingClaim('<p>쓰던 <strong>번호 그대로</strong> 옮겨올 수도 있다는 거!</p>'),
    true,
  );
  assert.equal(
    hasNumberKeepingClaim('<div>번호를 그대로 유지하고 싶으신 분 (번호이동)</div>'),
    true,
  );
});

test("1인칭 가드 — 블록 태그가 문장 경계로 살아나야 오탐이 없다", () => {
  // 실제 생성물(p-260728-002)에서 나온 구조. "내 명의"(제목)와 "미납"(도입부)이
  // 서로 다른 블록에 있으므로 경험담이 아니다 — 태그를 공백으로 지우면 오탐.
  assert.equal(
    hasFirstPersonVictimClaim(
      "<h2>신용 조회 없이 내 명의로 진행하는 순서</h2><p>통신 미납이나 신용 문제로 개통이 어려우셨나요?</p>",
    ),
    false,
  );
  // 같은 블록 안에 있으면 종전대로 잡아야 한다 (기능 약화 아님).
  assert.equal(
    hasFirstPersonVictimClaim("<p>제 명의로는 미납 때문에 개통이 안 된다고 퇴짜 맞았어요</p>"),
    true,
  );
  // <br>로만 나뉜 두 줄도 별개 문장으로 취급.
  assert.equal(
    hasFirstPersonVictimClaim("내 명의로 개통 가능해요<br>미납 이력 있어도 됩니다"),
    false,
  );
});

// ─── 컴플라이언스 금지어 가드 (CLAUDE.md 2026-07-23) ───────────────

test("컴플라이언스 — 실제 발행됐던 위반 문구 전부 감지", () => {
  assert.deepEqual(
    findComplianceBannedWords("자세한 유심 가이드는 공식 사이트에서 확인하실 수 있어요"),
    ["공식"],
  );
  assert.deepEqual(
    findComplianceBannedWords("다이소 U+망 유심(빨간색)도 호환돼요"),
    ["다이소"],
  );
  assert.deepEqual(
    findComplianceBannedWords("외국인등록증이 있고 간편인증서가 있다면 비대면 개통이 가능합니다"),
    ["외국인등록증"],
  );
  assert.deepEqual(
    findComplianceBannedWords("통신사 직영점에 방문하여 해제 요청을 해야 합니다"),
    ["직영"],
  );
  assert.deepEqual(
    findComplianceBannedWords("고객센터 1899-7700으로 전화주세요"),
    ["고객센터"],
  );
  assert.deepEqual(findComplianceBannedWords("24시간 언제든 셀프개통!"), ["24시간"]);
  assert.deepEqual(findComplianceBannedWords("스카이라이프 유심도 가능해요"), ["스카이라이프"]);
});

test("컴플라이언스 — 복수 금지어 동시 감지 + HTML 제거", () => {
  const hits = findComplianceBannedWords(
    '<p>본사 공식 개통센터에서 24시간 상담해 드려요</p>',
  );
  assert.deepEqual(hits.sort(), ["24시간", "개통센터", "공식", "본사"].sort());
});

test("컴플라이언스 — 정상 표현은 통과 (경계 오탐 회귀 방지)", () => {
  assert.deepEqual(findComplianceBannedWords("앤텔레콤 안심개통은 인증판매점입니다"), []);
  assert.deepEqual(findComplianceBannedWords("기본 사용법을 알려드려요"), []); // "본사" 경계 오탐 X
  assert.deepEqual(findComplianceBannedWords("궁금한 점은 1:1 채팅 상담(카카오 채널)으로!"), []);
  assert.deepEqual(findComplianceBannedWords("개통 성공 사례가 많아요"), []);
  assert.deepEqual(findComplianceBannedWords(""), []);
});

test("컴플라이언스 — 교정 힌트 생성", () => {
  const hints = complianceFixHints(["공식", "고객센터"]);
  assert.ok(hints.includes("인증판매점"));
  assert.ok(hints.includes("1:1 채팅 상담"));
});
