import { generateJSON } from "./gemini";
import {
  getGlobalContext,
  getCategoryContext,
  getFaqExcerpt,
} from "./knowledge";
import { sanitizeForTistory } from "./sanitize-html";
import {
  HOOK_PATTERNS,
  PATTERN_COUNT,
  MONEY_ALLOWED_PATTERNS,
  isMoneyHookTitle,
  titleMatchesKeyword,
  titleStartsWithKeyword,
  type HookPatternId,
  analyzeOverusedWords,
  pickLeastUsedPattern,
  containsBannedWords,
} from "./title-diversity";

export { sanitizeForTistory };

/**
 * Gemini로 SEO 최적화 + 시각적 레이아웃이 잡힌 한국어 블로그 글 생성.
 *
 * dajjis.tistory.com 참고 레이아웃 적용:
 *  - 상단 그라데이션 히어로 블록 (제목 + 도입부 + 4개 CTA 그리드)
 *  - 핵심 정보 박스 (흰 카드 + 강조 텍스트)
 *  - 📌 목차 박스 (2x3 anchor 그리드)
 *  - 각 H2가 <div class="ntc-section"> 블록 (그라데이션 헤더 + 본문 카드, 평탄 구조)
 *  - 빨간 세로선 부제목 (border-left), 체크리스트/단계 박스
 *  - Q&A 5개 (각 Q는 div + 라벨, 평탄 구조)
 *  - 친근한 존댓말 + 이모지 (📌 ✅ 💬 📱 🔍)
 *  - 본문 2,500~3,500자
 *  - 키워드 밀도 0.7~1.4%
 *  - 내부 링크 3~5개 (UTM 부착)
 */

export type ThumbnailMeta = {
  lines: string[]; // 썸네일 제목 3줄 (짧은 임팩트 카피)
  highlight: number[]; // 강조(테마색)할 줄 인덱스
  tags: string[]; // 태그 3개 (#포함)
  theme: "green" | "blue" | "orange" | "purple"; // 테마색 키
  character: string; // 캐릭터 감정 키 (thumbsup/worried/coin 등)
};

// 사용 가능한 캐릭터 감정 키 (scripts/assets/characters/ 와 동기화)
const CHARACTER_EMOTIONS = [
  "thumbsup", "surprised", "wink", "thinking", "pointing",
  "cheer", "heart", "worried", "ok", "callcenter",
  "checklist", "celebrate", "relieved", "coin", "stop",
] as const;

export type GeneratedPost = {
  title: string;
  meta_description: string;
  content_html: string;
  char_count: number;
  seo_score: number;
  utm_campaign: string;
  sub_keywords_used?: string[];
  tags?: string[];
  thumbnail?: ThumbnailMeta;
};

const PERSONAS: Record<string, string> = {
  IT: "30대 IT 직장인 톤. 합리적·데이터 기반이지만 친근한 존댓말 + 가벼운 이모지 1~2개. 짧고 정확.",
  자영업자:
    "40대 자영업자 톤. 실용적·결론부터. 짧은 문장, 격식 있는 존댓말. 경험 기반 설명.",
  대학생:
    "20대 대학생 톤. 캐주얼하지만 정중한 존댓말. 절약·가성비 키워드 강조. 이모지 활발.",
  일반: "친근한 존댓말 (~해요, ~끝나요, ~기억해 주세요). 평문, 짧은 문장, 모든 연령대 이해 가능.",
};

const SITE_URL = "https://ntelecomsafe.com";

function buildPrompt(opts: {
  keyword: string;
  category: string;
  subKeywords: string[];
  persona: string;
  utmCampaign: string;
  recentTitles?: string[];
  /** 이번 글이 사용해야 할 후킹 패턴 (1~20) — round-robin 또는 least-used로 지정. */
  forcedPattern?: HookPatternId;
  /** 제목에 절대 쓰면 안 되는 단어 (과사용된 단어 목록). */
  bannedTitleWords?: string[];
  /** 재시도 회차 (0=첫 시도, 1=재시도). 재시도 시 더 강한 압박 문구. */
  retryAttempt?: number;
}): string {
  const { keyword, category, subKeywords, persona, utmCampaign } = opts;
  const recentTitles = opts.recentTitles ?? [];
  const forcedPattern = opts.forcedPattern;
  const bannedTitleWords = opts.bannedTitleWords ?? [];
  const retryAttempt = opts.retryAttempt ?? 0;
  const personaDesc = PERSONAS[persona] || PERSONAS["일반"];
  const subList = subKeywords.length
    ? subKeywords.map((k, i) => `   ${i + 1}. ${k}`).join("\n")
    : "   (없음 — 본문에서 자연스러운 동의어 활용)";

  const globalCtx = getGlobalContext();
  const catCtx = getCategoryContext(category);
  const faqCtx = getFaqExcerpt({ category, keyword, subKeywords });

  return `당신은 한국 SEO + 블로그 카피라이팅 전문가입니다. 다음 키워드로 티스토리 발행용 한국어 블로그 글 1편을 작성해주세요.

# 📚 회사 정보 (Knowledge Base — 반드시 이 정보만 사용, 추측/창작 금지)

${globalCtx}

# 📚 카테고리별 상세 정보

${catCtx}

# ❓ 공식 FAQ (이 글 주제 관련 항목 발췌 — 더지통신 259문항 中. 사실 근거로만 사용, 운영 에러코드는 본문에 옮기지 말 것)

${faqCtx}

⚠️ **위 KB에 없는 가격·정책·FAQ는 절대 만들지 마세요.**
- 가격: 02-plans 표 그대로
- 정책 (약정, 위약금, 회선 한도, 미성년자 등): 04-faq / 06-cases 그대로
- 케이스별 가능 여부: 01-services / 06-cases 그대로
- 정보가 없으면 "자세한 내용은 [공식 사이트] 또는 [카톡 문의]에서 확인해 주세요" 식으로 우회

---

# 주 키워드 (글 제목과 H2에 자연스럽게 사용)
${keyword}

# 서브 키워드 (본문에 자연스럽게 녹임, 키워드 밀도 0.7~1.4%)
${subList}

# 카테고리
${category}

# 페르소나
${persona} — ${personaDesc}

# 우리 사이트 (전환 목적지)
${SITE_URL} — 앤텔레콤 안심개통, 선불폰/유심 비대면 셀프 개통 전문.
- 개통 신청: ${SITE_URL}/step2
- 카카오톡 문의: ${SITE_URL}/kakao
- 요금제 안내: ${SITE_URL}/plans
- 유심 가이드: ${SITE_URL}/usim-choice
UTM 캠페인: ${utmCampaign}

# 작성 규칙

## 분량
본문 텍스트 2,500~3,500자.

## 톤
${personaDesc}
- "~해요", "~끝나요", "~기억해 주세요" 같은 친근한 존댓말
- 짧은 문단 (3~5줄, 평균 12~18자 문장)
- 이모지 활용: 📌 ✅ 💬 📱 🔍 ⬅️ ⚠️ 핵심
- 핵심 메시지 1개를 글 안에서 3~5회 반복 강조 (예: "승인 후 충전요청까지 완료")

## 구조 (반드시 이 순서)
1) **히어로 박스** — 그라데이션 배경 + 제목 + 도입부 2문단 + CTA 2x2 그리드
2) **핵심 정보 박스** — 흰 카드 + "핵심" 라벨 + 한 줄 강조
3) **📌 목차 박스** — 2x3 anchor 그리드 (각 H2 섹션으로 이동)
4) **H2 섹션 5~6개** — 각 섹션은 \`<div class="ntc-section">\` 블록 (평탄 구조, 토글 X)
   - 권장 섹션: 도입부(왜 필요한가) / 준비물 / 개통절차 / 요금제 / 비용 / Q&A
5) **Q&A 섹션** — Q1~Q5 (각 Q는 div + 라벨)
6) **마무리 + 최종 CTA**

## 인라인 스타일 HTML — 평탄한 div 구조 (details/summary, section 모두 사용 금지)

⚠️ **각 H2 섹션은 \`<div class="ntc-section" id="section-N">\` + 헤더 div + 본문 div 구조로.**
- \`<details>\`/\`<summary>\`/\`<section>\` 같은 시멘틱/토글 컨테이너 사용 금지.
  티스토리 비주얼 에디터가 section/details를 "한 덩어리"로 인식해
  내부에 이미지 삽입을 막아버립니다. 일반 div가 가장 자유롭게 편집됩니다.
- 사용자가 티스토리 비주얼 에디터에서 본문 영역에 자유롭게 이미지/표/추가 콘텐츠를
  삽입할 수 있어야 함.
- 모든 콘텐츠는 default로 펼쳐진 상태 (토글 X).

⚠️ **섹션 제목 규칙:**
- 헤더 div는 라임 그라데이션 배경 + 18px 볼드.
- 제목은 30자 이내, 한 줄로 짧게. 형식: \`{번호}) {핵심 키워드 한 마디}\`
- ▼/▶ 같은 토글 마커 기호 절대 넣지 말 것 (토글 컨테이너 아님).
- 부제는 헤더 div 다음 div로 (같은 라임 그라데이션 배경, 작은 글씨, 부드러운 톤).

⚠️ **각 H2 섹션 본문 의무 — 카드뉴스 인포그래픽 위해 시각 요소 필수:**
모든 H2 섹션에 다음 **A 또는 B 중 1개 이상** 포함 (요금제 같은 평이한 \`<p>\` 목록만 있으면 X):
- **A) 체크리스트 박스** — \`<div style="background:#F4F9E0;..."><div>✅ 항목1<br/>✅ 항목2<br/>✅ 항목3</div></div>\` (3~4개)
- **B) 단계 박스** — \`<div style="background:#F2F4F6;..."><div><strong>1. 라벨</strong>...</div><div><strong>2. 라벨</strong>...</div>...</div>\` (3~5단계)

예: 요금제 섹션이면 → 평이한 \`<p>선불 396 (39,600원):...</p>\` 가 아니라
   \`✅ 선불 396 — 가성비형 (10.3GB + 무제한)\`
   \`✅ 선불 459 — 데이터 헤비 (20.3GB)\`
   \`✅ 선불 770 — 매일 2GB\`
형태의 체크리스트로. 카드뉴스에서 인포그래픽으로 추출됩니다.

⚠️ **마크다운 문법 절대 사용 금지 — HTML 태그만 사용:**
- 강조: \`**텍스트**\` ❌ → \`<strong>텍스트</strong>\` ✅
- 이탤릭: \`*텍스트*\` \`_텍스트_\` ❌ → \`<em>텍스트</em>\` ✅
- 헤딩: \`## 제목\` ❌ → \`<h2 style="...">제목</h2>\` ✅
- 리스트: \`- 항목\` \`* 항목\` ❌ → \`<ul>...<li>\` 또는 \`✅ 항목\` 텍스트
- 링크: \`[텍스트](url)\` ❌ → \`<a href="url">텍스트</a>\` ✅
- 코드: \`\` \`코드\` \`\` ❌ → \`<code>코드</code>\` ✅
티스토리는 마크다운 렌더링 X → \`**\` \`__\` 같은 기호가 raw로 노출됨.

각 블록은 아래 정확한 패턴으로 작성:

## 🎨 컬러 팔레트 (ntelecomsafe.com 사이트와 통일)
- 메인 라임 그린: #9DC91A (강조 배경, 라벨)
- 진한 라임: #7FA512 (히어로 배경, 호버)
- 가장 진한 라임: #5F7C0E (히어로 배경 끝, 링크 텍스트)
- 옅은 라임: #F4F9E0 (체크리스트 배경, 토글 헤더)
- 중간 라임: #EAF5BD (그라데이션)
- 노란 액센트: #FFE066 (히어로 강조 키워드, 라임 위 가독성)
- 다크 텍스트: #191F28 (흰 배경 위 본문)
- 흰색: #FFFFFF (라임/다크 배경 위 본문)
- 회색 배경: #F2F4F6 (단계 박스)

## 📝 가독성 우선 규칙
- 라임 배경(히어로) 위에는 무조건 **흰색 + 볼드(700~800)** 텍스트
- 강조 키워드는 노란 액센트 #FFE066 또는 **흰색 + 밑줄/박스 하이라이트**
- 히어로 본문은 2~3 문장으로 짧게 (긴 문장 가독성 떨어짐)
- 라인 높이 1.8~2.0 (여유 공간)

\`\`\`html
<!-- ① 히어로 박스 (옅은 라임 그라데이션 + 다크 텍스트, 토글 헤더 색상 통일) -->
<div style="background:linear-gradient(135deg,#F4F9E0 0%,#EAF5BD 100%);border-radius:24px;padding:48px 40px;margin-bottom:24px;border:1px solid #D4E89C;">
  <h2 style="font-size:30px;font-weight:900;margin:0 0 24px;color:#191F28;line-height:1.3;letter-spacing:-0.02em;">{글 메인 제목}</h2>
  <p style="font-size:17px;line-height:1.9;margin:0 0 16px;color:#191F28;font-weight:600;">{도입부 1문단 — 짧게 2~3문장. 주 키워드 첫 문장에 등장.}</p>
  <p style="font-size:16px;line-height:1.9;margin:0 0 32px;color:#4E5968;font-weight:500;">이 글은 <strong style="color:#5F7C0E;font-weight:800;background:#FFFFFF;padding:2px 8px;border-radius:6px;">{핵심 단어}</strong>를 빠르게 끝내는 흐름과 꼭 체크해야 할 <strong style="color:#5F7C0E;font-weight:800;background:#FFFFFF;padding:2px 8px;border-radius:6px;">완료 포인트</strong>를 한 번에 정리했어요.</p>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
    <a href="${SITE_URL}/step2?utm_source=tistory&utm_medium=blog&utm_campaign=${utmCampaign}" style="display:block;background:#FFFFFF;border-radius:12px;padding:18px;text-align:center;font-weight:800;color:#191F28;text-decoration:none;box-shadow:0 2px 8px rgba(0,0,0,0.06);">📱 개통 신청하기</a>
    <a href="${SITE_URL}/kakao?utm_source=tistory&utm_medium=blog&utm_campaign=${utmCampaign}" style="display:block;background:#FFFFFF;border-radius:12px;padding:18px;text-align:center;font-weight:800;color:#191F28;text-decoration:none;box-shadow:0 2px 8px rgba(0,0,0,0.06);">💬 카카오톡 문의</a>
    <a href="${SITE_URL}/plans?utm_source=tistory&utm_medium=blog&utm_campaign=${utmCampaign}" style="display:block;background:#FFFFFF;border-radius:12px;padding:18px;text-align:center;font-weight:800;color:#191F28;text-decoration:none;box-shadow:0 2px 8px rgba(0,0,0,0.06);">🔍 추가 정보 보기</a>
    <a href="${SITE_URL}/usim-choice?utm_source=tistory&utm_medium=blog&utm_campaign=${utmCampaign}" style="display:block;background:#FFFFFF;border-radius:12px;padding:18px;text-align:center;font-weight:800;color:#191F28;text-decoration:none;box-shadow:0 2px 8px rgba(0,0,0,0.06);">⬅️ 이전 글 보기</a>
  </div>
</div>

<!-- ② 핵심 정보 박스 (흰 카드 + 라임 라벨) -->
<div style="background:#FFFFFF;border-radius:16px;padding:24px 28px;margin-bottom:24px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
  <div style="display:flex;align-items:flex-start;gap:12px;">
    <span style="flex-shrink:0;display:inline-block;background:#9DC91A;color:#FFFFFF;font-weight:800;font-size:13px;padding:6px 12px;border-radius:20px;">핵심</span>
    <p style="margin:0;font-size:15px;line-height:1.7;color:#191F28;">{핵심 한 줄 — 주 키워드 포함, 숫자 1개}</p>
  </div>
  <p style="margin:12px 0 0 0;padding-left:0;font-size:14px;line-height:1.7;color:#4E5968;">{부연 1~2문장}</p>
</div>

<!-- ③ 목차 박스 (흰 배경 + 그레이 보더) -->
<div style="background:#FFFFFF;border:1px solid #E5E8EB;border-radius:16px;padding:20px 24px;margin-bottom:32px;">
  <div style="font-weight:800;font-size:15px;margin-bottom:16px;color:#191F28;">📌 목차 <span style="font-weight:500;font-size:12px;color:#8B95A1;">(클릭하면 해당 섹션으로 이동)</span></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
    <a href="#section-1" style="display:flex;justify-content:space-between;padding:12px 16px;border:1px solid #E5E8EB;border-radius:10px;text-decoration:none;background:#FFFFFF;"><span style="color:#191F28;font-weight:700;font-size:13px;">도입부(선택 이유)</span><span style="color:#5F7C0E;font-size:12px;text-decoration:underline;">왜 {키워드}인가</span></a>
    <a href="#section-2" style="display:flex;justify-content:space-between;padding:12px 16px;border:1px solid #E5E8EB;border-radius:10px;text-decoration:none;background:#FFFFFF;"><span style="color:#191F28;font-weight:700;font-size:13px;">준비물</span><span style="color:#5F7C0E;font-size:12px;text-decoration:underline;">필수 체크</span></a>
    <a href="#section-3" style="display:flex;justify-content:space-between;padding:12px 16px;border:1px solid #E5E8EB;border-radius:10px;text-decoration:none;background:#FFFFFF;"><span style="color:#191F28;font-weight:700;font-size:13px;">개통 절차</span><span style="color:#5F7C0E;font-size:12px;text-decoration:underline;">5분 흐름</span></a>
    <a href="#section-4" style="display:flex;justify-content:space-between;padding:12px 16px;border:1px solid #E5E8EB;border-radius:10px;text-decoration:none;background:#FFFFFF;"><span style="color:#191F28;font-weight:700;font-size:13px;">요금제</span><span style="color:#5F7C0E;font-size:12px;text-decoration:underline;">3가지 추천</span></a>
    <a href="#section-5" style="display:flex;justify-content:space-between;padding:12px 16px;border:1px solid #E5E8EB;border-radius:10px;text-decoration:none;background:#FFFFFF;"><span style="color:#191F28;font-weight:700;font-size:13px;">비용 정리</span><span style="color:#5F7C0E;font-size:12px;text-decoration:underline;">실제 드는 돈</span></a>
    <a href="#section-6" style="display:flex;justify-content:space-between;padding:12px 16px;border:1px solid #E5E8EB;border-radius:10px;text-decoration:none;background:#FFFFFF;"><span style="color:#191F28;font-weight:700;font-size:13px;">Q&amp;A</span><span style="color:#5F7C0E;font-size:12px;text-decoration:underline;">자주 묻는 질문</span></a>
  </div>
</div>

<!-- ④ 각 H2 섹션 (5~6개) — div + 헤더 div + 본문 div 평탄 구조 -->
<!-- ✅ details/summary/section 사용 금지. 사용자가 본문 영역에 이미지를 자유롭게 추가할 수 있어야 함. -->
<div class="ntc-section" id="section-1" style="background:#FFFFFF;border:1px solid #E5E8EB;border-radius:16px;margin-bottom:16px;overflow:hidden;">
  <div style="padding:20px 24px 6px;background:linear-gradient(135deg,#F4F9E0 0%,#EAF5BD 100%);font-size:18px;font-weight:800;color:#191F28;line-height:1.4;">1) {H2 제목 — 예: 준비물 - 유심부터 인증까지 한 번에}</div>
  <!-- 부제 띠 (헤더 그라데이션 연속) -->
  <div style="background:linear-gradient(135deg,#F4F9E0 0%,#EAF5BD 100%);padding:0 24px 14px;font-size:13px;color:#5F7C0E;font-weight:600;border-bottom:1px solid #D4E89C;">{한 줄 부제 — 예: 비대면 개통은 "준비물"에서 승부가 납니다}</div>
  <div style="padding:24px 28px;">
    <!-- 라임 세로선 부제목 (H3 대신) -->
    <div style="border-left:3px solid #9DC91A;padding-left:12px;font-weight:800;font-size:15px;margin-bottom:12px;color:#191F28;">{H3 부제목}</div>
    <p style="font-size:15px;line-height:1.8;margin:0 0 16px;color:#333D4B;">{본문 1~2문단}</p>

    <!-- 체크리스트 박스 (옅은 라임 배경) -->
    <div style="background:#F4F9E0;border-radius:12px;padding:16px 20px;margin:16px 0;">
      <div style="font-size:14px;line-height:2;color:#191F28;">
        ✅ {항목 1}<br/>
        ✅ {항목 2}<br/>
        ✅ {항목 3}
      </div>
    </div>

    <!-- 다음 H3 -->
    <div style="border-left:3px solid #9DC91A;padding-left:12px;font-weight:800;font-size:15px;margin:24px 0 12px;color:#191F28;">{다음 H3}</div>
    <p style="font-size:15px;line-height:1.8;margin:0;color:#333D4B;">{본문}</p>
  </div>
</div>

<!-- 다음 H2 섹션 — 동일한 section + 헤더 div + 본문 div 패턴 -->
<div class="ntc-section" id="section-3" style="background:#FFFFFF;border:1px solid #E5E8EB;border-radius:16px;margin-bottom:16px;overflow:hidden;">
  <div style="padding:20px 24px 6px;background:linear-gradient(135deg,#F4F9E0 0%,#EAF5BD 100%);font-size:18px;font-weight:800;color:#191F28;line-height:1.4;">3) 개통 절차 - 승인 후 충전하기가 진짜 끝!</div>
  <div style="background:linear-gradient(135deg,#F4F9E0 0%,#EAF5BD 100%);padding:0 24px 14px;font-size:13px;color:#5F7C0E;font-weight:600;border-bottom:1px solid #D4E89C;">{한 줄 부제 — 5분 흐름}</div>
  <div style="padding:24px 28px;">
    <div style="border-left:3px solid #9DC91A;padding-left:12px;font-weight:800;font-size:15px;margin-bottom:12px;color:#191F28;">비대면 개통 6단계(웹페이지 기준)</div>
    <p style="font-size:15px;line-height:1.8;margin:0 0 16px;color:#333D4B;">아래 순서대로만 하면 어렵지 않아요.</p>
    <!-- 단계 박스 (회색 라운드) -->
    <div style="background:#F2F4F6;border-radius:12px;padding:18px 22px;margin:16px 0;font-size:14px;line-height:2;color:#333D4B;">
      <div><strong>1. 접수페이지 접속</strong><br/>→ <a href="${SITE_URL}/step2?utm_source=tistory&utm_medium=blog&utm_campaign=${utmCampaign}" style="color:#5F7C0E;font-weight:700;">개통 신청 페이지 접속</a></div>
      <div style="margin-top:14px;"><strong>2. 본인인증 진행</strong><br/>→ 간편인증서로 본인 확인</div>
      <div style="margin-top:14px;"><strong>3. 유심번호 입력</strong><br/>→ KT 바로유심 / LG 모두의유심원칩 번호 정확히 입력</div>
      <div style="margin-top:14px;"><strong>4. 신분증 정보입력</strong><br/>→ 촬영/기재 단계에서 흔들리면 재요청될 수 있어요</div>
      <div style="margin-top:14px;"><strong>5. 요금제 선택</strong><br/>→ 사용 패턴에 맞춰 선택</div>
      <div style="margin-top:14px;color:#5F7C0E;"><strong>6. 승인 후 충전하기</strong></div>
    </div>
  </div>
</div>

<!-- ⑤ Q&A 섹션 — Q/A 모두 평탄 div (이전엔 details 내 details, 이젠 div + 라벨) -->
<div class="ntc-section" id="section-6" style="background:#FFFFFF;border:1px solid #E5E8EB;border-radius:16px;margin-bottom:16px;overflow:hidden;">
  <div style="padding:20px 24px 6px;background:linear-gradient(135deg,#F4F9E0 0%,#EAF5BD 100%);font-size:18px;font-weight:800;color:#191F28;line-height:1.4;">6) Q&amp;A - {키워드} 자주 묻는 질문</div>
  <div style="background:linear-gradient(135deg,#F4F9E0 0%,#EAF5BD 100%);padding:0 24px 14px;font-size:13px;color:#5F7C0E;font-weight:600;border-bottom:1px solid #D4E89C;">개통 과정에서 생기는 질문 5가지</div>
  <div style="padding:24px 28px;">
    <div style="margin-bottom:16px;border-bottom:1px solid #E5E8EB;padding-bottom:16px;">
      <div style="font-weight:700;font-size:15px;color:#191F28;">Q1. {질문}</div>
      <p style="margin:12px 0 0;font-size:14px;line-height:1.8;color:#4E5968;">{답변 2~3문장}</p>
    </div>
    <div style="margin-bottom:16px;border-bottom:1px solid #E5E8EB;padding-bottom:16px;">
      <div style="font-weight:700;font-size:15px;color:#191F28;">Q2. {질문}</div>
      <p style="margin:12px 0 0;font-size:14px;line-height:1.8;color:#4E5968;">{답변}</p>
    </div>
    <!-- ... Q3, Q4, Q5 동일 패턴 -->
  </div>
</div>

<!-- ⑥ 최종 CTA (흰 카드 + 라임 강조) -->
<div style="background:#FFFFFF;border:1px solid #E5E8EB;border-radius:16px;padding:24px 28px;margin-top:24px;">
  <p style="font-size:15px;line-height:1.8;margin:0 0 16px;color:#191F28;font-weight:700;">{핵심 메시지 한 번 더 — 예: 선불폰은 흐름만 알면 빠르게 끝나요. 특히 승인 후 충전요청까지 가야 진짜 완료라는 점, 꼭 기억해 주세요.}</p>
  <p style="font-size:14px;line-height:1.8;margin:0 0 12px;color:#4E5968;">지금 바로 진행하려면 아래 링크를 열어두고 시작하세요.</p>
  <p style="margin:0;line-height:2;">
    ✅ <a href="${SITE_URL}/step2?utm_source=tistory&utm_medium=blog&utm_campaign=${utmCampaign}" style="color:#5F7C0E;font-weight:700;">개통 신청 페이지 접속</a><br/>
    ✅ 궁금한 건 바로 카톡으로 → <a href="${SITE_URL}/kakao?utm_source=tistory&utm_medium=blog&utm_campaign=${utmCampaign}" style="color:#5F7C0E;font-weight:700;">앤텔레콤 안심개통</a>
  </p>
</div>
\`\`\`

## 외부 DoFollow 링크 (1~2개)
신뢰 사이트 중에서:
- 과학기술정보통신부 https://www.msit.go.kr
- 한국정보통신진흥협회 https://www.kait.or.kr
- KT 공식 https://www.kt.com
- LG U+ 공식 https://www.lguplus.com
모두 \`target="_blank" rel="noopener"\`

## 키워드 사용 규칙
- 주 키워드 "${keyword}"는 본문 전체에서 7~10회 (밀도 0.8~1.0%)
- 제목 첫 1~3단어에 주 키워드 (SEO 가중치)
- H2 중 2~3개에 주 키워드 포함
- 첫 문단 첫 문장에 주 키워드 1회 등장
- 서브 키워드는 본문에 자연스럽게 (강제 X)

## 📚 지난 25개 글 제목 (참고)

${
  recentTitles.length > 0
    ? recentTitles.map((t, i) => `${i + 1}. ${t}`).join("\n")
    : "(없음 — 첫 글)"
}

${
  bannedTitleWords.length > 0
    ? `## 🚫 이번 제목에서 절대 사용 금지인 단어 (지난 25개 글에서 과사용된 것들)

다음 단어들은 지난 글들에서 ${bannedTitleWords.length}회 이상 반복되어 검색 결과에서 우리 글들이 모두 똑같아 보입니다. **이번 제목에는 단 하나도 포함하면 안 됩니다:**

${bannedTitleWords.map((w) => `- ❌ \`${w}\``).join("\n")}

위 단어들 없이 같은 의도를 전달하세요. 동의어/돌려 말하기/완전 다른 후킹 사용.

`
    : ""
}${
    forcedPattern
      ? `## 🎯 이번 글 강제 후킹 패턴: **#${forcedPattern} - ${HOOK_PATTERNS.find((p) => p.id === forcedPattern)?.name}**

지난 글들 패턴 분포를 분석한 결과, 이번엔 패턴 #${forcedPattern}을 사용해야 합니다.
힌트: ${HOOK_PATTERNS.find((p) => p.id === forcedPattern)?.hint}

이 패턴 외 다른 패턴은 사용 금지. 아래 20가지 패턴 설명에서 #${forcedPattern}번을 정확히 따르세요.

${
  MONEY_ALLOWED_PATTERNS.includes(forcedPattern)
    ? `🚨 **돈/금액 후크 과사용 경고:** 최근 글의 절반 이상이 "월 통신비 8만→1만, 144만원" 같은 똑같은 금액 템플릿입니다. 이 패턴(#${forcedPattern})은 금액을 써도 되지만 **"144만원", "8만→1만", "무제한"이라는 표현·숫자는 절대 재사용 금지.** 완전히 다른 금액 표현/각도(예: 일 단위 비용, 커피 한 잔 값, 연간 환산, 특정 요금제 단가)로 신선하게.`
    : `🚨 **이번 패턴은 돈/금액 후크 금지:** 제목에 "통신비", "X만원", "X만→Y만", "144만원", "무제한", "절약", "아끼는", "얼마" 등 **금액·요금 절약 관련 표현을 절대 넣지 마세요.** 최근 글의 절반이 돈 얘기라 식상합니다. 이번엔 오직 #${forcedPattern} 각도(${HOOK_PATTERNS.find((p) => p.id === forcedPattern)?.name})로만, 돈과 무관한 후킹으로 작성하세요.`
}

`
      : ""
  }${
    retryAttempt > 0
      ? `## ⚠️ 재시도 (${retryAttempt}회차)

이전 시도에서 금지어 또는 클리셰가 포함되어 거절됐습니다. 위 금지어 목록을 다시 확인하고 **완전히 다른 표현**으로 다시 작성하세요.

`
      : ""
  }

## 🎯 제목(title) 규칙 — 클릭 유도 후킹 + SEO 균형

🚨🚨🚨 **제목은 반드시 주 키워드 "${keyword}"로 시작해야 합니다.** 🚨🚨🚨
- 제목 **맨 앞**(첫 단어)이 "${keyword}" 그대로 또는 공백 풀이형이어야 합니다.
- 키워드가 복합어(예: "알뜰폰선불폰무약정장점")면 띄어서 풀어 써도 OK ("알뜰폰 선불폰 무약정 장점")
- ✅ 예) 키워드 "편의점선불유심" → 제목 "편의점선불유심 이렇게 개통하면 5분이면 끝나요"
- ✅ 예) 키워드 "춘천선불폰" → 제목 "춘천 선불폰, 신용조회 없이 통과되는 방법"
- ❌ 예) 키워드 "춘천선불폰" → 제목 "신용불량도 OK, 춘천선불폰 통과되는 이유" (앞에 다른 단어)
- ❌ 예) 키워드 "선불폰" → 제목 "약정 없이 선불폰 사용법" (선불폰이 중간에 있음 — 금지)
- **검증:** 제목 첫 단어가 "${keyword}"인지 확인. 아니면 다시 쓰세요.

🚨 **제목 ↔ 본문 주제 일치 — 어기면 클릭 사기:**
- 제목의 주제·소재는 **본문 내용과 일치**해야 합니다.
- 제목에서 약속한 것(예: "신용불량도 OK")을 본문이 실제로 다루지 않으면 절대 안 됩니다.
- ❌ 나쁜 예: 키워드 "N텔레콤요금제" → 제목 "신용불량 OK? 3초 진단" (키워드 없음 + 본문은 요금제 얘기)
- ❌ 나쁜 예: 키워드 "알뜰폰선불폰무약정장점" → 제목 "신용불량자도 거절 없이? KT망은 왜 그냥 통과될까" (키워드 없음 + 다른 주제)
- ✅ 좋은 예: 키워드 "N텔레콤요금제" → "N텔레콤요금제, 나에게 맞는지 3초 진단"
- ✅ 좋은 예: 키워드 "알뜰폰선불폰무약정장점" → "알뜰폰 선불폰 무약정 장점 4가지, 가입 전 꼭 확인할 것"

🚫 **절대 금지 — 미성년자·외국인 관련 콘텐츠 (정책상 차단)**
- **미성년자**: 미성년자/청소년/어린이/학생/자녀/만 14·15·17·18·19세 등 미성년자 대상 또는 언급
- **외국인**: 외국인/외국인등록증/단기·장기 체류/유학생/이민자/이민/다문화/워홀/워킹홀리데이/영주권/거소증/재외국민 등
  외국인·재외동포 대상 또는 언급
- 제목·메타·본문·태그·예시 어디에도 등장시키지 말 것.
- "외국인등록증 개통", "유학생 유심", "자녀 폰", "학생 요금제" 같은 변형도 모두 금지.
- 위반 시 해당 글은 폐기 — 반드시 **내국인 성인 대상** 콘텐츠로만 작성.

🚨 **아래 패턴 예시는 "문체/구조" 참고용일 뿐 — 예시의 단어·소재(직원/신용불량 등)를 그대로 복사하지 마세요.** 반드시 이번 주 키워드("${keyword}")에 맞는 소재로 바꿔 쓰세요.

⚠️ **브랜드 접미사 절대 금지:**
- ❌ \`| 앤텔레콤 안심개통\` \`- 앤텔레콤 안심개통\` \`· 앤텔레콤 안심개통\` 같은 brand suffix
- ❌ 제목 안에 "앤텔레콤" "안심개통" 직접 노출 X (브랜드 호기심 X → 후킹 약함)
- 브랜드는 본문/CTA에서 충분히 노출되므로 제목엔 후킹만 집중

⚠️ **반복 클리셰 회피 — "5분/30분 시간 단축" 패턴 과사용 금지** ⚠️

지난 40개 글 중 30개가 "5분 비대면 개통", "30분 → 5분 단축" 패턴이라 검색 결과에서 우리 글이 모두 똑같이 보입니다. 이 후킹 자체가 나쁜 건 아니지만 **너무 자주 써서** 차별성이 사라졌어요.

규칙:
- 위 "지난 25개 글 제목" 목록을 보고, 거기 이미 많이 나온 패턴은 **이번엔 다른 각도로** 가세요
- 시간 단위 ("X분", "Y분 단축", "Z분 만에") 후킹은 8개 패턴 중 1개일 뿐 — 매번 이걸로 가지 마세요
- 같은 표현 ("5분 비대면 개통", "30분 → 5분", "5분 만에 끝", "노하우 공개", "비법 공개") 반복 자제
- ❌ \`OK!\` \`끝!\` 같은 평범한 결말 어미
- ❌ \`완벽 가이드\` \`총정리\` 같은 무의미한 SEO 단어

→ 핵심: **다양한 각도로 회전**. 시간 단축 후크가 좋은 경우엔 써도 OK, 하지만 같은 표현 반복은 X.

✅ **후킹 패턴 20가지 — 강제 할당된 패턴 #번호를 정확히 따를 것:**

1. **돈/절약** — 요금 절약 (※ "144만원", "8만→1만", "무제한" 표현은 식상하니 매번 다른 금액·각도로)
   예) \`커피 두 잔 값이면 한 달 데이터 다 쓰는 요금제\`
   예) \`알뜰폰 잘못 고르면 연 24만원 더 내는 함정\`

2. **신용/심사** — 거절 경험자 타겟
   예) \`신용불량이라 통신사 다 거절? KT망 선불폰은 왜 그냥 통과될까\`
   예) \`타사 미납 있어도 개통되는 알뜰폰, 진짜 가능한 이유\`

3. **위험/위약금** — 잘못 가입하면 손해 (5명 중 3명 당하는 함정 식)
   예) \`유심 옮기다 위약금 폭탄, 5명 중 3명이 놓치는 한 가지\`
   예) \`알뜰폰 가입 전 모르면 손해 보는 위약금 함정\`

4. **타겟 호명** — 특정 상황/직업/지역 (※ 미성년자·외국인 호명 금지)
   예) \`자영업자라면 폰 회선 5개까지 묶는 법 — 사업자 명의 활용\`
   예) \`프리랜서가 통신비 경비 처리하는 가장 깔끔한 방법\`
   예) \`택배·배달 일 시작하면 무조건 갈아타야 하는 요금제\`

5. **숨겨진 정보/내부자** — 직원도 모르는, 안 알려주는
   예) \`직권해지 5년 지난 사람도 통과되는 통신사, 어디까지 알아봤나\`
   예) \`매장에서 안 알려주는 KT망 vs LG망 속도 실측 차이\`

6. **질문형** — 진짜 궁금증 자극 (구체적, 모호한 질문 X)
   예) \`선불폰 eSIM 본인인증 막혀도 우회되는 경로가 있을까?\`
   예) \`해외 체류 중 한국 번호 살려두는 가장 싼 방법은?\`

7. **비교/대조** — A vs B 선택지 (시간 단위 비교 X)
   예) \`KT 바로유심 vs LG 모두의유심, 속도/가격/제한 비교\`
   예) \`선불 vs 후불 알뜰폰, 진짜로 누가 더 싸고 안전한가\`

8. **수치형** — N가지/N단계/N개 등 갯수
   예) \`KT망 선불 요금제 5종, 데이터 1GB당 단가 비교표\`
   예) \`알뜰폰 위약금 0원으로 끝내는 3가지 조건\`

9. **체크리스트** — 반드시 확인할 N가지, 체크포인트
   예) \`선불폰 가입 전 반드시 확인할 7가지 체크포인트\`
   예) \`알뜰폰 갈아타기 전 꼭 확인 — 잊으면 후회하는 5항목\`

10. **반전/통념 깨기** — 다들 X라는데 실제론 정반대
    예) \`다들 비대면이 빠르다는데, 실제론 매장이 더 빠른 케이스\`
    예) \`KT망이 다 비싸다고? 사실은 LG망보다 싼 요금제 정리\`

11. **개인 후기/실측** — 직접 해봤다, 경험자 톤
    예) \`통신사 5번 갈아탄 사람이 말하는 진짜 알뜰폰 가성비 순위\`
    예) \`KT vs LG 직접 한 달씩 써본 결과, 누가 더 안정적이었나\`

12. **시간/타이밍** — 지금 가입 손해, 다음 달 적기
    예) \`이번 달 가입하면 손해, 다음 달 기다려야 하는 진짜 이유\`
    예) \`알뜰폰 갈아타기 적기는 따로 있다 — 요금제 개편 직전\`

13. **무료/혜택** — 0원, 보너스, 쿠폰, 증정
    예) \`유심비 0원에 첫 충전 1만원 보너스, 진짜 혜택 정리\`
    예) \`알뜰폰 가입 시 받을 수 있는 숨은 혜택 4가지\`

14. **단계별 가이드** — 사진 N장, 차근차근, 순서대로
    예) \`복잡해 보이는 셀프 개통, 사진 11장으로 순서대로 정리\`
    예) \`처음 가입하는 사람용, 단계별로 따라하는 KT 바로유심\`

15. **트렌드/사회증명** — 요즘 N대가, N명이 선택
    예) \`요즘 20대가 다 갈아탄 알뜰폰 브랜드, 진짜 이유\`
    예) \`최근 6개월 가장 많이 가입한 요금제 TOP 3 분석\`

16. **자격/조건 진단** — 당신도 해당, 진단 N가지
    예) \`이 조건 하나라도 해당하면 알뜰폰이 답 — 진단 체크리스트\`
    예) \`신용·연체·미납 — 내가 개통 되는 케이스인지 3초 진단\`

17. **Before-After** — 바꾼 후 효과, N개월 후기 (※ "8만→1만", "144만원" 표현은 식상)
    예) \`매장만 다니던 내가 비대면으로 바꾼 뒤 생긴 변화\`
    예) \`갈아탄 뒤 한 달, 변한 것과 변하지 않은 것\`

18. **FOMO/마감** — 단종, 마지노선, 곧 종료
    예) \`이 요금제 단종 임박, 가입 마지노선은 이번 달 말까지\`
    예) \`KT 바로유심 프로모션 곧 종료 — 마지막 가입 타이밍\`

19. **부정 명령형** — 하지 마세요, 절대 ~ 마세요
    예) \`통신사 매장 가지 마세요 — 비대면이 진짜 답인 이유\`
    예) \`알뜰폰 가입 전 절대 클릭하지 마세요, 이 사이트만큼은\`

20. **극단/충격 단정** — 호구입니다, 폭리, 충격, 진실
    예) \`아직도 매장에서 개통? 호구 잡히는 줄도 모르는 사람들\`
    예) \`알고 보면 충격, 같은 KT망인데 이렇게까지 다릅니다\`

✅ **길이 25-45자** (검색결과에 잘리지 않음, 모바일에서도 한눈에)
✅ **주 키워드는 제목 시작 부분**에 배치 (SEO)
✅ **강한 동사/형용사**: 끝낸다, 정리, 공개, 비법, 진짜, 의외의, 함정, 손해, 통과되는, 거절, 가능, 우회

✅ **개선 예시들 (지난 글들과 다른 각도로 다시 만들면):**
- "충주 선불폰, 신용조회 거치지 않고 당일 개통 가능한 진짜 이유"
- "선불폰 eSIM 본인인증 막혔다면, KT망에서 우회되는 경로 있을까"
- "신용불량 5년차도 통과된 알뜰폰, 진짜로 가능한 통신사 정리"

# 출력 형식 (JSON만, 다른 설명/마크다운 코드펜스 X)

{
  "title": "{25~45자 — 위 후킹 규칙 따라. 브랜드 접미사 절대 X.}",
  "meta_description": "{100~160자 — 첫 50자 안에 주 키워드}",
  "content_html": "{HTML 본문 — 위 인라인 스타일 패턴을 그대로 따라 작성. <div class=\\"ntc-section\\"> 5~6개 (details/summary/section 사용 금지). 본문 2,500~3,500자.}",
  "char_count": {본문 글자 수 — 공백 제외, HTML 태그 제외},
  "seo_score": {자가 평가 60~100 — 키워드 밀도/구조/링크/Q&A/이미지 모두 충족시 90+},
  "sub_keywords_used": ["{본문에 녹여 쓴 서브 키워드 목록}"],
  "tags": ["{티스토리 발행용 태그 5~8개. 주 키워드 + 관련 검색 키워드 + 타겟·상황·브랜드. 한국어, 공백 X, 하이픈 또는 한 단어. 너무 길지 않게 (2~10자). 미성년자/외국인 관련 태그 금지. 예: 선불폰, 비대면개통, KT바로유심, 신용불량OK, 5분개통, 무약정}"],
  "thumbnail": {
    "lines": ["{썸네일 카피 1줄째}", "{2줄째}", "{3줄째}"],
    "highlight": [0, 2],
    "tags": ["#{짧은태그1}", "#{태그2}", "#{태그3}"],
    "theme": "{green|blue|orange|purple}",
    "character": "{글 분위기에 맞는 캐릭터 감정 1개}"
  }
}

# 🖼️ thumbnail 작성 규칙 (카드뉴스 썸네일용 — 매우 중요)
- **lines**: 긴 제목이 아니라 **짧고 강한 카피 3줄**. 각 줄 4~9자. 위→아래로 읽으면 한 문장처럼 이어지게.
  · 좋은 예: ["미납 정지폰도", "본인 명의 그대로", "5분 비대면 개통!"] / ["신용불량도", "거절 없이", "당일 개통!"]
  · 나쁜 예: 제목을 그대로 복붙하거나 한 줄이 12자 넘는 것.
- **highlight**: lines 중 테마색으로 강조할 줄 인덱스 (보통 [0, 2] — 첫·마지막 줄. 핵심 메시지 줄을 강조).
- **tags**: 짧은 해시태그 3개 (#포함, 각 3~6자). 글 주제 핵심. 미성년자/외국인 금지.
- **theme**: 글 분위기에 맞는 색 1개.
  · green = 안심·해결·기본 (미납/정지/직권해지 해결) / blue = 신뢰·자격 (신용·본인인증)
  · orange = 혜택·이득 (가성비/절약/요금제) / purple = 프리미엄·특별
- **character**: 강아지 마스코트 표정 1개. 글 분위기에 맞게 선택:
  · thumbsup=자신감·가능 / cheer=응원·축하 / heart=감사 / ok=안심
  · worried=걱정·페인포인트 / surprised=놀람·반전 / thinking=고민·질문
  · pointing=안내·설명 / callcenter=상담·문의 / checklist=절차·체크
  · celebrate=완료·성공 / relieved=해결·안도 / coin=혜택·절약·요금 / stop=주의·경고 / wink=꿀팁·친근
`;
}

/**
 * 히어로 박스(상단 표지) 일관성 보장.
 * Gemini가 가끔 히어로 박스 없이 본문 섹션부터 시작 → 없으면 코드가 자동 prepend.
 * 이미 라임 그라데이션 히어로로 시작하면 그대로 둠.
 */
function ensureHeroBox(
  html: string,
  title: string,
  keyword: string,
  utmCampaign: string,
): string {
  const head = html.slice(0, 700);
  // 이미 히어로 박스(라임 그라데이션 F4F9E0)로 시작하면 그대로
  if (/linear-gradient[^;"']*F4F9E0/i.test(head)) return html;
  return buildHeroBox(title, keyword, utmCampaign) + "\n" + html;
}

/** 히어로 박스 HTML 생성 (프롬프트 ① 템플릿과 동일 구조). */
function buildHeroBox(
  title: string,
  keyword: string,
  utmCampaign: string,
): string {
  const utm = `utm_source=tistory&utm_medium=blog&utm_campaign=${utmCampaign}`;
  const btn =
    "display:block;background:#FFFFFF;border-radius:12px;padding:18px;text-align:center;font-weight:800;color:#191F28;text-decoration:none;box-shadow:0 2px 8px rgba(0,0,0,0.06);";
  const hl =
    "color:#5F7C0E;font-weight:800;background:#FFFFFF;padding:2px 8px;border-radius:6px;";
  return `<div style="background:linear-gradient(135deg,#F4F9E0 0%,#EAF5BD 100%);border-radius:24px;padding:48px 40px;margin-bottom:24px;border:1px solid #D4E89C;">
  <h2 style="font-size:30px;font-weight:900;margin:0 0 24px;color:#191F28;line-height:1.3;letter-spacing:-0.02em;">${title}</h2>
  <p style="font-size:17px;line-height:1.9;margin:0 0 16px;color:#191F28;font-weight:600;">${keyword} 때문에 막막하셨나요? 앤텔레콤 안심개통 케어통신이 복잡한 절차 없이 해결해 드립니다.</p>
  <p style="font-size:16px;line-height:1.9;margin:0 0 32px;color:#4E5968;font-weight:500;">이 글은 <strong style="${hl}">${keyword}</strong>를 빠르게 끝내는 흐름과 꼭 체크해야 할 <strong style="${hl}">완료 포인트</strong>를 한 번에 정리했어요.</p>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
    <a href="${SITE_URL}/step2?${utm}" style="${btn}">📱 개통 신청하기</a>
    <a href="${SITE_URL}/kakao?${utm}" style="${btn}">💬 카카오톡 문의</a>
    <a href="${SITE_URL}/plans?${utm}" style="${btn}">🔍 추가 정보 보기</a>
    <a href="${SITE_URL}/usim-choice?${utm}" style="${btn}">⬅️ 이전 글 보기</a>
  </div>
</div>`;
}

/** 글자수 계산용 — HTML 태그 제거. */
function htmlTextLength(html: string): number {
  if (!html) return 0;
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, "")
    .length;
}

/**
 * 제목 후처리 — 브랜드 접미사 자동 제거.
 * Gemini가 prompt 규칙 어겨도 "| 앤텔레콤..." 같은 suffix 강제 제거.
 *
 * 변환 규칙:
 *  - 끝의 \` | 앤텔레콤 안심개통\` \`- 앤텔레콤 안심개통\` \`· 앤텔레콤 안심개통\` 모두 제거
 *  - 끝의 \` | 앤텔레콤 케어통신\` \`| 케어통신\` 같은 변형도 제거
 *  - 제목 마지막 공백/구두점 정리
 */
function stripBrandSuffix(title: string): string {
  if (!title) return title;
  let t = title.trim();

  // 끝의 \s*[구분자]\s*앤텔레콤... 패턴 제거 (반복 적용 — 중첩 가능)
  for (let i = 0; i < 3; i++) {
    const before = t;
    // | / - / · / · / – / — 등 구분자 + 앤텔레콤... 끝
    t = t.replace(
      /\s*[|·•・/\-–—]\s*(?:앤텔레콤(?:\s*안심개통)?(?:\s*케어(?:통신)?)?|안심개통(?:\s*케어(?:통신)?)?|케어통신)\s*$/i,
      "",
    );
    // 그냥 끝에 \s+앤텔레콤... 있는 경우 (구분자 없이)
    t = t.replace(
      /\s+(?:앤텔레콤(?:\s*안심개통)?(?:\s*케어(?:통신)?)?|안심개통(?:\s*케어(?:통신)?)?|케어통신)\s*$/i,
      "",
    );
    if (t === before) break;
  }

  // 끝의 잡 구분자/공백 정리
  t = t.replace(/[\s|·•・/\-–—]+$/, "").trim();

  return t || title; // 비어버리면 원본 반환 (안전)
}

// sanitizeForTistory: lib/sanitize-html.ts 로 이동 (client/server 양쪽 사용 가능하도록).
// post-generator는 그것을 re-export만 함 (위 import + export 참고).

export async function generatePost(opts: {
  keyword: string;
  category?: string;
  subKeywords?: string[];
  persona?: string;
  /** 최근 글 제목 (클리셰 회피용 — Gemini 프롬프트에 주입). */
  recentTitles?: string[];
  /** 이번 글 강제 후킹 패턴 (1~20). 미지정 시 recentTitles 분석으로 자동 결정. */
  forcedPattern?: HookPatternId;
}): Promise<GeneratedPost> {
  const category = opts.category || "일반";
  const subKeywords = opts.subKeywords?.slice(0, 5) || [];
  const persona = opts.persona || "일반";
  const utmCampaign = opts.keyword
    .replace(/[\s\W]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  const recentTitles = opts.recentTitles ?? [];

  // 과사용 단어 분석 → 이번 제목에서 금지
  const overused = analyzeOverusedWords(recentTitles, opts.keyword, 3, 8);
  const bannedTitleWords = overused.map((o) => o.word);

  // 패턴 결정 — 명시 안 했으면 가장 안 쓴 패턴 자동 선택
  const forcedPattern =
    opts.forcedPattern ??
    (recentTitles.length > 0 ? pickLeastUsedPattern(recentTitles) : undefined);

  // 이번 패턴이 돈/금액 후크 허용 패턴인지
  const moneyAllowed =
    forcedPattern == null || MONEY_ALLOWED_PATTERNS.includes(forcedPattern);

  // 돈-허용 패턴이면 금지어에서 '돈 관련 단어'는 빼준다
  // (안 그러면 #1/#13/#17이 정당한 금액 후크를 못 써서 무한 재시도)
  const effectiveBanned = moneyAllowed
    ? bannedTitleWords.filter((w) => !isMoneyHookTitle(w))
    : bannedTitleWords;

  // 최대 2회 시도 — 금지어/금액후크 위반 시 재시도.
  // ⚠️ Vercel Hobby 60초 한도: 1회 생성이 ~25-50초라 3회는 504 타임아웃 유발.
  //    → 2회로 제한 + 시간예산 가드(첫 시도가 오래 걸렸으면 재시도 생략).
  const startedAt = Date.now();
  const RETRY_TIME_BUDGET_MS = 25_000; // 이 시간 넘게 썼으면 재시도 안 함
  let result: GeneratedPost | undefined;
  let attempt = 0;
  const maxAttempts = 2;

  while (attempt < maxAttempts) {
    const prompt = buildPrompt({
      keyword: opts.keyword,
      category,
      subKeywords,
      persona,
      utmCampaign,
      recentTitles,
      forcedPattern,
      bannedTitleWords: effectiveBanned,
      retryAttempt: attempt,
    });

    const r = await generateJSON<GeneratedPost>(prompt, {
      generationConfig: {
        temperature: 0.85,
        maxOutputTokens: 16384,
      },
    });

    const cleanTitle = stripBrandSuffix(r.title?.trim() || "");
    const bannedHit = containsBannedWords(cleanTitle, effectiveBanned);
    // 돈 안 되는 패턴인데 금액 후크 썼으면 위반
    const moneyViolation = !moneyAllowed && isMoneyHookTitle(cleanTitle);
    // 제목이 키워드와 매칭 안 되면 위반 (클릭 사기 방지)
    const keywordMismatch = !titleMatchesKeyword(cleanTitle, opts.keyword);
    // 키워드가 제목 맨 앞에 없으면 위반 (SEO + 가독성)
    const keywordNotFirst =
      !keywordMismatch && !titleStartsWithKeyword(cleanTitle, opts.keyword);
    const violation =
      bannedHit ||
      (moneyViolation ? "금액/통신비 후크" : null) ||
      (keywordMismatch
        ? `제목-키워드 불일치(키워드 "${opts.keyword}" 없음)`
        : null) ||
      (keywordNotFirst
        ? `키워드 "${opts.keyword}"가 제목 맨 앞에 없음`
        : null);

    if (!violation) {
      result = r;
      break;
    }

    // 시간 예산 초과 시 재시도 포기 (타임아웃 방지) — 위반이어도 채택
    if (Date.now() - startedAt > RETRY_TIME_BUDGET_MS) {
      console.log(
        `[generate] 시간예산 초과 — 위반 "${violation}" 있지만 채택: ${cleanTitle.slice(0, 60)}`,
      );
      result = r;
      break;
    }

    console.log(
      `[generate] 재시도(${attempt + 1}/${maxAttempts}) — 위반 "${violation}": ${cleanTitle.slice(0, 60)}`,
    );
    attempt++;
    if (attempt >= maxAttempts) {
      // 최대 시도 후에도 실패하면 그대로 채택 (블로킹 X)
      result = r;
      break;
    }
  }

  if (!result) {
    throw new Error("제목 생성 실패 (재시도 후에도 결과 없음)");
  }

  // 티스토리 sanitizer 안전 후처리 — summary 안 div를 span으로, 마커 제거, open 첫개만
  const safeHtml = sanitizeForTistory(result.content_html || "");

  const charCount =
    typeof result.char_count === "number" && result.char_count > 0
      ? result.char_count
      : htmlTextLength(safeHtml);
  const seoScore =
    typeof result.seo_score === "number"
      ? Math.max(0, Math.min(100, result.seo_score))
      : 75;

  // 태그 정리 — 공백 제거, 중복 제거, 길이 제한
  const rawTags = Array.isArray(result.tags) ? result.tags : [];
  const cleanTags = Array.from(
    new Set(
      rawTags
        .map((t) =>
          typeof t === "string"
            ? t.trim().replace(/[#,\s]+/g, "").slice(0, 20)
            : "",
        )
        .filter((t) => t.length >= 2 && t.length <= 20),
    ),
  ).slice(0, 8);

  // 메인 키워드를 첫 태그로 보장 (없으면 추가)
  const mainTagNormalized = opts.keyword.replace(/\s+/g, "");
  if (!cleanTags.some((t) => t === mainTagNormalized)) {
    cleanTags.unshift(mainTagNormalized);
  }

  const finalTitle =
    stripBrandSuffix(result.title?.trim() || "") || `${opts.keyword} 가이드`;
  // 히어로 박스(상단 표지) 일관성 — Gemini가 빠뜨리면 자동 추가
  const htmlWithHero = ensureHeroBox(
    safeHtml,
    finalTitle,
    opts.keyword,
    utmCampaign,
  );

  return {
    title: finalTitle,
    meta_description: result.meta_description?.trim() || "",
    content_html: htmlWithHero,
    char_count: charCount,
    seo_score: seoScore,
    utm_campaign: utmCampaign,
    sub_keywords_used: result.sub_keywords_used || [],
    tags: cleanTags.slice(0, 8),
    thumbnail: normalizeThumbnail(result.thumbnail, opts.keyword),
  };
}

/** Gemini의 thumbnail 메타 정규화 — 누락/형식 오류 시 키워드 기반 fallback. */
function normalizeThumbnail(
  raw: unknown,
  keyword: string,
): ThumbnailMeta {
  const themes = ["green", "blue", "orange", "purple"] as const;
  const r = (raw || {}) as Partial<ThumbnailMeta>;
  let lines = Array.isArray(r.lines)
    ? r.lines.map((s) => String(s).trim()).filter(Boolean).slice(0, 3)
    : [];
  if (lines.length < 3) {
    // fallback — 키워드로 간단 구성
    lines = [keyword.slice(0, 10), "지금 바로", "개통 가능!"];
  }
  let tags = Array.isArray(r.tags)
    ? r.tags
        .map((s) => {
          const t = String(s).trim();
          return t.startsWith("#") ? t : `#${t}`;
        })
        .filter((t) => t.length > 1)
        .slice(0, 3)
    : [];
  if (tags.length === 0) tags = [`#${keyword.replace(/\s+/g, "")}`];
  const highlight = Array.isArray(r.highlight)
    ? r.highlight.filter((n) => typeof n === "number" && n >= 0 && n < 3)
    : [0, 2];
  const theme = themes.includes(r.theme as (typeof themes)[number])
    ? (r.theme as ThumbnailMeta["theme"])
    : "green";
  const character = CHARACTER_EMOTIONS.includes(
    r.character as (typeof CHARACTER_EMOTIONS)[number],
  )
    ? (r.character as string)
    : "thumbsup";
  return { lines, highlight, tags, theme, character };
}

export async function generatePosts(
  inputs: Array<{
    keyword: string;
    category?: string;
    subKeywords?: string[];
    persona?: string;
  }>,
  options: {
    onProgress?: (i: number, total: number, keyword: string) => void;
    /** 시트에서 미리 읽은 최근 글 제목 — 클리셰 회피. */
    recentTitles?: string[];
  } = {},
): Promise<
  Array<
    | { ok: true; keyword: string; post: GeneratedPost }
    | { ok: false; keyword: string; error: string }
  >
> {
  const results: Array<
    | { ok: true; keyword: string; post: GeneratedPost }
    | { ok: false; keyword: string; error: string }
  > = [];

  // 이번 배치에서 이미 생성된 제목을 누적 → 다음 글에 전달 (배치 내 자기복제 방지)
  const sessionTitles: string[] = [];

  // 패턴 round-robin 시작점을 매번 다르게 (시드처럼)
  // — 같은 시점에 여러 배치 돌아도 골고루 분포되도록 시간 기반 오프셋
  const patternOffset =
    (new Date().getUTCHours() + new Date().getUTCDate()) % PATTERN_COUNT;

  for (let i = 0; i < inputs.length; i++) {
    const it = inputs[i];
    options.onProgress?.(i + 1, inputs.length, it.keyword);
    try {
      const recentTitles = [
        ...sessionTitles, // 이번 배치 생성분 (가장 회피 우선)
        ...(options.recentTitles ?? []), // 시트 과거분
      ].slice(0, 30);

      // round-robin 패턴 할당 (1~20)
      const forcedPattern = (((i + patternOffset) % PATTERN_COUNT) + 1) as HookPatternId;

      const post = await generatePost({ ...it, recentTitles, forcedPattern });
      sessionTitles.unshift(post.title); // 최신부터 prepend
      results.push({ ok: true, keyword: it.keyword, post });
    } catch (err) {
      results.push({
        ok: false,
        keyword: it.keyword,
        error: (err as Error).message,
      });
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return results;
}
