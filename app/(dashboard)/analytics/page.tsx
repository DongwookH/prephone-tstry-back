import { Topbar } from "@/components/topbar";
import { getAllPosts, toKstDate, getGaProperties } from "@/lib/sheets";
import { MultiBlogAnalytics } from "@/components/multi-blog-analytics";
import { auth } from "@/auth";
import {
  getOverview,
  getDailyTrend,
  getTopPages,
  getChannels,
  getRealtimeOverview,
  getRealtimeTopPages,
  type GAOverview,
  type GADailyRow,
  type GATopPage,
  type GAChannelRow,
  type GARealtimeOverview,
  type GARealtimeTopPage,
} from "@/lib/ga4";
import Link from "next/link";
import { ExternalLink, AlertTriangle, LogIn } from "lucide-react";

export const dynamic = "force-dynamic";

interface GAState {
  ok: boolean;
  reason?: "no-session" | "no-token" | "refresh-error" | "no-property" | "api-error";
  message?: string;
  overview?: GAOverview;
  daily?: GADailyRow[];
  topPages?: GATopPage[];
  channels?: GAChannelRow[];
  realtime?: GARealtimeOverview;
  realtimeTopPages?: GARealtimeTopPage[];
}

async function loadGA(): Promise<GAState> {
  const session = await auth();
  if (!session) return { ok: false, reason: "no-session" };
  if (session.error === "RefreshAccessTokenError") {
    return {
      ok: false,
      reason: "refresh-error",
      message: "GA 인증 만료 — 로그아웃 후 재로그인",
    };
  }
  if (!session.accessToken) {
    return {
      ok: false,
      reason: "no-token",
      message:
        "Analytics scope 미동의 — 로그아웃 후 재로그인 (analytics.readonly 권한 필요)",
    };
  }
  if (!process.env.GA_PROPERTY_ID) {
    return {
      ok: false,
      reason: "no-property",
      message: "GA_PROPERTY_ID env 미설정",
    };
  }
  try {
    // 일반 API + 실시간 API 병렬 호출
    // 실시간 실패해도 일반은 보여줘야 하니 별도 try
    const [overview, daily, topPages, channels] = await Promise.all([
      getOverview(session.accessToken, 7),
      getDailyTrend(session.accessToken, 7),
      getTopPages(session.accessToken, 7, 7),
      getChannels(session.accessToken, 7),
    ]);

    let realtime: GARealtimeOverview | undefined;
    let realtimeTopPages: GARealtimeTopPage[] | undefined;
    try {
      [realtime, realtimeTopPages] = await Promise.all([
        getRealtimeOverview(session.accessToken),
        getRealtimeTopPages(session.accessToken, 5),
      ]);
    } catch {
      // 실시간 API 실패해도 일반 데이터는 표시
    }

    return {
      ok: true,
      overview,
      daily,
      topPages,
      channels,
      realtime,
      realtimeTopPages,
    };
  } catch (err) {
    return {
      ok: false,
      reason: "api-error",
      message: (err as Error).message,
    };
  }
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  // 기간 토글 — ?days=1 (오늘) | 7 | 30. 기본 7일.
  const sp = await searchParams;
  const parsed = parseInt(sp.days || "7", 10);
  const days =
    parsed === 1 || parsed === 7 || parsed === 30 ? parsed : 7;

  const [all, ga, gaProps] = await Promise.all([
    getAllPosts(),
    loadGA(),
    getGaProperties().catch(() => []),
  ]);

  // 등록된 블로그 GA가 있으면 multi-blog 섹션을 페이지 최상단에 표시.
  // 옛 단일 GA_PROPERTY_ID 섹션은 multi-blog 없을 때만 fallback으로 유지.
  const hasMultiBlog = gaProps.length > 0;

  const totalPosts = all.length;

  // ── KPI: GA가 연결되면 GA 우선, 아니면 시트 fallback ─────────
  const totalPageviews =
    ga.overview?.pageviews ??
    all.reduce((a, p) => a + parseInt(p.ga_pageviews || "0", 10), 0);
  const totalUsers = ga.overview?.activeUsers ?? 0;
  const totalSessions = ga.overview?.sessions ?? 0;
  const bouncePct =
    ga.overview?.bounceRate !== undefined
      ? Math.round(ga.overview.bounceRate * 1000) / 10
      : null;
  const avgDur =
    ga.overview?.avgSessionDuration !== undefined
      ? Math.round(ga.overview.avgSessionDuration)
      : null;

  // ── 7일 발행 추이 (시트 기반은 그대로 유지) ──────────
  const trendDays: {
    label: string;
    published: number;
    ready: number;
  }[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    // KST 기준 날짜로 비교 (created_at은 UTC ISO이라 변환 필요)
    const dStr = toKstDate(date);
    const label =
      i === 0
        ? "오늘"
        : ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
    const dayPosts = all.filter(
      (p) => p.created_at && toKstDate(p.created_at) === dStr,
    );
    trendDays.push({
      label,
      published: dayPosts.filter((p) => p.status === "published").length,
      ready: dayPosts.filter((p) => p.status === "ready").length,
    });
  }
  const maxBar = Math.max(
    ...trendDays.flatMap((d) => [d.published, d.ready]),
    10,
  );

  // ── GA 일자별 페이지뷰 (있을 때만) ──────────
  const gaDailyMax = ga.daily
    ? Math.max(...ga.daily.map((d) => d.pageviews), 10)
    : 10;

  // ── 카테고리 분포 ──────────
  const catCounts: Record<string, number> = {};
  for (const p of all) {
    const c = p.category || "기타";
    catCounts[c] = (catCounts[c] || 0) + 1;
  }
  const sortedCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <Topbar
        crumbs={[{ label: "워크스페이스" }, { label: "분석", bold: true }]}
        right={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 p-1 rounded-xl bg-ink-100">
              <Link
                href="/analytics?days=1"
                className={`px-3 h-8 rounded-lg text-[12px] flex items-center transition ${
                  days === 1
                    ? "bg-white shadow-card font-bold text-ink-900"
                    : "font-semibold text-ink-600 hover:text-ink-900"
                }`}
              >
                오늘
              </Link>
              <Link
                href="/analytics?days=7"
                className={`px-3 h-8 rounded-lg text-[12px] flex items-center transition ${
                  days === 7
                    ? "bg-white shadow-card font-bold text-ink-900"
                    : "font-semibold text-ink-600 hover:text-ink-900"
                }`}
              >
                7일
              </Link>
              <Link
                href="/analytics?days=30"
                className={`px-3 h-8 rounded-lg text-[12px] flex items-center transition ${
                  days === 30
                    ? "bg-white shadow-card font-bold text-ink-900"
                    : "font-semibold text-ink-600 hover:text-ink-900"
                }`}
              >
                30일
              </Link>
            </div>
            <a
              href="https://analytics.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className="h-9 px-3 rounded-xl text-[13px] font-semibold text-ink-700 hover:bg-ink-100 transition flex items-center gap-1.5"
            >
              <ExternalLink size={13} />
              GA4 열기
            </a>
          </div>
        }
      />

      <div className="px-8 py-8 max-w-[1400px] mx-auto">
        {/* ─── 블로그별 GA4 멀티 분석 (등록된 경우만) ─── */}
        {hasMultiBlog && (
          <div className="mb-8">
            <MultiBlogAnalytics days={days} />
          </div>
        )}

        {!hasMultiBlog && (
          <section className="mb-6">
            <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-3 text-[12px] text-ink-700">
              💡 <strong>블로그 5개 GA4를 등록</strong>하시면 여기서 합산 +
              블로그별 비교 보기가 가능해요.{" "}
              <Link
                href="/settings#ga-blogs"
                className="text-brand-700 font-bold underline"
              >
                설정 → GA4 블로그
              </Link>
              에서 추가하세요.
            </div>
          </section>
        )}

        <section className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="relative flex h-2 w-2">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${
                  ga.ok ? "bg-mint-500" : "bg-amber-500"
                }`}
              ></span>
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  ga.ok ? "bg-mint-500" : "bg-amber-500"
                }`}
              ></span>
            </span>
            <span
              className={`text-[12px] font-bold ${
                ga.ok ? "text-mint-700" : "text-amber-700"
              }`}
            >
              {ga.ok ? "GA4 실시간 연동 중" : "GA4 미연결"}
            </span>
          </div>
          <h1 className="text-[28px] font-extrabold text-ink-900 tracking-tight">
            {hasMultiBlog ? "콘텐츠 통계" : "성과 분석"}
          </h1>
          <p className="mt-1 text-[14px] text-ink-600">
            {hasMultiBlog
              ? "발행 글 수·추이·카테고리 분포 (위 GA4 블로그별 카드와 별개)"
              : "최근 7일 GA4 데이터 + 시트 발행 추이를 한눈에 확인하세요."}
          </p>
        </section>

        {!hasMultiBlog && !ga.ok && <GANotConnected state={ga} />}

        {/* 실시간 (지난 30분) — multi-blog 섹션에 이미 합산 실시간이 있으면 생략 */}
        {!hasMultiBlog && ga.ok && ga.realtime && (
          <RealtimeBlock
            overview={ga.realtime}
            topPages={ga.realtimeTopPages ?? []}
          />
        )}

        {/* KPI — multi-blog일 땐 GA 의존 카드 숨김(합산은 위에 있음), 총 글 수만 단독 */}
        {hasMultiBlog ? (
          <section className="grid grid-cols-4 gap-4 mb-6">
            <KPI
              label="총 글 수"
              value={`${totalPosts}`}
              sub="발행 + 대기 합계"
            />
            <div className="col-span-3 rounded-2xl border border-dashed border-ink-200 p-4 text-[12px] text-ink-500 flex items-center justify-center">
              GA4 KPI는 위 “전체 합계 — 최근 7일” 섹션을 참고하세요.
            </div>
          </section>
        ) : (
          <section className="grid grid-cols-4 gap-4 mb-6">
            <KPI
              label="총 글 수"
              value={`${totalPosts}`}
              sub="발행 + 대기 합계"
            />
            <KPI
              label="페이지뷰 (7일)"
              value={totalPageviews.toLocaleString()}
              sub={ga.ok ? "GA4 실시간" : "GA4 미연결"}
            />
            <KPI
              label="활성 사용자 (7일)"
              value={totalUsers.toLocaleString()}
              sub={
                ga.ok ? `세션 ${totalSessions.toLocaleString()}` : "GA4 미연결"
              }
            />
            <DarkKPI
              label="이탈률 / 체류시간"
              value={
                bouncePct !== null && avgDur !== null ? `${bouncePct}%` : "—"
              }
              sub={
                avgDur !== null
                  ? `평균 체류 ${formatDuration(avgDur)}`
                  : "GA4 미연결"
              }
            />
          </section>
        )}

        <section className="bg-white rounded-2xl shadow-card p-6 mb-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-[16px] font-extrabold text-ink-900">
                7일 발행 추이
              </h3>
              <p className="text-[12px] text-ink-500 mt-0.5">
                일별 발행 완료 + 대기
              </p>
            </div>
            <div className="flex items-center gap-4 text-[12px] font-bold">
              <Legend color="bg-mint-500" label="발행 완료" />
              <Legend color="bg-amber-500" label="대기" />
            </div>
          </div>
          <BarChart7Day days={trendDays} maxBar={maxBar} />
        </section>

        {!hasMultiBlog && ga.ok && ga.daily && ga.daily.length > 0 && (
          <section className="bg-white rounded-2xl shadow-card p-6 mb-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-[16px] font-extrabold text-ink-900">
                  GA4 일별 페이지뷰
                </h3>
                <p className="text-[12px] text-ink-500 mt-0.5">
                  최근 7일 — Google Analytics 실시간 데이터
                </p>
              </div>
              <Legend color="bg-brand-500" label="페이지뷰" />
            </div>
            <GADailyChart daily={ga.daily} maxBar={gaDailyMax} />
          </section>
        )}

        {!hasMultiBlog && (
        <section className="grid grid-cols-3 gap-6">
          <div className="col-span-2 bg-white rounded-2xl shadow-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[16px] font-extrabold text-ink-900">
                GA4 인기 페이지 TOP 7
              </h3>
              <Link
                href="/posts"
                className="text-[12px] font-bold text-brand-600 hover:text-brand-700"
              >
                전체 보기 →
              </Link>
            </div>
            {ga.ok && ga.topPages && ga.topPages.length > 0 ? (
              <div className="space-y-3">
                {ga.topPages.map((p, i) => (
                  <a
                    key={p.path + i}
                    href={`https://ntelecomsafe.tistory.com${p.path}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-4 p-3 -mx-3 rounded-xl hover:bg-ink-50 transition"
                  >
                    <span
                      className={
                        i === 0
                          ? "w-7 h-7 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white font-extrabold text-[12px] flex items-center justify-center"
                          : "w-7 h-7 rounded-lg bg-ink-100 text-ink-700 font-extrabold text-[12px] flex items-center justify-center"
                      }
                    >
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-bold text-ink-900 truncate">
                        {p.title || p.path}
                      </div>
                      <div className="text-[11px] text-ink-500 mt-0.5 truncate">
                        {p.path}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[14px] font-extrabold text-ink-900 tabular-nums">
                        {p.pageviews.toLocaleString()}
                      </div>
                      <div className="text-[10px] font-bold text-ink-500">
                        사용자 {p.activeUsers}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-ink-500 text-[13px]">
                {ga.ok
                  ? "최근 7일 페이지뷰가 아직 없습니다"
                  : "GA4 연결 후 인기 페이지가 표시됩니다"}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="bg-white rounded-2xl shadow-card p-6">
              <h3 className="text-[15px] font-extrabold text-ink-900 mb-4">
                카테고리 분포
              </h3>
              {sortedCats.length > 0 ? (
                <div className="space-y-3">
                  {sortedCats.slice(0, 6).map(([cat, n]) => {
                    const pct = Math.round((n / Math.max(totalPosts, 1)) * 100);
                    return (
                      <div key={cat}>
                        <div className="flex justify-between mb-1.5">
                          <span className="text-[12px] font-bold text-ink-700">
                            {cat}
                          </span>
                          <span className="text-[12px] font-extrabold text-ink-900">
                            {n} ({pct}%)
                          </span>
                        </div>
                        <div className="h-2 bg-ink-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-brand-500 rounded-full"
                            style={{ width: `${pct}%` }}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-6 text-center text-ink-500 text-[12px]">
                  글이 아직 없습니다
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow-card p-6">
              <h3 className="text-[15px] font-extrabold text-ink-900 mb-4">
                유입 채널
              </h3>
              {ga.ok && ga.channels && ga.channels.length > 0 ? (
                <div className="space-y-3">
                  {ga.channels.slice(0, 6).map((c) => {
                    const totSess = ga.channels!.reduce(
                      (a, x) => a + x.sessions,
                      0,
                    );
                    const pct =
                      totSess > 0
                        ? Math.round((c.sessions / totSess) * 100)
                        : 0;
                    return (
                      <div key={c.channel}>
                        <div className="flex justify-between mb-1.5">
                          <span className="text-[12px] font-bold text-ink-700 truncate max-w-[140px]">
                            {c.channel}
                          </span>
                          <span className="text-[12px] font-extrabold text-ink-900">
                            {c.sessions.toLocaleString()} ({pct}%)
                          </span>
                        </div>
                        <div className="h-2 bg-ink-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-mint-500 rounded-full"
                            style={{ width: `${pct}%` }}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-[12px] text-ink-500 leading-relaxed">
                    GA4 연결 후 Google/네이버/Direct 등<br />
                    채널별 세션 분포가 표시됩니다
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>
        )}
      </div>
    </>
  );
}

function GANotConnected({ state }: { state: GAState }) {
  const isAuthIssue =
    state.reason === "no-token" || state.reason === "refresh-error";
  return (
    <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
      <AlertTriangle
        size={20}
        className="text-amber-600 flex-shrink-0 mt-0.5"
      />
      <div className="flex-1">
        <div className="text-[14px] font-extrabold text-amber-900 mb-1">
          GA4 데이터를 불러오지 못했습니다
        </div>
        <div className="text-[12px] text-amber-800 leading-relaxed mb-2">
          {state.message ??
            "GA_PROPERTY_ID env 또는 OAuth 권한을 확인해주세요"}
        </div>
        {isAuthIssue && (
          <Link
            href="/api/auth/signout"
            className="inline-flex items-center gap-1.5 text-[12px] font-bold text-amber-900 underline underline-offset-2 hover:no-underline"
          >
            <LogIn size={12} />
            로그아웃하고 재로그인 → analytics 권한 동의
          </Link>
        )}
        {state.reason === "no-property" && (
          <code className="block mt-1 text-[11px] text-amber-900 bg-white/60 px-2 py-1 rounded">
            .env.local 또는 Vercel env에 GA_PROPERTY_ID 등록 필요
          </code>
        )}
      </div>
    </div>
  );
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}분 ${s}초`;
}

function RealtimeBlock({
  overview,
  topPages,
}: {
  overview: GARealtimeOverview;
  topPages: GARealtimeTopPage[];
}) {
  return (
    <section className="bg-gradient-to-br from-mint-50 to-brand-50/40 border border-mint-200 rounded-2xl p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-mint-500 opacity-70"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-mint-500"></span>
          </span>
          <h3 className="text-[15px] font-extrabold text-ink-900">
            지금 실시간
          </h3>
          <span className="text-[11px] text-ink-500 font-bold">
            (지난 30분)
          </span>
        </div>
        <span className="text-[10px] text-mint-700 font-bold bg-white rounded-full px-2 py-0.5">
          GA4 Realtime API
        </span>
      </div>

      <div className="grid grid-cols-[200px_1fr] gap-5 items-stretch">
        {/* 좌측: 큰 활성 사용자 카운트 */}
        <div className="bg-white rounded-xl p-4 flex flex-col justify-center items-center text-center shadow-card">
          <div className="text-[40px] font-extrabold tabular-nums text-mint-700 leading-none">
            {overview.activeUsers}
          </div>
          <div className="text-[11px] font-bold text-ink-700 mt-1.5">
            활성 사용자
          </div>
          <div className="text-[10px] text-ink-500 mt-0.5">
            페이지뷰 {overview.pageviews}
          </div>
        </div>

        {/* 우측: 인기 페이지 TOP 5 */}
        <div className="bg-white rounded-xl p-4 shadow-card">
          <div className="text-[11px] font-bold text-ink-500 tracking-wider mb-2">
            지금 사람들이 보는 페이지
          </div>
          {topPages.length > 0 ? (
            <ul className="space-y-1.5">
              {topPages.slice(0, 5).map((p, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 text-[12px]"
                >
                  <span className="font-extrabold text-mint-700 tabular-nums w-6 text-right">
                    {p.activeUsers}
                  </span>
                  <span className="text-ink-700 truncate flex-1 font-medium">
                    {p.path}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="py-3 text-[12px] text-ink-500 italic">
              지난 30분간 방문자 없음. 사이트 방문 후 1-2분 뒤 다시
              확인하세요.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-3 h-3 rounded-sm ${color}`}></span>
      <span className="text-ink-700">{label}</span>
    </div>
  );
}

function KPI({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-card p-6">
      <div className="flex items-center justify-between mb-4">
        <span className="text-[12px] font-bold text-ink-500 tracking-wider">
          {label}
        </span>
      </div>
      <div className="text-[32px] font-extrabold tabular-nums text-ink-900">
        {value}
      </div>
      {sub && (
        <div className="text-[11px] font-bold text-ink-500 mt-1">{sub}</div>
      )}
    </div>
  );
}

function DarkKPI({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="bg-ink-900 text-white rounded-2xl shadow-card p-6 relative overflow-hidden">
      <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-brand-500/30 blur-2xl"></div>
      <div className="relative flex items-center justify-between mb-4">
        <span className="text-[12px] font-bold text-white/60 tracking-wider">
          {label}
        </span>
      </div>
      <div className="relative text-[32px] font-extrabold tabular-nums">
        {value}
      </div>
      <div className="relative text-[11px] font-bold text-white/70 mt-1">
        {sub}
      </div>
    </div>
  );
}

function BarChart7Day({
  days,
  maxBar,
}: {
  days: { label: string; published: number; ready: number }[];
  maxBar: number;
}) {
  const chartH = 200;
  return (
    <svg viewBox="0 0 700 240" className="w-full h-[240px]">
      <line x1="0" y1="40" x2="700" y2="40" stroke="#F2F4F6" />
      <line x1="0" y1="100" x2="700" y2="100" stroke="#F2F4F6" />
      <line x1="0" y1="160" x2="700" y2="160" stroke="#F2F4F6" />
      <line x1="0" y1="220" x2="700" y2="220" stroke="#E5E8EB" />
      {days.map((day, i) => {
        const baseX = 40 + i * 95;
        const phHeight = (day.published / maxBar) * chartH;
        const rdHeight = (day.ready / maxBar) * chartH;
        const isToday = day.label === "오늘";
        return (
          <g key={day.label}>
            <rect
              x={baseX}
              y={220 - phHeight}
              width="20"
              height={phHeight}
              rx="3"
              fill={isToday ? "#00A076" : "#00C896"}
            />
            <rect
              x={baseX + 24}
              y={220 - rdHeight}
              width="20"
              height={rdHeight}
              rx="3"
              fill={isToday ? "#D67700" : "#FF9500"}
            />
            <text
              x={baseX + 22}
              y="236"
              textAnchor="middle"
              fill={isToday ? "#191F28" : "#8B95A1"}
              fontSize="11"
              fontWeight={isToday ? 800 : 700}
            >
              {day.label}
            </text>
            {day.published > 0 && (
              <text
                x={baseX + 10}
                y={220 - phHeight - 4}
                textAnchor="middle"
                fontSize="10"
                fill="#191F28"
                fontWeight="700"
              >
                {day.published}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function GADailyChart({
  daily,
  maxBar,
}: {
  daily: GADailyRow[];
  maxBar: number;
}) {
  const chartH = 200;
  const colW = 700 / Math.max(daily.length, 1);
  return (
    <svg viewBox="0 0 700 240" className="w-full h-[240px]">
      <line x1="0" y1="40" x2="700" y2="40" stroke="#F2F4F6" />
      <line x1="0" y1="100" x2="700" y2="100" stroke="#F2F4F6" />
      <line x1="0" y1="160" x2="700" y2="160" stroke="#F2F4F6" />
      <line x1="0" y1="220" x2="700" y2="220" stroke="#E5E8EB" />
      {daily.map((d, i) => {
        const baseX = i * colW + colW / 2 - 14;
        const h = (d.pageviews / maxBar) * chartH;
        const isLast = i === daily.length - 1;
        const mmdd = d.date.slice(5).replace("-", "/");
        return (
          <g key={d.date}>
            <rect
              x={baseX}
              y={220 - h}
              width="28"
              height={h}
              rx="3"
              fill={isLast ? "#7FA512" : "#A8D533"}
            />
            <text
              x={baseX + 14}
              y="236"
              textAnchor="middle"
              fill={isLast ? "#191F28" : "#8B95A1"}
              fontSize="11"
              fontWeight={isLast ? 800 : 700}
            >
              {isLast ? "오늘" : mmdd}
            </text>
            {d.pageviews > 0 && (
              <text
                x={baseX + 14}
                y={220 - h - 4}
                textAnchor="middle"
                fontSize="10"
                fill="#191F28"
                fontWeight="700"
              >
                {d.pageviews}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
