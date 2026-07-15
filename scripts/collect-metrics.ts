/**
 * scripts/collect-metrics.ts — 하루 1회 성과 수집 + 아침 텔레그램 브리핑.
 * 소스별 try/catch 격리: 하나 실패해도 나머지는 수집·발송.
 * 실행: npx --yes tsx scripts/collect-metrics.ts [--dry-run]
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── .env.local 폴백 로드 (로컬 테스트용) ────────────────────────
// GHA에서는 env로 시크릿이 이미 주입되므로 파일이 없어도 무방.
// dotenv 의존성 없이 직접 파싱한다.
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
    // 감싼 따옴표 제거 (양끝이 같은 따옴표일 때만)
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

// ⚠️ .env.local 로드 "후"에 lib 모듈을 import해야 한다 (top-level import는
//    env 로드보다 먼저 실행되므로 dynamic import 사용).

const DRY = process.argv.includes("--dry-run");
const errors: string[] = [];
/** 소스(Tistory GA·ntelecom GA·Threads) 중 하나라도 실제 수집에 성공했는지. */
let anySourceOk = false;
const kstToday = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

/** 텔레그램 HTML parse_mode용 이스케이프. 제목·본문 등 외부 데이터를 메시지에 넣기 전 필수. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function main() {
  const { getGaAccessTokenForCron } = await import("../lib/ga-token");
  const { getPagePathPageviews, getUtmCampaignFunnel } = await import("../lib/ga4");
  const { getAllPosts, updatePostsGaPageviewsBatch, updatePostTistoryUrl, appendMetricsDaily, appendThreadsMetrics, getThreadsDrafts, getGaProperties } = await import("../lib/sheets");
  const { getThreadsToken, getMediaInsights } = await import("../lib/threads");
  const { styleFromInsight, matchPostByPath } = await import("../lib/metrics-utils");
  const { sendTelegram } = await import("../lib/telegram");

  let gaToken: string | null = null;
  try {
    gaToken = await getGaAccessTokenForCron();
  } catch (e) {
    errors.push(`GA 토큰: ${(e as Error).message}`);
  }

  // 시트는 한 번만 읽고 a0·a가 공유 — 반복 읽기는 Sheets 분당 쿼터(60/min)를 갉아먹는다.
  // (a0가 URL을 채우면 아래 allPosts의 같은 객체를 in-memory로도 갱신하므로 a)가 재읽기 불필요)
  const gaProps = await getGaProperties().catch((e) => {
    errors.push(`ga_property 설정 읽기: ${(e as Error).message}`);
    return [] as Awaited<ReturnType<typeof getGaProperties>>;
  });
  const allPosts = await getAllPosts().catch((e) => {
    errors.push(`posts 읽기: ${(e as Error).message}`);
    return [] as Awaited<ReturnType<typeof getAllPosts>>;
  });

  // a0) 신규 발행 글 URL 자동 채움 — 블로그 RSS(최신 10개)에서 data-filename의 글 ID 추출
  //     a)가 조회수 매칭에 쓰는 posts.tistory_url을 발행 직후부터 채워둬야 다음 GA
  //     매칭 정확도가 올라간다. 보강 단계 — 실패해도 errors에만 기록하고 다른 소스는
  //     계속 진행(anySourceOk에는 관여 안 함, 소스 자체가 아니라 보강이므로).
  try {
    const { extractPostIds, parseRssItems } = await import("../lib/tistory-match");
    const props0 = gaProps;
    const postsById0 = new Map(allPosts.map((p) => [p.id, p]));
    let filled = 0;
    const rssErrors: string[] = [];
    for (const prop of props0) {
      if (!prop.tistory_url) continue;
      try {
        const origin = new URL(prop.tistory_url).origin;
        const res = await fetch(`${origin}/rss`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const xml = await res.text();
        const items = parseRssItems(xml);
        for (const item of items) {
          const ids = extractPostIds(item.description);
          if (ids.length !== 1) continue;
          const post = postsById0.get(ids[0]);
          if (!post || post.tistory_url) continue;
          // 글 URL만 기록 (공지·카테고리 등 방어 — 백필 스크립트와 동일 기준)
          try {
            const lu = new URL(item.link);
            if (lu.origin !== origin || !/^\/\d+$/.test(lu.pathname)) continue;
          } catch {
            continue;
          }
          if (!DRY) await updatePostTistoryUrl(post.id, item.link);
          post.tistory_url = item.link; // 이번 실행 내 재매칭 방지 (같은 id가 여러 item에 안 나오지만 방어적으로)
          filled++;
        }
      } catch (e) {
        rssErrors.push(`${prop.label}: ${(e as Error).message}`);
      }
    }
    if (rssErrors.length > 0) {
      errors.push(`URL 자동 채움 일부 실패: ${rssErrors.join(" / ")}`);
    }
    console.log(`[url-fill] ${filled}건 채움`);
  } catch (e) {
    errors.push(`URL 자동 채움: ${(e as Error).message}`);
  }

  // a) Tistory 글별 조회수 → posts.ga_pageviews (누적 30일)
  //    블로그가 5개(settings의 ga_property 행, 대시보드 통계와 동일 소스)라
  //    속성별로 조회하고, 경로 매칭은 그 속성의 블로그(tistory_url 호스트) 글로만 한정
  //    (블로그가 달라도 pagePath는 "/123"처럼 겹칠 수 있음 — 호스트 스코프 필수).
  const topPosts: { id: string; title: string; pv: number }[] = [];
  if (gaToken) {
    try {
      const props = gaProps;
      if (props.length === 0) throw new Error("settings에 활성 ga_property 없음");
      const posts = allPosts.filter((p) => p.tistory_url);
      const byId = new Map<string, number>();
      let pathTotal = 0;
      const propErrors: string[] = [];
      for (const prop of props) {
        try {
          const origin = new URL(prop.tistory_url).origin;
          const blogPosts = posts.filter((p) => {
            try {
              return new URL(p.tistory_url).origin === origin;
            } catch {
              return false;
            }
          });
          const pvByPath = await getPagePathPageviews(gaToken, 30, 500, prop.property_id);
          pathTotal += Object.keys(pvByPath).length;
          for (const [path, pv] of Object.entries(pvByPath)) {
            const id = matchPostByPath(path, blogPosts);
            if (id) byId.set(id, (byId.get(id) ?? 0) + pv);
          }
        } catch (e) {
          propErrors.push(`${prop.label}: ${(e as Error).message}`);
        }
      }
      if (propErrors.length > 0) {
        errors.push(`Tistory GA 일부 속성 실패: ${propErrors.join(" / ")}`);
      }
      // 일괄 쓰기 (1읽기+1쓰기) — per-post 루프는 분당 쿼터 초과 (2026-07-15 사고)
      if (!DRY) {
        const written = await updatePostsGaPageviewsBatch(
          [...byId].map(([id, pageviews]) => ({ id, pageviews })),
        );
        console.log(`[tistory] ga_pageviews 일괄 갱신 ${written}건`);
      }
      for (const [id, pv] of byId) {
        const post = posts.find((p) => p.id === id);
        topPosts.push({ id, title: post?.title ?? id, pv });
      }
      topPosts.sort((a, b) => b.pv - a.pv);
      // 한 속성이라도 조회에 성공했으면 소스 자체는 살아있는 것 (매칭 0은 URL 미기록 문제)
      if (propErrors.length < props.length) anySourceOk = true;
      console.log(
        `[tistory] 속성 ${props.length - propErrors.length}/${props.length}개 조회 · GA 경로 ${pathTotal}개 · 매칭 ${byId.size}글`,
      );
    } catch (e) {
      errors.push(`Tistory GA: ${(e as Error).message}`);
    }
  }

  // b) ntelecomsafe utm 퍼널 → metrics_daily
  let funnel: Awaited<ReturnType<typeof getUtmCampaignFunnel>> = [];
  const ntelProp = process.env.NTELECOM_GA_PROPERTY_ID;
  if (gaToken && ntelProp) {
    try {
      funnel = await getUtmCampaignFunnel(gaToken, ntelProp);
      anySourceOk = true;
      const rows = funnel.map((f) => [kstToday, "ntelecom", f.campaign, 0, f.sessions, f.step2Views, 0, ""]);
      if (!DRY) await appendMetricsDaily(rows);
      console.log(`[ntelecom] 캠페인 ${funnel.length}개`);
    } catch (e) {
      errors.push(`ntelecom GA: ${(e as Error).message}`);
    }
  } else if (!ntelProp) {
    errors.push("NTELECOM_GA_PROPERTY_ID 미설정");
  }

  // c) Threads insights (최근 14일 발행분) → threads_metrics
  let bestThread: { text: string; style: string; views: number; replies: number } | null = null;
  try {
    const token = await getThreadsToken();
    if (!token) throw new Error("Threads 토큰 없음");
    const drafts = (await getThreadsDrafts()).filter(
      (d) =>
        d.published_id &&
        d.published_at &&
        Date.now() - new Date(d.published_at).getTime() < 14 * 86_400_000,
    );
    const rows: (string | number)[][] = [];
    for (const d of drafts) {
      try {
        const ins = await getMediaInsights(d.published_id, token.access_token);
        rows.push([
          kstToday,
          d.published_id,
          d.id,
          d.keyword,
          styleFromInsight(d.insight),
          d.published_at,
          ins.views ?? 0,
          ins.likes ?? 0,
          ins.replies ?? 0,
          ins.reposts ?? 0,
          ins.quotes ?? 0,
        ]);
        if (!bestThread || (ins.views ?? 0) > bestThread.views) {
          bestThread = {
            text: d.draft_text.replace(/\n/g, " ").slice(0, 40),
            style: styleFromInsight(d.insight),
            views: ins.views ?? 0,
            replies: ins.replies ?? 0,
          };
        }
      } catch (e) {
        console.warn(`[threads] ${d.id} insights 실패: ${(e as Error).message}`);
      }
    }
    // per-item 실패가 전건이면(권한 문제 등) 조용히 넘어가지 않고 브리핑에 표면화
    if (drafts.length > 0 && rows.length === 0) {
      errors.push(`Threads insights 전건 실패(${drafts.length}건)`);
    }
    if (rows.length > 0) anySourceOk = true;
    if (!DRY) await appendThreadsMetrics(rows);
    console.log(`[threads] ${rows.length}/${drafts.length}건 수집`);
  } catch (e) {
    errors.push(`Threads: ${(e as Error).message}`);
  }

  // d) 아침 브리핑 (HTML parse_mode — 외부 텍스트는 반드시 이스케이프)
  const lines = [`📊 <b>${kstToday} 성과 브리핑</b>`];
  if (topPosts.length) {
    lines.push("유입 TOP3 (30일 누적):");
    topPosts
      .slice(0, 3)
      .forEach((p, i) => lines.push(`  ${i + 1}. ${escapeHtml(p.title.slice(0, 30))} (${p.pv})`));
  }
  const totalStep2 = funnel.reduce((a, f) => a + f.step2Views, 0);
  if (funnel.length) {
    lines.push(`어제 신청 페이지 도달: ${totalStep2}회`);
    funnel
      .filter((f) => f.step2Views > 0)
      .slice(0, 3)
      .forEach((f) => lines.push(`  · ${escapeHtml(f.campaign)}: 세션 ${f.sessions} → step2 ${f.step2Views}`));
  }
  if (bestThread) {
    lines.push(
      `Threads 최고: "${escapeHtml(bestThread.text)}…" 조회 ${bestThread.views}·댓글 ${bestThread.replies}${
        bestThread.style ? ` [${escapeHtml(bestThread.style)}]` : ""
      }`,
    );
  }
  lines.push(errors.length ? `⚠️ 수집 실패: ${escapeHtml(errors.join(" / "))}` : "수집 실패: 없음");
  const report = lines.join("\n");
  console.log("---report---\n" + report);
  if (!DRY) await sendTelegram(report);

  console.log(JSON.stringify({ ok: true, errors: errors.length, dry: DRY }));
  if (!anySourceOk) process.exit(1); // 전 소스 실패 시에만 빨강 (부분 실패는 브리핑에 표기하고 성공)
}

main().catch((e) => {
  console.error("ERR:", e);
  process.exit(1);
});
