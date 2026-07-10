import { test } from "node:test";
import assert from "node:assert/strict";
import { styleFromInsight, matchPostByPath } from "../lib/metrics-utils.ts";

test("insight 앞머리에서 스타일명 추출", () => {
  assert.equal(styleFromInsight("반전/오해 정정형: 널리 퍼진 오해를…"), "반전/오해 정정형");
  assert.equal(styleFromInsight(""), "");
  assert.equal(styleFromInsight("스타일 구분자 없음 문장만 잔뜩 있는 경우에는 빈 값이어야 한다 왜냐하면 삼십자를 넘으니까"), "");
});

test("전각 콜론·짧은 head·undefined 처리", () => {
  assert.equal(styleFromInsight("경험담형： 디테일이 공감을…"), "경험담형");
  assert.equal(styleFromInsight("a: 한 글자 head는 버림"), "");
  assert.equal(styleFromInsight(undefined), "");
});

test("GA pagePath ↔ posts tistory_url 매칭", () => {
  const posts = [
    { id: "p-1", tistory_url: "https://ntel.tistory.com/123" },
    { id: "p-2", tistory_url: "https://ntel.tistory.com/entry/abc-def" },
    { id: "p-3", tistory_url: "" },
  ];
  assert.equal(matchPostByPath("/123", posts), "p-1");
  assert.equal(matchPostByPath("/entry/abc-def?category=1", posts), "p-2");
  assert.equal(matchPostByPath("/999", posts), null);
});

test("트레일링 슬래시·잘못된 URL 처리", () => {
  const posts = [
    { id: "p-1", tistory_url: "https://ntel.tistory.com/123" },
    { id: "p-bad", tistory_url: "not a url" },
  ];
  assert.equal(matchPostByPath("/123/", posts), "p-1");
  assert.equal(matchPostByPath("/anything", [posts[1]]), null);
});
