"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Loader2, CheckCircle2 } from "lucide-react";
import { regenerateOneRejectedAction } from "@/app/(dashboard)/threads/actions";

type LogEntry = {
  ok: boolean;
  text: string;
};

export function RegenerateRejectedButton({ count }: { count: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [progress, setProgress] = useState<{
    processed: number;
    total: number;
  } | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);

  const run = () => {
    if (count === 0) return;
    if (
      !confirm(
        `반려된 초안 ${count}개를 새 키워드로 재생성합니다.\n` +
          `Gemini API를 ${count}번 호출합니다.\n계속할까요?`,
      )
    )
      return;

    start(async () => {
      setLog([]);
      setProgress({ processed: 0, total: count });
      let processed = 0;
      let remaining = count;
      // 안전상 최대 count + 2번까지만 시도 (무한루프 방지)
      const HARD_CAP = count + 2;
      let attempts = 0;
      while (remaining > 0 && attempts < HARD_CAP) {
        attempts++;
        const res = await regenerateOneRejectedAction();
        if (!res.ok) {
          setLog((l) => [{ ok: false, text: `❌ ${res.error}` }, ...l]);
          break;
        }
        if (res.done) {
          remaining = 0;
          break;
        }
        processed++;
        remaining = res.remaining;
        setProgress({ processed, total: count });
        setLog((l) => [
          {
            ok: true,
            text: `✓ ${res.oldKeyword} → ${res.newKeyword}`,
          },
          ...l,
        ]);
      }
      router.refresh();
    });
  };

  if (count === 0) return null;

  return (
    <section className="space-y-3 bg-rose-50/50 border border-rose-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[14px] font-extrabold text-rose-900 flex items-center gap-2">
            <RotateCcw size={14} className="text-rose-600" />
            반려된 초안 재생성
          </h2>
          <p className="text-[12px] text-ink-600 mt-1">
            반려된 초안 <strong>{count}개</strong>를 새 키워드로 다시 작성합니다.
            기존 예약 시각은 유지, 상태는 검토 대기로 돌아갑니다.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="h-10 px-4 rounded-xl bg-rose-500 hover:bg-rose-600 disabled:opacity-40 text-white text-[13px] font-bold flex items-center gap-1.5 transition shrink-0"
        >
          {pending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RotateCcw size={14} />
          )}
          {pending
            ? progress
              ? `${progress.processed} / ${progress.total} 처리 중...`
              : "처리 중..."
            : `${count}개 재생성`}
        </button>
      </div>

      {log.length > 0 && (
        <div className="space-y-1 bg-white rounded-lg p-3 border border-rose-100 max-h-48 overflow-y-auto">
          {log.map((e, i) => (
            <div
              key={i}
              className={`text-[12px] flex items-center gap-1.5 ${
                e.ok ? "text-mint-700" : "text-rose-700"
              }`}
            >
              {e.ok && <CheckCircle2 size={12} />}
              <span>{e.text}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
