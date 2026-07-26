/**
 * 멀티테넌트 생성 격리 회귀 테스트.
 *   node --test scripts/tenant-generation.test.mjs
 *
 * 핵심 보증: 테넌트 모드 프롬프트/히어로에 오너(앤텔레콤) 브랜드·링크·KB가
 * 절대 새어들지 않는다 — 새면 "남의 글에 오너 회사 정보"가 들어가는 사고.
 * 반대로 오너 모드는 기존 그대로여야 한다 (기존 파이프라인 무회귀).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, ensureHeroBox } from "../lib/post-generator.ts";
import {
  missingRequiredGuideSections,
  withUtm,
} from "../lib/tenant-config.ts";

const TENANT_GUIDE = {
  brand_name: "홍길동텔레콤",
  links: [
    { label: "📱 신청 페이지", url: "https://hong.example.com/apply" },
    { label: "💬 카톡 문의", url: "https://pf.kakao.com/_hongtest" },
  ],
  company: "홍길동텔레콤 — 연중무휴, 카톡 상담 운영. 홈페이지 https://hong.example.com",
  plans: "베이직 20,000원 / 프리미엄 40,000원 (확정가 2종)",
  personas: "가격 비교 중인 30대 직장인",
  banned_words: ["최저가", "업계1위"],
  extra_rules: "이모지는 쓰지 않는다.",
  faq: "Q. 당일 개통 되나요?\nA. 영업시간 내 접수 시 당일 처리됩니다.",
};

const OWNER_MARKERS = [
  "앤텔레콤",
  "안심개통",
  "케어통신",
  "ntelecomsafe.com",
  "인증판매점",
  "더지통신",
];

function tenantPrompt() {
  return buildPrompt({
    keyword: "선불폰개통",
    category: "일반",
    subKeywords: [],
    persona: "일반",
    utmCampaign: "test-campaign",
    tenantBrand: TENANT_GUIDE,
  });
}

function ownerPrompt() {
  return buildPrompt({
    keyword: "선불폰개통",
    category: "일반",
    subKeywords: [],
    persona: "일반",
    utmCampaign: "test-campaign",
  });
}

test("테넌트 프롬프트 — 오너 브랜드·링크·KB가 전혀 없다", () => {
  const p = tenantPrompt();
  for (const marker of OWNER_MARKERS) {
    assert.equal(
      p.includes(marker),
      false,
      `테넌트 프롬프트에 오너 마커 "${marker}" 발견 — 격리 실패`,
    );
  }
});

test("테넌트 프롬프트 — 테넌트 브랜드·링크·금지어·추가규칙이 주입된다", () => {
  const p = tenantPrompt();
  assert.equal(p.includes("홍길동텔레콤"), true);
  assert.equal(p.includes("https://hong.example.com/apply"), true);
  assert.equal(p.includes("최저가"), true, "banned_words 미주입");
  assert.equal(p.includes("이모지는 쓰지 않는다"), true, "extra_rules 미주입");
  assert.equal(p.includes("아래 규칙이 우선"), true, "extra_rules 우선 명시 누락");
  assert.equal(p.includes("당일 개통 되나요"), true, "faq 미주입");
  assert.equal(p.includes("베이직 20,000원"), true, "plans 미주입");
});

test("오너 프롬프트 — 기존 그대로 (무회귀)", () => {
  const p = ownerPrompt();
  assert.equal(p.includes("앤텔레콤 안심개통"), true);
  assert.equal(p.includes("ntelecomsafe.com"), true);
  assert.equal(p.includes("인증판매점"), true, "NRC 컴플라이언스 블록 누락");
  assert.equal(p.includes("홍길동텔레콤"), false);
});

test("히어로 자동 삽입 — 테넌트 모드는 테넌트 브랜드·버튼으로", () => {
  const noHero = '<div class="ntc-section" id="section-1">본문</div>';
  const out = ensureHeroBox(noHero, "테스트 제목", "선불폰개통", "test-campaign", TENANT_GUIDE);
  assert.equal(out.includes("홍길동텔레콤"), true);
  assert.equal(out.includes("https://hong.example.com/apply"), true);
  for (const marker of OWNER_MARKERS) {
    assert.equal(out.includes(marker), false, `테넌트 히어로에 "${marker}" 발견`);
  }
  // 오너 모드는 기존 그대로
  const ownerOut = ensureHeroBox(noHero, "테스트 제목", "선불폰개통", "test-campaign");
  assert.equal(ownerOut.includes("앤텔레콤 안심개통 케어통신"), true);
});

test("필수 섹션 검증 — brand_name·links·company·plans", () => {
  assert.deepEqual(missingRequiredGuideSections(TENANT_GUIDE), []);
  assert.deepEqual(
    missingRequiredGuideSections({
      ...TENANT_GUIDE,
      brand_name: "",
      links: [],
      company: "",
      plans: "",
    }),
    ["brand_name", "links", "company", "plans"],
  );
});

test("컴플라이언스 금지어 포함 키워드 — 계획 단계에서 차단", async () => {
  const { isComplianceBlacklistedKeyword, isContentBlacklistedKeyword } =
    await import("../lib/sheets.ts");
  // 2026-07-26 실사고: 제목이 키워드로 시작해야 해서 금지어 키워드는 100% 폐기됨
  assert.equal(isComplianceBlacklistedKeyword("스카이라이프유심"), true);
  assert.equal(isComplianceBlacklistedKeyword("다이소 선불폰"), true);
  assert.equal(isComplianceBlacklistedKeyword("고객센터 문의"), true);
  assert.equal(isComplianceBlacklistedKeyword("SKT선불폰"), false);
  assert.equal(isComplianceBlacklistedKeyword("선불유심가격"), false);
  assert.equal(isContentBlacklistedKeyword("스카이라이프유심"), true);
});

test("정지·미납류 키워드 — 새 번호 프레임 강제 블록 주입", () => {
  const risky = buildPrompt({
    keyword: "SKT발신정지",
    category: "일반",
    subKeywords: [],
    persona: "일반",
    utmCampaign: "test",
  });
  assert.equal(risky.includes("번호 관련 서술 규칙"), true);
  assert.equal(risky.includes("새 번호가 발급"), true);

  const normal = buildPrompt({
    keyword: "선불유심가격",
    category: "일반",
    subKeywords: [],
    persona: "일반",
    utmCampaign: "test",
  });
  assert.equal(normal.includes("번호 관련 서술 규칙"), false);
});

test("프레임 블록이 지시하는 예시 문장 — 실제 가드 통과 정합성", async () => {
  const { hasNumberKeepingClaim } = await import("../lib/content-guards.ts");
  // 블록이 "이렇게만 쓰라"고 지시하는 문장들은 반드시 가드를 통과해야 한다
  assert.equal(hasNumberKeepingClaim("번호는 새로 발급받아요"), false);
  assert.equal(hasNumberKeepingClaim("새 번호로 5분 만에 개통할 수 있어요"), false);
  assert.equal(
    hasNumberKeepingClaim("연락처·사진·카톡 데이터는 단말기에 그대로 남아 있어요"),
    false,
  );
  // 1차 버전 블록의 예시가 걸렸던 패턴 — 가드가 차단하는 게 맞다 (회귀 문서화)
  assert.equal(hasNumberKeepingClaim("기존 번호는 살릴 수 없지만 새로 개통"), true);
});

test("withUtm — 쿼리 유무에 따라 ?/& 처리", () => {
  assert.equal(
    withUtm("https://a.com/x", "c1"),
    "https://a.com/x?utm_source=tistory&utm_medium=blog&utm_campaign=c1",
  );
  assert.equal(
    withUtm("https://a.com/x?ref=1", "c1"),
    "https://a.com/x?ref=1&utm_source=tistory&utm_medium=blog&utm_campaign=c1",
  );
});
