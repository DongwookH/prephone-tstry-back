/**
 * 멀티테넌트 생성 격리 회귀 테스트.
 *   npx tsx --test scripts/tenant-generation.test.mjs
 *   (lib/*.ts가 확장자 없는 상대 import를 쓰므로 tsx 러너가 필요하다.
 *    node --test로는 모듈 해석에 실패한다 — GHA도 tsx로 돌린다)
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
  assembleGuide,
  withUtm,
} from "../lib/tenant-config.ts";

/** 폼이 저장하는 원문 형태(빈 값 기본) — 테스트에서 부분만 덮어쓰기 위한 헬퍼. */
function raw(over = {}) {
  return {
    brand_name: "",
    link_kakao: "",
    link_site: "",
    phone: "",
    hours: "",
    company: "",
    links: "",
    personas: "",
    banned_words: "",
    extra_rules: "",
    faq: "",
    ...over,
  };
}

const TENANT_GUIDE = {
  brand_name: "홍길동텔레콤",
  links: [
    { label: "📱 신청 페이지", url: "https://hong.example.com/apply" },
    { label: "💬 카톡 문의", url: "https://pf.kakao.com/_hongtest" },
  ],
  company: "홍길동텔레콤 — 연중무휴, 카톡 상담 운영. 홈페이지 https://hong.example.com",
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
  // 요금표는 테넌트에게 받지 않는다 — 항상 공통 확정가가 들어간다
  assert.equal(p.includes("12,100"), true, "공통 요금표 미주입");
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

test("필수 섹션 검증 — brand_name·links·company (요금표는 항목 자체가 없음)", () => {
  assert.deepEqual(missingRequiredGuideSections(TENANT_GUIDE), []);
  assert.deepEqual(
    missingRequiredGuideSections({
      ...TENANT_GUIDE,
      brand_name: "",
      links: [],
      company: "",
    }),
    ["brand_name", "links", "company"],
  );
});

test("요금표 — 테넌트 입력과 무관하게 항상 공통 확정가를 쓴다", () => {
  const p = buildPrompt({
    keyword: "선불폰개통",
    category: "일반",
    subKeywords: [],
    persona: "일반",
    utmCampaign: "test",
    tenantBrand: TENANT_GUIDE,
  });
  // 공통 요금표의 확정가가 들어와야 한다
  assert.equal(p.includes("12,100"), true, "공통 요금표 미주입");
  // 브랜드·링크는 여전히 테넌트 것이고 오너 마커는 새면 안 된다
  assert.equal(p.includes("홍길동텔레콤"), true);
  assert.equal(p.includes("https://hong.example.com/apply"), true);
  for (const marker of OWNER_MARKERS) {
    assert.equal(p.includes(marker), false, `오너 마커 "${marker}" 누출`);
  }
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

test("새 번호 프레임 블록 — 키워드와 무관하게 항상 주입 (가드가 항상 켜져 있으므로)", () => {
  const risky = buildPrompt({
    keyword: "SKT발신정지",
    category: "일반",
    subKeywords: [],
    persona: "일반",
    utmCampaign: "test",
  });
  assert.equal(risky.includes("번호 관련 서술 규칙"), true);
  assert.equal(risky.includes("새 번호가 발급"), true);

  // ⚠️ 조건부로 되돌리지 말 것. 가드(findNumberKeepingClaims)는 키워드와
  //    무관하게 항상 켜져 있다. 규칙만 조건부면 조건 밖 키워드에서 모델이
  //    배운 적 없는 위반을 반복해 재시도 3회를 그대로 태운다
  //    (2026-08-04 '선불폰당일개통' 3/3 폐기).
  const normal = buildPrompt({
    keyword: "선불유심가격",
    category: "일반",
    subKeywords: [],
    persona: "일반",
    utmCampaign: "test",
  });
  assert.equal(normal.includes("번호 관련 서술 규칙"), true);
  assert.equal(normal.includes("새 번호가 발급"), true);

  // 번호 Q&A는 "유도"가 아니라 "금지"다 — 답변이 거의 매번 "기존 번호를
  // 유지할 수 없어요"로 나와 통째로 폐기됐다 (2026-08-04 '통신사직권해지').
  for (const p of [risky, normal]) {
    assert.equal(p.includes("Q&A에 번호 관련 질문을 아예 만들지 마세요"), true);
  }
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

test("가드 위반 스니펫 — 위반 구간 텍스트를 반환 (정밀 재시도 피드백용)", async () => {
  const { findNumberKeepingClaims } = await import("../lib/content-guards.ts");
  const hits = findNumberKeepingClaims(
    "<p>정지된 폰도 걱정 마세요. 기존 번호 그대로 다시 쓸 수 있으니까요.</p>",
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].includes("번호 그대로"), true);
  assert.deepEqual(
    findNumberKeepingClaims("번호는 새로 발급받아요. 단말기는 그대로 쓰세요."),
    [],
  );
});

test("세컨폰류 키워드 — 전용 번호 서술 규칙 블록 발동", () => {
  const p = buildPrompt({
    keyword: "세컨폰개통",
    category: "일반",
    subKeywords: [],
    persona: "일반",
    utmCampaign: "test",
  });
  assert.equal(p.includes("번호 관련 서술 규칙"), true);
  assert.equal(p.includes("새 번호를 하나 더 받습니다"), true);
});

// ─── 백오피스 가이드 폼 (2026-07-27) — 세분 행 → 조립 ───────────────

test("링크 조립 — 개통 사이트가 대표(첫 번째), 카톡이 두 번째, 자유형식이 뒤", () => {
  const g = assembleGuide(
    raw({
      link_site: "https://hong.example.com/apply",
      link_kakao: "https://pf.kakao.com/_hong",
      links: "블로그: https://blog.example.com",
    }),
  );
  assert.deepEqual(g.links, [
    { label: "개통 신청", url: "https://hong.example.com/apply" },
    { label: "카카오톡 상담", url: "https://pf.kakao.com/_hong" },
    { label: "블로그", url: "https://blog.example.com" },
  ]);
  // post-generator가 [0]을 대표 버튼, [1]을 문의 버튼으로 쓴다
  assert.equal(g.links[0].url.includes("apply"), true);
});

test("링크 조립 — 자동 라벨에 이모지를 넣지 않는다 (이모지 금지 테넌트 보호)", () => {
  const g = assembleGuide(raw({ link_kakao: "https://pf.kakao.com/_x" }));
  assert.equal(/\p{Extended_Pictographic}/u.test(g.links[0].label), false);
});

test("링크 조립 — http(s)가 아닌 값은 링크로 잡지 않는다", () => {
  const g = assembleGuide(
    raw({ link_site: "hong.example.com", link_kakao: "  " }),
  );
  assert.deepEqual(g.links, []);
});

test("회사 정보 조립 — 판매점명·전화·영업시간 + 원문 병합", () => {
  const g = assembleGuide(
    raw({
      brand_name: "홍길동텔레콤",
      phone: "010-1111-2222",
      hours: "평일 09:00~19:00",
      company: "당일 개통 전문입니다.",
    }),
  );
  assert.equal(
    g.company,
    "홍길동텔레콤 — 전화 010-1111-2222, 영업시간 평일 09:00~19:00\n당일 개통 전문입니다.",
  );
});

test("회사 정보 — 판매점명만으론 회사 정보로 치지 않는다 (필수 미충족)", () => {
  const g = assembleGuide(raw({ brand_name: "홍길동텔레콤" }));
  assert.equal(g.company, "");
  assert.equal(missingRequiredGuideSections(g).includes("company"), true);
  // 전화번호 하나만 채워도 통과
  const g2 = assembleGuide(
    raw({ brand_name: "홍길동텔레콤", phone: "010-1111-2222" }),
  );
  assert.equal(missingRequiredGuideSections(g2).includes("company"), false);
});

test("필수 검증 — 카톡만 있어도 links 통과 / 셋 다 없으면 누락 보고", () => {
  const only = assembleGuide(
    raw({
      brand_name: "홍길동텔레콤",
      link_kakao: "https://pf.kakao.com/_x",
      phone: "010-1111-2222",
    }),
  );
  // 요금표 없이도 통과해야 한다 (공통 요금표 폴백)
  assert.deepEqual(missingRequiredGuideSections(only), []);

  const none = assembleGuide(raw({ brand_name: "홍길동텔레콤" }));
  assert.deepEqual(missingRequiredGuideSections(none).sort(), [
    "company",
    "links",
  ]);
});

test("하위호환 — 기존 links·company 자유형식만 있는 시트도 그대로 통과", () => {
  const legacy = assembleGuide(
    raw({
      brand_name: "구형텔레콤",
      links: "신청: https://old.example.com\n카톡: https://pf.kakao.com/_old",
      company: "구형텔레콤 — 연중무휴 상담",
    }),
  );
  assert.deepEqual(missingRequiredGuideSections(legacy), []);
  assert.equal(legacy.links.length, 2);
  assert.equal(legacy.links[0].label, "신청");
  assert.equal(legacy.company, "구형텔레콤 — 연중무휴 상담");
});

test("조립본이 프롬프트·히어로에 그대로 흘러간다 (폼 → 글 왕복)", () => {
  const g = assembleGuide(
    raw({
      brand_name: "홍길동텔레콤",
      link_site: "https://hong.example.com/apply",
      phone: "010-1111-2222",
      banned_words: "최저가, 업계1위",
    }),
  );
  const p = buildPrompt({
    keyword: "선불폰개통",
    category: "일반",
    subKeywords: [],
    persona: "일반",
    utmCampaign: "test",
    tenantBrand: g,
  });
  assert.equal(p.includes("홍길동텔레콤"), true);
  assert.equal(p.includes("https://hong.example.com/apply"), true);
  assert.equal(p.includes("010-1111-2222"), true);
  assert.equal(p.includes("최저가"), true);
  for (const marker of OWNER_MARKERS) {
    assert.equal(p.includes(marker), false, `오너 마커 "${marker}" 누출`);
  }
});

test("업무폰·법인폰류 키워드 — 세컨폰과 동일한 번호 규칙 블록 발동 (2026-07-28 회귀)", () => {
  // '업무폰개통'이 트리거 목록에 없어 블록이 빠졌고, 모델이 번호이동 Q&A를
  // 써서 3/3 폐기 → 하루 10편이 9편이 된 사고
  for (const kw of ["업무폰개통", "법인폰개통", "사업자폰", "회사폰추천"]) {
    const p = buildPrompt({
      keyword: kw,
      category: "일반",
      subKeywords: [],
      persona: "일반",
      utmCampaign: "test",
    });
    assert.equal(p.includes("번호 관련 서술 규칙"), true, `${kw}: 블록 누락`);
    assert.equal(
      p.includes("새 번호를 하나 더 받습니다"),
      true,
      `${kw}: 세컨폰 전용 규칙 누락`,
    );
    // 세컨폰류는 번호 Q&A를 유도하면 안 된다 — 유도 규칙이 오히려 3/3 폐기를
    // 불렀다 (2026-07-28). 대신 주제 자체를 금지하는 규칙이 들어가야 한다.
    assert.equal(p.includes("번호는 어떻게 되나요?"), false, `${kw}: 번호 Q&A 유도 규칙이 남아 있음`);
    assert.equal(p.includes("번호이동"), true, `${kw}: 번호이동 금지 규칙 누락`);
    assert.equal(
      p.includes("Q&A에 번호 관련 질문을 아예 만들지 마세요"),
      true,
      `${kw}: 번호 Q&A 금지 규칙 누락`,
    );
  }
});

test("번호이동 계열 키워드 — 계획 단계에서 차단 (2026-07-28 사업주 결정)", async () => {
  const { isMnpBlacklistedKeyword, isContentBlacklistedKeyword } =
    await import("../lib/sheets.ts");
  for (const kw of [
    "번호이동",
    "번호 이동",
    "선불폰번호이동",
    "번호유지개통",
    "번호그대로개통",
    "MNP선불폰",
  ]) {
    assert.equal(isMnpBlacklistedKeyword(kw), true, `${kw}: 차단 안 됨`);
    assert.equal(isContentBlacklistedKeyword(kw), true, `${kw}: 통합 차단 안 됨`);
  }
  // 오탐 경계 — '이동통신'·'이동'만으론 걸리면 안 된다
  for (const kw of ["이동통신사비교", "선불폰개통", "유심이동", "세컨폰개통"]) {
    assert.equal(isMnpBlacklistedKeyword(kw), false, `${kw}: 오탐`);
  }
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
