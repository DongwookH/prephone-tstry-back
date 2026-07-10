import { test } from "node:test";
import assert from "node:assert/strict";
import { buildImageAlert } from "./build-image-alert.mjs";

test("전부 성공이면 빈 문자열 (알림 없음)", () => {
  assert.equal(
    buildImageAlert("success", '{"total":10,"ok":10,"failed":0}', '{"total":40,"ok":40,"failed":0}', "메인", ""),
    "",
  );
});

test("부분 실패면 실패 수 포함 경고", () => {
  const msg = buildImageAlert("success", '{"total":10,"ok":7,"failed":3}', '{"total":40,"ok":1,"failed":39}', "메인", "백필이 재시도합니다.");
  assert.match(msg, /썸네일: 7\/10/);
  assert.match(msg, /카드뉴스: 1\/40/);
  assert.match(msg, /백필이 재시도/);
});

test("잡 자체가 failure면 요약 JSON 없어도 경고", () => {
  const msg = buildImageAlert("failure", "", "", "백필", "");
  assert.match(msg, /백필/);
  assert.match(msg, /failure/);
});
