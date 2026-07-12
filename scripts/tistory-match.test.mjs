/**
 * lib/tistory-match.ts 순수 파서 회귀 테스트.
 *   node --test scripts/tistory-match.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractPostIds,
  postUrlsFromSitemap,
  parseRssItems,
} from "../lib/tistory-match.ts";

// ─── extractPostIds ───────────────────────────────────────────

test("extractPostIds: 글 id 1개", () => {
  const html = `<img src="x" data-filename="p-20260710-006.png" data-origin-width="1024"/>`;
  assert.deepEqual(extractPostIds(html), ["p-20260710-006"]);
});

test("extractPostIds: 여러 개(중복 포함) — 중복 제거·등장 순서 유지", () => {
  const html = `
    <span data-filename="p-20260710-006.png"></span>
    <img data-filename="p-20260710-006.png"/>
    <img data-filename="p-20260710-006-1.png"/>
    <img data-filename="p-20260701-002-3.png"/>
    <img data-filename="p-20260710-006-1.png"/>
  `;
  assert.deepEqual(extractPostIds(html), [
    "p-20260710-006",
    "p-20260701-002",
  ]);
});

test("extractPostIds: 매치 없음 → 빈 배열", () => {
  assert.deepEqual(extractPostIds("<p>글 이미지 없음</p>"), []);
  assert.deepEqual(extractPostIds(""), []);
});

// ─── postUrlsFromSitemap ──────────────────────────────────────

// 실측(https://ntelecomsafe-5.tistory.com/sitemap.xml) 구조 축약:
// 카테고리·/m/·태그·방명록 등 비-글 URL과 실제 글(/숫자) URL이 섞여있다.
const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://ntelecomsafe-5.tistory.com</loc>
    <lastmod>2026-07-12T17:32:49+09:00</lastmod>
    <priority>1.0</priority>
  </url>
<url>
  <loc>https://ntelecomsafe-5.tistory.com/category</loc>
</url>
<url>
  <loc>https://ntelecomsafe-5.tistory.com/category/%EC%95%A4%ED%85%94%EB%A0%88%EC%BD%A4</loc>
</url>
<url>
  <loc>https://ntelecomsafe-5.tistory.com/m/category/%EC%95%A4%ED%85%94%EB%A0%88%EC%BD%A4</loc>
</url>
<url><loc>https://ntelecomsafe-5.tistory.com/tag</loc></url>
<url><loc>https://ntelecomsafe-5.tistory.com/guestbook</loc></url>
<url><loc>https://ntelecomsafe-5.tistory.com/m/guestbook</loc></url>
<url>
  <loc>https://ntelecomsafe-5.tistory.com/21</loc>
  <lastmod>2026-07-10T15:44:06+09:00</lastmod>
</url>
<url>
  <loc>https://ntelecomsafe-5.tistory.com/m/21</loc>
  <lastmod>2026-07-10T15:44:06+09:00</lastmod>
</url>
<url>
  <loc>https://ntelecomsafe-5.tistory.com/20</loc>
  <lastmod>2026-07-10T14:41:37+09:00</lastmod>
</url>
<url>
  <loc>https://ntelecomsafe-5.tistory.com/m/20</loc>
  <lastmod>2026-07-10T14:41:37+09:00</lastmod>
</url>
<url>
  <loc>https://ntelecomsafe-5.tistory.com/21</loc>
  <lastmod>2026-07-10T15:44:06+09:00</lastmod>
</url>
<url>
  <loc>https://other-blog.tistory.com/21</loc>
</url>
</urlset>`;

test("postUrlsFromSitemap: 글 URL만(카테고리·/m/·타 도메인·중복 제외)", () => {
  const urls = postUrlsFromSitemap(
    SITEMAP_XML,
    "https://ntelecomsafe-5.tistory.com",
  );
  assert.deepEqual(urls, [
    "https://ntelecomsafe-5.tistory.com/21",
    "https://ntelecomsafe-5.tistory.com/20",
  ]);
});

test("postUrlsFromSitemap: loc 없음/빈 sitemap → 빈 배열", () => {
  assert.deepEqual(
    postUrlsFromSitemap(
      `<?xml version="1.0"?><urlset></urlset>`,
      "https://ntelecomsafe-5.tistory.com",
    ),
    [],
  );
});

// ─── parseRssItems ────────────────────────────────────────────

// 실측(https://ntelecomsafe-5.tistory.com/rss) 구조: title은 plain text,
// description은 HTML 엔티티로 escape된 본문(HTML 안 인코딩, CDATA 아님).
const RSS_PLAIN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>앤텔레콤 안심개통 케어통신</title>
    <link>https://ntelecomsafe-5.tistory.com/</link>
    <description>선불폰 비대면 개통</description>
    <item>
      <title>군산선불폰, 신용 없이 3가지 유형 통과하는 비법</title>
      <link>https://ntelecomsafe-5.tistory.com/21</link>
      <description>&lt;figure data-filename=&quot;p-20260710-006.png&quot;&gt;&lt;/figure&gt;&lt;p&gt;본문&lt;/p&gt;</description>
      <author>ntelecom</author>
      <pubDate>Sun, 12 Jul 2026 17:30:31 +0900</pubDate>
    </item>
    <item>
      <title>CU 바로유심, KT망 개통 막막하다면? 5분 비대면 완료 꿀팁</title>
      <link>https://ntelecomsafe-5.tistory.com/20</link>
      <description>&lt;figure data-filename=&quot;p-20260710-005.png&quot;&gt;&lt;/figure&gt;</description>
      <pubDate>Fri, 10 Jul 2026 14:41:37 +0900</pubDate>
    </item>
  </channel>
</rss>`;

test("parseRssItems: plain text title/description(엔티티 인코딩) 2건", () => {
  const items = parseRssItems(RSS_PLAIN_XML);
  assert.equal(items.length, 2);
  assert.equal(items[0].link, "https://ntelecomsafe-5.tistory.com/21");
  assert.equal(items[0].title, "군산선불폰, 신용 없이 3가지 유형 통과하는 비법");
  assert.match(items[0].description, /p-20260710-006/);
  assert.equal(items[1].link, "https://ntelecomsafe-5.tistory.com/20");
  assert.equal(
    items[1].title,
    "CU 바로유심, KT망 개통 막막하다면? 5분 비대면 완료 꿀팁",
  );
  assert.match(items[1].description, /p-20260710-005/);
});

// CDATA로 감싼 title/description 변형도 있을 수 있으므로 방어적으로 지원.
const RSS_CDATA_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>테스트 블로그</title>
    <item>
      <title><![CDATA[CDATA 제목 & 특수문자 <태그>]]></title>
      <link>https://example.tistory.com/5</link>
      <description><![CDATA[<figure data-filename="p-20260701-001.png"></figure>]]></description>
    </item>
  </channel>
</rss>`;

test("parseRssItems: CDATA로 감싼 title/description 처리", () => {
  const items = parseRssItems(RSS_CDATA_XML);
  assert.equal(items.length, 1);
  assert.equal(items[0].link, "https://example.tistory.com/5");
  assert.equal(items[0].title, "CDATA 제목 & 특수문자 <태그>");
  assert.match(items[0].description, /p-20260701-001/);
});

test("parseRssItems: item 없음 → 빈 배열", () => {
  assert.deepEqual(
    parseRssItems(`<?xml version="1.0"?><rss><channel></channel></rss>`),
    [],
  );
});
