/**
 * 글 content_html에서 카드뉴스용 데이터 추출.
 *
 * 추출 대상 (최대 5장):
 *  - 표지 카드 (cover): 글 제목 + 키워드 + 카테고리
 *  - 각 H2 섹션 카드 (section): summary 제목 + 부제 + 본문 첫 단락 (최대 4장)
 *  - Q&A 섹션은 제외 (제목에 "Q&A" / "자주 묻는" / "Q1." 포함되는 details)
 *
 * 정규식 기반 — 우리 prompt 패턴(sanitize 후)에 안전하게 동작.
 */

/** 카드뉴스 1세트의 카드 수 (표지 1 + 섹션 4). */
export const CARDNEWS_MAX = 5;
const MAX_SECTION_CARDS = CARDNEWS_MAX - 1; // 4

/**
 * 카드 비율 — 콘텐츠 양에 따라 자동 결정.
 *  - square: 1080×1080 (인스타 피드 기본, OG 호환). 짧은 콘텐츠.
 *  - portrait: 1080×1350 (인스타 권장 4:5). 풍부한 콘텐츠 — 빈 공간 X.
 */
export type CardRatio = "square" | "portrait";

export type CoverCard = {
  type: "cover";
  title: string;
  keyword: string;
  category: string;
  ratio: CardRatio;
};

export type SectionCard = {
  type: "section";
  pageNum: number;
  totalPages: number;
  title: string;
  subtitle?: string;
  /** 한 줄 강조 메시지 — 본문 첫 문장 (짧게, 60자 이내). */
  hook?: string;
  /** 불릿 항목 — 체크리스트(✅) 또는 단계(1.2.3.) 본문에서 추출. 3~4개. */
  bullets?: string[];
  /** 불릿 스타일 — checklist(✅), steps(1️⃣2️⃣3️⃣). 없으면 fallback. */
  bulletStyle?: "checklist" | "steps";
  /** 카드 비율 — 콘텐츠 양 자동 결정. */
  ratio: CardRatio;
};

export type CardData = CoverCard | SectionCard;

/** HTML 태그 제거 + 엔티티 디코드 + 마크다운 잔재 제거 + 공백 정리. */
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
    // 마크다운 강조 잔재 제거 (sanitizeForTistory가 놓친 경우 카드뉴스 단계에서 안전망)
    .replace(/\*\*([^*\n]+?)\*\*/g, "$1")
    .replace(/__([^_\n]+?)__/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * <div class="ntc-section" ...>...</div> 블록을 balanced parsing으로 추출.
 * div 중첩이 있으므로 정규식 lazy match만으론 부정확.
 */
function extractNtcSectionDivs(
  html: string,
): { tagName: string; attrs: string; inner: string }[] {
  const blocks: { tagName: string; attrs: string; inner: string }[] = [];
  // ntc-section 시작 div 또는 id="section-N" div
  const startRe =
    /<div\b([^>]*(?:class\s*=\s*["'][^"']*ntc-section[^"']*["']|id\s*=\s*["']section-[^"']*["'])[^>]*)>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = startRe.exec(html)) !== null) {
    const startIdx = sm.index;
    const headerEnd = startRe.lastIndex;
    const attrs = sm[1];

    // balanced </div> 찾기 — depth 카운터
    let depth = 1;
    const tagRe = /<(\/?)div\b[^>]*>/gi;
    tagRe.lastIndex = headerEnd;
    let tm: RegExpExecArray | null;
    while ((tm = tagRe.exec(html)) !== null) {
      if (tm[1]) {
        // </div>
        depth--;
        if (depth === 0) {
          const innerStart = headerEnd;
          const innerEnd = tm.index;
          blocks.push({
            tagName: "div",
            attrs,
            inner: html.slice(innerStart, innerEnd),
          });
          // 다음 ntc-section 검색은 이 닫는 태그 다음부터
          startRe.lastIndex = tagRe.lastIndex;
          break;
        }
      } else {
        // <div>
        depth++;
      }
    }
    if (depth !== 0) {
      // 균형 안 맞으면 종료
      break;
    }
    // startIdx 변수 — 위 break이 outer를 빠져나가지 않게 안전하게.
    // (linter 경고 방지용 dummy 사용)
    void startIdx;
  }
  return blocks;
}

/** summary 텍스트가 Q&A 섹션인지 판별. */
function isQASummary(title: string, attrs: string): boolean {
  if (/Q\s*\d+\s*\.|Q\s*&\s*A|자주\s*묻는/i.test(title)) return true;
  if (/id\s*=\s*["']section-6["']/i.test(attrs)) return true;
  if (/id\s*=\s*["']section-q/i.test(attrs)) return true;
  return false;
}

/** 본문 첫 문장 추출 — 마침표/물음표/느낌표 단위, 60자 이내 자연 cut. */
function extractHook(inner: string): string | undefined {
  // 모든 <p> 텍스트 모음
  const paragraphs = [...inner.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripTags(m[1]))
    .filter((s) => s.length > 0);

  for (const para of paragraphs) {
    // 문장 단위 분리
    const sentences = para.split(/(?<=[.!?。요죠다])\s+/);
    for (const s of sentences) {
      const trimmed = s.trim();
      if (trimmed.length < 8) continue; // 너무 짧으면 skip
      if (trimmed.length <= 60) return trimmed;
      // 60자 이내로 자연 cut — 쉼표 기준
      const commaCut = trimmed.slice(0, 60).lastIndexOf(",");
      if (commaCut > 20) {
        return trimmed.slice(0, commaCut);
      }
      // 공백 기준 cut
      const spaceCut = trimmed.slice(0, 56).lastIndexOf(" ");
      if (spaceCut > 20) {
        return trimmed.slice(0, spaceCut) + "…";
      }
      return trimmed.slice(0, 56) + "…";
    }
  }
  return undefined;
}

/** 체크리스트(✅) 추출 — ✅ 다음 텍스트를 한 항목씩. 최대 4개. */
function extractChecklist(inner: string): string[] {
  // ✅ 다음 텍스트를 <br>나 줄바꿈, 또는 다음 ✅까지 추출
  const items: string[] = [];
  // ✅로 split해서 각 조각 정리
  const parts = inner.split(/✅\s*/);
  for (let i = 1; i < parts.length; i++) {
    // 첫 <br> 또는 ✅ 이전까지가 한 항목
    const raw = parts[i].split(/<br\s*\/?>/i)[0].split(/✅/)[0];
    const txt = stripTags(raw);
    if (txt && txt.length >= 2 && txt.length <= 50) {
      items.push(txt);
      if (items.length >= 4) break;
    }
  }
  return items;
}

/** 단계(1. 2. 3.) 추출 — <strong>N. 라벨</strong> 패턴. 최대 4개. */
function extractSteps(inner: string): string[] {
  const items: string[] = [];
  const pattern = /<strong>\s*(\d+)\.\s*([^<]+?)<\/strong>/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(inner)) !== null) {
    const txt = stripTags(m[2]).trim();
    if (txt && txt.length <= 40) {
      items.push(txt);
      if (items.length >= 4) break;
    }
  }
  return items;
}

/** strong 라벨이 추출 조건을 만족하면 정리해서 반환, 아니면 null. */
function normalizeLabel(raw: string): string | null {
  let label = stripTags(raw).trim();
  label = label.replace(/[:：]\s*$/, "").trim();
  if (!label) return null;
  if (label.length < 2 || label.length > 50) return null;
  // 숫자.로 시작하는 건 단계 (extractSteps에서 처리)
  if (/^\d+\./.test(label)) return null;
  return label;
}

/**
 * key-value 반복 패턴 추출 — 평이한 <p>/<div> 목록도 bullets로 자동 인식.
 *
 * 인식 패턴 (2개 이상 반복되면 list로 간주):
 *  A) <p><strong>이름:</strong> 설명</p>  ← <p> 안
 *  B) <li><strong>이름</strong>: 설명</li> ← <li> 안
 *  C) <div><strong>A</strong>설명<br/><strong>B</strong>설명...</div>  ← <div> 안 strong + <br/>
 *
 * 시도 순서:
 *  1차 — <p>/<li> 블록 안 첫 strong (가장 명확한 의도)
 *  2차 — 같은 <div> 안에 strong이 2개 이상 인접 (br 구분 패턴)
 *  3차 — inner 전체 strong 매치 — 4개 이상이면 list로 인정
 *
 * 추출 시 숫자.로 시작하는 건 skip (단계 패턴은 extractSteps가 처리).
 */
function extractKeyValueList(inner: string): string[] {
  // === 1차: <p>/<li> 안 첫 strong ===
  const items1: string[] = [];
  const blockPattern = /<(?:p|li)\b[^>]*>([\s\S]*?)<\/(?:p|li)>/gi;
  let bm: RegExpExecArray | null;
  while ((bm = blockPattern.exec(inner)) !== null) {
    const strongMatch = bm[1].match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i);
    if (!strongMatch) continue;
    const label = normalizeLabel(strongMatch[1]);
    if (!label) continue;
    items1.push(label);
    if (items1.length >= 4) break;
  }
  if (items1.length >= 2) return items1;

  // === 2차: 같은 <div> 안 strong이 2개 이상 인접 (<br/>로 구분된 list) ===
  // lazy match로 div 추출하고 그 안에 strong이 몇 개 있는지 확인
  const divPattern = /<div\b[^>]*>([\s\S]*?)<\/div>/gi;
  let dm: RegExpExecArray | null;
  while ((dm = divPattern.exec(inner)) !== null) {
    const divInner = dm[1];
    const strongs = [
      ...divInner.matchAll(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi),
    ];
    if (strongs.length < 2) continue;
    const items2: string[] = [];
    for (const sm of strongs) {
      const label = normalizeLabel(sm[1]);
      if (!label) continue;
      items2.push(label);
      if (items2.length >= 4) break;
    }
    if (items2.length >= 2) return items2;
  }

  // === 3차: inner 전체에 strong 매치 — 4개 이상이면 list 인정 ===
  const allStrongs = [
    ...inner.matchAll(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi),
  ];
  if (allStrongs.length >= 4) {
    const items3: string[] = [];
    for (const sm of allStrongs) {
      const label = normalizeLabel(sm[1]);
      if (!label) continue;
      items3.push(label);
      if (items3.length >= 4) break;
    }
    if (items3.length >= 2) return items3;
  }

  return [];
}

export function extractCardData(opts: {
  title: string;
  keyword: string;
  category: string;
  contentHtml: string;
}): CardData[] {
  const cards: CardData[] = [];

  // 1. 표지 — 정사각형 default (인스타 피드 기본, OG 호환)
  cards.push({
    type: "cover",
    title: opts.title,
    keyword: opts.keyword,
    category: opts.category,
    ratio: "square",
  });

  // 2. 모든 H2 섹션 블록 추출
  //    새 구조: <div class="ntc-section" id="section-N">...</div>
  //    중간 구조: <section id="section-N">...</section>
  //    옛 구조: <details><summary>제목</summary>...</details>
  //    세 패턴 모두 지원.
  const sections: Omit<SectionCard, "pageNum" | "totalPages">[] = [];
  const allBlocks: { tagName: string; attrs: string; inner: string }[] = [];

  // details: lazy match로 OK (안에 details 또 있으면 별도 매치)
  for (const m of opts.contentHtml.matchAll(
    /<details\b([^>]*)>([\s\S]*?)<\/details>/gi,
  )) {
    allBlocks.push({ tagName: "details", attrs: m[1], inner: m[2] });
  }
  // section: lazy match
  for (const m of opts.contentHtml.matchAll(
    /<section\b([^>]*)>([\s\S]*?)<\/section>/gi,
  )) {
    if (/id\s*=\s*["']section-/i.test(m[1])) {
      allBlocks.push({ tagName: "section", attrs: m[1], inner: m[2] });
    }
  }
  // div.ntc-section: balanced div parsing (안에 div 여러개 있으므로)
  allBlocks.push(...extractNtcSectionDivs(opts.contentHtml));

  for (const block of allBlocks) {
    const tagName = block.tagName;
    const attrs = block.attrs;
    const inner = block.inner;

    // 제목 추출 — 두 패턴 모두 지원:
    //   A) details: <summary>제목</summary>
    //   B) section: 첫 자식 <div style="...background:linear-gradient..."> 제목 </div>
    let title = "";
    if (tagName === "details") {
      const summaryMatch = inner.match(
        /<summary\b[^>]*>([\s\S]*?)<\/summary>/i,
      );
      if (!summaryMatch) continue;
      title = stripTags(summaryMatch[1]).replace(/^[▼▶▽▸]\s*/, "");
    } else {
      // section의 첫 자식 div (라임 그라데이션 배경)
      const headerDivMatch = inner.match(
        /<div\b[^>]*background[^>]*linear-gradient[^>]*>([\s\S]*?)<\/div>/i,
      );
      if (!headerDivMatch) continue;
      title = stripTags(headerDivMatch[1]);
    }

    if (!title) continue;
    if (isQASummary(title, attrs)) continue;

    // 부제 추출 — 헤더 다음 background 있는 두 번째 div (라임 띠 연속)
    let subtitle: string | undefined;
    if (tagName === "details") {
      const subMatch = inner.match(
        /<\/summary>\s*<div\b[^>]*background[^>]*>([\s\S]*?)<\/div>/i,
      );
      subtitle = subMatch ? stripTags(subMatch[1]) : undefined;
    } else {
      // section: 헤더 div 다음의 두 번째 background div
      const allHeaderDivs = [
        ...inner.matchAll(
          /<div\b[^>]*background[^>]*linear-gradient[^>]*>([\s\S]*?)<\/div>/gi,
        ),
      ];
      if (allHeaderDivs.length >= 2) {
        subtitle = stripTags(allHeaderDivs[1][1]);
      }
    }

    // 인포그래픽 추출: 체크리스트 > 단계 > hook 우선순위
    // 우선순위: 체크리스트(✅) > 단계(1.2.3.) > key-value 목록(strong 반복)
    let bullets: string[] = extractChecklist(inner);
    let bulletStyle: SectionCard["bulletStyle"] = "checklist";
    if (bullets.length < 2) {
      bullets = extractSteps(inner);
      bulletStyle = "steps";
    }
    if (bullets.length < 2) {
      // 마지막 보루: <p><strong>이름:</strong> 설명</p> 같은 반복 패턴
      // (Gemini가 prompt 어겨도 카드뉴스가 빈 박스로 안 나오게 보장)
      bullets = extractKeyValueList(inner);
      bulletStyle = "checklist"; // 시각적으로 ✓ 체크리스트와 동일하게
    }
    if (bullets.length < 2) {
      bullets = [];
      bulletStyle = undefined;
    }

    // 한 줄 hook (본문 첫 문장, 60자 이내)
    const hook = extractHook(inner);

    // 비율 자동 결정 — 콘텐츠 양 기반
    //  - 풍부 (bullets >= 3 또는 hook+subtitle+bullets 모두 있음): portrait 1080×1350
    //  - 빈약 (hook만 또는 bullets 2개 이하): square 1080×1080
    const contentScore =
      (bullets.length >= 3 ? 2 : 0) +
      (hook ? 1 : 0) +
      (subtitle ? 1 : 0);
    const ratio: CardRatio = contentScore >= 3 ? "portrait" : "square";

    sections.push({
      type: "section",
      title,
      subtitle,
      hook,
      bullets: bullets.length > 0 ? bullets : undefined,
      bulletStyle,
      ratio,
    });

    if (sections.length >= MAX_SECTION_CARDS) break;
  }

  // 페이지 번호 부여 (분모는 실제 카드 수)
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
