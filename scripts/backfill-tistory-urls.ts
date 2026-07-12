/**
 * scripts/backfill-tistory-urls.ts
 *
 * posts 시트의 tistory_url(M열)이 비어있는 과거 글들을 블로그 sitemap.xml·
 * 글 페이지 HTML에서 결정적으로 매칭해 채우는 1회성 백필 도구.
 *
 * 매칭 순서 (블로그별):
 *  1) `${origin}/sitemap.xml` → postUrlsFromSitemap으로 글 URL만 추출
 *  2) posts 시트에 이미 기록된 URL(트레일링 슬래시 무시)은 후보에서 제외
 *  3) 남은 URL마다 300ms 간격으로 페이지 fetch → extractPostIds
 *     - 정확히 1개 & 그 id가 시트에 존재 & tistory_url 비어있음 → 매칭 확정
 *     - 그 id의 post에 이미 "다른" URL이 기록돼 있으면 → conflict 리포트(덮어쓰지 않음)
 *     - 0개 또는 2개 이상 → og:title 정규화(공백 collapse·trim) 일치로 폴백.
 *       tistory_url 없는 posts 중 제목 일치가 유일할 때만 매칭, 아니면 skip.
 *
 * 실행: npx --yes tsx scripts/backfill-tistory-urls.ts [--dry-run]
 *   --dry-run: 매칭 결과만 출력, 시트 무변경. 실행 모드는 updatePostTistoryUrl로 기록.
 *
 * 페이지 fetch 실패는 해당 URL만 skip 처리하고 계속 진행한다(전체 중단 X).
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { PostRow } from "../lib/sheets";

// ── .env.local 폴백 로드 (scripts/generate-daily.ts 30~56과 동일 패턴) ──────
function loadEnvLocal(): void {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    // 이미 process.env에 있으면(=GHA에서 주입) 덮어쓰지 않음
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvLocal();

// ⚠️ .env.local 로드 "후"에 lib 모듈을 import해야 하므로 top-level import는
//    타입만 사용하고(erased) 런타임 값은 main() 안에서 dynamic import.

const DRY = process.argv.includes("--dry-run");
const FETCH_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(url: string): string {
  return (url || "").trim().replace(/\/$/, "");
}

function normalizeTitle(title: string): string {
  return (title || "").replace(/\s+/g, " ").trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** <meta property="og:title" content="..."> (속성 순서 무관) 추출. */
function extractOgTitle(html: string): string {
  const re =
    /<meta[^>]*(?:property=["']og:title["'][^>]*content=["']([^"']*)["']|content=["']([^"']*)["'][^>]*property=["']og:title["'])[^>]*>/i;
  const m = re.exec(html);
  if (!m) return "";
  return decodeEntities((m[1] ?? m[2] ?? "").trim());
}

type MatchResult = { postId: string; url: string };
type ConflictResult = { id: string; existingUrl: string; newUrl: string };
type SkipResult = { url: string; reason: string };

async function processBlog(
  origin: string,
  label: string,
  allPosts: PostRow[],
  effective: Map<string, string>,
): Promise<{
  pagesFetched: number;
  matched: MatchResult[];
  conflicts: ConflictResult[];
  skipped: SkipResult[];
}> {
  const matched: MatchResult[] = [];
  const conflicts: ConflictResult[] = [];
  const skipped: SkipResult[] = [];
  let pagesFetched = 0;

  const postsById = new Map(allPosts.map((p) => [p.id, p]));

  const { postUrlsFromSitemap, extractPostIds } = await import(
    "../lib/tistory-match"
  );

  let sitemapXml: string;
  try {
    const res = await fetch(`${origin}/sitemap.xml`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    sitemapXml = await res.text();
  } catch (e) {
    console.log(`[${label}] sitemap.xml fetch 실패: ${(e as Error).message}`);
    return { pagesFetched: 0, matched, conflicts, skipped };
  }

  const allUrls = postUrlsFromSitemap(sitemapXml, origin);

  const recordedUrls = new Set(
    allPosts.filter((p) => p.tistory_url).map((p) => normalizeUrl(p.tistory_url)),
  );
  const candidateUrls = allUrls.filter((u) => !recordedUrls.has(normalizeUrl(u)));

  console.log(
    `[${label}] sitemap 글 URL ${allUrls.length}개 · 미기록 ${candidateUrls.length}개`,
  );

  for (let i = 0; i < candidateUrls.length; i++) {
    const url = candidateUrls[i];
    if (i > 0) await sleep(FETCH_DELAY_MS);

    let html: string;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = await res.text();
      pagesFetched++;
    } catch (e) {
      skipped.push({ url, reason: `페이지 fetch 실패: ${(e as Error).message}` });
      continue;
    }

    const ids = extractPostIds(html);

    if (ids.length === 1) {
      const id = ids[0];
      const post = postsById.get(id);
      if (!post) {
        skipped.push({ url, reason: `id ${id} 시트에 없음` });
        continue;
      }
      const currentUrl = effective.get(post.id) ?? post.tistory_url ?? "";
      if (!currentUrl) {
        matched.push({ postId: post.id, url });
        effective.set(post.id, url);
      } else if (normalizeUrl(currentUrl) !== normalizeUrl(url)) {
        conflicts.push({ id: post.id, existingUrl: currentUrl, newUrl: url });
      }
      continue;
    }

    // 0개 또는 2개 이상 — og:title 정규화 일치로 폴백
    const ogTitle = extractOgTitle(html);
    if (!ogTitle) {
      skipped.push({ url, reason: `id ${ids.length}개 추출, og:title 없음` });
      continue;
    }
    const normTitle = normalizeTitle(ogTitle);
    const candidates = allPosts.filter((p) => {
      const currentUrl = effective.get(p.id) ?? p.tistory_url ?? "";
      return !currentUrl && normalizeTitle(p.title) === normTitle;
    });
    if (candidates.length === 1) {
      matched.push({ postId: candidates[0].id, url });
      effective.set(candidates[0].id, url);
    } else {
      skipped.push({
        url,
        reason: `id ${ids.length}개 추출, 제목 매칭 ${candidates.length}건("${ogTitle.slice(0, 40)}")`,
      });
    }
  }

  return { pagesFetched, matched, conflicts, skipped };
}

async function main() {
  const { getGaProperties, getAllPosts, updatePostTistoryUrl } = await import(
    "../lib/sheets"
  );

  const props = await getGaProperties();
  if (props.length === 0) {
    console.log("settings에 활성 ga_property 없음 — 종료");
    console.log(
      JSON.stringify({ blogs: 0, pagesFetched: 0, matched: 0, skipped: 0, conflicts: 0 }),
    );
    return;
  }

  const posts = await getAllPosts();
  const effective = new Map<string, string>(); // 이번 실행 중 확정된 매칭 (postId → url)

  let totalPagesFetched = 0;
  let totalMatched = 0;
  let totalSkipped = 0;
  let totalConflicts = 0;
  let blogsProcessed = 0;

  const allMatches: MatchResult[] = [];

  for (const prop of props) {
    if (!prop.tistory_url) {
      console.log(`[${prop.label}] tistory_url 미설정 — skip`);
      continue;
    }
    let origin: string;
    try {
      origin = new URL(prop.tistory_url).origin;
    } catch {
      console.log(`[${prop.label}] tistory_url 파싱 실패: ${prop.tistory_url}`);
      continue;
    }

    blogsProcessed++;
    const { pagesFetched, matched, conflicts, skipped } = await processBlog(
      origin,
      prop.label,
      posts,
      effective,
    );

    totalPagesFetched += pagesFetched;
    totalMatched += matched.length;
    totalSkipped += skipped.length;
    totalConflicts += conflicts.length;
    allMatches.push(...matched);

    console.log(
      `[${prop.label}] 페이지 ${pagesFetched}건 fetch · 매칭 ${matched.length} · conflict ${conflicts.length} · skip ${skipped.length}`,
    );
    for (const m of matched) console.log(`  매칭: ${m.postId} → ${m.url}`);
    for (const c of conflicts)
      console.log(
        `  conflict: ${c.id} 기존=${c.existingUrl} 신규=${c.newUrl} (덮어쓰지 않음)`,
      );
    for (const s of skipped) console.log(`  skip: ${s.url} — ${s.reason}`);
  }

  if (!DRY) {
    for (const m of allMatches) {
      await updatePostTistoryUrl(m.postId, m.url);
    }
    console.log(`[기록] ${allMatches.length}건 tistory_url 기록 완료`);
  } else {
    console.log(
      `[dry-run] 시트 무변경 — 매칭 ${allMatches.length}건 (실행 모드에서 기록됨)`,
    );
  }

  console.log(
    JSON.stringify({
      blogs: blogsProcessed,
      pagesFetched: totalPagesFetched,
      matched: totalMatched,
      skipped: totalSkipped,
      conflicts: totalConflicts,
    }),
  );
}

main().catch((e) => {
  console.error("ERR:", e);
  process.exit(1);
});
