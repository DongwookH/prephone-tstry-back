"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Eye, EyeOff, Loader2, Check, X } from "lucide-react";
import {
  addGeminiKeyAction,
  disableGeminiKeyAction,
} from "@/app/(dashboard)/settings/actions";
import { cn } from "@/lib/utils";

export interface GeminiKeyItem {
  id: string;
  masked: string;
  label: string;
  createdAt: string;
  source: "sheet" | "env";
  usage: number;
}

export function GeminiKeyManager({
  keys,
  envCount,
}: {
  keys: GeminiKeyItem[];
  envCount: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [showFull, setShowFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const handleAdd = async () => {
    setErr(null);
    setOkMsg(null);
    setBusy(true);
    const r = await addGeminiKeyAction({
      value: keyInput,
      label: labelInput,
    });
    setBusy(false);
    if (r.ok) {
      setKeyInput("");
      setLabelInput("");
      setAdding(false);
      setOkMsg("키가 추가되었습니다 — 다음 API 호출부터 적용");
      startTransition(() => router.refresh());
    } else {
      setErr(r.error);
    }
  };

  const handleRemove = async (id: string) => {
    if (!confirm("이 키를 비활성화할까요? (시트에는 보존됩니다)")) return;
    setErr(null);
    setOkMsg(null);
    const r = await disableGeminiKeyAction(id);
    if (r.ok) {
      setOkMsg("비활성화되었습니다");
      startTransition(() => router.refresh());
    } else {
      setErr(r.error);
    }
  };

  const sheetKeys = keys.filter((k) => k.source === "sheet");

  return (
    <div className="space-y-3">
      {/* 헤더 — 추가 버튼 */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[13px] font-bold text-ink-900">
            등록된 키 {keys.length}개
          </div>
          <div className="text-[11px] text-ink-500 mt-0.5">
            {sheetKeys.length > 0
              ? `시트 ${sheetKeys.length}개 사용 중`
              : envCount > 0
                ? `Vercel env ${envCount}개 사용 중 (시트 키 추가 시 자동 전환)`
                : "키 없음 — 추가 필요"}
          </div>
        </div>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="h-9 px-3 rounded-xl bg-ink-900 hover:bg-ink-800 transition text-white text-[12px] font-bold flex items-center gap-1.5"
          >
            <Plus size={11} strokeWidth={2.4} />
            키 추가
          </button>
        )}
      </div>

      {/* 추가 폼 */}
      {adding && (
        <div className="rounded-xl border-2 border-brand-500 bg-brand-50/30 p-4 space-y-3">
          <div>
            <label className="block text-[12px] font-bold text-ink-700 mb-1.5">
              Gemini API 키
            </label>
            <div className="flex gap-2">
              <input
                type={showFull ? "text" : "password"}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="AIzaSy..."
                className="flex-1 h-10 px-3 rounded-xl border border-ink-200 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 outline-none text-[13px] font-mono"
              />
              <button
                onClick={() => setShowFull((v) => !v)}
                className="w-10 h-10 rounded-xl border border-ink-200 hover:bg-ink-50 flex items-center justify-center"
                title={showFull ? "숨기기" : "보기"}
              >
                {showFull ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-[11px] text-ink-500 mt-1">
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 hover:underline font-semibold"
              >
                Google AI Studio
              </a>
              에서 발급 → 보통 39자, AIza로 시작
            </p>
          </div>
          <div>
            <label className="block text-[12px] font-bold text-ink-700 mb-1.5">
              메모 (선택)
            </label>
            <input
              type="text"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              placeholder="예: 주 계정, 백업 계정"
              className="w-full h-10 px-3 rounded-xl border border-ink-200 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 outline-none text-[13px]"
            />
          </div>
          {err && (
            <div className="rounded-lg bg-rose-50 text-rose-700 text-[12px] font-semibold px-3 py-2">
              {err}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setAdding(false);
                setKeyInput("");
                setLabelInput("");
                setErr(null);
              }}
              className="h-9 px-4 rounded-lg text-[12px] font-bold text-ink-700 hover:bg-ink-100"
            >
              취소
            </button>
            <button
              onClick={handleAdd}
              disabled={busy || !keyInput.trim()}
              className={cn(
                "h-9 px-4 rounded-lg text-[12px] font-bold flex items-center gap-1.5",
                busy || !keyInput.trim()
                  ? "bg-ink-200 text-ink-500 cursor-not-allowed"
                  : "bg-brand-500 hover:bg-brand-600 text-white",
              )}
            >
              {busy ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  추가 중…
                </>
              ) : (
                <>
                  <Check size={12} strokeWidth={3} />
                  추가
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {okMsg && (
        <div className="rounded-lg bg-mint-50 text-mint-700 text-[12px] font-semibold px-3 py-2 flex items-center justify-between">
          <span>✓ {okMsg}</span>
          <button
            onClick={() => setOkMsg(null)}
            className="text-mint-600 hover:text-mint-900"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* 키 목록 */}
      <div className="rounded-xl border border-ink-200 divide-y divide-ink-100">
        {keys.length === 0 && (
          <div className="p-6 text-center text-[12px] text-ink-500">
            등록된 키가 없습니다 — 위 &lsquo;키 추가&rsquo;로 시작하세요
          </div>
        )}
        {keys.map((k) => (
          <div key={k.id} className="px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-mono text-[12px] font-semibold text-ink-900">
                  {k.masked}
                </span>
                <span
                  className={cn(
                    "text-[10px] font-bold rounded px-1.5 py-0.5",
                    k.source === "sheet"
                      ? "bg-brand-50 text-brand-700"
                      : "bg-ink-100 text-ink-600",
                  )}
                >
                  {k.source === "sheet" ? "시트" : "env"}
                </span>
                {k.label && (
                  <span className="text-[11px] text-ink-600 font-semibold">
                    · {k.label}
                  </span>
                )}
              </div>
              <div className="text-[10px] text-ink-500">
                {k.source === "sheet"
                  ? `등록: ${k.createdAt?.slice(0, 10) || "—"} · 사용 ${k.usage}회`
                  : "Vercel env 변수 — 백오피스에서 수정 불가"}
              </div>
            </div>
            {k.source === "sheet" ? (
              <button
                onClick={() => handleRemove(k.id)}
                className="w-8 h-8 rounded-lg hover:bg-rose-50 hover:text-rose-700 text-ink-400 transition flex items-center justify-center"
                title="비활성화"
              >
                <Trash2 size={14} />
              </button>
            ) : (
              <div className="text-[10px] text-ink-400 font-semibold px-2">
                읽기 전용
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
