// node --test — lib/research-select.ts (니치 우선 + 바이럴 소수 혼합 선별)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectResearchReferences,
  NICHE_PATTERN,
} from "../lib/research-select.ts";

const niche = (i) => ({ text: `선불폰 유심 개통 후기 ${i}`, likes: 100 - i });
const viral = (i) => ({ text: `오늘 점심 뭐 먹을지 고민 ${i}`, likes: 1000 - i });

test("니치 패턴 — 통신 관련 본문 매칭", () => {
  assert.ok(NICHE_PATTERN.test("요금 미납으로 핸드폰 정지됐어요"));
  assert.ok(NICHE_PATTERN.test("알뜰폰 자급제 조합 꿀팁"));
  assert.ok(!NICHE_PATTERN.test("촛불은 바람불면 꺼진다고? ARMY가 지킨다"));
  assert.ok(!NICHE_PATTERN.test("안면 비대칭 교정 물리치료사입니다"));
});

test("니치 충분 → 니치 6 + 바이럴 2", () => {
  const posts = [
    ...Array.from({ length: 5 }, (_, i) => viral(i)), // 참여도 상위는 바이럴
    ...Array.from({ length: 10 }, (_, i) => niche(i)),
  ];
  const out = selectResearchReferences(posts, 8);
  const nicheCount = out.filter((p) => NICHE_PATTERN.test(p.text)).length;
  assert.equal(out.length, 8);
  assert.equal(nicheCount, 6);
});

test("니치 부족 → 니치 전부 + 바이럴로 채움", () => {
  const posts = [
    ...Array.from({ length: 10 }, (_, i) => viral(i)),
    ...Array.from({ length: 3 }, (_, i) => niche(i)),
  ];
  const out = selectResearchReferences(posts, 8);
  const nicheCount = out.filter((p) => NICHE_PATTERN.test(p.text)).length;
  assert.equal(out.length, 8);
  assert.equal(nicheCount, 3);
});

test("니치 0개 → 바이럴만 limit개", () => {
  const posts = Array.from({ length: 10 }, (_, i) => viral(i));
  const out = selectResearchReferences(posts, 8);
  assert.equal(out.length, 8);
});

test("바이럴 0개 → 니치만 limit개", () => {
  const posts = Array.from({ length: 10 }, (_, i) => niche(i));
  const out = selectResearchReferences(posts, 8);
  assert.equal(out.length, 8);
});

test("전체가 limit 미만 → 전부 반환", () => {
  const posts = [niche(1), niche(2), viral(1)];
  const out = selectResearchReferences(posts, 8);
  assert.equal(out.length, 3);
});

test("중복 본문 제거 — @핸들 접두사 변형도 같은 글로 판정", () => {
  const posts = [
    { text: "현직 폰팔이로서 말합니다 지금 바꾸지 마세요", likes: 765 },
    { text: "@phonesinsa_uman 현직 폰팔이로서 말합니다 지금 바꾸지 마세요", likes: 765 },
    niche(1),
    niche(1), // 완전 동일 본문
    niche(2),
  ];
  const out = selectResearchReferences(posts, 8);
  assert.equal(out.length, 3); // 폰팔이 1 + niche(1) 1 + niche(2) 1
});

test("니치 내 참여도 순서 유지", () => {
  const posts = [viral(0), niche(3), niche(1), niche(2)];
  const out = selectResearchReferences(posts, 3);
  const nicheTexts = out.filter((p) => NICHE_PATTERN.test(p.text));
  assert.deepEqual(
    nicheTexts.map((p) => p.text),
    [niche(3).text, niche(1).text, niche(2).text].slice(0, nicheTexts.length),
  );
});
