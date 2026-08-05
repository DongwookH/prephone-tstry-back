/**
 * JSON 복구 회귀 테스트.
 *
 * 배경 (2026-07-30): Gemini가 HTML을 JSON 문자열로 실어 보낼 때
 * style="..." 내부 따옴표를 간헐적으로 escape하지 않아
 * "Expected ',' or '}' after property value"로 파싱이 죽었다.
 * 3회 재시도가 모두 같은 이유로 실패해 하루 1편이 날아갔다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { repairUnescapedQuotes } from "../lib/gemini.ts";

test("HTML style 속성의 escape 안 된 따옴표를 복구", () => {
  const broken = '{"content_html":"<div style="color:red">안녕</div>","n":1}';
  const parsed = JSON.parse(repairUnescapedQuotes(broken));
  assert.equal(parsed.content_html, '<div style="color:red">안녕</div>');
  assert.equal(parsed.n, 1);
});

test("여러 개·중첩된 따옴표도 복구", () => {
  const broken =
    '{"html":"<a href="x" class="y">링크</a><p style="m:0">본문</p>","ok":true}';
  const parsed = JSON.parse(repairUnescapedQuotes(broken));
  assert.match(parsed.html, /href="x"/);
  assert.match(parsed.html, /style="m:0"/);
  assert.equal(parsed.ok, true);
});

test("정상 JSON은 그대로 통과 (멱등)", () => {
  const good = '{"a":"이미 \\"escape\\" 된 값","b":[1,2],"c":{"d":"e"}}';
  assert.equal(repairUnescapedQuotes(good), good);
  assert.deepEqual(JSON.parse(repairUnescapedQuotes(good)), JSON.parse(good));
});

test("닫는 따옴표 뒤 공백·개행이 있어도 정상 인식", () => {
  const good = '{\n  "a": "값"  ,\n  "b": "값2"\n}';
  assert.deepEqual(JSON.parse(repairUnescapedQuotes(good)), { a: "값", b: "값2" });
});

test("이미 escape된 백슬래시를 망가뜨리지 않는다", () => {
  const good = '{"path":"C:\\\\temp\\\\a.txt"}';
  assert.deepEqual(JSON.parse(repairUnescapedQuotes(good)), { path: "C:\\temp\\a.txt" });
});

// ─── 통신 오류 판정 (2026-08-05) ────────────────────────────────────
//
// 배경: undici의 "fetch failed"는 HTTP status가 없어서 재시도 판정에서
// 걸러지지 않았다. 폴백 체인이 첫 키에서 즉시 throw했고, 스크립트는 그걸
// "내용 시도 3회" 중 1회로 세어버렸다. 그날 프리페이드유심 1편이 글 자체엔
// 아무 문제가 없는데도 사라졌다.
test("fetch failed — 통신 오류로 판정 (시도 횟수 차감 대상 아님)", async () => {
  const { isTransientApiError } = await import("../lib/gemini.ts");
  assert.equal(
    isTransientApiError(
      new Error(
        "[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent: fetch failed",
      ),
    ),
    true,
  );
});

test("cause에 숨은 소켓 오류도 통신 오류로 판정", async () => {
  const { isTransientApiError } = await import("../lib/gemini.ts");
  const err = new Error("fetch failed");
  err.cause = Object.assign(new Error("read ECONNRESET"), {
    code: "ECONNRESET",
  });
  assert.equal(isTransientApiError(err), true);

  const undiciTimeout = new Error("request failed");
  undiciTimeout.cause = Object.assign(new Error("Connect Timeout Error"), {
    code: "UND_ERR_CONNECT_TIMEOUT",
  });
  assert.equal(isTransientApiError(undiciTimeout), true);
});

test("429·503은 통신 오류 / 가드 폐기는 아니다", async () => {
  const { isTransientApiError } = await import("../lib/gemini.ts");
  assert.equal(isTransientApiError(Object.assign(new Error("x"), { status: 429 })), true);
  assert.equal(isTransientApiError(Object.assign(new Error("x"), { status: 503 })), true);

  // ⚠️ 가드 폐기를 통신 오류로 오판하면 재시도가 무한정 공짜가 되고
  //    같은 위반이 반복돼도 아무도 못 잡는다.
  assert.equal(
    isTransientApiError(
      new Error("구조 가드: 본문 분량 미달 — 실측 1487자 (하한 1500자)"),
    ),
    false,
  );
  assert.equal(
    isTransientApiError(new Error("페르소나 가드: 1인칭 피해 경험담")),
    false,
  );
  assert.equal(isTransientApiError(Object.assign(new Error("x"), { status: 400 })), false);
});

test("cause 순환 참조에도 무한루프에 빠지지 않는다", async () => {
  const { isTransientApiError } = await import("../lib/gemini.ts");
  const a = new Error("배드 리퀘스트");
  const b = new Error("래핑");
  a.cause = b;
  b.cause = a;
  assert.equal(isTransientApiError(a), false);
});
