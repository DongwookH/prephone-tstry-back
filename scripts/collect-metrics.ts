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
  const { getAllPosts, updatePostGaPageviews, appendMetricsDaily, appendThreadsMetrics, getThreadsDrafts } = await import("../lib/sheets");
  const { getThreadsToken, getMediaInsights } = await import("../lib/threads");
  const { styleFromInsight, matchPostByPath } = await import("../lib/metrics-utils");
  const { sendTelegram } = await import("../lib/telegram");

  let gaToken: string | null = null;
  try {
    gaToken = await getGaAccessTokenForCron();
  } catch (e) {
    errors.push(`GA 토큰: ${(e as Error).message}`);
  }

  // a) Tistory 글별 조회수 → posts.ga_pageviews (누적 30일)
  const topPosts: { id: string; title: string; pv: number }[] = [];
  if (gaToken) {
    try {
      const pvByPath = await getPagePathPageviews(gaToken, 30, 500);
      const posts = (await getAllPosts()).filter((p) => p.tistory_url);
      const byId = new Map<string, number>();
      for (const [path, pv] of Object.entries(pvByPath)) {
        const id = matchPostByPath(path, posts);
        if (id) byId.set(id, (byId.get(id) ?? 0) + pv);
      }
      for (const [id, pv] of byId) {
        if (!DRY) await updatePostGaPageviews(id, pv);
        const post = posts.find((p) => p.id === id);
        topPosts.push({ id, title: post?.title ?? id, pv });
      }
      topPosts.sort((a, b) => b.pv - a.pv);
      anySourceOk = true;
      console.log(`[tistory] 매칭 ${byId.size}글 / GA 경로 ${Object.keys(pvByPath).length}개`);
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
