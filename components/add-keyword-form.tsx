"use client";

import { useState, useTransition, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Plus, X, Loader2, Check, AlertCircle } from "lucide-react";
import {
  addKeywordsAction,
  type AddedKeyword,
} from "@/app/(dashboard)/keywords/actions";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  { value: "", label: "자동 분류" },
  { value: "개통핵심", label: "개통핵심" },
  { value: "광역시", label: "광역시" },
  { value: "페인포인트", label: "페인포인트" },
  { value: "eSIM", label: "eSIM" },
  { value: "타겟", label: "타겟" },
  { value: "채널", label: "채널" },
  { value: "지역", label: "지역" },
  { value: "일반", label: "일반" },
] as const;

const PRIORITIES = [
  { value: "", label: "자동 (검색량 기준)" },
  { value: "high", label: "High (필수)" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
] as const;

export function AddKeywordButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="h-9 px-4 rounded-xl bg-brand-500 hover:bg-brand-600 transition text-white text-[13px] font-bold flex items-center gap-1.5 shadow-press"
      >
        <Plus size={13} strokeWidth={2.4} />
        키워드 추가
      </button>
      {open && <AddKeywordModal onClose={() => setOpen(false)} />}
    </>
  );
}

function AddKeywordModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [category, setCategory] = useState<string>("");
  const [priority, setPriority] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [result, setResult] = useState<{
    added: AddedKeyword[];
    skipped: { keyword: string; reason: string }[];
    error?: string;
  } | null>(null);

  // Portal 마운트 + ESC 닫기 + body 스크롤 잠금
  useEffect(() => {
    setMounted(true);
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = original;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const handleSubmit = async () => {
    // 콤마 또는 줄바꿈으로 구분
    const keywords = text
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (keywords.length === 0) {
      setResult({ added: [], skipped: [], error: "키워드를 입력하세요" });
      return;
    }
    setLoading(true);
    setResult(null);
    const r = await addKeywordsAction({
      keywords,
      category: (category || undefined) as Parameters<
        typeof addKeywordsAction
      >[0]["category"],
      priority: (priority || undefined) as
        | "high"
        | "normal"
        | "low"
        | undefined,
    });
    setLoading(false);
    if (r.ok) {
      setResult({ added: r.added, skipped: r.skipped });
      startTransition(() => router.refresh());
      // 다 성공한 경우 텍스트 비우기
      if (r.skipped.length === 0) setText("");
    } else {
      setResult({ added: [], skipped: [], error: r.error });
    }
  };

  if (!mounted) return null;

  const modal = (
    <div
      className="fixed inset-0 flex items-start justify-center bg-black/50 p-4 overflow-y-auto"
      style={{ zIndex: 9999 }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl shadow-hover w-full max-w-[560px] my-12 flex flex-col max-h-[calc(100vh-96px)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header (sticky) */}
        <div className="sticky top-0 z-10 bg-white rounded-t-3xl flex items-center justify-between px-6 py-5 border-b border-ink-100">
          <div>
            <h2 className="text-[18px] font-extrabold text-ink-900">
              키워드 추가
            </h2>
            <p className="text-[12px] text-ink-500 mt-0.5">
              한 번에 최대 30개. 콤마 또는 줄바꿈으로 구분.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl hover:bg-ink-100 transition flex items-center justify-center"
          >
            <X size={18} className="text-ink-700" />
          </button>
        </div>

        {/* Form (스크롤 영역) */}
        <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-[12px] font-bold text-ink-700 mb-1.5">
              키워드 <span className="text-rose-500">*</span>
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`예시:\n선불폰 개통 후기\n외국인 선불폰 비대면 개통, KT 바로유심 편의점`}
              rows={5}
              className="w-full px-3 py-2.5 rounded-xl border border-ink-200 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 outline-none text-[13px] font-medium transition resize-none"
            />
            <p className="text-[11px] text-ink-500 mt-1">
              줄바꿈 또는 콤마(,)로 여러 키워드 한 번에 입력 가능
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-bold text-ink-700 mb-1.5">
                카테고리
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-ink-200 focus:border-brand-500 outline-none text-[13px] font-medium bg-white"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-bold text-ink-700 mb-1.5">
                우선순위
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-ink-200 focus:border-brand-500 outline-none text-[13px] font-medium bg-white"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="bg-brand-50 rounded-xl p-3 text-[11px] text-brand-700 font-semibold leading-relaxed">
            💡 추가하면 자동으로:
            <br />• 네이버 광고 API로 PC/모바일 월 검색량 조회
            <br />• 카테고리·역할(main/sub) 자동 분류 (수동 지정 시 우선)
            <br />• Google Sheet keywords 탭에 즉시 저장
          </div>

          {/* Result */}
          {result && (
            <div
              className={cn(
                "rounded-xl p-4 text-[13px]",
                result.error
                  ? "bg-rose-50 text-rose-700"
                  : result.added.length > 0
                    ? "bg-mint-50 text-mint-700"
                    : "bg-amber-50 text-amber-700",
              )}
            >
              {result.error ? (
                <div className="flex items-start gap-2">
                  <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold mb-1">실패</div>
                    <div>{result.error}</div>
                  </div>
                </div>
              ) : (
                <>
                  {result.added.length > 0 && (
                    <div className="flex items-start gap-2 mb-2">
                      <Check
                        size={16}
                        strokeWidth={3}
                        className="flex-shrink-0 mt-0.5"
                      />
                      <div className="flex-1">
                        <div className="font-bold mb-1">
                          {result.added.length}개 추가됨
                        </div>
                        <ul className="space-y-1">
                          {result.added.map((a) => (
                            <li
                              key={a.id}
                              className="text-[12px] flex items-center gap-2 flex-wrap"
                            >
                              <span className="font-bold">{a.keyword}</span>
                              <span className="text-[10px] bg-white rounded px-1.5 py-0.5">
                                {a.category}
                              </span>
                              <span className="text-[10px] bg-white rounded px-1.5 py-0.5">
                                {a.role}
                              </span>
                              <span className="text-[10px] bg-white rounded px-1.5 py-0.5">
                                {a.priority}
                              </span>
                              <span className="text-[10px]">
                                {a.search_volume > 0
                                  ? `${a.search_volume.toLocaleString()}회/월`
                                  : "검색량 없음"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                  {result.skipped.length > 0 && (
                    <div className="flex items-start gap-2">
                      <AlertCircle
                        size={16}
                        className="flex-shrink-0 mt-0.5 text-amber-600"
                      />
                      <div className="flex-1">
                        <div className="font-bold mb-1 text-amber-700">
                          {result.skipped.length}개 건너뜀
                        </div>
                        <ul className="space-y-0.5">
                          {result.skipped.map((s, i) => (
                            <li key={i} className="text-[11px] text-amber-700">
                              <span className="font-bold">{s.keyword}</span> —{" "}
                              {s.reason}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer (sticky) */}
        <div className="sticky bottom-0 bg-ink-50/95 backdrop-blur-sm flex items-center justify-between px-6 py-4 border-t border-ink-100 rounded-b-3xl">
          <button
            onClick={onClose}
            className="h-10 px-4 rounded-xl text-[13px] font-bold text-ink-700 hover:bg-ink-100 transition"
          >
            닫기
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !text.trim()}
            className={cn(
              "h-10 px-5 rounded-xl text-[13px] font-bold transition flex items-center gap-2",
              loading || !text.trim()
                ? "bg-ink-200 text-ink-500 cursor-not-allowed"
                : "bg-brand-500 hover:bg-brand-600 text-white shadow-press",
            )}
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                추가 중…
              </>
            ) : (
              <>
                <Plus size={14} strokeWidth={2.4} />
                추가하기
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  // Portal로 body 직속에 마운트 → topbar의 backdrop-blur stacking context 영향 X
  return createPortal(modal, document.body);
}
