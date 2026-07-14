/**
 * Threads 경쟁 리서치 — 수집된 인기글을 바탕으로 우리 브랜드용 초안 생성.
 *
 * 베끼기 금지 — 후킹 각도/포맷만 차용, 내용은 우리 KB(앤텔레콤) 기반 오리지널.
 */

import { generateJSON } from "./gemini";
import { getGlobalContext, getFaqExcerpt } from "./knowledge";
import { hasNumberKeepingClaim } from "./content-guards";

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
  "유심 종류·단말 호환(공기계/자급제/eSIM 등 단말 관점)",
  "개통 후 실사용 팁(잔액·유효기간·데이터 관리 등)",
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

// ─── 메인 글 카피 스타일 로테이션 ────────────────────────
// 문제: 기존엔 "궁금증 미끼(cliffhanger)" 한 가지 전략만 강제 → "~그 방법은 딱
//       하나 있어요" 류 낚시형 카피 일변도. 운영자 요청: 비밀·낚시 스타일 탈피 + 다양화.
// 해결: 검증된 카피 원칙에 근거한 8종 스타일을 키워드+슬롯 해시로 회전 선택.
//       클리프행어는 8종 중 하나로 강등 + 가중치를 낮춰 과대표 방지.
// 각 스타일: id / name(이름) / desc(1줄 설명) / hook(첫 줄 후킹 가이드) /
//           close(끝맺음 가이드) / basis(근거 스킬 — 주석용).
interface CopyStyle {
  id: string;
  name: string;
  desc: string;
  hook: string;
  close: string;
  basis: string; // 근거 스킬 (프롬프트엔 안 나감, 코드 문서용)
}

const COPY_STYLES: CopyStyle[] = [
  {
    id: "direct",
    name: "직접 해결형",
    desc: "문제를 이미 아는 독자에게 답을 바로 준다. 낚시·보류 없음.",
    hook: "첫 줄에서 이 주제의 핵심 답·결론을 곧장 던진다. 예) \"OO은 사실 이렇게 하면 바로 됩니다.\" 궁금증을 미루지 말고 가치를 먼저 준다.",
    close: "답을 준 뒤, 독자 상황을 되묻거나(\"본인은 어느 케이스예요?\") 자연스러운 여지를 남긴다. 셀프 댓글은 낚시가 아니라 '보강·디테일' 역할.",
    basis: "copywriting: Be Direct / 가치 먼저. marketing-psychology: 활성화에너지 낮추기.",
  },
  {
    id: "firstperson",
    name: "1인칭 경험담형",
    desc: "내가 겪은 일처럼 구체적 장면으로 풀어 공감·재현 욕구를 자극.",
    hook: "\"나도 그랬어요\" 톤. 첫 줄에 본인이 겪은 구체적 상황 한 장면(시간·감정 포함). 예) \"지난달에 폰이 갑자기 먹통 됐거든요.\"",
    close: "겪은 사람이 자기 경험을 댓글로 쓰고 싶게 끝낸다. 마케팅 카피가 아니라 친구가 썰 푸는 톤.",
    basis: "marketing-psychology: 가용성 휴리스틱·유사성(liking)·연대(unity). humanizer: 구체적 디테일·1인칭.",
  },
  {
    id: "myth",
    name: "반전/오해 정정형",
    desc: "널리 믿는 오해를 짚고 사실로 뒤집어 궁금증과 신뢰를 동시에.",
    hook: "첫 줄에 흔한 오해를 그대로 얹고 곧바로 부정한다. 예) \"정지된 폰은 못 살린다? 그거 오해예요.\" (거짓 오해 창작 금지 — KB 사실 범위 안에서만.)",
    close: "정정한 사실의 근거·조건을 셀프 댓글로 이어 준다. 정정은 본문에서 명확히, 디테일은 뒤로.",
    basis: "marketing-psychology: 프레이밍·대조효과·확증편향 뒤집기. copywriting: 반전 후킹.",
  },
  {
    id: "number",
    name: "구체적 숫자·데이터형",
    desc: "막연한 형용사 대신 숫자로 구체화해 신뢰와 스크롤 정지를 만든다.",
    hook: "첫 줄에 구체 숫자를 박는다(소요 시간·단계 수·금액 등, KB 사실 범위 내). 예) \"매장 안 가고 3분이면 개통 끝납니다.\" (없는 수치 창작 금지.)",
    close: "숫자의 근거·내역을 셀프 댓글에서 풀어 준다. 과장 수치·\"100%·무조건\" 금지.",
    basis: "copywriting: Specificity Over Vagueness. hook-generator: digit/metric 우선.",
  },
  {
    id: "loss",
    name: "손실회피 프레임형",
    desc: "안 하면 잃는 것을 짚는다. 단, 공포 조장·과장은 금지.",
    hook: "첫 줄에 방치 시 치르는 대가를 담담히 짚는다. 예) \"정지된 채 두면 매달 요금만 쌓여요.\" 겁주기가 아니라 사실 기반 손실.",
    close: "손실을 막는 방법이 있다는 데까지 열고, 구체 절차는 셀프 댓글로. 협박·긴박 조작 금지.",
    basis: "marketing-psychology: 손실회피(prospect theory)·후회회피. 단 진짜일 때만(scarcity 윤리).",
  },
  {
    id: "social",
    name: "사회적 증거형",
    desc: "남들도 겪고·이렇게 해결한다는 신호로 안심시킨다.",
    hook: "첫 줄에 '같은 상황의 사람이 많다'는 신호. 예) \"요즘 이거 물어보는 분들 부쩍 많더라고요.\" (가짜 후기·특정 숫자 창작 금지 — 일반적 관찰 톤으로.)",
    close: "다들 어떻게 풀었는지로 자연스럽게 잇고, 방법 디테일은 셀프 댓글. 독자에게 \"본인도?\"를 던져도 좋다.",
    basis: "marketing-psychology: 사회적증거·밴드왜건·모방욕구(mimetic).",
  },
  {
    id: "question",
    name: "질문 유도형",
    desc: "독자 상황을 콕 집는 질문으로 '내 얘기다' 하고 멈추게.",
    hook: "첫 줄을 구체적 상황 질문으로. 예) \"SKT 요금 밀려서 정지된 분 계세요?\" 두루뭉술한 \"어때요?\" 말고 특정 케이스를 지목.",
    close: "질문 자체로 댓글을 부른다. 본인 답변은 셀프 댓글로 짧게 보강.",
    basis: "copywriting: Rhetorical Questions. marketing-psychology: 타겟 지목·확증편향.",
  },
  {
    id: "cliffhanger",
    name: "클리프행어형",
    desc: "핵심 답을 살짝 보류해 더 알고 싶게. (기존 전략 — 이제 8종 중 하나)",
    hook: "페인포인트와 '해결법이 있다'는 사실까지만 열고 핵심 답은 보류. 예) \"이거 되살리는 방법, 딱 하나 있어요.\"",
    close: "문장을 살짝 끊어 궁금증을 남기거나 구체적 질문으로. 보류한 답은 셀프 댓글에서 일부만 풀고 디테일은 프로필 링크로.",
    basis: "marketing-psychology: 자이가르닉 효과(열린 고리). ※ 과대표 방지 위해 가중치 낮춤.",
  },
];

/**
 * 키워드 + 슬롯 인덱스 해시 → 이번 초안의 메인 글 카피 스타일 결정.
 * - 결정론적(같은 키워드+슬롯 = 같은 스타일)이라 재현 가능.
 * - 클리프행어형(마지막 원소)은 해시가 정확히 그 인덱스일 때만 → 1/n 확률로 억제
 *   (다른 스타일 대비 등장 빈도를 낮춰 과대표 방지).
 * - slot으로 count=2일 때 두 초안이 다른 스타일을 쓰도록 분산.
 */
function pickCopyStyle(keyword: string, slot: number): CopyStyle {
  let h = 0;
  for (const ch of keyword) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  h = (h + slot * 2654435761) >>> 0; // 슬롯별로 시드 크게 분리
  const cliffIdx = COPY_STYLES.length - 1; // 클리프행어형 인덱스
  const nonCliff = COPY_STYLES.length - 1; // 클리프행어 제외 개수
  // 먼저 '클리프행어를 뽑을지'를 별도 저확률 게이트로: 8종 중 1/16 확률만 클리프행어.
  // (h의 상위 비트로 게이트 → 아래 스타일 선택 비트와 독립)
  const cliffGate = (h >>> 28) & 0xf; // 0~15
  if (cliffGate === 0) return COPY_STYLES[cliffIdx];
  // 나머지는 클리프행어 제외 7종에서 균등 선택
  return COPY_STYLES[h % nonCliff];
}

/**
 * count개 초안의 카피 스타일을 서로 다르게 배정.
 * 슬롯마다 pickCopyStyle을 돌리되, 앞 슬롯과 겹치면 다음 스타일(클리프행어 제외 순환)로 밀어 중복 방지.
 */
function pickCopyStyleSet(keyword: string, count: number): CopyStyle[] {
  const out: CopyStyle[] = [];
  const usedIds = new Set<string>();
  for (let s = 0; s < count; s++) {
    let st = pickCopyStyle(keyword, s);
    if (usedIds.has(st.id)) {
      // 겹치면 클리프행어 제외 목록에서 안 쓴 스타일로 밀기
      const pool = COPY_STYLES.slice(0, COPY_STYLES.length - 1);
      const start = pool.findIndex((c) => c.id === st.id);
      for (let k = 1; k <= pool.length; k++) {
        const cand = pool[(start + k) % pool.length];
        if (!usedIds.has(cand.id)) {
          st = cand;
          break;
        }
      }
    }
    usedIds.add(st.id);
    out.push(st);
  }
  return out;
}

/**
 * 인기글 묶음(같은 키워드) → 우리 브랜드용 Threads 초안 N개 생성.
 *
 * @param keyword 검색 키워드
 * @param posts 인기글 (이미 필터·랭킹된 상위)
 * @param count 생성할 초안 수 (기본 2)
 */
/**
 * 이모지·이모티콘 제거 — 쓰레드 글은 이모지 없이 텍스트만.
 * 프롬프트로도 금지하지만 모델이 가끔 넣으므로 코드에서 확실히 제거(안전장치).
 * Extended_Pictographic(얼굴·사물·하트 등) + 국기(지역표시자) + 변형선택자·키캡·ZWJ 제거 후
 * 이모지 자리에 남은 이중 공백을 정리한다.
 */
export function stripEmoji(s: string): string {
  return s
    .replace(
      /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{20E3}\u{200D}]/gu,
      "",
    )
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 매장 홍보·자기소개성 글 판별 — 예시로 쓰면 '광고 각도'를 학습시켜 톤이 나빠짐.
 * 스크랩 인기글 중 이런 글은 예시 풀에서 제외한다.
 */
function looksLikeAd(text = ""): boolean {
  const t = text.replace(/\s+/g, " ");
  return /자기소개|매장\s*(운영|오픈|입니다|이에요)|오픈했|판매[·/]?\s*매입|중고폰\s*(전문|매입|판매)|010[-\s]?\d{2,4}[-\s]?\d{3,4}|카톡|오픈\s*채팅|공동구매|\d{3,4}명\s*프로젝트|맞팔|팔로우\s*(해|환영|맞)/.test(
    t,
  );
}

/**
 * 댓글 잘 붙는 글의 '각도' 예시 (뼈대만 — 문장 복붙 금지용 참고).
 * 스크랩 인기글이 광고 위주거나 세션 문제로 빈약할 때도 모델이 좋은 각도를 잡도록 항상 주입.
 * ⚠️ 이모지 없음 · AI 티 없음 · 우리 니치(선불폰/유심/미납/비대면) — 각도별로 서로 다르게.
 */
const GOOD_ANGLE_EXEMPLARS: string[] = [
  "[공감 페인포인트] 요금 밀려서 정지된 폰, 그냥 버려야 하나 고민했는데 알고 보니 살릴 방법이 있더라고요.",
  "[내 케이스 vs 너 케이스] KT 요금 미납이랑 KT 단말기 할부 미납은 완전 다른 얘기예요. 한쪽은 그냥 개통되고, 한쪽은 폰을 못 씁니다.",
  "[찬반 유발] 선불폰 쓰면 손해라던데, 저는 후불 쓸 때보다 통신비가 줄었어요. 상황 따라 다른 것 같더라고요.",
  "[경험담 디테일] 비대면으로 유심 신청하고 개통까지 딱 5분 걸렸어요. 매장 갈 필요가 없더라고요.",
  "[구체 상황 지목 질문] SKT 정지된 채로 유심만 바꾸면 되는 줄 아는 분들 많던데, 그게 안 될 때가 있어요.",
];

// 2차 자기비평(편집자) 패스용 체크리스트 — 초안을 이 기준으로 점검·재작성.
// 메인 프롬프트의 "AI 티 금지 12개"를 편집자 관점으로 압축한 것.
const AI_TELL_CHECKLIST: string[] = [
  "이모지·이모티콘이 한 글자라도 있으면 전부 삭제 (본문·셀프댓글·태그 전부 0개).",
  "과장 상징·거창한 수식('게임체인저·혁명적·인생을 바꾸는·필수템·신세계') → 담담한 사실로.",
  "뜬구름 형용사('놀라운·완벽한·환상적인·압도적인·최고의') → 구체 사실로 교체.",
  "기계적 3연속 나열('빠르고 간편하고 저렴하게') → 2개나 4개로 흩뜨리거나 문장으로 풀기.",
  "'단순히 X가 아니라 Y' / '~뿐만 아니라 ~까지' 대구(對句) 남용 → 그냥 X는 X라고.",
  "모든 문장 길이·구조가 똑같으면 짧은 문장·긴 문장을 섞어 리듬을 흐트러뜨리기.",
  "영업 상투어('지금 바로·놓치지 마세요·주목하세요·여러분!·확인해보세요') → 친구 말투로.",
  "속 빈 마무리('당신의 선택에 달렸습니다·새로운 시작을 응원합니다·더 나은 내일') 삭제.",
  "번역체·문어체('~하실 수 있습니다·~인 것으로 보여집니다') → 구어체로 짧게.",
  "가짜 친근 도입부('사실은요·솔직히 말하면·여기서 팁 하나')를 후크로 쓰면 빼고 바로 본론.",
  "아포리즘·명언조('선불폰은 자유의 다른 이름') → 구체적 사실로.",
  "'다·나' 종결로만 딱딱하게 나열 → '~거든요·~더라고요·~잖아요' 말끝을 섞기.",
  "낚시/보류가 스타일에 안 맞는데 억지로 쓰였으면 본문에서 답을 주는 톤으로.",
  "'디자인된 마케팅 카피' 냄새 → 친구가 정보 흘리듯 자연스럽게.",
  "본문 길이 100~280자 유지(280 초과 절대 금지), 벽글이면 줄바꿈으로 호흡.",
  "미성년자·외국인 관련 표현이 있으면 초안 전체를 내국인 성인 대상으로 다시 쓰기.",
  "셀프댓글이 '핵심은 망 선택이에요' 정형문이거나 '어때요?/경험 있으세요?' 되묻기면 답 주는 톤으로.",
];

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
  const styleSet = pickCopyStyleSet(keyword, count); // 초안별 메인 글 카피 스타일 (서로 다르게)
  // 초안 번호별 스타일 지시문 — 프롬프트에 "초안 N은 이 스타일로" 명시
  const styleBrief = styleSet
    .map(
      (st, i) =>
        `- 초안 ${i + 1} = 【${st.name}】 (${st.desc})\n` +
        `  · 첫 줄: ${st.hook}\n` +
        `  · 끝맺음: ${st.close}`,
    )
    .join("\n");
  // 미납/정지 케이스가 아니면 "망 선택" 정형답을 하드 금지 (주제 이탈·획일화 차단)
  const isDelinquencyTopic =
    /미납|정지|연체|직권|해지|신용|블랙|회생|파산|밀린|밀려|먹통|수신정지|발신정지/.test(
      keyword,
    );

  // 인기글 요약 — 본문/지표만 (링크/작성자는 분석엔 불필요, 프롬프트 절약)
  // 매장 홍보·자기소개 글은 예시로 부적합(광고 각도 학습) → 제외. 다 걸러지면 원본 사용.
  const nonAd = posts.filter((p) => !looksLikeAd(p.text || ""));
  const pool = nonAd.length > 0 ? nonAd : posts;
  const ranked = [...pool]
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
- **첫 줄(hook)은 0.7초 안에 시선 잡아야 함** — 12 단어 이내. 후킹 방식은 아래에서 이 초안에 배정된 카피 스타일을 따른다(직접 답·경험담·숫자·질문·반전 등 — 궁금증 미끼만이 정답이 아님).
- **길이 100~280자 sweet spot** — 너무 길면 효율 ↓ (500자 한도지만 280 넘기지 말 것).
- **줄바꿈으로 시각적 호흡** — 1줄 1 아이디어, 벽글 금지.

## 🔑 메인 글 카피 스타일 (초안마다 지정 — 아래 배정을 반드시 따를 것)
- 예전엔 모든 글이 "궁금증 미끼(cliffhanger)" 한 가지였다 → 낚시형 카피가 반복돼 식상해짐.
- 이제 **초안마다 아래에 지정된 카피 스타일**로 쓴다. **낚시·보류가 기본값이 아니다.**
  스타일에 따라 답을 바로 주기도 하고, 경험담·숫자·질문으로 열기도 한다.
${styleBrief}
- ⚠️ **각 초안은 배정된 스타일의 첫 줄·끝맺음 가이드를 지켜라.** 초안이 2개면 두 스타일이 확연히 달라야 한다.
- **셀프 댓글로 잇는 구조는 유지하되 스타일에 맞게:** 클리프행어형만 '보류한 답'을 푸는 자리이고,
  나머지 스타일(직접 해결형·경험담형·숫자형 등)에서는 셀프 댓글이 **낚시가 아니라 '보강·디테일·근거' 역할**이다.
  (메인 글에서 이미 답을 줬다면 셀프 댓글은 그 답의 조건·절차·근거를 덧붙인다.)
- ❌ "어때요?" 같은 막연한 질문 X (질문 유도형도 반드시 '구체적 상황'을 지목).
- 디자인된 마케팅 카피처럼 X → 친구가 정보 흘리듯 ✓ (반말/존댓말 다양하게).
- **이모지·이모티콘 절대 금지 — 한 글자도 넣지 마라(0개).** 그림문자 없이 텍스트만으로 담백하게. (이모지는 광고·AI 티가 확 남)
- 과장/허위 ("무조건" "100%") 금지 — 신뢰 손상 + 디부스트.

## 🚫 AI 티 나는 표현 금지 (사람이 쓴 SNS 글처럼 — 아래 패턴 감지 시 다시 써라)
아래는 한국어 SNS에서 'AI가 썼다'는 티가 확 나는 신호들이다. 하나도 쓰지 마라:
1. **과장 상징·거창한 수식** — "게임체인저", "혁명적", "패러다임을 바꾸는", "인생을 바꾸는", "필수템", "신세계". 그냥 실제로 뭐가 좋은지 담담히.
2. **뜬구름 형용사** — "놀라운", "완벽한", "환상적인", "압도적인", "최고의", "믿을 수 없는". 구체 사실로 대체.
3. **기계적 3연속 나열** — "빠르고, 간편하고, 저렴하게" 식으로 항상 3개씩 리듬 맞추는 것. 2개나 4개로 흩뜨리거나 문장으로 풀어라.
4. **"단순히 X가 아니라 Y" / "~뿐만 아니라 ~까지" 병렬 남용** — "단순한 유심이 아니라 자유입니다" 류의 대구(對句) 금지. 그냥 X는 X라고.
5. **모든 문장 길이·구조가 똑같음** — 사람은 짧은 문장과 긴 문장을 섞는다. 리듬을 일부러 흐트러뜨려라.
6. **이모지·느낌표** — 이모지·이모티콘은 아예 쓰지 마라(글 전체 0개). 느낌표도 연발(!!!) 금지, 있어도 1개.
7. **영업·광고 톤 상투어** — "지금 바로", "놓치지 마세요", "주목하세요", "여러분!", "확인해보세요". 친구 말투로.
8. **속 빈 마무리** — "당신의 선택에 달렸습니다", "새로운 시작을 응원합니다", "더 나은 내일" 같은 공허한 긍정 엔딩 금지.
9. **번역체·문어체** — "~하실 수 있습니다", "~인 것으로 보여집니다", "~라고 할 수 있겠습니다" 남발. 구어체로 짧게.
10. **가짜 친근함 상투어** — "사실은요", "솔직히 말하면", "여기서 팁 하나" 같은 뜸 들이는 도입부를 후크로 쓰지 말 것. 바로 본론.
11. **아포리즘 흉내** — "선불폰은 자유의 다른 이름", "개통은 시작일 뿐" 같은 그럴싸한 명언조 금지. 구체적 사실로.
12. **다·나 종결로만 이어지는 딱딱한 정보 나열** — 실제 사람은 "~거든요", "~더라고요", "~잖아요" 같은 말끝을 섞는다.

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

# ✍️ 댓글 잘 붙는 글의 '각도' 예시 (뼈대만 참고 — 문장 복붙 금지, 이 각도로 "${keyword}" 주제를 새로 써라)
${GOOD_ANGLE_EXEMPLARS.map((e) => `- ${e}`).join("\n")}

# 📚 최근 우리 니치(선불폰·알뜰폰·유심)에서 잘 터진 실제 인기글 (각도·후킹 방식만 차용, 문장 복사·번역·재배열 절대 금지. 매장 홍보·자기소개 글은 이미 걸러냄)
${sampleList}

# 🏢 우리 회사 정보 (이 사실만 사용, 가격/정책 창작 금지)
${globalCtx}

# ❓ 공식 FAQ (더지통신 259문항 中 이 주제 관련 발췌 — 개통/요금/절차/유심 사실 근거. 없는 내용 창작 금지, 운영코드는 본문에 옮기지 말 것)
${faqCtx}

# 📡 통신망 선택 — 올바른 사실 (2026-07 운영자 확인. 아래 내용만 사실로 사용)
- 선불 유심은 선결제 구조라 **요금 미납이 있어도 개통 자체는 막히지 않는다**:
  · **KT 요금미납 → KT망·LG망 모두 개통 가능**
  · **LG 요금미납 → KT망·LG망 모두 개통 가능**
  · **SKT 요금미납 → KT망·LG망 개통 가능** (우리는 KT망·LG망 선불 유심 취급)
- ⚠️ 유일한 예외 — **KT 단말기 할부금 미납**: 단말기 할부금이 밀려 있으면
  새로 개통한 **KT 유심을 그 단말기에서는 사용할 수 없다.**
  → 이 경우 **LG망 유심으로 개통**하면 해당 단말기를 그대로 살릴 수 있다.
- 🚫 **금지 (과거 잘못된 공식)**: "같은 통신사 망은 미납 이력이 따라붙어 막힌다 /
  반드시 다른 망으로 가야 한다"는 표현은 사실이 아니다 — 절대 쓰지 말 것.
- 🚫🚫 **번호는 못 살린다 (2026-07-14 운영자 확정)**: 요금 미납·정지·직권해지 상태에선
  **기존 번호 유지/번호이동이 불가**하다. 선불 개통은 **새 번호**가 나오는 것이고,
  살릴 수 있는 건 **단말기(폰 기기)**뿐이다.
  → "기존 번호 그대로", "번호 살릴 수 있다", "번호 유지" 표현 **절대 금지**.
  올바른 표현: "폰(기기)은 그대로 쓰고, 번호는 새로 받아요".
- 이 정보는 미납·정지 고객에게 강력한 후킹이다.
  ⚠️ 단, **키워드/주제가 미납·정지·직권해지·신용불량·할부금 케이스일 때만** 활용할 것.
  충전·요금제·eSIM·유심구매·번호이동·지역·가격비교 등 다른 주제 글에는 억지로 넣지 말고
  **그 주제의 실제 답**을 줘라. (안 그러면 모든 글이 똑같은 얘기로 획일화됨.)
  단 "100%·무조건" 같은 단정은 금지, "~인 경우가 많다 / ~하면 됩니다" 톤 유지.

# 💊 핵심 솔루션 메시지 (주제에 맞을 때만 변주 — 매 글 똑같은 문장으로 반복 X)
- **선불유심 하나로 본인 명의 개통 + 정지폰(기기) 그대로 사용 — 단, 번호는 새 번호.** (미납·정지 케이스에 적합)
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

# 💬 셀프 댓글 (self_replies) — 답 보강 + 프로필 링크 유도 (핵심)
- 셀프 댓글은 **글쓴이(우리)가 본인 글에 대댓글**로 다는 것. 발행 직후 자동 게시됨.
- 역할(메인 글 스타일에 맞춰):
  · 클리프행어형이면 → 메인 글에서 **보류한 답을 일부 풀어주고** 디테일은 프로필 링크로.
  · 그 외 스타일(답을 이미 준 경우)이면 → 답의 **조건·절차·근거·다음 단계를 보강**하고 디테일은 프로필 링크로.
- 톤: **평서문, 정보 제공 톤**. 본인이 자기 글에 정보를 보강하는 느낌.
- 📌 **첫 댓글의 역할 (고정댓글 원칙 이식):**
  · 첫 댓글은 메인 글이 못다 한 **가장 궁금할 지점 하나**를 콕 집어 보강한다 — 여러 얘기를 욱여넣지 말고 한 가지에 집중.
  · 메인 글이 '정보'라면 첫 댓글은 '사람 냄새 나는 보강'이다. 광고 문구가 아니라, 아는 사람이 한 마디 더 얹는 톤.
  · 메인 글 문장을 되풀이하지 말고, 메인 글만 읽어도 자연스럽고 첫 댓글이 붙으면 더 완성되게 (첫 댓글 없이도 메인 글은 성립해야 함).
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
- (미납/정지 주제) 답 보강: "선불은 선결제라 요금 미납이 있어도 개통돼요.\\n단말기 할부금이 밀린 폰이면\\nLG망 유심으로 그 폰 그대로 살릴 수 있고요."
- (충전 주제) 답 보강: "충전은 앱이나 편의점에서 바로 돼요.\\n남은 잔액도 문자로 확인되고요.\\n예약리필 걸어두면 신경 쓸 필요도 없어요."
- (요금제 주제) 답 보강: "선불은 쓴 만큼 선결제예요.\\n약정·위약금이 없어서\\n매달 요금이 고정돼요."
- (eSIM/단말 주제) 답 보강: "eSIM은 유심 배송을 안 기다려요.\\nQR 코드만 찍으면 바로 등록되거든요."
- 프로필 유도(매번 변주, 1~2줄): "본인 상황 순서는 프로필 링크에 있어요" / "정확한 준비물은 프로필에서 확인" / "케이스마다 달라서\\n프로필 링크에 케이스별로 정리해 뒀어요" 등.

→ 평서문, 마침표로 끝남. 각 줄은 짧게. 셀프 댓글이 1개만 어울리면 1개도 OK (단 가능하면 마지막 1개는 프로필 링크 유도).

# 출력 규칙
- 각 초안 메인 본문은 100~280자 (절대 280 초과 X).
- 각 초안은 **위에서 배정된 카피 스타일**로 쓰고, 그 스타일의 첫 줄·끝맺음 가이드를 지킬 것.
- 초안이 2개면 두 초안의 카피 스타일이 확연히 다르게 (같은 후킹 반복 금지).
- AI 티 나는 표현(위 12개 금지 패턴) 하나도 쓰지 말 것.
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
      "insight": "{사용한 카피 스타일 + 왜 댓글 유도되는지 한 줄}"
    }
  ]
}`;

  const result = await generateJSON<{ drafts: GeneratedThreadsDraft[] }>(
    prompt,
    {
      generationConfig: { temperature: 0.9, maxOutputTokens: 4096 },
    },
  );

  const rawDrafts = Array.isArray(result.drafts) ? result.drafts : [];

  // ── 2차 자기비평(편집자) 패스 — best-effort ─────────────
  // 1차 초안을 AI 티·이모지·낚시·광고톤·길이 기준으로 별도 호출에서 점검·재작성.
  // 실패하면 원본 초안으로 진행(생성 자체는 절대 깨뜨리지 않음).
  const drafts = await critiqueAndRewriteDrafts({
    keyword,
    drafts: rawDrafts,
    isDelinquencyTopic,
  });

  return drafts
    .filter((d) => d && typeof d.draft_text === "string" && d.draft_text.trim())
    .map((d) => {
      // topic_tag 정규화: Threads 규칙 — 1~50자, '.'와 '&' 불가
      const topic = (d.topic_tag || "").replace(/[.&]/g, "").trim().slice(0, 50);
      const replies = Array.isArray(d.self_replies)
        ? d.self_replies
            .filter((r) => typeof r === "string")
            .map((r) => stripEmoji(r).slice(0, 500))
            .filter(Boolean)
            .slice(0, 3)
        : [];
      return {
        draft_text: stripEmoji(d.draft_text).slice(0, 500),
        insight: (d.insight || "").trim().slice(0, 200),
        topic_tag: stripEmoji(topic) || undefined,
        self_replies: replies.length > 0 ? replies : undefined,
      };
    })
    // 사실 가드 — "번호 유지/살림" 표현이 남아 있으면 초안 폐기 (절대 발행 금지).
    // 폐기로 슬롯이 비면 fill-missing 크론이 다음 실행에서 재생성한다.
    .filter((d) => {
      const joined = [d.draft_text, ...(d.self_replies ?? [])].join("\n");
      if (hasNumberKeepingClaim(joined)) {
        console.warn(
          `[threads] 사실 가드 — 번호 유지 표현 감지, 초안 폐기: "${d.draft_text.replace(/\n/g, " ").slice(0, 50)}…"`,
        );
        return false;
      }
      return true;
    })
    .slice(0, count);
}

/**
 * 2차 자기비평(편집자) 패스 — 1차 초안을 별도 Gemini 호출로 점검·재작성.
 * "새 눈"으로 AI 티·이모지·낚시·광고톤·길이·정책위반을 잡아 고친 최종본을 돌려준다.
 *
 * 안전장치(검수가 오히려 손해나면 원본을 그대로 씀):
 *  - drafts가 비었으면 그대로 반환(검수할 게 없음).
 *  - 호출/파싱 실패 → 원본 초안 반환(생성 파이프라인을 깨뜨리지 않음).
 *  - 재작성 결과 개수가 원본보다 적거나 본문이 비면 → 원본 초안 반환.
 */
async function critiqueAndRewriteDrafts(opts: {
  keyword: string;
  drafts: GeneratedThreadsDraft[];
  isDelinquencyTopic: boolean;
}): Promise<GeneratedThreadsDraft[]> {
  const { keyword, drafts, isDelinquencyTopic } = opts;
  if (drafts.length === 0) return drafts;
  console.info(
    `[threads] 2차 자기비평 패스 실행 — "${keyword}" 초안 ${drafts.length}개`,
  );

  const draftsJson = JSON.stringify({ drafts }, null, 2);
  const checklist = AI_TELL_CHECKLIST.map((c, i) => `${i + 1}. ${c}`).join("\n");
  const netRule = isDelinquencyTopic
    ? "이 글은 미납/정지 케이스라 '망 선택' 답은 OK지만, 정형문('핵심은 망 선택이에요')은 매번 새 문장으로."
    : `이 글은 미납/정지 케이스가 아니다 → 본문·셀프댓글에서 '망 선택/다른 통신사 망/미납 이력/정지폰' 얘기를 빼고, 오직 "${keyword}"의 실제 주제로만 답하게 고쳐라.`;

  const critiquePrompt = `당신은 한국 SNS(Threads) 게시글을 다듬는 깐깐한 편집자입니다.
아래는 "${keyword}" 주제로 1차 작성된 초안 JSON입니다.
이 초안들을 **아래 체크리스트로 냉정하게 점검하고, 걸리는 부분만 고쳐** 최종본을 출력하세요.

# 편집 원칙
- **이미 자연스럽고 사람이 쓴 것 같은 부분은 그대로 둔다.** 멀쩡한 문장을 굳이 바꾸지 마라(과잉편집 금지).
- 문제가 있는 초안만, 문제 있는 부분만 고쳐라. 각도·주제·핵심 메시지는 유지.
- 고칠 때도 "친구가 정보 흘리듯" 담백한 구어체를 유지. 더 광고처럼 만들지 마라.
- **초안 개수(${drafts.length}개)와 JSON 구조(draft_text, topic_tag, self_replies, insight)를 그대로 유지.**
- self_replies의 개수·역할(답 보강 → 프로필 링크 유도)도 유지하되 위 문제만 정리.

# 점검 체크리스트 (하나라도 걸리면 그 부분을 고쳐라)
${checklist}

# 통신망 관련 사실 (고칠 때 이 사실만 사용, 창작 금지)
- 선불 유심은 선결제라 요금 미납이 있어도 개통 자체는 막히지 않는다(KT/LG/SKT 미납 → KT망·LG망 개통 가능).
- 유일한 예외: KT 단말기 할부금 미납이면 그 단말기엔 KT 유심을 못 쓰니 LG망 유심으로 개통.
- "같은 망은 미납 이력이 따라붙어 막힌다"는 틀린 공식 — 쓰지 마라.
- 🚫🚫 **미납·정지·직권해지 상태에선 기존 번호를 못 살린다** — 선불 개통은 **새 번호**,
  살리는 건 **단말기(기기)**뿐. 초안에 "기존 번호 그대로", "번호 살릴 수 있다", "번호 유지"류
  표현이 있으면 **반드시** "폰(기기)은 그대로, 번호는 새로 받는다"로 고쳐라. 암시도 금지
  (예: "번호 그대로 살리고 싶으시죠? 방법이 있어요" 같은 낚시 → 번호가 아니라 기기·명의 얘기로 바꿀 것).
- ${netRule}

# insight 필드
- 각 초안의 insight는 "무엇을 왜 고쳤는지(또는 문제없어 유지)" 한 줄로 갱신.

# 출력 (JSON만, 코드펜스 X, 문자열 안 줄바꿈은 \\n으로 escape)
{
  "drafts": [
    {
      "draft_text": "{고친 메인 글 본문 — 줄바꿈은 \\n}",
      "topic_tag": "{주제 태그}",
      "self_replies": ["{셀프 댓글1}", "{셀프 댓글2}"],
      "insight": "{무엇을 왜 고쳤는지 한 줄}"
    }
  ]
}

# 점검할 초안 JSON
${draftsJson}`;

  try {
    const result = await generateJSON<{ drafts: GeneratedThreadsDraft[] }>(
      critiquePrompt,
      {
        // 편집 패스는 창작보다 보수적으로 — 온도 낮춤
        generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
      },
    );
    const revised = Array.isArray(result.drafts) ? result.drafts : [];
    const usable = revised.filter(
      (d) => d && typeof d.draft_text === "string" && d.draft_text.trim(),
    );
    if (process.env.THREADS_DEBUG) {
      const rc = (a: GeneratedThreadsDraft[]) =>
        a.map((d) => (d.self_replies?.length ?? 0)).join(",");
      console.info(
        `[threads][debug] 셀프댓글 개수 raw=[${rc(drafts)}] → revised=[${rc(usable)}]`,
      );
    }
    // 검수가 초안을 잃어버리면(개수 감소) 신뢰 불가 → 원본 유지
    if (usable.length < drafts.length) {
      console.warn(
        `[threads] 자기비평 결과 개수 부족(${usable.length}/${drafts.length}) — 원본 초안 사용`,
      );
      return drafts;
    }
    return usable;
  } catch (e) {
    console.warn(
      `[threads] 자기비평 패스 실패 — 원본 초안 사용: ${(e as Error).message}`,
    );
    return drafts;
  }
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

