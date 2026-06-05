import { generateJSON } from "./gemini";
import { getGlobalContext, getCategoryContext } from "./knowledge";
import { sanitizeForTistory } from "./sanitize-html";
import {
  HOOK_PATTERNS,
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

export type GeneratedPost = {
  title: string;
  meta_description: string;
  content_html: string;
  char_count: number;
  seo_score: number;
  utm_campaign: string;
  sub_keywords_used?: string[];
  tags?: string[];
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
  /** 이번 글이 사용해야 할 후킹 패턴 (1~8) — round-robin 또는 least-used로 지정. */
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

  return `당신은 한국 SEO + 블로그 카피라이팅 전문가입니다. 다음 키워드로 티스토리 발행용 한국어 블로그 글 1편을 작성해주세요.

# 📚 회사 정보 (Knowledge Base — 반드시 이 정보만 사용, 추측/창작 금지)

${globalCtx}

# 📚 카테고리별 상세 정보

${catCtx}

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

이 패턴 외 다른 패턴은 사용 금지. 아래 8가지 패턴 설명에서 #${forcedPattern}번을 정확히 따르세요.

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

✅ **후킹 패턴 8가지 — 다양하게 회전시킬 것 (특정 패턴 쏠림 금지):**

1. **돈/절약 후크** — 통신비 절약 액수
   예) \`월 통신비 5만→1만, 3년 안 갈아탔으면 손해 보는 중\`
   예) \`알뜰폰 잘못 고르면 연 24만원 더, 진짜 싼 요금제 고르는 법\`

2. **신용/심사 후크** — 거절 경험자 타겟
   예) \`신용불량이라 통신사 다 거절? KT망 선불폰은 왜 그냥 통과될까\`
   예) \`타사 미납 있어도 개통되는 알뜰폰, 진짜 가능한 이유\`

3. **위험/주의 후크** — 잘못 가입하면 손해
   예) \`알뜰폰 가입 전 이거 모르면 위약금 폭탄, 절대 묻지 않는 함정\`
   예) \`유심 옮길 때 한 가지 빼먹으면 번호이동 막힙니다\`

4. **타겟 호명 후크** — 특정 상황/직업/지역
   예) \`외국인등록증으로 한국 폰 만들기, 체류 6개월 미만도 가능한 경로\`
   예) \`자영업자라면 폰 회선 5개까지 묶는 법 — 사업자 명의 활용\`
   예) \`미성년자도 부모 없이 가입되는 알뜰폰, 어떤 게 진짜인가\`

5. **숨겨진 정보/내부자 후크** — 직원도 모르는, 안 알려주는
   예) \`직권해지 5년 지난 사람도 통과되는 통신사, 어디까지 알아봤나\`
   예) \`매장에서 안 알려주는 KT망 vs LG망 차이, 속도 실측 결과\`

6. **질문형 후크** — 진짜 궁금증 자극 (구체적이어야 함)
   예) \`선불폰 eSIM, 본인인증 막혀도 우회되는 경로가 있을까?\`
   예) \`해외 체류 중 한국 번호 살려두는 가장 싼 방법은?\`

7. **비교/대조 후크** — 두 선택지 차이
   예) \`KT 바로유심 vs LG 모두의유심, 데이터 속도/가격/제한 비교\`
   예) \`선불 vs 후불 알뜰폰 — 진짜로 누가 더 싸고 안전한가\`

8. **수치/시간 후크** — 분/원/% 등 (단, 같은 표현 반복 X)
   예) \`KT망 선불 요금제 5종, 데이터 1GB당 단가 비교표\`
   예) \`알뜰폰 위약금 0원으로 끝내는 3가지 조건\`
   예) (시간 단위도 OK — 단 표현은 매번 다르게)
       \`매장 안 가고 집에서 30분 안에 끝낸 셀프 개통 후기\`
       \`충전 만료 임박? 7일 안에 다시 살리는 절차\`

✅ **길이 25-45자** (검색결과에 잘리지 않음, 모바일에서도 한눈에)
✅ **주 키워드는 제목 시작 부분**에 배치 (SEO)
✅ **강한 동사/형용사**: 끝낸다, 정리, 공개, 비법, 진짜, 의외의, 함정, 손해, 통과되는, 거절, 가능, 우회

✅ **개선 예시들 (지난 글들과 다른 각도로 다시 만들면):**
- "충주 선불폰, 신용조회 거치지 않고 당일 개통 가능한 진짜 이유"
- "선불폰 eSIM 본인인증 막혔다면, KT망에서 우회되는 경로 있을까"
- "미성년자 알뜰폰 — 부모 동의 없이도 통과되는 통신사, 어디까지 알아봤나"

# 출력 형식 (JSON만, 다른 설명/마크다운 코드펜스 X)

{
  "title": "{25~45자 — 위 후킹 규칙 따라. 브랜드 접미사 절대 X.}",
  "meta_description": "{100~160자 — 첫 50자 안에 주 키워드}",
  "content_html": "{HTML 본문 — 위 인라인 스타일 패턴을 그대로 따라 작성. <div class=\\"ntc-section\\"> 5~6개 (details/summary/section 사용 금지). 본문 2,500~3,500자.}",
  "char_count": {본문 글자 수 — 공백 제외, HTML 태그 제외},
  "seo_score": {자가 평가 60~100 — 키워드 밀도/구조/링크/Q&A/이미지 모두 충족시 90+},
  "sub_keywords_used": ["{본문에 녹여 쓴 서브 키워드 목록}"],
  "tags": ["{티스토리 발행용 태그 5~8개. 주 키워드 + 관련 검색 키워드 + 타겟·상황·브랜드. 한국어, 공백 X, 하이픈 또는 한 단어. 너무 길지 않게 (2~10자). 예: 선불폰, 비대면개통, KT바로유심, 신용불량OK, 5분개통, 미성년자, 외국인등록증}"]
}`;
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
  /** 이번 글 강제 후킹 패턴 (1~8). 미지정 시 recentTitles 분석으로 자동 결정. */
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

  // 최대 2회 시도 — 금지어 포함되면 1회 재시도
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
      bannedTitleWords,
      retryAttempt: attempt,
    });

    const r = await generateJSON<GeneratedPost>(prompt, {
      generationConfig: {
        temperature: 0.85,
        maxOutputTokens: 16384,
      },
    });

    const cleanTitle = stripBrandSuffix(r.title?.trim() || "");
    const hit = containsBannedWords(cleanTitle, bannedTitleWords);

    if (!hit) {
      result = r;
      break;
    }

    console.log(
      `[generate] 재시도 — 제목에 금지어 "${hit}" 포함: ${cleanTitle.slice(0, 60)}`,
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

  return {
    title:
      stripBrandSuffix(result.title?.trim() || "") ||
      `${opts.keyword} 가이드`,
    meta_description: result.meta_description?.trim() || "",
    content_html: safeHtml,
    char_count: charCount,
    seo_score: seoScore,
    utm_campaign: utmCampaign,
    sub_keywords_used: result.sub_keywords_used || [],
    tags: cleanTags.slice(0, 8),
  };
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
  const patternOffset = (new Date().getUTCHours() + new Date().getUTCDate()) % 8;

  for (let i = 0; i < inputs.length; i++) {
    const it = inputs[i];
    options.onProgress?.(i + 1, inputs.length, it.keyword);
    try {
      const recentTitles = [
        ...sessionTitles, // 이번 배치 생성분 (가장 회피 우선)
        ...(options.recentTitles ?? []), // 시트 과거분
      ].slice(0, 30);

      // round-robin 패턴 할당 (1~8)
      const forcedPattern = (((i + patternOffset) % 8) + 1) as HookPatternId;

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
