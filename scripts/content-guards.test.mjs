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

test("번호와 무관한 문장·일반 문구는 통과", () => {
  assert.equal(hasNumberKeepingClaim("선불폰은 신용조회 없이 개통돼요"), false);
  assert.equal(hasNumberKeepingClaim("유심번호 입력 후 요금제 선택"), false);
  assert.equal(hasNumberKeepingClaim("전화번호 안내를 확인하세요"), false);
  assert.equal(hasNumberKeepingClaim(""), false);
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
