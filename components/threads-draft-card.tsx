"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Loader2,
  Send,
  Trash2,
  ExternalLink,
  Heart,
  MessageCircle,
  Repeat2,
  Lightbulb,
  Save,
  Hash,
  Plus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  saveDraftTextAction,
  rejectDraftAction,
  approveAndPublishAction,
} from "@/app/(dashboard)/threads/actions";

export type SourcePost = {
  author?: string;
  text?: string;
  likes?: number;
  replies?: number;
  reposts?: number;
  permalink?: string;
  timestamp?: string;
};

export type DraftCardData = {
  id: string;
  createdAt: string;
  keyword: string;
  draftText: string;
  insight: string;
  sourcePosts: SourcePost[];
  topicTag?: string;
  selfReplies?: string[];
};

export function ThreadsDraftCard({
  data,
  threadsConnected,
}: {
  data: DraftCardData;
  threadsConnected: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState(data.draftText);
  const [topicTag, setTopicTag] = useState(data.topicTag || "");
  const [selfReplies, setSelfReplies] = useState<string[]>(
    data.selfReplies && data.selfReplies.length > 0 ? data.selfReplies : [],
  );
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );
  const [showSource, setShowSource] = useState(false);

  const cleanReplies = (rs: string[]) => rs.map((r) => r.trim()).filter(Boolean);
  const dirty =
    text.trim() !== data.draftText.trim() ||
    topicTag.trim() !== (data.topicTag || "").trim() ||
    JSON.stringify(cleanReplies(selfReplies)) !==
      JSON.stringify(data.selfReplies || []);
  const len = text.length;

  const updateReply = (i: number, v: string) => {
    setSelfReplies((arr) => arr.map((r, idx) => (idx === i ? v : r)));
  };
  const addReply = () => {
    if (selfReplies.length >= 3) return;
    setSelfReplies((arr) => [...arr, ""]);
  };
  const removeReply = (i: number) => {
    setSelfReplies((arr) => arr.filter((_, idx) => idx !== i));
  };

  const handleSave = () =>
    start(async () => {
      const res = await saveDraftTextAction(
        data.id,
        text,
        topicTag,
        cleanReplies(selfReplies),
      );
      if (res.ok) {
        setMsg({ kind: "ok", text: "저장됨" });
        router.refresh();
      } else setMsg({ kind: "err", text: res.error });
    });

  const handleReject = () => {
    if (!confirm("이 초안을 반려할까요?")) return;
    start(async () => {
      const res = await rejectDraftAction(data.id);
      if (res.ok) router.refresh();
      else setMsg({ kind: "err", text: res.error });
    });
  };

  const handlePublish = () => {
    const cleaned = cleanReplies(selfReplies);
    const msg2 =
      cleaned.length > 0
        ? `메인 글 + 셀프 댓글 ${cleaned.length}개를 Threads에 발행할까요?`
        : "이 초안을 Threads에 발행할까요?";
    if (!confirm(msg2)) return;
    start(async () => {
      const res = await approveAndPublishAction(
        data.id,
        text,
        topicTag,
        cleaned,
      );
      if (res.ok) {
        const wantedReplies = cleaned.length;
        const okReplies = res.replyIds.length;
        if (wantedReplies > 0 && okReplies < wantedReplies) {
          // 메인은 발행됐지만 일부 댓글 실패
          const errs = res.replyErrors.join(" / ") || "원인 불명";
          setMsg({
            kind: "err",
            text: `메인 발행 OK (${res.postId}). 그러나 댓글 ${okReplies}/${wantedReplies}만 성공. 실패: ${errs}`,
          });
        } else {
          const replyMsg =
            okReplies > 0 ? ` + 댓글 ${okReplies}개` : "";
          setMsg({
            kind: "ok",
            text: `발행 완료${replyMsg}! (id: ${res.postId})`,
          });
        }
        router.refresh();
      } else setMsg({ kind: "err", text: res.error });
    });
  };

  return (
    <div className="bg-white rounded-2xl shadow-card p-5 space-y-3">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold bg-brand-50 text-brand-700 rounded-full px-2.5 py-1">
            #{data.keyword}
          </span>
          <span className="text-[11px] text-ink-400">
            {new Date(data.createdAt).toLocaleString("ko-KR", {
              timeZone: "Asia/Seoul",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
        <span
          className={cn(
            "text-[11px] font-bold tabular-nums",
            len > 500 ? "text-rose-600" : "text-ink-400",
          )}
        >
          {len}/500
        </span>
      </div>

      {/* 인사이트 */}
      {data.insight && (
        <div className="flex items-start gap-2 text-[12px] text-ink-600 bg-ink-50 rounded-lg px-3 py-2">
          <Lightbulb size={13} className="text-brand-500 mt-0.5 flex-shrink-0" />
          <span className="leading-relaxed">{data.insight}</span>
        </div>
      )}

      {/* 초안 편집 (메인 글) */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={7}
        className="w-full rounded-xl border border-ink-200 p-3 text-[14px] leading-relaxed text-ink-900 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none resize-y"
        placeholder="초안 본문..."
      />

      {/* 주제 태그 (topic_tag) */}
      <div className="flex items-center gap-2">
        <Hash size={14} className="text-ink-500 flex-shrink-0" />
        <input
          type="text"
          value={topicTag}
          onChange={(e) => setTopicTag(e.target.value)}
          maxLength={50}
          placeholder="주제 (예: 선불폰) — 비워두면 미적용"
          className="flex-1 h-9 px-3 rounded-lg border border-ink-200 text-[13px] text-ink-900 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
        />
        <span className="text-[10px] text-ink-400 tabular-nums w-12 text-right">
          {topicTag.length}/50
        </span>
      </div>

      {/* 셀프 댓글 (self_replies) — 알고리즘 부스트 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-ink-700">
            <MessageCircle size={12} />
            셀프 댓글 ({selfReplies.length}/3)
            <span className="text-ink-400 font-medium">
              · 발행 직후 자동 게시 → 알고리즘 부스트
            </span>
          </div>
          {selfReplies.length < 3 && (
            <button
              type="button"
              onClick={addReply}
              className="text-[11px] font-bold text-brand-600 hover:text-brand-700 flex items-center gap-0.5"
            >
              <Plus size={11} /> 추가
            </button>
          )}
        </div>
        {selfReplies.map((r, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="text-[10px] font-bold text-ink-400 mt-2.5 w-5 flex-shrink-0">
              ↳{i + 1}
            </span>
            <textarea
              value={r}
              onChange={(e) => updateReply(i, e.target.value)}
              rows={2}
              maxLength={500}
              placeholder={`댓글 ${i + 1} (자연스러운 후속 내용)`}
              className="flex-1 rounded-lg border border-ink-200 p-2 text-[13px] leading-relaxed text-ink-800 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none resize-y"
            />
            <button
              type="button"
              onClick={() => removeReply(i)}
              className="text-ink-400 hover:text-rose-500 mt-2 flex-shrink-0"
            >
              <X size={13} />
            </button>
          </div>
        ))}
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
          {msg.kind === "ok" ? <Check size={13} strokeWidth={3} /> : null}
          {msg.text}
        </div>
      )}

      {/* 액션 버튼 */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handlePublish}
          disabled={pending || !threadsConnected || len === 0 || len > 500}
          title={!threadsConnected ? "설정에서 Threads 연결 필요" : ""}
          className="h-10 px-4 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white text-[13px] font-bold flex items-center gap-1.5 transition"
        >
          {pending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Send size={14} />
          )}
          승인 & 발행
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={pending || !dirty}
          className="h-10 px-3 rounded-xl border border-ink-200 hover:bg-ink-50 disabled:opacity-40 text-ink-700 text-[13px] font-bold flex items-center gap-1.5 transition"
        >
          <Save size={14} />
          수정 저장
        </button>
        <button
          type="button"
          onClick={handleReject}
          disabled={pending}
          className="h-10 px-3 rounded-xl border border-rose-200 hover:bg-rose-50 disabled:opacity-40 text-rose-600 text-[13px] font-bold flex items-center gap-1.5 transition ml-auto"
        >
          <Trash2 size={14} />
          반려
        </button>
      </div>

      {/* 근거 인기글 */}
      {data.sourcePosts.length > 0 && (
        <div className="pt-2 border-t border-ink-100">
          <button
            type="button"
            onClick={() => setShowSource((s) => !s)}
            className="text-[12px] font-bold text-ink-500 hover:text-ink-700 transition"
          >
            {showSource ? "▼" : "▶"} 근거가 된 인기글 {data.sourcePosts.length}개
          </button>
          {showSource && (
            <div className="mt-2 space-y-2">
              {data.sourcePosts.map((p, i) => (
                <div
                  key={i}
                  className="rounded-lg bg-ink-50 p-2.5 text-[12px]"
                >
                  <div className="flex items-center gap-3 text-[11px] text-ink-500 mb-1">
                    {p.author && (
                      <span className="font-bold text-ink-700">
                        @{p.author}
                      </span>
                    )}
                    <span className="flex items-center gap-0.5">
                      <Heart size={11} /> {p.likes ?? 0}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <MessageCircle size={11} /> {p.replies ?? 0}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <Repeat2 size={11} /> {p.reposts ?? 0}
                    </span>
                    {p.permalink && (
                      <a
                        href={p.permalink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto text-brand-600 hover:underline flex items-center gap-0.5"
                      >
                        원문 <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                  <p className="text-ink-700 leading-relaxed line-clamp-3">
                    {p.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
