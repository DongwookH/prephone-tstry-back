"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MessageCircleQuestion,
  CalendarClock,
  CircleAlert,
  RefreshCw,
  Search,
  Smartphone,
  Monitor,
  HelpCircle,
  Inbox,
  Loader2,
  ChevronDown,
  MessageSquareText,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ChatLogItem = {
  ts: string;
  question: string;
  status: "ok" | "error" | "";
  model: string;
  ua: "mobile" | "desktop" | "unknown";
  answer: string;
};

export type ChatLogsPayload = {
  rows: ChatLogItem[];
  total: number;
  todayCount: number;
  errorCount: number;
};

const POLL_MS = 15_000;
const LIMIT = 200;

const absFmt = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const clockFmt = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function fmtAbs(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return absFmt.format(d);
}

/** "방금 전" / "3분 전" / "2시간 전" / "4일 전" */
function fmtRelative(iso: string, nowMs: number): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const diff = Math.max(0, nowMs - t);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day}일 전`;
  return `${Math.floor(day / 30)}개월 전`;
}

export function ChatQuestionsLive({ initial }: { initial: ChatLogsPayload }) {
  const [data, setData] = useState<ChatLogsPayload>(initial);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 하이드레이션 불일치 방지 — 시각 관련 표시는 마운트 후에만
  const [nowMs, setNowMs] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const res = await fetch(`/api/chat-logs?limit=${LIMIT}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ChatLogsPayload & {
        ok?: boolean;
        error?: string;
      };
      if (json.ok === false) throw new Error(json.error || "불러오기 실패");
      setData({
        rows: json.rows ?? [],
        total: json.total ?? 0,
        todayCount: json.todayCount ?? 0,
        errorCount: json.errorCount ?? 0,
      });
      setError(null);
      setLastUpdated(Date.now());
      setNowMs(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, []);

  // 15초 폴링 (탭이 백그라운드면 건너뜀) + 상대시간 갱신
  // 시각 seed는 마운트 직후 비동기로 — SSR/CSR 하이드레이션 불일치 방지
  useEffect(() => {
    const seed = setTimeout(() => {
      setNowMs(Date.now());
      setLastUpdated(Date.now());
    }, 0);
    const id = setInterval(() => {
      setNowMs(Date.now());
      if (typeof document !== "undefined" && document.hidden) return;
      void load();
    }, POLL_MS);
    return () => {
      clearTimeout(seed);
      clearInterval(id);
    };
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter((r) => r.question.toLowerCase().includes(q));
  }, [data.rows, query]);

  const isEmpty = data.rows.length === 0;

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* 요약 카드 */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryCard
          label="오늘 질문"
          value={data.todayCount}
          sub="KST 기준"
          Icon={MessageCircleQuestion}
          tone="brand"
        />
        <SummaryCard
          label="전체 누적"
          value={data.total}
          sub="chat_logs 탭 전체"
          Icon={CalendarClock}
          tone="ink"
        />
        <SummaryCard
          label="실패 (error)"
          value={data.errorCount}
          sub={data.errorCount > 0 ? "응답 실패 로그" : "실패 없음"}
          Icon={CircleAlert}
          tone={data.errorCount > 0 ? "rose" : "mint"}
        />
      </section>

      {/* 검색 + 새로고침 */}
      <section className="flex flex-col sm:flex-row sm:items-center gap-2.5">
        <div className="flex items-center gap-2 h-10 px-3 rounded-xl bg-white border border-ink-200 flex-1 min-w-0">
          <Search size={15} className="text-ink-400 flex-shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="질문 내용 검색"
            className="flex-1 min-w-0 text-[13px] text-ink-900 placeholder:text-ink-400 outline-none bg-transparent"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-[11px] font-bold text-ink-500 hover:text-ink-800 transition flex-shrink-0"
            >
              지우기
            </button>
          )}
        </div>
        <div className="flex items-center justify-between sm:justify-end gap-3">
          <span className="text-[11px] text-ink-500 font-medium tabular-nums">
            {lastUpdated
              ? `마지막 갱신 ${clockFmt.format(new Date(lastUpdated))}`
              : "갱신 대기"}
            <span className="text-ink-400"> · 15초마다 자동</span>
          </span>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="h-10 px-3.5 rounded-xl bg-brand-500 text-white text-[13px] font-bold flex items-center gap-1.5 hover:bg-brand-600 transition disabled:opacity-60 flex-shrink-0"
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            새로고침
          </button>
        </div>
      </section>

      {error && (
        <div className="rounded-xl bg-rose-50 text-rose-700 text-[12px] font-bold px-4 py-3">
          불러오기 실패: {error} — 다음 폴링에서 다시 시도합니다.
        </div>
      )}

      {/* 질문 목록 */}
      {isEmpty ? (
        <EmptyState />
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-card px-6 py-12 text-center">
          <p className="text-[13px] font-bold text-ink-700">
            “{query}” 검색 결과가 없습니다
          </p>
          <p className="text-[12px] text-ink-500 mt-1">
            최근 {data.rows.length}개 질문 중에서 검색합니다.
          </p>
        </div>
      ) : (
        <section className="space-y-2">
          {filtered.map((r, i) => (
            <QuestionRow key={`${r.ts}-${i}`} row={r} nowMs={nowMs} />
          ))}
          {data.total > data.rows.length && (
            <p className="text-[11px] text-ink-400 text-center pt-2">
              최근 {data.rows.length}개만 표시 (전체 {data.total}개)
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function QuestionRow({ row, nowMs }: { row: ChatLogItem; nowMs: number }) {
  const isError = row.status === "error";
  const hasAnswer = !!row.answer?.trim();
  const [open, setOpen] = useState(false);

  return (
    <article className="bg-white rounded-2xl shadow-card px-4 sm:px-5 py-4">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-[12px] font-bold text-ink-700 tabular-nums">
          {nowMs ? fmtRelative(row.ts, nowMs) : ""}
        </span>
        <span className="text-[11px] text-ink-400 tabular-nums">
          {fmtAbs(row.ts)}
        </span>
        <span
          className={cn(
            "text-[10px] font-extrabold rounded-full px-2 py-0.5",
            isError
              ? "bg-rose-50 text-rose-700"
              : "bg-brand-50 text-brand-700",
          )}
        >
          {isError ? "error" : "ok"}
        </span>
        <UaBadge ua={row.ua} />
        {row.model && (
          <span className="text-[10px] font-bold text-ink-500 bg-ink-100 rounded-full px-2 py-0.5 max-w-full truncate">
            {row.model}
          </span>
        )}
      </div>
      <p className="text-[14px] text-ink-900 leading-relaxed break-words whitespace-pre-wrap">
        {row.question || "(빈 질문)"}
      </p>

      {hasAnswer && (
        <div className="mt-2.5">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-bold text-ink-500 hover:text-brand-700 transition"
          >
            <MessageSquareText size={12} />
            답변 보기
            <ChevronDown
              size={12}
              className={cn("transition-transform", open && "rotate-180")}
            />
          </button>

          {open && (
            <div className="mt-2 rounded-xl bg-ink-50 px-3.5 py-3">
              <p className="text-[12px] text-ink-600 leading-relaxed break-words whitespace-pre-wrap">
                {row.answer}
              </p>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function UaBadge({ ua }: { ua: ChatLogItem["ua"] }) {
  const map = {
    mobile: {
      Icon: Smartphone,
      label: "mobile",
      cls: "bg-violet-50 text-violet-700",
    },
    desktop: {
      Icon: Monitor,
      label: "desktop",
      cls: "bg-mint-50 text-mint-700",
    },
    unknown: {
      Icon: HelpCircle,
      label: "unknown",
      cls: "bg-ink-100 text-ink-600",
    },
  } as const;
  const { Icon, label, cls } = map[ua];
  return (
    <span
      className={cn(
        "text-[10px] font-bold rounded-full px-2 py-0.5 flex items-center gap-1",
        cls,
      )}
    >
      <Icon size={11} strokeWidth={2.2} />
      {label}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="bg-white rounded-2xl shadow-card px-6 py-16 text-center">
      <div className="w-12 h-12 rounded-2xl bg-ink-50 flex items-center justify-center mx-auto mb-4">
        <Inbox size={22} className="text-ink-400" />
      </div>
      <p className="text-[15px] font-extrabold text-ink-900">
        아직 수집된 질문이 없습니다
      </p>
      <p className="text-[13px] text-ink-500 mt-1.5 leading-relaxed">
        챗봇에 질문이 들어오면 chat_logs 탭에 쌓이고, 이 화면에 15초 안에
        나타납니다.
      </p>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  Icon,
  tone,
}: {
  label: string;
  value: number;
  sub: string;
  Icon: React.ElementType;
  tone: "brand" | "ink" | "rose" | "mint";
}) {
  const toneMap = {
    brand: { bg: "bg-brand-50", text: "text-brand-700" },
    ink: { bg: "bg-ink-100", text: "text-ink-700" },
    rose: { bg: "bg-rose-50", text: "text-rose-700" },
    mint: { bg: "bg-mint-50", text: "text-mint-700" },
  } as const;
  const t = toneMap[tone];
  return (
    <div className="bg-white rounded-2xl shadow-card p-5">
      <div className="flex items-center gap-2 mb-3">
        <div
          className={cn(
            "w-7 h-7 rounded-lg flex items-center justify-center",
            t.bg,
          )}
        >
          <Icon size={14} strokeWidth={2.2} className={t.text} />
        </div>
        <span className="text-[12px] font-bold text-ink-500 tracking-wider">
          {label}
        </span>
      </div>
      <div className="text-[26px] font-extrabold text-ink-900 tabular-nums">
        {value.toLocaleString()}
      </div>
      <div className={cn("text-[11px] font-bold mt-0.5", t.text)}>{sub}</div>
    </div>
  );
}
