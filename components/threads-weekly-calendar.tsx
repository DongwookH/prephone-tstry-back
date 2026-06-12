"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  X,
  Loader2,
  Send,
  Trash2,
  CalendarClock,
  Hash,
  MessageCircle,
  Lightbulb,
  CheckSquare,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  saveDraftTextAction,
  rejectDraftAction,
  scheduleDraftAction,
  bulkScheduleAction,
  unscheduleDraftAction,
  approveAndPublishAction,
} from "@/app/(dashboard)/threads/actions";

export type CalendarDraft = {
  id: string;
  keyword: string;
  draft_text: string;
  topic_tag: string;
  self_replies: string[];
  insight: string;
  status: "pending" | "scheduled" | "published" | "rejected" | "failed" | "";
  scheduled_at: string;
  published_id: string;
  published_at: string;
  publish_error: string;
};

type Slot = {
  day: number; // 0=월, 6=일
  hourLabel: string; // "9시" / "14시" / "20시"
  draft: CalendarDraft | null;
};

const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
const SLOT_BASES = [9, 14, 20];

function fmtKstTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function fmtKstDayMonth(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
  }).format(d);
}

function statusColor(s: CalendarDraft["status"]) {
  switch (s) {
    case "pending":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "scheduled":
      return "bg-mint-50 text-mint-700 border-mint-200";
    case "published":
      return "bg-brand-50 text-brand-700 border-brand-200";
    case "rejected":
      return "bg-ink-100 text-ink-500 border-ink-200";
    case "failed":
      return "bg-rose-50 text-rose-700 border-rose-200";
    default:
      return "bg-ink-50 text-ink-500 border-ink-200";
  }
}

function statusLabel(s: CalendarDraft["status"]) {
  return (
    {
      pending: "검토 대기",
      scheduled: "예약됨",
      published: "발행 완료",
      rejected: "반려",
      failed: "발행 실패",
      "": "—",
    } as const
  )[s];
}

export function ThreadsWeeklyCalendar({
  drafts,
  weekStartIso,
  threadsConnected,
}: {
  drafts: CalendarDraft[];
  weekStartIso: string;
  threadsConnected: boolean;
}) {
  const router = useRouter();
  const weekStart = useMemo(() => new Date(weekStartIso), [weekStartIso]);

  // 21개 슬롯 그리드 만들기 — 각 슬롯에 어떤 draft가 있는지 매칭
  const grid: Slot[][] = useMemo(() => {
    const out: Slot[][] = [];
    for (let day = 0; day < 7; day++) {
      const row: Slot[] = [];
      for (let s = 0; s < SLOT_BASES.length; s++) {
        const hour = SLOT_BASES[s];
        // 그 슬롯에 해당하는 draft 찾기 — scheduled_at의 KST hour로 매칭
        const match = drafts.find((d) => {
          if (!d.scheduled_at) return false;
          const dt = new Date(d.scheduled_at);
          const kstHour = Number(
            new Intl.DateTimeFormat("en-GB", {
              timeZone: "Asia/Seoul",
              hour: "2-digit",
              hour12: false,
            }).format(dt),
          );
          const startDay = new Date(weekStart);
          startDay.setUTCDate(startDay.getUTCDate() + day);
          // KST 날짜 매칭
          const dKst = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Seoul",
          }).format(dt);
          const targetKst = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Seoul",
          }).format(startDay);
          if (dKst !== targetKst) return false;
          // 시간대 매칭 (±2시간 허용 — jitter)
          return Math.abs(kstHour - hour) <= 2;
        }) || null;
        row.push({ day, hourLabel: `${hour}시`, draft: match });
      }
      out.push(row);
    }
    return out;
  }, [drafts, weekStart]);

  const pendingIds = drafts.filter((d) => d.status === "pending").map((d) => d.id);

  const [openSlot, setOpenSlot] = useState<{
    day: number;
    hourLabel: string;
    draft: CalendarDraft;
  } | null>(null);

  const [pending, start] = useTransition();
  const [bulkMsg, setBulkMsg] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  const handleBulkApprove = () => {
    if (pendingIds.length === 0) return;
    if (
      !confirm(
        `검토 대기 ${pendingIds.length}개를 모두 예약하시겠습니까?\n시간 되면 자동 발행됩니다.`,
      )
    )
      return;
    start(async () => {
      const res = await bulkScheduleAction(pendingIds);
      if (res.ok) {
        setBulkMsg({
          kind: "ok",
          text: `${res.scheduled}개 예약됨${
            res.skipped > 0 ? ` · ${res.skipped}개 건너뜀` : ""
          }`,
        });
        router.refresh();
      } else {
        setBulkMsg({ kind: "err", text: res.error });
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[18px] font-extrabold text-ink-900 flex items-center gap-2">
            <CalendarClock size={18} className="text-brand-600" />
            이번 주 발행 일정
          </h2>
          <p className="text-[12px] text-ink-500 mt-0.5">
            매일 9시 / 14시 / 20시 (±15분) · 21개 슬롯
          </p>
        </div>
        {pendingIds.length > 0 && threadsConnected && (
          <button
            type="button"
            onClick={handleBulkApprove}
            disabled={pending}
            className="h-10 px-4 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white text-[13px] font-bold flex items-center gap-1.5 transition"
          >
            {pending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <CheckSquare size={14} />
            )}
            검토 대기 {pendingIds.length}개 일괄 예약
          </button>
        )}
      </div>

      {bulkMsg && (
        <div
          className={cn(
            "px-3 py-2 rounded-lg text-[12px] font-bold flex items-center gap-2",
            bulkMsg.kind === "ok"
              ? "bg-mint-50 text-mint-700"
              : "bg-rose-50 text-rose-700",
          )}
        >
          {bulkMsg.kind === "ok" && <Check size={13} strokeWidth={3} />}
          {bulkMsg.text}
        </div>
      )}

      {!threadsConnected && (
        <div className="rounded-xl bg-amber-50 text-amber-800 text-[12px] px-3 py-2 flex items-center gap-2">
          <AlertTriangle size={13} />
          Threads 미연결 — 설정에서 연결 후 발행 가능
        </div>
      )}

      {/* 캘린더 그리드 — 7 day x 3 slot */}
      <div className="grid grid-cols-7 gap-2">
        {grid.map((dayRow, dayIdx) => {
          const dayDate = new Date(weekStart);
          dayDate.setUTCDate(dayDate.getUTCDate() + dayIdx);
          const today = (() => {
            const todayKst = new Intl.DateTimeFormat("en-CA", {
              timeZone: "Asia/Seoul",
            }).format(new Date());
            const dayKst = new Intl.DateTimeFormat("en-CA", {
              timeZone: "Asia/Seoul",
            }).format(dayDate);
            return todayKst === dayKst;
          })();
          return (
            <div key={dayIdx} className="space-y-2">
              <div
                className={cn(
                  "text-center py-1.5 rounded-lg",
                  today ? "bg-brand-500 text-white" : "bg-ink-50 text-ink-700",
                )}
              >
                <div className="text-[11px] font-bold">
                  {DAY_LABELS[dayIdx]}
                </div>
                <div className="text-[11px] font-semibold opacity-80">
                  {fmtKstDayMonth(dayDate.toISOString())}
                </div>
              </div>
              {dayRow.map((slot) => (
                <SlotCard
                  key={slot.hourLabel}
                  slot={slot}
                  onClick={() =>
                    slot.draft &&
                    setOpenSlot({
                      day: dayIdx,
                      hourLabel: slot.hourLabel,
                      draft: slot.draft,
                    })
                  }
                />
              ))}
            </div>
          );
        })}
      </div>

      {/* 모달 — 슬롯 펼쳐서 편집 */}
      {openSlot && (
        <SlotModal
          info={openSlot}
          threadsConnected={threadsConnected}
          onClose={() => setOpenSlot(null)}
          onRefresh={() => router.refresh()}
        />
      )}
    </div>
  );
}

function SlotCard({
  slot,
  onClick,
}: {
  slot: Slot;
  onClick: () => void;
}) {
  const d = slot.draft;
  if (!d) {
    return (
      <div className="rounded-xl border border-dashed border-ink-200 p-2.5 min-h-[78px]">
        <div className="text-[10px] font-bold text-ink-400">
          {slot.hourLabel}
        </div>
        <div className="text-[10px] text-ink-400 mt-1">초안 없음</div>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl border p-2.5 w-full text-left min-h-[78px] hover:shadow-card transition",
        statusColor(d.status),
      )}
    >
      <div className="flex items-center justify-between text-[10px] font-bold mb-1">
        <span>{fmtKstTime(d.scheduled_at) || slot.hourLabel}</span>
        <span className="opacity-60 text-[9px]">
          {statusLabel(d.status)}
        </span>
      </div>
      <div className="text-[10px] font-bold text-ink-800 truncate">
        #{d.keyword}
      </div>
      <div className="text-[10px] text-ink-600 mt-0.5 leading-tight line-clamp-2">
        {d.draft_text}
      </div>
    </button>
  );
}

function SlotModal({
  info,
  threadsConnected,
  onClose,
  onRefresh,
}: {
  info: { day: number; hourLabel: string; draft: CalendarDraft };
  threadsConnected: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const { draft } = info;
  const [text, setText] = useState(draft.draft_text);
  const [topicTag, setTopicTag] = useState(draft.topic_tag || "");
  const [selfReplies, setSelfReplies] = useState<string[]>(draft.self_replies);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  const cleanReplies = (rs: string[]) =>
    rs.map((r) => r.trim()).filter(Boolean);

  const dirty =
    text.trim() !== draft.draft_text.trim() ||
    topicTag.trim() !== (draft.topic_tag || "").trim() ||
    JSON.stringify(cleanReplies(selfReplies)) !==
      JSON.stringify(draft.self_replies);

  const updateReply = (i: number, v: string) =>
    setSelfReplies((arr) => arr.map((r, idx) => (idx === i ? v : r)));
  const addReply = () => {
    if (selfReplies.length >= 3) return;
    setSelfReplies((arr) => [...arr, ""]);
  };
  const removeReply = (i: number) =>
    setSelfReplies((arr) => arr.filter((_, idx) => idx !== i));

  const handleSave = () =>
    start(async () => {
      const res = await saveDraftTextAction(
        draft.id,
        text,
        topicTag,
        cleanReplies(selfReplies),
      );
      if (res.ok) {
        setMsg({ kind: "ok", text: "저장됨" });
        onRefresh();
      } else setMsg({ kind: "err", text: res.error });
    });

  const handleSchedule = () =>
    start(async () => {
      const res = await scheduleDraftAction(
        draft.id,
        text,
        topicTag,
        cleanReplies(selfReplies),
      );
      if (res.ok) {
        setMsg({ kind: "ok", text: "예약됨 — 시간되면 자동 발행" });
        onRefresh();
        setTimeout(onClose, 1200);
      } else setMsg({ kind: "err", text: res.error });
    });

  const handleUnschedule = () =>
    start(async () => {
      const res = await unscheduleDraftAction(draft.id);
      if (res.ok) {
        setMsg({ kind: "ok", text: "예약 취소됨" });
        onRefresh();
      } else setMsg({ kind: "err", text: res.error });
    });

  const handleReject = () => {
    if (!confirm("이 초안을 반려할까요?")) return;
    start(async () => {
      const res = await rejectDraftAction(draft.id);
      if (res.ok) {
        onRefresh();
        onClose();
      } else setMsg({ kind: "err", text: res.error });
    });
  };

  const handlePublishNow = () => {
    if (!confirm("지금 즉시 발행할까요? (예약 시각 무시)")) return;
    start(async () => {
      const res = await approveAndPublishAction(
        draft.id,
        text,
        topicTag,
        cleanReplies(selfReplies),
      );
      if (res.ok) {
        setMsg({
          kind: "ok",
          text: `발행 완료! (id: ${res.postId})${
            res.replyIds.length > 0
              ? ` + 댓글 ${res.replyIds.length}개`
              : ""
          }`,
        });
        onRefresh();
        setTimeout(onClose, 1500);
      } else setMsg({ kind: "err", text: res.error });
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm flex items-start justify-center px-4 py-10 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-card w-full max-w-[640px] p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-bold bg-brand-50 text-brand-700 rounded-full px-2.5 py-1">
              {DAY_LABELS[info.day]} {info.hourLabel}
            </span>
            <span className="text-[11px] text-ink-500">
              {draft.scheduled_at && fmtKstTime(draft.scheduled_at)}
            </span>
            <span
              className={cn(
                "text-[10px] font-bold rounded-full px-2 py-0.5 border",
                statusColor(draft.status),
              )}
            >
              {statusLabel(draft.status)}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-400 hover:text-ink-700"
          >
            <X size={18} />
          </button>
        </div>

        {/* 인사이트 */}
        {draft.insight && (
          <div className="flex items-start gap-2 text-[12px] text-ink-600 bg-ink-50 rounded-lg px-3 py-2">
            <Lightbulb
              size={13}
              className="text-brand-500 mt-0.5 flex-shrink-0"
            />
            <span className="leading-relaxed">{draft.insight}</span>
          </div>
        )}

        {/* 본문 편집 */}
        <div>
          <div className="text-[11px] font-bold text-ink-700 mb-1 flex items-center gap-1.5">
            <Hash size={11} /> #{draft.keyword} · 메인 글 ({text.length}/500)
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            disabled={draft.status === "published"}
            className="w-full rounded-xl border border-ink-200 p-3 text-[13px] leading-relaxed focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none resize-y disabled:bg-ink-50 disabled:text-ink-500"
          />
        </div>

        {/* 주제 태그 */}
        <div className="flex items-center gap-2">
          <Hash size={13} className="text-ink-500 flex-shrink-0" />
          <input
            type="text"
            value={topicTag}
            onChange={(e) => setTopicTag(e.target.value)}
            maxLength={50}
            disabled={draft.status === "published"}
            placeholder="주제 (Threads topic tag, 비우면 미적용)"
            className="flex-1 h-9 px-3 rounded-lg border border-ink-200 text-[13px] focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none disabled:bg-ink-50"
          />
        </div>

        {/* 셀프 댓글 */}
        <div className="space-y-2">
          <div className="text-[11px] font-bold text-ink-700 flex items-center gap-1.5">
            <MessageCircle size={11} /> 셀프 댓글 ({selfReplies.length}/3)
          </div>
          {selfReplies.map((r, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-[10px] font-bold text-ink-400 mt-2 w-4">
                ↳{i + 1}
              </span>
              <textarea
                value={r}
                onChange={(e) => updateReply(i, e.target.value)}
                rows={2}
                maxLength={500}
                disabled={draft.status === "published"}
                className="flex-1 rounded-lg border border-ink-200 p-2 text-[12px] focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none resize-y disabled:bg-ink-50"
              />
              {draft.status !== "published" && (
                <button
                  type="button"
                  onClick={() => removeReply(i)}
                  className="text-ink-400 hover:text-rose-500 mt-1.5"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
          {selfReplies.length < 3 && draft.status !== "published" && (
            <button
              type="button"
              onClick={addReply}
              className="text-[11px] font-bold text-brand-600 hover:text-brand-700"
            >
              + 댓글 추가
            </button>
          )}
        </div>

        {/* 메시지 */}
        {msg && (
          <div
            className={cn(
              "px-3 py-2 rounded-lg text-[12px] font-bold flex items-center gap-2",
              msg.kind === "ok"
                ? "bg-mint-50 text-mint-700"
                : "bg-rose-50 text-rose-700",
            )}
          >
            {msg.kind === "ok" && <Check size={13} strokeWidth={3} />}
            {msg.text}
          </div>
        )}

        {/* 발행 에러 (이전 시도) */}
        {draft.publish_error && (
          <div className="px-3 py-2 rounded-lg text-[11px] bg-rose-50 text-rose-700 flex items-start gap-2">
            <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
            <span>이전 발행 에러: {draft.publish_error}</span>
          </div>
        )}

        {/* 액션 */}
        <div className="flex items-center gap-2 pt-2 border-t border-ink-100">
          {draft.status === "pending" && (
            <>
              <button
                type="button"
                onClick={handleSchedule}
                disabled={pending || !text.trim()}
                className="h-10 px-4 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white text-[13px] font-bold flex items-center gap-1.5"
              >
                <CheckSquare size={13} />
                예약 (시간되면 자동 발행)
              </button>
              {threadsConnected && (
                <button
                  type="button"
                  onClick={handlePublishNow}
                  disabled={pending || !text.trim()}
                  className="h-10 px-3 rounded-xl border border-ink-200 hover:bg-ink-50 disabled:opacity-40 text-[12px] font-bold flex items-center gap-1.5"
                >
                  <Send size={13} />
                  지금 발행
                </button>
              )}
            </>
          )}
          {draft.status === "scheduled" && (
            <>
              <button
                type="button"
                onClick={handleSave}
                disabled={pending || !dirty}
                className="h-10 px-3 rounded-xl border border-ink-200 hover:bg-ink-50 disabled:opacity-40 text-[12px] font-bold"
              >
                수정 저장
              </button>
              <button
                type="button"
                onClick={handleUnschedule}
                disabled={pending}
                className="h-10 px-3 rounded-xl border border-ink-200 hover:bg-ink-50 disabled:opacity-40 text-[12px] font-bold flex items-center gap-1.5"
              >
                <RotateCcw size={13} /> 예약 취소
              </button>
            </>
          )}
          {draft.status === "failed" && (
            <button
              type="button"
              onClick={handleSchedule}
              disabled={pending}
              className="h-10 px-4 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white text-[13px] font-bold flex items-center gap-1.5"
            >
              <RotateCcw size={13} /> 다시 예약
            </button>
          )}
          {draft.status === "pending" && (
            <button
              type="button"
              onClick={handleReject}
              disabled={pending}
              className="ml-auto h-10 px-3 rounded-xl border border-rose-200 hover:bg-rose-50 disabled:opacity-40 text-rose-600 text-[12px] font-bold flex items-center gap-1.5"
            >
              <Trash2 size={13} /> 반려
            </button>
          )}
          {draft.status === "published" && draft.published_id && (
            <a
              href={`https://www.threads.net/@safe_ntel/post/${draft.published_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] font-bold text-brand-600 hover:underline"
            >
              원문 보기 ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
