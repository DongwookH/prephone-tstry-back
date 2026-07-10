/** 성과 수집용 순수 유틸 — I/O 없음 (단독 테스트 가능). */

/** ThreadsDraftRow.insight "스타일명: 설명" → 스타일명. 형식이 아니면 빈 값. */
export function styleFromInsight(insight?: string): string {
  const head = (insight || "").split(/[:：]/)[0].trim();
  return head.length >= 2 && head.length <= 30 ? head : "";
}

/** GA pagePath(쿼리 제거)와 posts.tistory_url의 pathname을 매칭해 post id 반환. */
export function matchPostByPath(
  pagePath: string,
  posts: { id: string; tistory_url?: string }[],
): string | null {
  const clean = pagePath.split("?")[0].replace(/\/$/, "");
  if (!clean) return null;
  for (const p of posts) {
    if (!p.tistory_url) continue;
    try {
      const u = new URL(p.tistory_url);
      if (u.pathname.replace(/\/$/, "") === clean) return p.id;
    } catch {
      /* 잘못된 URL은 skip */
    }
  }
  return null;
}
