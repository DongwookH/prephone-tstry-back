import { Topbar } from "@/components/topbar";
import { getThreadsDrafts, type ThreadsDraftRow } from "@/lib/sheets";
import { getThreadsToken } from "@/lib/threads";
import {
  ThreadsWeeklyCalendar,
  type CalendarDraft,
} from "@/components/threads-weekly-calendar";
import { AtSign, CircleCheck, CircleX } from "lucide-react";
import { getUpcomingMondayKstStart } from "@/lib/threads-research";

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

export default async function ThreadsPage() {
  const [drafts, token] = await Promise.all([
    getThreadsDrafts(),
    getThreadsToken().catch(() => null),
  ]);

  const weekStart = getUpcomingMondayKstStart();
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3600 * 1000);

  // 이번 주에 속하는 초안만 — scheduled_at 기준
  const weekDrafts = drafts.filter((d) => {
    if (!d.scheduled_at) return false;
    const t = new Date(d.scheduled_at).getTime();
    return t >= weekStart.getTime() && t < weekEnd.getTime();
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

        {/* 캘린더 */}
        <ThreadsWeeklyCalendar
          drafts={cal}
          weekStartIso={weekStart.toISOString()}
          threadsConnected={threadsConnected}
        />

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
