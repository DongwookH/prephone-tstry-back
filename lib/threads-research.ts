/**
 * Threads 경쟁 리서치 — 수집된 인기글을 바탕으로 우리 브랜드용 초안 생성.
 *
 * 베끼기 금지 — 후킹 각도/포맷만 차용, 내용은 우리 KB(앤텔레콤) 기반 오리지널.
 */

import { generateJSON } from "./gemini";
import { getGlobalContext } from "./knowledge";

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
}

/** 참여도 점수 — 댓글(타인) 가중치 높게. */
export function engagementScore(p: ScrapedPost): number {
  const likes = p.likes ?? 0;
  const replies = p.replies ?? 0;
  const reposts = p.reposts ?? 0;
  // 댓글은 '다른 사람이 반응했다'는 강한 신호 → 가중 3, 리포스트 2, 좋아요 1
  return replies * 3 + reposts * 2 + likes;
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
  if (posts.length === 0) return [];

  const globalCtx = getGlobalContext();

  // 인기글 요약 — 본문/지표만 (링크/작성자는 분석엔 불필요, 프롬프트 절약)
  const ranked = [...posts]
    .sort((a, b) => engagementScore(b) - engagementScore(a))
    .slice(0, 8);
  const sampleList = ranked
    .map((p, i) => {
      const t = (p.text || "").replace(/\s+/g, " ").slice(0, 220);
      return `${i + 1}. (좋아요 ${p.likes ?? 0} · 댓글 ${p.replies ?? 0}) ${t}`;
    })
    .join("\n");

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
- **마지막은 질문으로 끝나야 댓글 3.1배 더 받음** — 단, "어때요?" 같은 막연한 질문 X.
  → 구체적 질문 ✓: "본인은 어떤 통신사 쓰세요?" / "신용 안 보고 개통한 적 있는 분?" / "혹시 이 케이스 겪어본 분 계세요?"
- ❌ "팔로우 해주세요" "프로필 링크 확인" 같은 광고 CTA 금지 — 알고리즘이 디부스트.
- 디자인된 마케팅 카피처럼 X → 친구가 정보 흘리듯 ✓ (반말/존댓말 다양하게).
- 이모지 0~3개 (과하면 광고처럼 보임).
- 과장/허위 ("무조건" "100%") 금지 — 신뢰 손상 + 디부스트.

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

# 출력 규칙
- 각 초안은 100~280자 (절대 280 초과 X).
- 마지막 줄은 구체적 질문으로 끝낼 것 (위 예시 참고).
- 각 초안마다 다른 후킹 각도 (페인포인트 / 반전 / 호기심갭 / 경험담 / 의견 갈림).
- 인기글 문장 복사·번역·재배열 절대 금지.

# 출력 (JSON만, 코드펜스 X, 문자열 안 줄바꿈은 \\n으로 escape)
{
  "drafts": [
    {
      "draft_text": "{초안 본문 — 줄바꿈은 \\n}",
      "insight": "{후킹 각도 + 왜 댓글 유도되는지 한 줄 설명}"
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
    .map((d) => ({
      draft_text: d.draft_text.trim().slice(0, 500),
      insight: (d.insight || "").trim().slice(0, 200),
    }))
    .slice(0, count);
}
