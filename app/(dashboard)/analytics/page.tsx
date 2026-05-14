import { Topbar } from "@/components/topbar";
import { getAllPosts } from "@/lib/sheets";
import { ExternalLink } from "lucide-react";

export const revalidate = 60;

export default async function AnalyticsPage() {
  const all = await getAllPosts();

  const totalPosts = all.length;
  const totalPageviews = all.reduce(
    (a, p) => a + parseInt(p.ga_pageviews || "0", 10),
    0,
  );
  const totalClicks = all.reduce(
    (a, p) => a + parseInt(p.ga_clicks || "0", 10),
    0,
  );
  const totalConversions = all.reduce(
    (a, p) => a + parseInt(p.ga_conversions || "0", 10),
    0,
  );
  const ctr =
    totalPageviews > 0
      ? Math.round((totalClicks / totalPageviews) * 1000) / 10
      : 0;
  const cvr =
    totalClicks > 0
      ? Math.round((totalConversions / totalClicks) * 1000) / 10
      : 0;

  // 7일 발행 추이
  const days: {
    label: string;
    published: number;
    ready: number;
  }[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dStr = date.toISOString().slice(0, 10);
    const label =
      i === 0
        ? "오늘"
        : ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
    const dayPosts = all.filter((p) => p.created_at?.slice(0, 10) === dStr);
    days.push({
      label,
      published: dayPosts.filter((p) => p.status === "published").length,
      ready: dayPosts.filter((p) => p.status === "ready").length,
    });
  }
  const maxBar = Math.max(...days.flatMap((d) => [d.published, d.ready]), 10);

  // TOP 7
  const topPosts = [...all]
    .map((p) => ({
      ...p,
      _pv: parseInt(p.ga_pageviews || "0", 10),
      _conv: parseInt(p.ga_conversions || "0", 10),
    }))
    .sort((a, b) => b._pv - a._pv || (b._conv - a._conv))
    .slice(0, 7);

  // 카테고리 분포
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
              <button className="px-3 h-8 rounded-lg text-[12px] font-semibold text-ink-600 hover:text-ink-900">
                오늘
              </button>
              <button className="px-3 h-8 rounded-lg bg-white shadow-card text-[12px] font-bold text-ink-900">
                7일
              </button>
              <button className="px-3 h-8 rounded-lg text-[12px] font-semibold text-ink-600 hover:text-ink-900">
                30일
              </button>
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
        <section className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-mint-500 opacity-60"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-mint-500"></span>
            </span>
            <span className="text-[12px] font-bold text-mint-700">
              Google Sheet 실시간 연동
            </span>
            {totalPageviews === 0 && (
              <>
                <span className="text-[12px] text-ink-500">·</span>
                <span className="text-[12px] font-bold text-amber-700">
                  GA4 측정 ID 미연결 (트래픽 0)
                </span>
              </>
            )}
          </div>
          <h1 className="text-[28px] font-extrabold text-ink-900 tracking-tight">
            성과 분석
          </h1>
          <p className="mt-1 text-[14px] text-ink-600">
            posts 시트의 글별 성과 + 발행 추이를 한눈에 확인하세요.
          </p>
        </section>

        <section className="grid grid-cols-4 gap-4 mb-6">
          <KPI label="총 글 수" value={`${totalPosts}`} sub="발행 + 대기 합계" />
          <KPI
            label="총 페이지뷰"
            value={totalPageviews.toLocaleString()}
            sub={totalPageviews > 0 ? "GA4 연동" : "GA4 미연결"}
          />
          <KPI
            label="유입 클릭"
            value={totalClicks.toLocaleString()}
            sub={ctr > 0 ? `CTR ${ctr}%` : "GA4 이벤트 필요"}
          />
          <DarkKPI
            label="전환"
            value={`${totalConversions}`}
            sub={cvr > 0 ? `CVR ${cvr}%` : "GA4 전환 이벤트 필요"}
          />
        </section>

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
          <BarChart7Day days={days} maxBar={maxBar} />
        </section>

        <section className="grid grid-cols-3 gap-6">
          <div className="col-span-2 bg-white rounded-2xl shadow-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[16px] font-extrabold text-ink-900">
                성과 TOP 7 글
              </h3>
              <a
                href="/posts"
                className="text-[12px] font-bold text-brand-600 hover:text-brand-700"
              >
                전체 보기 →
              </a>
            </div>
            {topPosts.length > 0 ? (
              <div className="space-y-3">
                {topPosts.map((p, i) => (
                  <a
                    key={p.id}
                    href={`/posts/${p.id}`}
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
                        {p.title}
                      </div>
                      <div className="text-[11px] text-ink-500 mt-0.5">
                        {p.keyword} · {p.created_at?.slice(0, 10)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[14px] font-extrabold text-ink-900 tabular-nums">
                        {p._pv.toLocaleString()}
                      </div>
                      {p._conv > 0 && (
                        <div className="text-[10px] font-bold text-mint-700">
                          전환 {p._conv}
                        </div>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-ink-500 text-[13px]">
                글이 아직 없거나 GA4 연동 전입니다
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
              <div className="text-center py-4">
                <p className="text-[12px] text-ink-500 leading-relaxed">
                  GA4 측정 ID를 .env에 등록하면
                  <br />
                  Google/네이버/Direct 등 채널별 분포가
                  <br />
                  자동으로 표시됩니다
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
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
