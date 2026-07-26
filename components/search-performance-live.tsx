"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Search,
  FileText,
  Sparkles,
  RefreshCw,
  Loader2,
  MousePointerClick,
  Eye,
  Percent,
  ExternalLink,
  AlertTriangle,
  Copy,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type GscQueryItem = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type GscPageItem = {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type SearchPerformancePayload = {
  ok: boolean;
  error?: string;
  queries: GscQueryItem[];
  pages: GscPageItem[];
  candidates: GscQueryItem[];
  totals: { clicks: number; impressions: number };
};

const DAYS_OPTIONS = [7, 28, 90] as const;
type DaysOption = (typeof DAYS_OPTIONS)[number];

const SERVICE_ACCOUNT_EMAIL =
  "tistory-auto-sheet@backoffice-tistory.iam.gserviceaccount.com";

function fmtPct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function fmtPos(pos: number): string {
  return pos.toFixed(1);
}

export function SearchPerformanceLive({
  initial,
  initialDays,
}: {
  initial: SearchPerformancePayload;
  initialDays: DaysOption;
}) {
  const [days, setDays] = useState<DaysOption>(initialDays);
  const [data, setData] = useState<SearchPerformancePayload>(initial);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"queries" | "pages" | "candidates">(
    "candidates",
  );
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const load = useCallback(async (targetDays: DaysOption) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/gsc?days=${targetDays}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as SearchPerformancePayload;
      setData(json);
      setLastUpdated(Date.now());
    } catch {
      setData({
        ok: false,
        error: "network_error",
        queries: [],
        pages: [],
        candidates: [],
        totals: { clicks: 0, impressions: 0 },
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDaysChange = (d: DaysOption) => {
    setDays(d);
    void load(d);
  };

  const avgCtr = useMemo(() => {
    const { clicks, impressions } = data.totals;
    return impressions > 0 ? clicks / impressions : 0;
  }, [data.totals]);

  if (!data.ok && data.error === "no_access") {
    return <NoAccessCard />;
  }

  if (!data.ok) {
    return (
      <div className="rounded-2xl bg-rose-50 text-rose-700 text-[13px] font-bold px-5 py-6">
        불러오기 실패: {data.error || "알 수 없는 오류"}
        <button
          type="button"
          onClick={() => void load(days)}
          className="ml-3 inline-flex items-center gap-1 text-[12px] font-bold underline underline-offset-2"
        >
          <RefreshCw size={12} />
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* 요약 카드 */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryCard
          label={`총 클릭 (${days}일)`}
          value={data.totals.clicks.toLocaleString()}
          Icon={MousePointerClick}
          tone="brand"
        />
        <SummaryCard
          label={`총 노출 (${days}일)`}
          value={data.totals.impressions.toLocaleString()}
          Icon={Eye}
          tone="ink"
        />
        <SummaryCard
          label="평균 CTR"
          value={fmtPct(avgCtr)}
          Icon={Percent}
          tone="mint"
        />
      </section>

      {/* 기간 선택 + 새로고침 */}
      <section className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-ink-100 w-fit">
          {DAYS_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => handleDaysChange(d)}
              className={cn(
                "px-3 h-8 rounded-lg text-[12px] flex items-center transition",
                days === d
                  ? "bg-white shadow-card font-bold text-ink-900"
                  : "font-semibold text-ink-600 hover:text-ink-900",
              )}
            >
              {d}일
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between sm:justify-end gap-3">
          <span className="text-[11px] text-ink-500 font-medium">
            {lastUpdated
              ? `마지막 갱신 ${new Date(lastUpdated).toLocaleTimeString("ko-KR", { hour12: false })}`
              : "Search Console 데이터는 통상 2~3일 지연 반영됩니다"}
          </span>
          <button
            type="button"
            onClick={() => void load(days)}
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

      {/* 탭 */}
      <section className="flex items-center gap-1 border-b border-ink-100">
        <TabButton
          active={tab === "candidates"}
          onClick={() => setTab("candidates")}
          Icon={Sparkles}
          label="제목 개선 후보"
          count={data.candidates.length}
          highlight
        />
        <TabButton
          active={tab === "queries"}
          onClick={() => setTab("queries")}
          Icon={Search}
          label="검색어 TOP"
          count={data.queries.length}
        />
        <TabButton
          active={tab === "pages"}
          onClick={() => setTab("pages")}
          Icon={FileText}
          label="페이지 TOP"
          count={data.pages.length}
        />
      </section>

      {tab === "candidates" && <CandidatesTable rows={data.candidates} />}
      {tab === "queries" && <QueriesTable rows={data.queries} />}
      {tab === "pages" && <PagesTable rows={data.pages} />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  Icon,
  label,
  count,
  highlight,
}: {
  active: boolean;
  onClick: () => void;
  Icon: React.ElementType;
  label: string;
  count: number;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-bold border-b-2 -mb-px transition",
        active
          ? "border-brand-500 text-brand-700"
          : "border-transparent text-ink-500 hover:text-ink-800",
      )}
    >
      <Icon size={14} />
      {label}
      {highlight && count > 0 && (
        <span className="text-[10px] font-extrabold bg-rose-500 text-white rounded-full px-1.5 py-0.5">
          {count}
        </span>
      )}
      {!highlight && (
        <span className="text-[11px] font-medium text-ink-400">
          {count}
        </span>
      )}
    </button>
  );
}

function CandidatesTable({ rows }: { rows: GscQueryItem[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="제목 개선 후보가 없습니다"
        desc="노출 50회 이상 + CTR 2% 미만 + 20위 이내 쿼리가 없으면 표시되지 않습니다. 잘하고 있다는 뜻일 수 있습니다."
      />
    );
  }
  return (
    <div className="bg-white rounded-2xl shadow-card overflow-hidden">
      <div className="px-5 py-3.5 bg-amber-50 border-b border-amber-100">
        <p className="text-[12px] text-amber-800 leading-relaxed">
          <strong className="font-extrabold">노출은 많은데 클릭이 적은 쿼리</strong>
          입니다. 이 검색어들이 실제로 페이지 제목/메타 설명에 얼마나
          반영되어 있는지 확인하고 다듬어보세요 (impressions≥50, CTR&lt;2%,
          평균 순위 20위 이내).
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] font-bold text-ink-400 tracking-wider border-b border-ink-100">
              <th className="px-5 py-3">검색어</th>
              <th className="px-3 py-3 text-right">노출</th>
              <th className="px-3 py-3 text-right">클릭</th>
              <th className="px-3 py-3 text-right">CTR</th>
              <th className="px-5 py-3 text-right">평균 순위</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={`${r.query}-${i}`}
                className="border-b border-ink-50 last:border-0 hover:bg-ink-50/60 transition"
              >
                <td className="px-5 py-3 font-semibold text-ink-900">
                  <CopyableText text={r.query} />
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-ink-700">
                  {r.impressions.toLocaleString()}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-ink-700">
                  {r.clicks.toLocaleString()}
                </td>
                <td className="px-3 py-3 text-right tabular-nums font-bold text-rose-600">
                  {fmtPct(r.ctr)}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-ink-700">
                  {fmtPos(r.position)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function QueriesTable({ rows }: { rows: GscQueryItem[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="검색어 데이터가 없습니다"
        desc="선택한 기간에 GSC로 수집된 검색어가 없습니다."
      />
    );
  }
  return (
    <div className="bg-white rounded-2xl shadow-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] font-bold text-ink-400 tracking-wider border-b border-ink-100">
              <th className="px-5 py-3 w-10">#</th>
              <th className="px-3 py-3">검색어</th>
              <th className="px-3 py-3 text-right">클릭</th>
              <th className="px-3 py-3 text-right">노출</th>
              <th className="px-3 py-3 text-right">CTR</th>
              <th className="px-5 py-3 text-right">평균 순위</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={`${r.query}-${i}`}
                className="border-b border-ink-50 last:border-0 hover:bg-ink-50/60 transition"
              >
                <td className="px-5 py-3 text-ink-400 font-bold">{i + 1}</td>
                <td className="px-3 py-3 font-semibold text-ink-900">
                  <CopyableText text={r.query} />
                </td>
                <td className="px-3 py-3 text-right tabular-nums font-bold text-ink-900">
                  {r.clicks.toLocaleString()}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-ink-700">
                  {r.impressions.toLocaleString()}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-ink-700">
                  {fmtPct(r.ctr)}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-ink-700">
                  {fmtPos(r.position)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PagesTable({ rows }: { rows: GscPageItem[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="페이지 데이터가 없습니다"
        desc="선택한 기간에 GSC로 수집된 페이지가 없습니다."
      />
    );
  }
  return (
    <div className="bg-white rounded-2xl shadow-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] font-bold text-ink-400 tracking-wider border-b border-ink-100">
              <th className="px-5 py-3 w-10">#</th>
              <th className="px-3 py-3">페이지</th>
              <th className="px-3 py-3 text-right">클릭</th>
              <th className="px-3 py-3 text-right">노출</th>
              <th className="px-3 py-3 text-right">CTR</th>
              <th className="px-5 py-3 text-right">평균 순위</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={`${r.page}-${i}`}
                className="border-b border-ink-50 last:border-0 hover:bg-ink-50/60 transition"
              >
                <td className="px-5 py-3 text-ink-400 font-bold">{i + 1}</td>
                <td className="px-3 py-3 font-semibold text-ink-900 max-w-[360px]">
                  <a
                    href={r.page}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 hover:text-brand-700 transition truncate"
                    title={r.page}
                  >
                    <span className="truncate">{r.page}</span>
                    <ExternalLink size={11} className="flex-shrink-0 text-ink-400" />
                  </a>
                </td>
                <td className="px-3 py-3 text-right tabular-nums font-bold text-ink-900">
                  {r.clicks.toLocaleString()}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-ink-700">
                  {r.impressions.toLocaleString()}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-ink-700">
                  {fmtPct(r.ctr)}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-ink-700">
                  {fmtPos(r.position)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CopyableText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // 클립보드 권한 없으면 조용히 무시
    }
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 text-left hover:text-brand-700 transition group"
      title="복사"
    >
      <span>{text}</span>
      {copied ? (
        <Check size={12} className="text-mint-600 flex-shrink-0" />
      ) : (
        <Copy
          size={12}
          className="flex-shrink-0 text-ink-300 opacity-0 group-hover:opacity-100 transition"
        />
      )}
    </button>
  );
}

function EmptyState({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="bg-white rounded-2xl shadow-card px-6 py-14 text-center">
      <p className="text-[14px] font-extrabold text-ink-900">{title}</p>
      <p className="text-[12px] text-ink-500 mt-1.5 leading-relaxed max-w-md mx-auto">
        {desc}
      </p>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  Icon,
  tone,
}: {
  label: string;
  value: string;
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
        {value}
      </div>
    </div>
  );
}

function NoAccessCard() {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(SERVICE_ACCOUNT_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };
  return (
    <div className="bg-white rounded-2xl shadow-card p-6 sm:p-8">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
          <AlertTriangle size={20} className="text-amber-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[16px] font-extrabold text-ink-900">
            Search Console에 아직 연결되지 않았습니다
          </h3>
          <p className="mt-1.5 text-[13px] text-ink-600 leading-relaxed">
            서비스 계정이 GSC 속성에 등록되지 않았거나 권한이 없습니다.
            아래 순서대로 한 번만 등록하면 이후 자동으로 연동됩니다.
          </p>

          <ol className="mt-4 space-y-2.5 text-[13px] text-ink-700">
            <li className="flex gap-2.5">
              <span className="w-5 h-5 rounded-full bg-ink-100 text-ink-700 text-[11px] font-extrabold flex items-center justify-center flex-shrink-0 mt-0.5">
                1
              </span>
              <span>
                <a
                  href="https://search.google.com/search-console/users"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold text-brand-700 underline underline-offset-2 hover:no-underline"
                >
                  Search Console → 설정 → 사용자 및 권한
                </a>{" "}
                으로 이동
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="w-5 h-5 rounded-full bg-ink-100 text-ink-700 text-[11px] font-extrabold flex items-center justify-center flex-shrink-0 mt-0.5">
                2
              </span>
              <span>&ldquo;사용자 추가&rdquo;로 아래 서비스 계정을 추가</span>
            </li>
            <li className="flex gap-2.5">
              <span className="w-5 h-5 rounded-full bg-ink-100 text-ink-700 text-[11px] font-extrabold flex items-center justify-center flex-shrink-0 mt-0.5">
                3
              </span>
              <span>권한은 &ldquo;전체&rdquo;로 설정</span>
            </li>
          </ol>

          <div className="mt-4 flex items-center gap-2 rounded-xl bg-ink-50 px-3.5 py-2.5">
            <code className="flex-1 text-[12px] font-mono text-ink-800 truncate">
              {SERVICE_ACCOUNT_EMAIL}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="flex-shrink-0 h-7 px-2.5 rounded-lg bg-white border border-ink-200 text-[11px] font-bold text-ink-700 hover:bg-ink-100 transition flex items-center gap-1"
            >
              {copied ? (
                <>
                  <Check size={11} className="text-mint-600" />
                  복사됨
                </>
              ) : (
                <>
                  <Copy size={11} />
                  복사
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
