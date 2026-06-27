import { Topbar } from "@/components/topbar";
import { getThreadsDrafts, type ThreadsDraftRow } from "@/lib/sheets";
import { getThreadsToken } from "@/lib/threads";
import {
  ThreadsWeeklyCalendar,
  type CalendarDraft,
} from "@/components/threads-weekly-calendar";
import { RegenerateRejectedButton } from "@/components/regenerate-rejected-button";
import { AtSign, CircleCheck, CircleX, CalendarClock } from "lucide-react";

export const dynamic = "force-dynamic";

function parseReplies(json: string): string[] {
  try {
    const arr = JSON.parse(json || "[]");
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function toCalendarDraft(r: ThreadsDraftRow): CalendarDraft {
  return {
    id: r.id,
    keyword: r.keyword,
    draft_text: r.draft_text,
    topic_tag: r.topic_tag || "",
    self_replies: parseReplies(r.self_replies),
    insight: r.insight || "",
    status: (r.status || "pending") as CalendarDraft["status"],
    scheduled_at: r.scheduled_at || "",
    published_id: r.published_id || "",
    published_at: r.published_at || "",
    publish_error: r.publish_error || "",
  };
}

// 임의의 시각이 속한 주의 월요일 00:00 KST를 UTC Date로 반환
function getMondayKstOf(refUtc: Date): Date {
  const refKstMs = refUtc.getTime() + 9 * 3600 * 1000;
  const refKst = new Date(refKstMs);
  const dayKst = refKst.getUTCDay(); // 0=일, 1=월, ..., 6=토
  const daysSinceMonday = (dayKst + 6) % 7;
  const mondayKstMs = refKstMs - daysSinceMonday * 24 * 3600 * 1000;
  const monday = new Date(mondayKstMs);
  monday.setUTCHours(0, 0, 0, 0);
  return new Date(monday.getTime() - 9 * 3600 * 1000);
}

export default async function ThreadsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const [drafts, token, sp] = await Promise.all([
    getThreadsDrafts(),
    getThreadsToken().catch(() => null),
    searchParams,
  ]);

  // 활성 주 결정:
  // 1) URL의 ?week=YYYY-MM-DD가 있으면 그 주
  // 2) 기본값 — 현재 시각(KST)이 속한 이번 주
  //    (지난주 미완료 초안이 있어도 이번 주를 보여줌. 다른 주 미완료는
  //     아래 otherWeekUnfinished 섹션에 별도 노출되므로 놓치지 않음.)
  let weekStart: Date;
  if (sp.week) {
    const parsed = new Date(sp.week);
    if (!isNaN(parsed.getTime())) {
      weekStart = getMondayKstOf(parsed);
    } else {
      weekStart = getMondayKstOf(new Date());
    }
  } else {
    weekStart = getMondayKstOf(new Date());
  }
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3600 * 1000);
  const prevWeek = new Date(weekStart.getTime() - 7 * 24 * 3600 * 1000);
  const nextWeek = new Date(weekStart.getTime() + 7 * 24 * 3600 * 1000);

  // 이 주에 속하는 초안만 — scheduled_at 기준
  const weekDrafts = drafts.filter((d) => {
    if (!d.scheduled_at) return false;
    const t = new Date(d.scheduled_at).getTime();
    return t >= weekStart.getTime() && t < weekEnd.getTime();
  });

  // 다른 주의 검토 대기/예약/실패 초안 — 표시는 하되 별도 섹션
  // 주간 자동화에 속한 반려글 (전체 주 — scheduled_at 있는 것만)
  const rejectedCount = drafts.filter(
    (d) => d.status === "rejected" && !!d.scheduled_at,
  ).length;

  const otherWeekUnfinished = drafts.filter((d) => {
    if (!d.scheduled_at) return false;
    if (
      d.status !== "pending" &&
      d.status !== "scheduled" &&
      d.status !== "failed"
    )
      return false;
    const t = new Date(d.scheduled_at).getTime();
    return t < weekStart.getTime() || t >= weekEnd.getTime();
  });

  // 옛 초안 (scheduled_at 없음 — 스크레이퍼가 만든 것) — 별도 섹션
  const legacyPending = drafts.filter(
    (d) => !d.scheduled_at && d.status === "pending",
  );
  const legacyPublished = drafts.filter(
    (d) => !d.scheduled_at && d.status === "published",
  );

  const threadsConnected = Boolean(token);

  const cal = weekDrafts.map(toCalendarDraft);
  const stats = {
    pending: cal.filter((c) => c.status === "pending").length,
    scheduled: cal.filter((c) => c.status === "scheduled").length,
    published: cal.filter((c) => c.status === "published").length,
    failed: cal.filter((c) => c.status === "failed").length,
  };

  const weekRangeLabel = (() => {
    const fmt = new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "numeric",
      day: "numeric",
    });
    const lastDay = new Date(weekEnd.getTime() - 24 * 3600 * 1000);
    return `${fmt.format(weekStart)} ~ ${fmt.format(lastDay)}`;
  })();
  const weekIsoDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
  }).format(weekStart);
  const prevIso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
  }).format(prevWeek);
  const nextIso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
  }).format(nextWeek);

  return (
    <>
      <Topbar
        crumbs={[
          { label: "워크스페이스" },
          { label: "Threads", bold: true },
        ]}
      />
      <div className="px-8 py-8 max-w-[1400px] mx-auto space-y-8 animate-fade-up">
        {/* 헤더 */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[22px] font-extrabold text-ink-900 flex items-center gap-2">
              <AtSign size={20} className="text-brand-600" />
              Threads 자동 발행
            </h1>
            <p className="text-[13px] text-ink-500 mt-1">
              매주 월요일 새벽 자동으로 1주치 21개 초안 생성 → 검토·승인 → 시간되면 자동 발행
            </p>
          </div>
          <ConnectionPill connected={threadsConnected} />
        </div>

        {/* 상태 요약 */}
        <div className="grid grid-cols-4 gap-3">
          <StatusKPI label="검토 대기" value={stats.pending} color="amber" />
          <StatusKPI label="예약됨" value={stats.scheduled} color="mint" />
          <StatusKPI label="발행 완료" value={stats.published} color="brand" />
          <StatusKPI label="실패" value={stats.failed} color="rose" />
        </div>

        {/* 주 네비게이션 */}
        <div className="flex items-center justify-between bg-ink-50 rounded-xl px-4 py-3">
          <a
            href={`/threads?week=${prevIso}`}
            className="text-[12px] font-bold text-ink-600 hover:text-ink-900 transition flex items-center gap-1"
          >
            ← 지난 주
          </a>
          <div className="text-center">
            <div className="text-[14px] font-extrabold text-ink-900">
              {weekRangeLabel}
            </div>
            <a
              href="/threads"
              className="text-[11px] text-brand-600 hover:underline"
            >
              이번 주로
            </a>
          </div>
          <a
            href={`/threads?week=${nextIso}`}
            className="text-[12px] font-bold text-ink-600 hover:text-ink-900 transition flex items-center gap-1"
          >
            다음 주 →
          </a>
        </div>

        {/* 캘린더 */}
        <ThreadsWeeklyCalendar
          drafts={cal}
          weekStartIso={weekStart.toISOString()}
          threadsConnected={threadsConnected}
        />

        {/* 반려글 재생성 */}
        <RegenerateRejectedButton count={rejectedCount} />

        {/* 다른 주의 미완료 초안 — 검토 대기/예약/실패 */}
        {otherWeekUnfinished.length > 0 && (
          <section className="space-y-3">
            <div>
              <h2 className="text-[14px] font-extrabold text-ink-700 flex items-center gap-2">
                <CalendarClockIcon /> 다른 주 검토 대기·예약 초안
              </h2>
              <p className="text-[11px] text-ink-500 mt-0.5">
                현재 표시 중인 주 외에 아직 발행되지 않은 초안 {otherWeekUnfinished.length}개
              </p>
            </div>
            <div className="space-y-2">
              {Object.entries(groupByWeek(otherWeekUnfinished)).map(
                ([iso, items]) => (
                  <a
                    key={iso}
                    href={`/threads?week=${iso}`}
                    className="block bg-white border border-ink-200 rounded-xl p-4 hover:border-brand-300 hover:shadow-sm transition"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[13px] font-bold text-ink-900">
                          {formatWeekRange(iso)} 주차
                        </div>
                        <div className="text-[11px] text-ink-500 mt-0.5">
                          검토 대기 {items.filter((x) => x.status === "pending").length} ·
                          예약 {items.filter((x) => x.status === "scheduled").length} ·
                          실패 {items.filter((x) => x.status === "failed").length}
                        </div>
                      </div>
                      <span className="text-[12px] text-brand-600 font-bold">
                        보기 →
                      </span>
                    </div>
                  </a>
                ),
              )}
            </div>
          </section>
        )}

        {/* 옛 스크레이퍼 기반 초안 (별도) */}
        {(legacyPending.length > 0 || legacyPublished.length > 0) && (
          <section className="space-y-2">
            <h2 className="text-[14px] font-extrabold text-ink-700">
              📜 스크레이퍼 기반 초안 (자동 일정 없음, 수동 검토용)
            </h2>
            <p className="text-[11px] text-ink-500">
              주간 자동화 도입 전 만들어진 초안들 · 검토 대기 {legacyPending.length} · 발행 완료 {legacyPublished.length}
            </p>
          </section>
        )}
      </div>
    </>
  );
}

function CalendarClockIcon() {
  return <CalendarClock size={14} className="text-brand-600 inline-block" />;
}

function groupByWeek(items: ThreadsDraftRow[]): Record<string, ThreadsDraftRow[]> {
  const out: Record<string, ThreadsDraftRow[]> = {};
  for (const it of items) {
    if (!it.scheduled_at) continue;
    const t = new Date(it.scheduled_at);
    if (isNaN(t.getTime())) continue;
    const mon = getMondayKstOf(t);
    const iso = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
    }).format(mon);
    if (!out[iso]) out[iso] = [];
    out[iso].push(it);
  }
  return out;
}

function formatWeekRange(weekStartIsoDate: string): string {
  // weekStartIsoDate = "YYYY-MM-DD" (KST 월요일)
  const [y, m, d] = weekStartIsoDate.split("-").map(Number);
  // KST 자정 = UTC 전날 15:00
  const startUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 9 * 3600 * 1000);
  const endUtc = new Date(startUtc.getTime() + 6 * 24 * 3600 * 1000);
  const fmt = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
  });
  return `${fmt.format(startUtc)} ~ ${fmt.format(endUtc)}`;
}

function ConnectionPill({ connected }: { connected: boolean }) {
  return (
    <span
      className={
        connected
          ? "text-[11px] font-bold bg-mint-50 text-mint-700 rounded-full px-3 py-1.5 flex items-center gap-1.5"
          : "text-[11px] font-bold bg-rose-50 text-rose-700 rounded-full px-3 py-1.5 flex items-center gap-1.5"
      }
    >
      {connected ? <CircleCheck size={12} /> : <CircleX size={12} />}
      {connected ? "Threads 연결됨" : "Threads 미연결"}
    </span>
  );
}

function StatusKPI({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "amber" | "mint" | "brand" | "rose";
}) {
  const map = {
    amber: "bg-amber-50 text-amber-700",
    mint: "bg-mint-50 text-mint-700",
    brand: "bg-brand-50 text-brand-700",
    rose: "bg-rose-50 text-rose-700",
  } as const;
  return (
    <div className={`rounded-xl px-4 py-3 ${map[color]}`}>
      <div className="text-[11px] font-bold opacity-80">{label}</div>
      <div className="text-[24px] font-extrabold tabular-nums">{value}</div>
    </div>
  );
}
