"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2, Check, AlertCircle } from "lucide-react";
import { savePostMetaAction } from "@/app/(dashboard)/posts/actions";
import { cn } from "@/lib/utils";

/**
 * 티스토리 발행 정보 저장 폼 (client component).
 * - 발행 완료 체크박스
 * - 티스토리 URL 입력
 * - 변경사항 저장 버튼 → savePostMetaAction 호출
 */
export function PublishForm({
  postId,
  initialPublished,
  initialUrl,
}: {
  postId: string;
  initialPublished: boolean;
  initialUrl: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [published, setPublished] = useState(initialPublished);
  const [url, setUrl] = useState(initialUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<"idle" | "saved" | "error">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // 변경 여부 감지 — 변경 없으면 버튼 비활성화 안내
  const dirty =
    published !== initialPublished || (url ?? "") !== (initialUrl ?? "");

  const handleSave = async () => {
    setSaving(true);
    setState("idle");
    setErrMsg(null);
    try {
      const r = await savePostMetaAction(postId, url.trim(), published);
      if (r.ok) {
        setState("saved");
        startTransition(() => router.refresh());
        setTimeout(() => setState("idle"), 2500);
      } else {
        setState("error");
        setErrMsg(r.error ?? "저장 실패");
      }
    } catch (err) {
      setState("error");
      setErrMsg((err as Error).message ?? "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-card p-6">
      <h3 className="text-[15px] font-extrabold text-ink-900 mb-4">
        티스토리 발행
      </h3>

      {/* 발행 완료 체크박스 */}
      <label className="flex items-start gap-3 cursor-pointer mb-4">
        <span className="relative flex-shrink-0 mt-0.5">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
            className="peer sr-only"
          />
          <span className="block w-5 h-5 rounded-md border-2 border-ink-300 peer-checked:bg-brand-500 peer-checked:border-brand-500 transition"></span>
          <svg
            className="absolute top-0 left-0 w-5 h-5 text-white opacity-0 peer-checked:opacity-100 pointer-events-none"
            viewBox="0 0 24 24"
            fill="none"
          >
            <path
              d="M5 13L9 17L19 7"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span>
          <span className="block text-[14px] font-bold text-ink-900">
            발행 완료
          </span>
          <span className="block text-[12px] text-ink-500 mt-0.5">
            티스토리에 게시한 뒤 체크하세요.
          </span>
        </span>
      </label>

      {/* 티스토리 URL */}
      <div className="mb-3">
        <label className="block text-[11px] font-bold text-ink-500 mb-1.5">
          티스토리 URL
        </label>
        <div className="flex items-center gap-2 h-11 px-3 rounded-xl border border-ink-200 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/10 transition">
          <Link2 size={14} className="text-ink-500" />
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://blog.tistory.com/entry/..."
            className="flex-1 bg-transparent outline-none text-[13px] font-medium text-ink-900 placeholder-ink-400"
          />
        </div>
      </div>

      {/* 저장 상태 표시 */}
      {state === "saved" && (
        <div className="mb-3 rounded-lg bg-mint-50 text-mint-700 text-[12px] font-bold px-3 py-2 flex items-center gap-1.5">
          <Check size={12} strokeWidth={3} />
          저장 완료
        </div>
      )}
      {state === "error" && (
        <div className="mb-3 rounded-lg bg-rose-50 text-rose-700 text-[12px] font-bold px-3 py-2 flex items-start gap-1.5">
          <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
          <span className="break-all">{errMsg ?? "저장 실패"}</span>
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving || !dirty}
        className={cn(
          "w-full h-11 rounded-xl transition text-white text-[14px] font-bold flex items-center justify-center gap-2",
          saving || !dirty
            ? "bg-ink-200 text-ink-500 cursor-not-allowed"
            : "bg-brand-500 hover:bg-brand-600 active:bg-brand-700 shadow-press",
        )}
      >
        {saving ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            저장 중…
          </>
        ) : !dirty ? (
          "변경사항 없음"
        ) : (
          "변경사항 저장"
        )}
      </button>
    </div>
  );
}
