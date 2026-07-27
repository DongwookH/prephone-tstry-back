"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ExternalLink, Loader2, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  addNvidiaKeyAction,
  disableGeminiKeyAction,
} from "@/app/(dashboard)/settings/actions";

/**
 * NVIDIA NIM API 키 관리 (썸네일·카드뉴스 배경 이미지 생성용).
 * 비활성화는 종류를 가리지 않는 disableGeminiKeyAction을 그대로 쓴다 (id로만 찾음).
 */

export type NvidiaKeyItem = {
  id: string;
  masked: string;
  label: string;
  createdAt: string;
};

export function NvidiaKeyManager({ keys }: { keys: NvidiaKeyItem[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(keys.length === 0);
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  const handleAdd = () => {
    setMsg(null);
    start(async () => {
      const res = await addNvidiaKeyAction({ value, label });
      if (res.ok) {
        setValue("");
        setLabel("");
        setShowForm(false);
        setMsg({ kind: "ok", text: "등록되었습니다" });
        router.refresh();
      } else {
        setMsg({ kind: "err", text: res.error });
      }
    });
  };

  const handleRemove = (id: string) => {
    if (!confirm("이 키를 비활성화할까요? (시트에는 보존됩니다)")) return;
    start(async () => {
      const res = await disableGeminiKeyAction(id);
      if (res.ok) router.refresh();
      else setMsg({ kind: "err", text: res.error });
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-bold text-ink-600">
          {keys.length > 0 ? `등록된 키 ${keys.length}개` : "키 없음"}
        </span>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="h-9 px-3 rounded-xl bg-brand-500 text-white text-[12.5px] font-bold hover:bg-brand-600 transition flex items-center gap-1.5"
          >
            <Plus size={14} strokeWidth={2.5} /> 키 추가
          </button>
        )}
      </div>

      {keys.map((k) => (
        <div
          key={k.id}
          className="flex items-center gap-3 p-3 rounded-xl border border-ink-200"
        >
          <ImageIcon size={16} className="text-ink-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-bold text-ink-900">
              {k.label || "이미지 생성 키"}
            </div>
            <div className="text-[11.5px] text-ink-500 font-mono truncate">
              {k.masked}
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleRemove(k.id)}
            disabled={pending}
            className="w-8 h-8 rounded-lg text-ink-500 hover:bg-rose-50 hover:text-rose-500 transition flex items-center justify-center flex-shrink-0"
            aria-label="비활성화"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      {showForm && (
        <div className="rounded-xl border border-ink-200 p-4 space-y-3">
          <div>
            <label className="text-[12px] font-bold text-ink-700 mb-1.5 block">
              API 키
            </label>
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="nvapi-..."
              className="w-full h-11 px-3 rounded-xl border border-ink-200 text-[13px] font-mono focus:outline-none focus:border-brand-500 transition"
            />
            <p className="text-[11px] text-ink-500 mt-1.5 leading-relaxed">
              <a
                href="https://build.nvidia.com/settings/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 font-bold hover:underline inline-flex items-center gap-1"
              >
                build.nvidia.com <ExternalLink size={10} />
              </a>
              {" "}에서 무료 발급 → nvapi- 로 시작합니다.
            </p>
          </div>
          <div>
            <label className="text-[12px] font-bold text-ink-700 mb-1.5 block">
              메모 (선택)
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="예: 이미지 생성용"
              className="w-full h-11 px-3 rounded-xl border border-ink-200 text-[13px] focus:outline-none focus:border-brand-500 transition"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAdd}
              disabled={pending || !value.trim()}
              className={cn(
                "h-10 px-4 rounded-xl bg-brand-500 text-white text-[13px] font-bold transition flex items-center gap-2",
                (pending || !value.trim()) && "opacity-50",
              )}
            >
              {pending ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> 등록 중
                </>
              ) : (
                "등록"
              )}
            </button>
            {keys.length > 0 && (
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="h-10 px-4 rounded-xl border border-ink-200 text-[13px] font-bold text-ink-600 hover:bg-ink-50 transition"
              >
                취소
              </button>
            )}
          </div>
        </div>
      )}

      {msg && (
        <div
          className={cn(
            "text-[12px] font-semibold",
            msg.kind === "ok" ? "text-mint-700" : "text-rose-500",
          )}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}
