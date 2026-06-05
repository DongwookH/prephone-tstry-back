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

  const prompt = `당신은 한국 SNS(Threads) 바이럴 카피라이터입니다.
아래는 "${keyword}" 관련해서 **어제 Threads에서 잘 터진 남의 인기글**들입니다 (좋아요·댓글 많은 순).

# 잘 터진 인기글 (참고만 — 절대 베끼지 말 것)
${sampleList}

# 우리 회사 정보 (이 사실만 사용, 창작/추측 금지)
${globalCtx}

# 작업
위 인기글들이 **왜 반응을 얻었는지** (후킹 각도, 감정, 포맷)를 분석하고,
그 인사이트를 우리 브랜드(앤텔레콤 안심개통, 선불폰/유심 비대면 셀프개통)에 맞춰
**완전히 새로운 오리지널 Threads 게시글 초안 ${count}개**를 작성하세요.

## 규칙
- 절대 인기글 문장을 복사/번역/재배열하지 말 것. 각도만 차용.
- 우리가 가진 사실(KB)만 사용. 없는 가격/정책 창작 금지.
- Threads 톤: 짧고 강한 첫 문장(후킹), 줄바꿈 활용, 이모지 1~3개, 구어체.
- 길이 200~450자 (Threads 500자 제한 여유).
- 과장/허위광고 금지 ("무조건", "100%" 같은 단정 자제).
- 마지막에 가벼운 CTA 1줄 (예: 프로필 링크 확인 / 댓글로 문의).
- 각 초안마다 서로 다른 후킹 각도 사용.

# 출력 (JSON만, 코드펜스 X)
{
  "drafts": [
    {
      "draft_text": "{초안 본문 — 줄바꿈은 \\n}",
      "insight": "{이 초안이 차용한 후킹 각도 한 줄 설명}"
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
