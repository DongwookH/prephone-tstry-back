import { Topbar } from "@/components/topbar";
import { PostRow, PostRowHeader, EmptyPostsState } from "@/components/post-row";
import { getAllPosts, getTodayPosts } from "@/lib/sheets";
import {
  Bell,
  CheckCircle2,
  Check,
  Calendar,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { ManualGenerateButton } from "@/components/manual-generate-button";

export const revalidate = 60;

function todayKSTLabel() {
  const fmt = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  return fmt.format(new Date());
}

function timeKSTLabel() {
  const fmt = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return fmt.format(new Date());
}

export default async function Dashboard() {
  const [todayPosts, allPosts] = await Promise.all([
    getTodayPosts(),
    getAllPosts(),
  ]);

  const todayGenerated = todayPosts.length;
  const todayLimit = 10;
  const todayPublishedCount = todayPosts.filter(
    (p) => p.status === "published",
  ).length;
  const todayReady = todayPosts.filter((p) => p.status === "ready").length;

  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const weekPosts = allPosts.filter((p) => {
    const t = new Date(p.created_at).getTime();
    return !isNaN(t) && t >= weekAgo;
  });
  const weekPublished = weekPosts.filter((p) => p.status === "published")
    .length;
  const weekLimit = 70;

  const totalClicks = allPosts.reduce(
    (acc, p) => acc + parseInt(p.ga_clicks || "0", 10),
    0,
  );

  return (
    <>
      <Topbar
        crumbs={[{ label: "워크스페이스" }, { label: "대시보드", bold: true }]}
        right={
          <div className="flex items-center gap-2">
            <ManualGenerateButton />
            <button className="w-9 h-9 rounded-xl hover:bg-ink-100 transition flex items-center justify-center relative">
              <Bell size={18} strokeWidth={2} className="text-ink-700" />
              {todayReady > 0 && (
                <span className="absolute top-1.5 right-2 w-2 h-2 bg-rose-500 rounded-full ring-2 ring-ink-50"></span>
              )}
            </button>
          </div>
        }
      />

      <div className="px-10 py-8 max-w-[1280px] mx-auto">
        <section>
          <div className="flex items-end justify-between gap-6 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[13px] font-bold text-brand-600">
                  {todayKSTLabel()}
                </span>
                <span className="w-1 h-1 rounded-full bg-ink-300"></span>
                <span className="text-[13px] font-medium text-ink-500">
                  {timeKSTLabel()}
                </span>
              </div>
              <h1 className="text-[34px] font-extrabold text-ink-900 leading-tight tracking-tight">
                {todayGenerated > 0
                  ? `오늘의 글 ${todayGenerated}편이 도착했어요`
                  : "오늘 생성된 글이 아직 없어요"}
              </h1>
              <p className="mt-2 text-[15px] text-ink-600">
                {todayGenerated > 0
                  ? "AI가 SEO 최적화를 마쳐 두었습니다. 복사해서 바로 발행해 보세요."
                  : "매일 KST 09:00에 GitHub Actions가 자동으로 10편을 생성합니다."}
              </p>
            </div>
            <div className="flex items-center gap-2 h-11 px-4 rounded-2xl bg-white border border-ink-200">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-mint-500 opacity-60"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-mint-500"></span>
              </span>
              <span className="text-[13px] font-semibold text-ink-700">
                다음 생성
              </span>
              <span className="text-[13px] font-bold text-ink-900">
                내일 오전 9:00
              </span>
            </div>
          </div>
        </section>

        <section className="mt-8 grid grid-cols-4 gap-4">
          <StatCard
            label="오늘 생성"
            value={`${todayGenerated}`}
            sub={`/ ${todayLimit}`}
            progress={(todayGenerated / todayLimit) * 100}
            tone="brand"
            badge={
              todayGenerated >= todayLimit
                ? "완료"
                : `${todayLimit - todayGenerated}개 남음`
            }
            badgeTone={todayGenerated >= todayLimit ? "mint" : "amber"}
            Icon={CheckCircle2}
            iconBg="bg-brand-50"
            iconColor="#3182F6"
          />
          <StatCard
            label="발행 완료"
            value={`${todayPublishedCount}`}
            sub={`/ ${todayGenerated || 0}`}
            progress={
              todayGenerated
                ? (todayPublishedCount / todayGenerated) * 100
                : 0
            }
            tone="mint"
            badge={
              todayGenerated
                ? `${Math.round((todayPublishedCount / todayGenerated) * 100)}%`
                : "0%"
            }
            badgeTone="mint"
            Icon={Check}
            iconBg="bg-mint-50"
            iconColor="#00A076"
          />
          <StatCard
            label="주간 발행"
            value={`${weekPublished}`}
            sub={`/ ${weekLimit}`}
            progress={(weekPublished / weekLimit) * 100}
            tone="amber"
            badge={`${Math.round((weekPublished / weekLimit) * 100)}%`}
            badgeTone="amber"
            Icon={Calendar}
            iconBg="bg-amber-50"
            iconColor="#D67700"
          />
          <DarkStatCard
            label="누적 클릭 (GA)"
            value={`${totalClicks}`}
            note={
              totalClicks > 0
                ? `${allPosts.length}개 글 누적`
                : "GA4 연동 후 표시"
            }
          />
        </section>

        <section className="mt-12">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <h2 className="text-[20px] font-extrabold text-ink-900">
                오늘의 글
              </h2>
              <span className="text-[12px] font-bold bg-ink-100 text-ink-700 rounded-full px-2.5 py-1">
                {todayGenerated}
              </span>
            </div>
            {todayGenerated > 0 && (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 p-1 rounded-xl bg-ink-100">
                  <button className="px-3 h-8 rounded-lg bg-white shadow-card text-[12px] font-bold text-ink-900">
                    전체 {todayGenerated}
                  </button>
                  <button className="px-3 h-8 rounded-lg text-[12px] font-semibold text-ink-600 hover:text-ink-900 transition">
                    대기 {todayReady}
                  </button>
                  <button className="px-3 h-8 rounded-lg text-[12px] font-semibold text-ink-600 hover:text-ink-900 transition">
                    완료 {todayPublishedCount}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-card overflow-hidden">
            {todayGenerated > 0 ? (
              <>
                <PostRowHeader />
                <div className="divide-y divide-ink-100">
                  {todayPosts.map((p) => (
                    <PostRow key={p.id} post={p} />
                  ))}
                </div>
                <div className="px-5 py-3 border-t border-ink-100 bg-ink-50/40 flex items-center justify-between text-[12px]">
                  <span className="text-ink-500 font-medium">
                    총{" "}
                    <span className="font-bold text-ink-800">
                      {todayGenerated}
                    </span>
                    개 표시
                  </span>
                  <div className="flex items-center gap-2 text-ink-500">
                    <span>발행 완료</span>
                    <span className="font-extrabold text-mint-700">
                      {todayPublishedCount}
                    </span>
                    <span className="text-ink-300">·</span>
                    <span>대기</span>
                    <span className="font-extrabold text-amber-700">
                      {todayReady}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <EmptyPostsState
                message="오늘 생성된 글이 없습니다"
                hint="매일 KST 09:00에 자동 생성됩니다. 수동으로 호출하려면 POST /api/cron/generate (글 생성 라우트 구현 후)"
              />
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function StatCard({
  label,
  value,
  sub,
  progress,
  tone,
  badge,
  badgeTone,
  Icon,
  iconBg,
  iconColor,
}: {
  label: string;
  value: string;
  sub?: string;
  progress: number;
  tone: "brand" | "mint" | "amber";
  badge: string;
  badgeTone: "mint" | "amber";
  Icon: React.ElementType;
  iconBg: string;
  iconColor: string;
}) {
  const barColor =
    tone === "brand"
      ? "bg-brand-500"
      : tone === "mint"
        ? "bg-mint-500"
        : "bg-amber-500";
  const badgeColor = badgeTone === "mint" ? "text-mint-700" : "text-amber-700";
  return (
    <div className="bg-white rounded-2xl shadow-card p-6">
      <div className="flex items-center justify-between mb-4">
        <span className="text-[12px] font-bold text-ink-500 tracking-wider">
          {label}
        </span>
        <div
          className={`w-7 h-7 rounded-lg ${iconBg} flex items-center justify-center`}
        >
          <Icon size={14} color={iconColor} strokeWidth={2.2} />
        </div>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[32px] font-extrabold text-ink-900">{value}</span>
        {sub && (
          <span className="text-[15px] font-semibold text-ink-400">{sub}</span>
        )}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-ink-100 rounded-full overflow-hidden">
          <div
            className={`h-full ${barColor} rounded-full`}
            style={{ width: `${Math.min(progress, 100)}%` }}
          ></div>
        </div>
        <span className={`text-[11px] font-bold ${badgeColor}`}>{badge}</span>
      </div>
    </div>
  );
}

function DarkStatCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="bg-ink-900 text-white rounded-2xl shadow-card p-6 relative overflow-hidden">
      <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-brand-500/30 blur-2xl"></div>
      <div className="relative flex items-center justify-between mb-4">
        <span className="text-[12px] font-bold text-white/60 tracking-wider">
          {label}
        </span>
        <div className="w-7 h-7 rounded-lg bg-brand-500/20 flex items-center justify-center">
          <Sparkles size={14} color="#A8C5FF" strokeWidth={2.2} fill="#A8C5FF" />
        </div>
      </div>
      <div className="relative flex items-baseline gap-1.5">
        <span className="text-[32px] font-extrabold">{value}</span>
      </div>
      <div className="relative mt-3 flex items-center gap-1.5">
        <TrendingUp size={14} className="text-mint-500" />
        <span className="text-[11px] font-semibold text-white/70">{note}</span>
      </div>
    </div>
  );
}
