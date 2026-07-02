/**
 * Threads 경쟁 리서치 — 수집된 인기글을 바탕으로 우리 브랜드용 초안 생성.
 *
 * 베끼기 금지 — 후킹 각도/포맷만 차용, 내용은 우리 KB(앤텔레콤) 기반 오리지널.
 */

import { generateJSON } from "./gemini";
import { getGlobalContext, getFaqExcerpt } from "./knowledge";

/** GHA Playwright 스크레이퍼가 넘기는 인기글 1건. */
export interface ScrapedPost {
  author?: string;
  text?: string;
  likes?: number;
  replies?: number;
  reposts?: number;
  permalink?: string;
  timestamp?: string;
}

export interface GeneratedThreadsDraft {
  draft_text: string;
  insight: string;
  topic_tag?: string;
  self_replies?: string[];
}

/** 참여도 점수 — 댓글(타인) 가중치 높게. */
export function engagementScore(p: ScrapedPost): number {
  const likes = p.likes ?? 0;
  const replies = p.replies ?? 0;
  const reposts = p.reposts ?? 0;
  // 댓글은 '다른 사람이 반응했다'는 강한 신호 → 가중 3, 리포스트 2, 좋아요 1
  return replies * 3 + reposts * 2 + likes;
}

// ─── 셀프 댓글 다양화 시드 ────────────────────────────
// 문제: 모든 초안의 셀프 댓글이 "핵심은 망 선택이에요…" + "프로필 링크에 정리해 뒀어요"
//       한 세트로 획일화됨. 키워드 해시로 답변 각도·CTA 스타일을 회전시켜 강제 분산.
const REPLY_ANSWER_ANGLES = [
  "선불은 선결제 구조라 신용·연체 심사가 없다는 점(후불과의 차이)",
  "비대면 셀프개통 절차가 실제로 얼마나 단순한지(단계·소요시간)",
  "개통 전에 꼭 챙겨야 할 준비물·체크리스트",
  "흔한 오해 하나를 정정(예: '정지폰은 못 살린다'는 오해)",
  "실제로 겪는 상황을 짧은 사례로(1인칭 경험담 톤)",
  "요금·비용 관점의 이득(선불 요금 구조·불필요한 지출 절약)",
  "통신망 선택 공식 — 단, 미납·정지·직권해지·신용 케이스일 때만",
  "유심 종류·단말 호환(공기계/자급제/eSIM 등 단말 관점)",
  "개통 가능 여부를 가르는 조건 한 가지를 콕 집어",
];
const REPLY_CTA_STYLES = [
  "궁금할 만한 지점을 콕 집어 '그 부분은 프로필 링크에' 식으로 짧게",
  "본인 상황이면 순서대로 따라 하면 된다는 안내로",
  "매장 안 가도 되는 비대면이라는 점을 곁들여",
  "시간이 얼마 안 걸린다는 점(빠름)을 강조하며",
  "준비물만 맞으면 바로 된다는 톤으로",
  "'상황마다 다르니 프로필 링크에서 본인 케이스 확인' 톤으로",
];

/** 키워드 해시 → 이번 초안이 시작할 답변 각도 2개 + CTA 스타일 1개. */
function pickReplyGuide(keyword: string): { a1: string; a2: string; cta: string } {
  let h = 0;
  for (const ch of keyword) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const n = REPLY_ANSWER_ANGLES.length;
  const a1 = REPLY_ANSWER_ANGLES[h % n];
  let a2 = REPLY_ANSWER_ANGLES[(Math.floor(h / 7) + 3) % n];
  if (a2 === a1) a2 = REPLY_ANSWER_ANGLES[(h + 1) % n];
  const cta = REPLY_CTA_STYLES[Math.floor(h / 11) % REPLY_CTA_STYLES.length];
  return { a1, a2, cta };
}

/**
 * 인기글 묶음(같은 키워드) → 우리 브랜드용 Threads 초안 N개 생성.
 *
 * @param keyword 검색 키워드
 * @param posts 인기글 (이미 필터·랭킹된 상위)
 * @param count 생성할 초안 수 (기본 2)
 */
export async function generateThreadsDraftsFromPosts(opts: {
  keyword: string;
  posts: ScrapedPost[];
  count?: number;
}): Promise<GeneratedThreadsDraft[]> {
  const { keyword, posts } = opts;
  const count = opts.count ?? 2;
  // 인기글 0건이어도 KB 기반으로 생성 가능 (주간 자동화용 — 스크레이퍼 결과 없을 수 있음)

  const globalCtx = getGlobalContext();
  const faqCtx = getFaqExcerpt({ keyword }); // 주제 관련 FAQ 섹션만 발췌 — 사실 근거
  const rg = pickReplyGuide(keyword); // 셀프 댓글 획일화 방지 — 각도·CTA 회전 시드
  // 미납/정지 케이스가 아니면 "망 선택" 정형답을 하드 금지 (주제 이탈·획일화 차단)
  const isDelinquencyTopic =
    /미납|정지|연체|직권|해지|신용|블랙|회생|파산|밀린|밀려|먹통|수신정지|발신정지/.test(
      keyword,
    );

  // 인기글 요약 — 본문/지표만 (링크/작성자는 분석엔 불필요, 프롬프트 절약)
  const ranked = [...posts]
    .sort((a, b) => engagementScore(b) - engagementScore(a))
    .slice(0, 8);
  const sampleList =
    ranked.length > 0
      ? ranked
          .map((p, i) => {
            const t = (p.text || "").replace(/\s+/g, " ").slice(0, 220);
            return `${i + 1}. (좋아요 ${p.likes ?? 0} · 댓글 ${p.replies ?? 0}) ${t}`;
          })
          .join("\n")
      : "(인기글 데이터 없음 — KB와 키워드 의미만 활용해 작성)";

  const prompt = `당신은 한국 SNS(Threads) 바이럴 카피라이터이자 그로스 마케터입니다.
2026년 최신 Threads 알고리즘과 다이렉트 리스폰스 카피라이팅 원리를 활용해
"${keyword}" 주제로 **댓글이 잘 달리는 Threads 게시글 초안 ${count}개**를 작성하세요.

# 🧠 Threads 알고리즘 (2026, 절대 외워서 적용)
1. **댓글이 최강 신호** — 좋아요 10개보다 진짜 댓글 1개가 노출에 10배 영향.
2. **참여 속도가 결정적** — 발행 후 30~60분의 댓글이 그 글의 도달을 결정.
3. **본문 있는 댓글이 가치 있다** — "ㅋㅋ" "좋네요" 같은 빈 댓글은 가중치 낮음.
4. **유사 관심사 사용자에게 우선 노출** — 키워드/주제 응집도가 중요.
5. 따라서 우리 목표는 **"댓글로 자기 경험·의견을 쓰고 싶게" 만드는 글**.

# 📝 검증된 글 작성 원칙 (반드시 적용)
- **첫 줄(hook)은 0.7초 안에 시선 잡아야 함** — 12 단어 이내, curiosity gap·페인포인트·반전 중 하나.
- **길이 100~280자 sweet spot** — 너무 길면 효율 ↓ (500자 한도지만 280 넘기지 말 것).
- **줄바꿈으로 시각적 호흡** — 1줄 1 아이디어, 벽글 금지.

## 🔑 메인 글 핵심 전략 — "궁금증 미끼(cliffhanger)"
- 메인 글에서 **정보를 다 주지 말 것.** 페인포인트와 "해결법이 있다"는 사실까지만 풀고,
  **핵심 답(구체적 방법·시간·공식·준비물)은 일부러 보류**해 독자가 더 알고 싶게 만든다.
- 그 보류한 답은 **셀프 댓글**에서 일부 풀고, 최종 디테일은 **프로필 링크로 유도**한다.
- 끝맺음은 둘 중 하나:
  ① **문장을 살짝 끊어 궁금증 유발** ("그 방법은 딱 하나 있어요." / "단, 조건이 하나 있죠.")
  ② **구체적 질문** ("본인은 어느 통신사가 정지됐어요?" / "혹시 이 케이스 겪어본 분?")
- ❌ "어때요?" 같은 막연한 질문 X. ❌ 메인 글 안에서 방법을 처음부터 끝까지 다 설명 X (궁금증 0 → 댓글 0).
- 디자인된 마케팅 카피처럼 X → 친구가 정보 흘리듯 ✓ (반말/존댓말 다양하게).
- 이모지 0~3개 (과하면 광고처럼 보임).
- 과장/허위 ("무조건" "100%") 금지 — 신뢰 손상 + 디부스트.

# 🚫 절대 금지 — 미성년자/외국인 관련 콘텐츠 (정책상 차단)
- **미성년자**: 미성년자/청소년/어린이/학생/자녀/만 14·15·17·18·19세 등 미성년자 대상 또는 언급
- **외국인**: 외국인/외국인등록증/단기·장기 체류/유학생/이민자/이민/다문화/워홀/워킹홀리데이/영주권/거소증/재외국민 등
  외국인·재외동포 대상 또는 언급
- 메인 글·셀프 댓글·예시 어디에도 등장시키지 말 것.
- "자녀 폰", "학생 요금제", "청소년 알뜰폰", "외국인 개통", "유학생 유심", "단기체류 선불폰" 같은 변형 표현도 모두 금지.
- 위반 시 해당 초안은 폐기 — 반드시 **내국인 성인 대상** 톤·표현으로만 작성.

# 🎣 어떤 글이 댓글 유발하나
- "공감 가는 페인포인트" — 독자가 "나도 그래!" 댓글 달고 싶어짐
- "내 케이스 vs 너 케이스" — 비교 호기심
- "찬반 갈리는 의견" — 댓글창에서 논쟁
- "잘 모르겠어요, 아시는 분?" — 정보 부탁
- "직접 경험담의 디테일" — 다른 사람도 자기 경험 공유하고 싶어짐

# 📚 어제 같은 키워드로 잘 터진 인기글 (각도만 차용, 절대 베끼지 X)
${sampleList}

# 🏢 우리 회사 정보 (이 사실만 사용, 가격/정책 창작 금지)
${globalCtx}

# ❓ 공식 FAQ (더지통신 259문항 中 이 주제 관련 발췌 — 개통/요금/절차/유심 사실 근거. 없는 내용 창작 금지, 운영코드는 본문에 옮기지 말 것)
${faqCtx}

# 📡 통신망 선택 공식 (검증된 도메인 사실 — 적극 활용, 단 단정 표현 주의)
- 요금 연체로 **정지/직권해지**되면, 같은 통신사 계열로는 미납 이력이 따라붙어 신규 개통이 막힌다.
- 그래서 **다른 통신사 망**의 알뜰폰 선불유심으로 가야 본인 명의 개통이 인식된다.
  · **KT 미납 → LG망 선불유심**
  · **LG 미납 → KT망 선불유심**
  · **SK 미납 → KT망 선불유심**
- 정지된 휴대폰은 통신사가 기기에 락을 걸어 다른 유심을 껴도 인식 안 되는 경우가 있는데,
  알뜰폰 선불유심은 모든 통신사 정지폰에 호환되어 정지폰을 그대로 살릴 수 있다.
- 이 "망선택 공식"은 경쟁 계정 대비 우리만의 **전문 정보 후킹**이다.
  ⚠️ 단, **키워드/주제가 미납·정지·직권해지·신용불량 케이스일 때만** 활용할 것.
  충전·요금제·eSIM·유심구매·번호이동·지역·가격비교 등 다른 주제 글에는 억지로 넣지 말고
  **그 주제의 실제 답**을 줘라. (안 그러면 모든 글이 똑같은 "망 선택" 얘기로 획일화됨.)
  단 "100%·무조건" 같은 단정은 금지, "~인 경우가 많다 / ~하면 됩니다" 톤 유지.

# 💊 핵심 솔루션 메시지 (주제에 맞을 때만 변주 — 매 글 똑같은 문장으로 반복 X)
- **선불유심 하나로 본인 명의 개통 + 정지폰 그대로 사용.** (미납·정지 케이스에 적합)
- 선불은 선결제 구조라 후불처럼 신용·연체 심사를 하지 않는다 → 연체 중에도 본인 명의로 열린다.
- 비대면 셀프개통이라 매장 안 가도 된다.
- ⚠️ 위 문장들을 **모든 글에 복붙하지 말 것.** 이 글 키워드의 실제 관심사에 맞는 것만 골라 새 표현으로.

# 🎯 타겟팅 전략 — 통신사별·상황별로 쪼개기 (중요)
- 두루뭉술한 "선불폰 좋아요" 글 X → **구체적 상황을 콕 집어** 그 사람만 반응하게.
- 좋은 타겟 축: 통신사별(KT 수신정지 / LGT 요금미납 / SKT 미납정지), 상황별(정지폰 / 미납폰 / 직권해지 / 신용불량).
- 키워드가 통신사·상황을 지정하면, 그 케이스의 페인포인트를 1인칭으로 생생하게 묘사할 것.
  예) "SKT 요금 밀려서 정지됐는데 유심 바꿔도 먹통이죠?" → 해당자만 "내 얘기다" 하고 멈춤.

# 🏷️ Threads 주제 태그 (topic_tag)
- Threads는 글에 1개의 주제를 붙일 수 있고, 같은 주제 관심사 사용자에게 우선 노출됩니다.
- 1~50자, '.'와 '&' 사용 불가, 공백은 가능 (단 짧을수록 좋음).
- 우리 니치에서 좋은 예: "선불폰", "알뜰폰", "유심", "통신비", "비대면개통".
- 키워드와 가장 가까우면서 검색량이 많을 후보 1개 선택.

# 💬 셀프 댓글 (self_replies) — 궁금증 해소 + 프로필 링크 유도 (핵심)
- 셀프 댓글은 **글쓴이(우리)가 본인 글에 대댓글**로 다는 것. 발행 직후 자동 게시됨.
- 역할: 메인 글에서 **보류한 답을 일부 풀어주고**, 최종 디테일은 **프로필 링크로 유도**.
- 톤: **평서문, 정보 제공 톤**. 본인이 자기 글에 정보를 보강하는 느낌.
- 📱 **가독성 (중요): 셀프 댓글도 메인 글처럼 줄바꿈(\\n)으로 짧게 끊어 쓴다.**
  · **한 줄에 한 생각**, 한 줄 15~35자 정도. 길게 늘어지는 벽글·만연체 금지.
  · 2~4줄로 나눠 호흡을 준다. 문장이 길어지면 접속사/쉼표 자리에서 줄을 바꿔라.
  · 예) "충전은 앱에서 바로 돼요.\\n남은 잔액도 문자로 확인되고요.\\n예약리필 걸어두면 신경 쓸 필요도 없어요."
- 구성 (셀프 댓글 2개 권장):
  · **댓글 1 = 답 보강**: 메인 글이 미뤄둔 핵심(방법·공식·이유)을 2~4줄로 끊어 푼다. 총 60~180자.
  · **댓글 2 = 프로필 링크 유도(CTA)**: 세부 안내를 프로필 링크로 보내는 짧은 코멘트(1~2줄).
    ⚠️ "URL", "http", 특정 도메인 직접 쓰지 말 것 →
    반드시 "프로필 링크" / "프로필에 정리해 뒀어요" 표현으로 (Threads는 본문 외부링크 디부스트, 프로필 링크는 안전).

🎲 **이번 초안 셀프 댓글 다양성 가이드 (획일화 방지 — 반드시 반영):**
- **답 보강 댓글**은 아래 각도에서 시작하되, 이 글 주제에 안 맞으면 주제에 맞는 답으로 바꿔라:
  · 우선 각도 A: ${rg.a1}
  · 우선 각도 B: ${rg.a2}
- **CTA 댓글 스타일**: ${rg.cta}
- ⚠️ **"핵심은 망 선택이에요"로 시작하는 정형문을 쓰지 말 것.**${
    isDelinquencyTopic
      ? " (미납/정지 케이스라 망 선택 답은 OK지만, 문장은 매번 새로 써라.)"
      : "\n- 🚫🚫 **이 글은 미납/정지 케이스가 아니다 → 셀프 댓글에 '망 선택 / 다른 통신사 망 / 미납 이력 / 정지폰' 얘기 절대 금지.** 오직 이 키워드(" +
        keyword +
        ")의 실제 주제로만 답하라."
  }
- ⚠️ **CTA를 "프로필 링크에 정리해 뒀어요" 한 문장으로 복붙 금지** — 매번 주제·상황에 맞춰 다른 문장으로.
- 초안이 2개면 두 초안의 셀프 댓글 답변 각도와 CTA 문구를 **서로 다르게**.

🚫 **셀프 댓글 금지 패턴:**
- ❌ "여러분 어때요?" "혹시 ~ 경험 있으세요?" 같은 또 다른 질문 X (댓글은 답 주는 자리).
- ❌ "팔로우 해주세요" "DM 주세요" "댓글 남겨주세요" 같은 직접 광고 CTA X. (프로필 링크 안내는 OK)
- ❌ 본문에 외부 URL·도메인 직접 노출 X → "프로필 링크"로 표현.
- ❌ 메인 글 문장 그대로 반복 X.

✅ **흐름은 "답 보강 → (마지막에) 프로필 유도". 아래는 서로 다른 주제의 톤 예시일 뿐 — 문구 그대로 쓰지 말고 이 글 주제에 맞게 새로 써라:**
(줄바꿈 \\n으로 짧게 끊은 형태 — 아래처럼 2~3줄로)
- (미납/정지 주제) 답 보강: "같은 통신사 망은 이력이 따라붙어 막히는 경우가 많아요.\\n그래서 다른 망 선불유심으로 가야 인식돼요."
- (충전 주제) 답 보강: "충전은 앱이나 편의점에서 바로 돼요.\\n남은 잔액도 문자로 확인되고요.\\n예약리필 걸어두면 신경 쓸 필요도 없어요."
- (요금제 주제) 답 보강: "선불은 쓴 만큼 선결제예요.\\n약정·위약금이 없어서\\n매달 요금이 고정돼요."
- (eSIM/단말 주제) 답 보강: "eSIM은 유심 배송을 안 기다려요.\\nQR 코드만 찍으면 바로 등록되거든요."
- 프로필 유도(매번 변주, 1~2줄): "본인 상황 순서는 프로필 링크에 있어요" / "정확한 준비물은 프로필에서 확인" / "케이스마다 달라서\\n프로필 링크에 케이스별로 정리해 뒀어요" 등.

→ 평서문, 마침표로 끝남. 각 줄은 짧게. 셀프 댓글이 1개만 어울리면 1개도 OK (단 가능하면 마지막 1개는 프로필 링크 유도).

# 출력 규칙
- 각 초안 메인 본문은 100~280자 (절대 280 초과 X).
- 메인 글은 **핵심 답을 보류**(cliffhanger)하거나 **구체적 질문**으로 끝낼 것 — 방법을 처음부터 끝까지 다 설명 X.
- 각 초안마다 다른 후킹 각도 (페인포인트 / 반전 / 호기심갭 / 경험담 / 의견 갈림).
- 인기글 문장 복사·번역·재배열 절대 금지.
- topic_tag는 매번 출력 (50자 이내, 공백 가능, '.'와 '&' 불가).
- self_replies는 1~2개 (권장 2개: 답 보강 + 프로필 링크 유도). 마지막 댓글은 가능하면 프로필 링크로 유도.

# 출력 (JSON만, 코드펜스 X, 문자열 안 줄바꿈은 \\n으로 escape)
{
  "drafts": [
    {
      "draft_text": "{메인 글 본문 — 줄바꿈은 \\n}",
      "topic_tag": "{주제 태그, 예: 선불폰}",
      "self_replies": ["{셀프 댓글1}", "{셀프 댓글2}"],
      "insight": "{후킹 각도 + 왜 댓글 유도되는지 한 줄}"
    }
  ]
}`;

  const result = await generateJSON<{ drafts: GeneratedThreadsDraft[] }>(
    prompt,
    {
      generationConfig: { temperature: 0.9, maxOutputTokens: 4096 },
    },
  );

  const drafts = Array.isArray(result.drafts) ? result.drafts : [];
  return drafts
    .filter((d) => d && typeof d.draft_text === "string" && d.draft_text.trim())
    .map((d) => {
      // topic_tag 정규화: Threads 규칙 — 1~50자, '.'와 '&' 불가
      const topic = (d.topic_tag || "").replace(/[.&]/g, "").trim().slice(0, 50);
      const replies = Array.isArray(d.self_replies)
        ? d.self_replies
            .filter((r) => typeof r === "string")
            .map((r) => r.trim().slice(0, 500))
            .filter(Boolean)
            .slice(0, 3)
        : [];
      return {
        draft_text: d.draft_text.trim().slice(0, 500),
        insight: (d.insight || "").trim().slice(0, 200),
        topic_tag: topic || undefined,
        self_replies: replies.length > 0 ? replies : undefined,
      };
    })
    .slice(0, count);
}

// ─── 주간 자동화 — 1주치 스케줄 + 일괄 생성 ─────────────

/**
 * 다가오는 또는 현재 주 월요일 00:00 KST.
 * @param ref 기준 시각 (기본 now)
 */
export function getUpcomingMondayKstStart(ref: Date = new Date()): Date {
  // KST = UTC+9
  const refKstMs = ref.getTime() + 9 * 3600 * 1000;
  const refKst = new Date(refKstMs);
  const dayKst = refKst.getUTCDay(); // 0=일, 1=월, ..., 6=토
  // 이번 주 월요일 (월요일이면 그대로, 다른 요일이면 다음 주 월요일까지의 일수)
  // 우리는 "다가오는" 월요일 — 월요일 새벽 트리거 → 그 주 월요일~일요일 발행
  // 월요일이면 오늘 0시, 화요일이면 6일 뒤 등이 아니라
  // 이번 트리거가 월요일에 도니까 그 날 0시 KST 사용
  const daysSinceMonday = (dayKst + 6) % 7; // 월=0, 일=6
  // 이번 주 월요일 KST 00:00
  const mondayKstMs = refKstMs - daysSinceMonday * 24 * 3600 * 1000;
  const monday = new Date(mondayKstMs);
  monday.setUTCHours(0, 0, 0, 0); // KST 자정 = 그 KST 날짜의 00:00
  // UTC로 다시 변환 (KST 자정 - 9시간 = 전날 UTC 15:00)
  return new Date(monday.getTime() - 9 * 3600 * 1000);
}

/**
 * 주간 스케줄 빌더 — 기본 8일(월~다음 주 월) × 3슬롯(9·14·20시 KST) = 24개.
 *   다음 주 월요일까지 미리 생성해, 월요일 글이 한 주 앞서 준비되도록 함
 *   (월요일 검토 시 그 주 월요일 글은 이미 전주에 생성돼 있음).
 *   중복은 라우트의 슬롯 dedup이 처리.
 * 각 슬롯에 ±15분 랜덤 jitter.
 *
 * weekStartUtc = KST 월요일 00:00에 해당하는 UTC 시각 (= 일요일 UTC 15:00).
 * KST (월요일+day) HOUR시 = weekStartUtc + day*24시간 + HOUR시간 (KST·UTC 차이 9는 이미 weekStart에 반영됨)
 */
export function buildWeeklySchedule(
  weekStartUtc: Date,
  days = 8,
): string[] {
  const baseHoursKst = [9, 14, 20];
  const slots: string[] = [];
  for (let day = 0; day < days; day++) {
    for (const hour of baseHoursKst) {
      const targetMs =
        weekStartUtc.getTime() + day * 24 * 3600 * 1000 + hour * 3600 * 1000;
      // ±15분 랜덤 jitter (정확히 정시 발행 봇 같아 보이지 않게)
      const jitterMs =
        Math.floor((Math.random() * 30 * 60 - 15 * 60) * 1000);
      slots.push(new Date(targetMs + jitterMs).toISOString());
    }
  }
  return slots;
}

// cache bust 1781256722

