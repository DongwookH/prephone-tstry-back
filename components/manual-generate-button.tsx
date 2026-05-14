"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, Check, AlertCircle } from "lucide-react";
import { generateNowAction } from "@/app/(dashboard)/actions";
import { cn } from "@/lib/utils";

type State =
  | { kind: "idle" }
  | { kind: "loading"; startedAt: number }
  | {
      kind: "done";
      saved: number;
      track1: number;
      track2: number;
      failed: number;
      durationMs: number;
    }
  | { kind: "error"; message: string };

export function ManualGenerateButton() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [state, setState] = useState<State>({ kind: "idle" });

  const handleClick = async () => {
    if (state.kind === "loading") return;
    const ok = window.confirm(
      "지금 글 10편을 생성하시겠습니까?\n90~180초 정도 소요됩니다. 창을 닫지 마세요.",
    );
    if (!ok) return;

    setState({ kind: "loading", startedAt: Date.now() });
    const r = await generateNowAction();

    if (r.ok) {
      setState({
        kind: "done",
        saved: r.saved ?? 0,
        track1: r.track1Count ?? 0,
        track2: r.track2Count ?? 0,
        failed: r.failedCount ?? 0,
        durationMs: r.durationMs ?? 0,
      });
      startTransition(() => router.refresh());
      // 8초 후 상태 초기화
      setTimeout(() => setState({ kind: "idle" }), 8000);
    } else {
      setState({ kind: "error", message: r.error || "알 수 없는 오류" });
      setTimeout(() => setState({ kind: "idle" }), 6000);
    }
  };

  if (state.kind === "loading") {
    const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
    return (
      <button
        disabled
        className="h-9 px-3 rounded-xl bg-brand-50 text-brand-700 text-[13px] font-bold flex items-center gap-1.5 cursor-not-allowed"
        title="글 생성 중…"
      >
        <Loader2 size={15} className="animate-spin" />
        생성 중 ({elapsed}s)
      </button>
    );
  }

  if (state.kind === "done") {
    return (
      <button
        disabled
        className="h-9 px-3 rounded-xl bg-mint-500 text-white text-[13px] font-bold flex items-center gap-1.5"
        title={`Track1 ${state.track1}편 + Track2 ${state.track2}편 (${Math.round(state.durationMs / 1000)}초)`}
      >
        <Check size={15} strokeWidth={2.5} />
        완료 {state.saved}편 저장
      </button>
    );
  }

  if (state.kind === "error") {
    return (
      <button
        onClick={() => setState({ kind: "idle" })}
        className="h-9 px-3 rounded-xl bg-rose-500 text-white text-[13px] font-bold flex items-center gap-1.5"
        title={state.message}
      >
        <AlertCircle size={15} />
        실패 (재시도)
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      className={cn(
        "h-9 px-3 rounded-xl text-[13px] font-semibold text-ink-700",
        "hover:bg-ink-100 transition flex items-center gap-1.5",
      )}
    >
      <Plus size={15} strokeWidth={2.2} />
      수동 생성
    </button>
  );
}
