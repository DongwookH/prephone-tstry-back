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
