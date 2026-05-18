/**
 * 글 content_html에서 카드뉴스용 데이터 추출.
 *
 * 추출 대상:
 *  - 표지 카드 (cover): 글 제목 + 키워드 + 카테고리
 *  - 각 H2 섹션 카드 (section): summary 제목 + 부제 + 본문 첫 단락
 *  - Q&A 섹션은 제외 (제목에 "Q&A" / "자주 묻는" / "Q1." 포함되는 details)
 *
 * 정규식 기반 — 우리 prompt 패턴(sanitize 후)에 안전하게 동작.
 */

export type CoverCard = {
  type: "cover";
  title: string;
  keyword: string;
  category: string;
};

export type SectionCard = {
  type: "section";
  pageNum: number;
  totalPages: number;
  title: string;
  subtitle?: string;
  body?: string;
};

export type CardData = CoverCard | SectionCard;

/** HTML 태그 제거 + 엔티티 디코드 + 공백 정리. */
function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** summary 텍스트가 Q&A 섹션인지 판별. */
function isQASummary(title: string, attrs: string): boolean {
  if (/Q\s*\d+\s*\.|Q\s*&\s*A|자주\s*묻는/i.test(title)) return true;
  if (/id\s*=\s*["']section-6["']/i.test(attrs)) return true;
  if (/id\s*=\s*["']section-q/i.test(attrs)) return true;
  return false;
}

export function extractCardData(opts: {
  title: string;
  keyword: string;
  category: string;
  contentHtml: string;
}): CardData[] {
  const cards: CardData[] = [];

  // 1. 표지
  cards.push({
    type: "cover",
    title: opts.title,
    keyword: opts.keyword,
    category: opts.category,
  });

  // 2. 모든 details 추출
  const detailsPattern = /<details\b([^>]*)>([\s\S]*?)<\/details>/gi;
  const sections: Omit<SectionCard, "pageNum" | "totalPages">[] = [];

  let match: RegExpExecArray | null;
  while ((match = detailsPattern.exec(opts.contentHtml)) !== null) {
    const attrs = match[1];
    const inner = match[2];

    // summary 텍스트 추출
    const summaryMatch = inner.match(
      /<summary\b[^>]*>([\s\S]*?)<\/summary>/i,
    );
    if (!summaryMatch) continue;

    let title = stripTags(summaryMatch[1]);
    // ▼ / ▶ / 숫자) 마커 제거하지 말고 ▼만
    title = title.replace(/^[▼▶▽▸]\s*/, "");

    if (!title) continue;
    if (isQASummary(title, attrs)) continue;

    // 부제 — summary 직후 background 있는 div (sanitize가 자동 삽입한 띠)
    const subMatch = inner.match(
      /<\/summary>\s*<div\b[^>]*background[^>]*>([\s\S]*?)<\/div>/i,
    );
    const subtitle = subMatch ? stripTags(subMatch[1]) : undefined;

    // 본문 첫 단락 — <p> 첫 매치
    const bodyMatch = inner.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
    let body: string | undefined;
    if (bodyMatch) {
      body = stripTags(bodyMatch[1]);
      // 너무 짧으면 다음 p나 체크리스트도 시도
      if (body.length < 30) {
        const all = [...inner.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
        for (const m of all) {
          const txt = stripTags(m[1]);
          if (txt.length >= body.length) body = txt;
          if (body.length >= 80) break;
        }
      }
      // 200자 자르기
      if (body.length > 200) body = body.slice(0, 200).trim() + "…";
    }

    sections.push({ type: "section", title, subtitle, body });
  }

  // 페이지 번호 부여
  const total = sections.length;
  for (let i = 0; i < sections.length; i++) {
    cards.push({
      ...sections[i],
      pageNum: i + 1,
      totalPages: total,
    });
  }

  return cards;
}
