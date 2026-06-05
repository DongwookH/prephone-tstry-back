import { Topbar } from "@/components/topbar";
import { getThreadsDrafts, type ThreadsDraftRow } from "@/lib/sheets";
import { getThreadsToken } from "@/lib/threads";
import {
  ThreadsDraftCard,
  type DraftCardData,
  type SourcePost,
} from "@/components/threads-draft-card";
import { AtSign, Inbox, History, CircleCheck, CircleX } from "lucide-react";

export const dynamic = "force-dynamic";

function parseSource(json: string): SourcePost[] {
  try {
    const arr = JSON.parse(json || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function toCard(r: ThreadsDraftRow): DraftCardData {
  return {
    id: r.id,
    createdAt: r.created_at,
    keyword: r.keyword,
    draftText: r.draft_text,
    insight: r.insight,
    sourcePosts: parseSource(r.source_posts),
  };
}

export default async function ThreadsPage() {
  const [drafts, token] = await Promise.all([
    getThreadsDrafts(),
    getThreadsToken().catch(() => null),
  ]);

  const pending = drafts.filter((d) => d.status === "pending" || !d.status);
  const published = drafts.filter((d) => d.status === "published");
  const rejected = drafts.filter((d) => d.status === "rejected");
  const threadsConnected = Boolean(token);

  return (
    <>
      <Topbar
        crumbs={[
          { label: "워크스페이스" },
          { label: "Threads", bold: true },
        ]}
      />
      <div className="px-8 py-8 max-w-[920px] mx-auto space-y-6 animate-fade-up">
        {/* 헤더 */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[22px] font-extrabold text-ink-900 flex items-center gap-2">
              <AtSign size={20} className="text-brand-600" />
              Threads 초안
            </h1>
            <p className="text-[13px] text-ink-500 mt-1">
              매일 전날 인기글을 분석해 만든 초안입니다. 검토·수정 후 발행하세요.
            </p>
          </div>
          <ConnectionPill connected={threadsConnected} />
        </div>

        {/* 대기 중 초안 */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Inbox size={16} className="text-ink-700" />
            <h2 className="text-[15px] font-extrabold text-ink-900">
              검토 대기
            </h2>
            <span className="text-[12px] font-bold text-ink-400">
              {pending.length}
            </span>
          </div>

          {pending.length === 0 ? (
            <EmptyState connected={threadsConnected} />
          ) : (
            <div className="space-y-4">
              {pending.map((d) => (
                <ThreadsDraftCard
                  key={d.id}
                  data={toCard(d)}
                  threadsConnected={threadsConnected}
                />
              ))}
            </div>
          )}
        </section>

        {/* 발행 완료 */}
        {published.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3 mt-8">
              <CircleCheck size={16} className="text-mint-600" />
              <h2 className="text-[15px] font-extrabold text-ink-900">
                발행 완료
              </h2>
              <span className="text-[12px] font-bold text-ink-400">
                {published.length}
              </span>
            </div>
            <div className="space-y-2">
              {published.map((d) => (
                <HistoryRow key={d.id} row={d} kind="published" />
              ))}
            </div>
          </section>
        )}

        {/* 반려 */}
        {rejected.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3 mt-8">
              <History size={16} className="text-ink-400" />
              <h2 className="text-[15px] font-extrabold text-ink-700">반려됨</h2>
              <span className="text-[12px] font-bold text-ink-400">
                {rejected.length}
              </span>
            </div>
            <div className="space-y-2">
              {rejected.map((d) => (
                <HistoryRow key={d.id} row={d} kind="rejected" />
              ))}
            </div>
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
      {connected ? (
        <CircleCheck size={12} />
      ) : (
        <CircleX size={12} />
      )}
      {connected ? "Threads 연결됨" : "Threads 미연결"}
    </span>
  );
}

function EmptyState({ connected }: { connected: boolean }) {
  return (
    <div className="bg-white rounded-2xl shadow-card p-10 text-center">
      <Inbox size={32} className="text-ink-300 mx-auto mb-3" />
      <p className="text-[14px] font-bold text-ink-700">
        검토할 초안이 없습니다
      </p>
      <p className="text-[12px] text-ink-500 mt-1 leading-relaxed">
        매일 아침 자동 리서치가 인기글을 분석해 초안을 채웁니다.
        {!connected && (
          <>
            <br />
            먼저 <strong>설정 → Threads 연동</strong>에서 계정을 연결하세요.
          </>
        )}
      </p>
    </div>
  );
}

function HistoryRow({
  row,
  kind,
}: {
  row: ThreadsDraftRow;
  kind: "published" | "rejected";
}) {
  return (
    <div className="bg-white rounded-xl border border-ink-100 px-4 py-3 flex items-center gap-3">
      <span className="text-[10px] font-bold bg-ink-50 text-ink-500 rounded px-1.5 py-0.5 flex-shrink-0">
        #{row.keyword}
      </span>
      <p className="text-[12px] text-ink-600 flex-1 truncate">
        {row.draft_text}
      </p>
      {kind === "published" && row.published_at && (
        <span className="text-[11px] text-ink-400 flex-shrink-0">
          {new Date(row.published_at).toLocaleDateString("ko-KR", {
            timeZone: "Asia/Seoul",
          })}
        </span>
      )}
    </div>
  );
}
