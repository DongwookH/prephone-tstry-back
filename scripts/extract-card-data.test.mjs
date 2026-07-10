/**
 * extract-card-data 회귀 테스트.
 *   node --test scripts/extract-card-data.test.mjs
 *
 * 핵심 회귀: 박스의 "마지막 ✅ 항목"이 <br> 없이 </div>로 끝나면
 * 뒤따르는 본문을 삼켜 길이 초과로 탈락하던 버그 (2026-07-10 발견).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCardData } from "../lib/extract-card-data.ts";

const OPTS = { maxItems: 6, maxItemLen: 75 };

function sectionCards(html) {
  return extractCardData(
    { title: "t", keyword: "k", category: "c", contentHtml: html },
    OPTS,
  ).filter((c) => c.type === "section");
}

// 실제 글 구조 축약 — <br> 구분 박스, 마지막 항목 뒤엔 </div>만.
const BR_BOX_HTML = `
<div class="ntc-section" id="section-2">
  <div style="background:linear-gradient(90deg,#eee,#fff)">2) 개통 준비물 - 필수 체크리스트</div>
  <div style="border-left:3px solid #9DC91A;padding-left:10px">
    <p>비대면 개통은 준비물에서 승부가 납니다.</p>
    <div style="background:#f2f8e6">
      ✅ KT망: KT 바로유심 (CU, GS25, 세븐일레븐 등 / 민트색)<br/>
      ✅ LG U+망: 모두의유심원칩 (이마트24, 스토리웨이 등 / 검정 또는 핑크색)
    </div>
    <p>안면인식 외에도 간편인증서로 본인 확인이 가능해요. 이 문장이 항목에 섞이면 안 됩니다.</p>
    <div style="background:#f2f8e6">
      ✅ PASS 인증<br/>
      ✅ 카카오/토스/KB/SOL 간편인증서
    </div>
  </div>
</div>`;

// div-per-item 구조 (p-20260710-004 인증 박스 패턴).
const DIV_BOX_HTML = `
<div class="ntc-section" id="section-3">
  <div style="background:linear-gradient(90deg,#eee,#fff)">3) 본인 인증 수단</div>
  <div>
    <div style="margin-top:14px;"><strong>✅ PASS 인증</strong></div>
    <div style="margin-top:14px;"><strong>✅ 카카오 인증</strong></div>
    <div style="margin-top:14px;"><strong>✅ SOL (신한) 간편인증</strong></div>
  </div>
  <p>다음 단락 텍스트는 마지막 항목에 붙으면 안 됩니다.</p>
</div>`;

test("br 구분 박스: 각 박스의 마지막 ✅ 항목도 추출된다", () => {
  const [card] = sectionCards(BR_BOX_HTML);
  assert.ok(card, "섹션 카드가 나와야 함");
  assert.deepEqual(card.bullets, [
    "KT망: KT 바로유심 (CU, GS25, 세븐일레븐 등 / 민트색)",
    "LG U+망: 모두의유심원칩 (이마트24, 스토리웨이 등 / 검정 또는 핑크색)",
    "PASS 인증",
    "카카오/토스/KB/SOL 간편인증서",
  ]);
});

test("div-per-item 박스: 마지막 항목이 다음 단락을 삼키지 않는다", () => {
  const [card] = sectionCards(DIV_BOX_HTML);
  assert.ok(card, "섹션 카드가 나와야 함");
  assert.deepEqual(card.bullets, [
    "PASS 인증",
    "카카오 인증",
    "SOL (신한) 간편인증",
  ]);
});

test("항목 안 인라인 태그(strong)는 종결자로 오인하지 않는다", () => {
  const html = `
<div class="ntc-section" id="section-4">
  <div style="background:linear-gradient(90deg,#eee,#fff)">4) 요금제</div>
  <div>
    ✅ <strong>선불 396</strong> (39,600원): 가성비형 일반 사용<br/>
    ✅ <strong>선불 859</strong> (85,900원): 프리미엄 헤비 유저
  </div>
</div>`;
  const [card] = sectionCards(html);
  assert.deepEqual(card.bullets, [
    "선불 396 (39,600원): 가성비형 일반 사용",
    "선불 859 (85,900원): 프리미엄 헤비 유저",
  ]);
});
