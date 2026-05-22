"use client";

import { useState } from "react";
import { Trash2, AlertTriangle, Loader2 } from "lucide-react";
import { deletePostWithBlacklistAction } from "@/app/(dashboard)/posts/actions";
import { cn } from "@/lib/utils";

/**
 * 위험 영역 — 글 삭제 + 키워드 블랙리스트.
 *
 * 사용:
 *  - 잘못된 정보가 있는 글 발견 시 삭제
 *  - 동시에 키워드 블랙리스트 → 다음 cron부터 같은 키워드 픽 안 됨 (재발 방지)
 */
export function DangerZone({
  postId,
  keyword,
  title,
}: {
  postId: string;
  keyword: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [blacklistToo, setBlacklistToo] = useState(true);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const expected = "삭제";
  const canSubmit = !busy && confirmText.trim() === expected;

  const handleDelete = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await deletePostWithBlacklistAction({
        postId,
        keyword,
        blacklistKeywordToo: blacklistToo,
      });
      // 성공 시 server action이 redirect → 여기 안 옴
      if (r && r.ok === false) {
        setErr(r.error ?? "삭제 실패");
        setBusy(false);
      }
    } catch (err) {
      // Next redirect 는 throw 기반이라 정상 흐름에선 여기 안 옴.
      // 진짜 에러일 때만 표시.
      const msg = (err as Error).message ?? "";
      if (msg && !msg.includes("NEXT_REDIRECT")) {
        setErr(msg);
        setBusy(false);
      }
    }
  };

  if (!open) {
    return (
      <div className="bg-rose-50/50 border border-rose-200 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle size={14} className="text-rose-600" />
          <h3 className="text-[13px] font-extrabold text-rose-700">
            위험 영역
          </h3>
        </div>
        <p className="text-[11px] text-rose-700/80 mb-3 leading-relaxed">
          글에 잘못된 내용이 있나요? 삭제하고 키워드를 블랙리스트에 추가하면 같은
          키워드로 다시 글이 생성되지 않습니다.
        </p>
        <button
          onClick={() => setOpen(true)}
          className="h-9 px-3 rounded-xl border border-rose-300 text-rose-700 hover:bg-rose-100 text-[12px] font-bold flex items-center gap-1.5 transition"
        >
          <Trash2 size={12} />
          글 삭제하기
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white border-2 border-rose-300 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle size={14} className="text-rose-600" />
        <h3 className="text-[13px] font-extrabold text-rose-700">
          정말 삭제하시겠어요?
        </h3>
      </div>

      <div className="mb-3 p-3 bg-ink-50 rounded-lg">
        <div className="text-[11px] text-ink-500 mb-1">삭제 대상</div>
        <div className="text-[13px] font-bold text-ink-900 truncate">
          {title}
        </div>
        <div className="text-[11px] text-ink-600 mt-0.5">
          키워드:{" "}
          <span className="font-bold text-brand-700">#{keyword}</span>
        </div>
      </div>

      {/* 블랙리스트 옵션 */}
      <label className="flex items-start gap-2 mb-4 cursor-pointer">
        <input
          type="checkbox"
          checked={blacklistToo}
          onChange={(e) => setBlacklistToo(e.target.checked)}
          className="mt-0.5 w-4 h-4 accent-rose-500"
        />
        <span>
          <span className="block text-[12px] font-bold text-ink-900">
            키워드 블랙리스트 동시 추가
          </span>
          <span className="block text-[11px] text-ink-500 mt-0.5">
            <strong>#{keyword}</strong>를 keywords 시트에서{" "}
            <code className="bg-ink-100 px-1 rounded">blacklisted</code> 상태로
            변경 → 다음 cron부터 픽 안 됨
          </span>
        </span>
      </label>

      {/* 확인 입력 */}
      <div className="mb-3">
        <label className="block text-[11px] font-bold text-ink-600 mb-1.5">
          확인을 위해 <code className="bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded font-mono">{expected}</code> 입력
        </label>
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={expected}
          className="w-full h-10 px-3 rounded-xl border border-ink-200 focus:border-rose-400 focus:ring-4 focus:ring-rose-400/10 outline-none text-[13px] font-medium"
        />
      </div>

      {err && (
        <div className="mb-3 rounded-lg bg-rose-100 text-rose-700 text-[12px] font-bold px-3 py-2 flex items-start gap-1.5">
          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
          <span>{err}</span>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => {
            setOpen(false);
            setConfirmText("");
            setErr(null);
          }}
          disabled={busy}
          className="flex-1 h-10 rounded-xl border border-ink-200 hover:bg-ink-50 text-[12px] font-bold text-ink-700 transition"
        >
          취소
        </button>
        <button
          onClick={handleDelete}
          disabled={!canSubmit}
          className={cn(
            "flex-1 h-10 rounded-xl text-[12px] font-bold flex items-center justify-center gap-1.5 transition",
            canSubmit
              ? "bg-rose-600 hover:bg-rose-700 text-white"
              : "bg-ink-200 text-ink-500 cursor-not-allowed",
          )}
        >
          {busy ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              삭제 중…
            </>
          ) : (
            <>
              <Trash2 size={12} />
              영구 삭제
            </>
          )}
        </button>
      </div>
    </div>
  );
}
