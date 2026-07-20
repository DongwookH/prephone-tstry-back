/**
 * 리서치 참고글 선별 — 니치 우선 + 바이럴 소수 혼합.
 *
 * 배경: 넓은 키워드 검색(유심·요금미납 등)은 통신과 무관한 바이럴 글도 수확한다
 * (연예·세금·생활 잡담 등). 참고자료를 "좋아요 상위 N개"로만 뽑으면 이런 글이
 * 상위를 독식해 초안 생성 프롬프트의 니치 맥락이 희석된다.
 *
 * 정책: 니치 관련 글을 우선 채우되, 후킹 각도 학습용으로 무관 바이럴 글도
 * 소수(기본 2개)는 남긴다 — 완전 배제하면 "댓글 터지는 각도" 다양성이 준다.
 */

/** 통신 니치 판정 패턴 — 본문에 하나라도 걸리면 니치 관련 글로 본다. */
export const NICHE_PATTERN =
  /폰|유심|이심|esim|통신|요금|개통|알뜰|선불|미납|연체|정지|해지|번호|자급제|단말|공기계|기기변경|데이터\s*무제한|mvno|skt|kt망|lg망|엘지망|셀프개통/i;

type TextPost = { text?: string };

/**
 * engagement 내림차순으로 정렬된 posts에서 limit개 선별.
 * 니치 글 우선, 무관 글은 최대 maxOffNiche개까지만 (니치 글이 모자라면 무관 글로 채움).
 * 반환 순서: 니치(참여도순) → 무관(참여도순).
 */
export function selectResearchReferences<T extends TextPost>(
  posts: T[],
  limit: number,
  maxOffNiche = 2,
): T[] {
  if (limit <= 0) return [];
  const niche: T[] = [];
  const offNiche: T[] = [];
  for (const p of posts) {
    (NICHE_PATTERN.test(p.text || "") ? niche : offNiche).push(p);
  }
  // 니치가 충분하면 무관 글 쿼터(maxOffNiche)만큼만 양보, 모자라면 무관 글로 채움
  const offCount = Math.min(
    offNiche.length,
    Math.max(maxOffNiche, limit - niche.length),
  );
  const nicheCount = Math.min(niche.length, limit - Math.min(offCount, maxOffNiche));
  const picked = niche.slice(0, nicheCount);
  return picked.concat(offNiche.slice(0, limit - picked.length));
}
