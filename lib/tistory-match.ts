/**
 * 티스토리 URL 자동 매칭용 순수 파서 — I/O(fetch) 없음, 단독 테스트 가능.
 *
 * 배경: 각 티스토리 글 페이지 HTML에는 우리가 생성한 이미지 파일명이
 * data-filename="p-YYYYMMDD-NNN.png" 형태로 보존되어 있어 글 id를
 * 결정적으로 추출할 수 있다. sitemap.xml/rss로 후보 URL·글 id를 모아
 * posts 시트의 tistory_url(M열)을 자동으로 채우는 데 쓴다.
 */

const POST_ID_RE = /p-\d{8}-\d{3}/g;

/**
 * HTML(또는 HTML이 포함된 임의 문자열)에서 우리 글 id(p-YYYYMMDD-NNN)를
 * 전부 추출한다. 중복은 제거하되 최초 등장 순서는 유지한다.
 */
export function extractPostIds(html: string): string[] {
  if (!html) return [];
  const matches = html.match(POST_ID_RE) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    if (seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}

const LOC_RE = /<loc>([\s\S]*?)<\/loc>/g;

/**
 * sitemap.xml에서 origin이 일치하고 pathname이 "/숫자"(글 URL)인 것만
 * 추출한다. 카테고리·/m/·태그·타 도메인 등은 제외. 중복 제거.
 */
export function postUrlsFromSitemap(xml: string, origin: string): string[] {
  if (!xml) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  let match: RegExpExecArray | null;
  LOC_RE.lastIndex = 0;
  while ((match = LOC_RE.exec(xml)) !== null) {
    const raw = decodeXmlEntities(match[1].trim());
    if (!raw) continue;
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    if (u.origin !== origin) continue;
    if (!/^\/\d+$/.test(u.pathname)) continue;
    const norm = `${u.origin}${u.pathname}`;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

/** XML 표준 엔티티만 최소 디코딩 (&amp; &lt; &gt; &quot; &#39;/&apos;). */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

const ITEM_RE = /<item[^>]*>([\s\S]*?)<\/item>/g;
const CDATA_OR_TEXT_RE = (tag: string) =>
  new RegExp(
    `<${tag}(?:\\s[^>]*)?>(?:\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*|([\\s\\S]*?))<\\/${tag}>`,
  );

function extractTag(block: string, tag: string): string {
  const re = CDATA_OR_TEXT_RE(tag);
  const m = re.exec(block);
  if (!m) return "";
  const cdata = m[1];
  const plain = m[2];
  if (cdata !== undefined) return cdata.trim();
  return decodeXmlEntities((plain ?? "").trim());
}

/**
 * RSS(rss 2.0)에서 <item>별 {link, title, description}을 추출한다.
 * title/description은 CDATA로 감싸진 경우/일반 텍스트(엔티티 인코딩)
 * 경우 모두 지원한다.
 */
export function parseRssItems(
  xml: string,
): { link: string; title: string; description: string }[] {
  if (!xml) return [];
  const out: { link: string; title: string; description: string }[] = [];
  let match: RegExpExecArray | null;
  ITEM_RE.lastIndex = 0;
  while ((match = ITEM_RE.exec(xml)) !== null) {
    const block = match[1];
    const link = extractTag(block, "link");
    const title = extractTag(block, "title");
    const description = extractTag(block, "description");
    out.push({ link, title, description });
  }
  return out;
}
