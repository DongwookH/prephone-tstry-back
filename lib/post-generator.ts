import { generateJSON } from "./gemini";

/**
 * Gemini로 SEO 최적화 + 시각적 레이아웃이 잡힌 한국어 블로그 글 생성.
 *
 * dajjis.tistory.com 참고 레이아웃 적용:
 *  - 상단 그라데이션 히어로 블록 (제목 + 도입부 + 4개 CTA 그리드)
 *  - 핵심 정보 박스 (흰 카드 + 강조 텍스트)
 *  - 📌 목차 박스 (2x3 anchor 그리드)
 *  - 각 H2가 <details> 토글 블록 (그라데이션 헤더 + 본문 카드)
 *  - 빨간 세로선 부제목 (border-left), 체크리스트/단계 박스
 *  - Q&A 5개 (각 Q를 <details>로)
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
}): string {
  const { keyword, category, subKeywords, persona, utmCampaign } = opts;
  const personaDesc = PERSONAS[persona] || PERSONAS["일반"];
  const subList = subKeywords.length
    ? subKeywords.map((k, i) => `   ${i + 1}. ${k}`).join("\n")
    : "   (없음 — 본문에서 자연스러운 동의어 활용)";

  return `당신은 한국 SEO + 블로그 카피라이팅 전문가입니다. 다음 키워드로 티스토리 발행용 한국어 블로그 글 1편을 작성해주세요.

# 주 키워드 (글 제목과 H2에 자연스럽게 사용)
${keyword}

# 서브 키워드 (본문에 자연스럽게 녹임, 키워드 밀도 0.7~1.4%)
${subList}

# 카테고리
${category}

# 페르소나
${persona} — ${personaDesc}

# 우리 사이트 (전환 목적지)
${SITE_URL} — 앤텔레콤 안심개통, 선불폰/유심 비대면 셀프개통 5분 완료.
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
4) **H2 섹션 5~6개** — 각 섹션은 <details> 토글 블록
   - 권장 섹션: 도입부(왜 필요한가) / 준비물 / 개통절차 / 요금제 / 비용 / Q&A
5) **Q&A 섹션** — Q1~Q5 (각 Q는 <details>)
6) **마무리 + 최종 CTA**

## 인라인 스타일 HTML (티스토리는 JS 안 되므로 details/summary 활용)

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

<!-- ④ 각 H2 섹션 (5~6개) — 토글 details, 옅은 라임 헤더 -->
<details id="section-1" open style="background:#FFFFFF;border:1px solid #E5E8EB;border-radius:16px;margin-bottom:16px;overflow:hidden;">
  <summary style="cursor:pointer;list-style:none;padding:20px 24px;background:linear-gradient(135deg,#F4F9E0 0%,#EAF5BD 100%);display:flex;justify-content:space-between;align-items:center;">
    <div>
      <div style="font-size:18px;font-weight:800;color:#191F28;">1) {H2 제목 — 예: 준비물 - 유심부터 인증까지 한 번에}</div>
      <div style="font-size:13px;color:#5F7C0E;margin-top:4px;font-weight:600;">{한 줄 부제 — 예: 비대면 개통은 "준비물"에서 승부가 납니다}</div>
    </div>
    <span style="color:#5F7C0E;font-size:24px;font-weight:300;">−</span>
  </summary>
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
</details>

<details id="section-3" open style="background:#FFFFFF;border:1px solid #E5E8EB;border-radius:16px;margin-bottom:16px;overflow:hidden;">
  <summary style="cursor:pointer;list-style:none;padding:20px 24px;background:linear-gradient(135deg,#F4F9E0 0%,#EAF5BD 100%);display:flex;justify-content:space-between;align-items:center;">
    <div>
      <div style="font-size:18px;font-weight:800;color:#191F28;">3) 개통 절차 - 승인 후 충전하기가 진짜 끝!</div>
      <div style="font-size:13px;color:#5F7C0E;margin-top:4px;font-weight:600;">{한 줄 부제 — 5분 흐름}</div>
    </div>
    <span style="color:#5F7C0E;font-size:24px;font-weight:300;">−</span>
  </summary>
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
</details>

<!-- ⑤ Q&A 섹션 — 각 Q를 details로, 옅은 라임 헤더 -->
<details id="section-6" open style="background:#FFFFFF;border:1px solid #E5E8EB;border-radius:16px;margin-bottom:16px;overflow:hidden;">
  <summary style="cursor:pointer;list-style:none;padding:20px 24px;background:linear-gradient(135deg,#F4F9E0 0%,#EAF5BD 100%);display:flex;justify-content:space-between;align-items:center;">
    <div>
      <div style="font-size:18px;font-weight:800;color:#191F28;">6) Q&amp;A - {키워드} 자주 묻는 질문</div>
      <div style="font-size:13px;color:#5F7C0E;margin-top:4px;font-weight:600;">개통 과정에서 생기는 질문 5가지</div>
    </div>
    <span style="color:#5F7C0E;font-size:24px;font-weight:300;">−</span>
  </summary>
  <div style="padding:24px 28px;">
    <details style="margin-bottom:16px;border-bottom:1px solid #E5E8EB;padding-bottom:16px;">
      <summary style="cursor:pointer;font-weight:700;font-size:15px;color:#191F28;">Q1. {질문}</summary>
      <p style="margin:12px 0 0;font-size:14px;line-height:1.8;color:#4E5968;">{답변 2~3문장}</p>
    </details>
    <details style="margin-bottom:16px;border-bottom:1px solid #E5E8EB;padding-bottom:16px;">
      <summary style="cursor:pointer;font-weight:700;font-size:15px;color:#191F28;">Q2. {질문}</summary>
      <p style="margin:12px 0 0;font-size:14px;line-height:1.8;color:#4E5968;">{답변}</p>
    </details>
    <!-- ... Q3, Q4, Q5 동일 패턴 -->
  </div>
</details>

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
- 제목 첫 1~3단어에 주 키워드
- H2 중 2~3개에 주 키워드 포함
- 첫 문단 첫 문장에 주 키워드 1회 등장
- 서브 키워드는 본문에 자연스럽게 (강제 X)

# 출력 형식 (JSON만, 다른 설명/마크다운 코드펜스 X)

{
  "title": "{50~60자 — 주 키워드 + 숫자 + | 앤텔레콤 안심개통}",
  "meta_description": "{100~160자 — 첫 50자 안에 주 키워드}",
  "content_html": "{HTML 본문 — 위 인라인 스타일 패턴을 그대로 따라 작성. <details> 5~6개. 본문 2,500~3,500자.}",
  "char_count": {본문 글자 수 — 공백 제외, HTML 태그 제외},
  "seo_score": {자가 평가 60~100 — 키워드 밀도/구조/링크/Q&A/이미지 모두 충족시 90+},
  "sub_keywords_used": ["{본문에 녹여 쓴 서브 키워드 목록}"]
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

export async function generatePost(opts: {
  keyword: string;
  category?: string;
  subKeywords?: string[];
  persona?: string;
}): Promise<GeneratedPost> {
  const category = opts.category || "일반";
  const subKeywords = opts.subKeywords?.slice(0, 5) || [];
  const persona = opts.persona || "일반";
  const utmCampaign = opts.keyword
    .replace(/[\s\W]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

  const prompt = buildPrompt({
    keyword: opts.keyword,
    category,
    subKeywords,
    persona,
    utmCampaign,
  });

  const result = await generateJSON<GeneratedPost>(prompt, {
    generationConfig: {
      temperature: 0.85,
      maxOutputTokens: 16384,
    },
  });

  const charCount =
    typeof result.char_count === "number" && result.char_count > 0
      ? result.char_count
      : htmlTextLength(result.content_html || "");
  const seoScore =
    typeof result.seo_score === "number"
      ? Math.max(0, Math.min(100, result.seo_score))
      : 75;

  return {
    title: result.title?.trim() || `${opts.keyword} 가이드`,
    meta_description: result.meta_description?.trim() || "",
    content_html: result.content_html || "",
    char_count: charCount,
    seo_score: seoScore,
    utm_campaign: utmCampaign,
    sub_keywords_used: result.sub_keywords_used || [],
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
  for (let i = 0; i < inputs.length; i++) {
    const it = inputs[i];
    options.onProgress?.(i + 1, inputs.length, it.keyword);
    try {
      const post = await generatePost(it);
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
