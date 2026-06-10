"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  ExternalLink,
  Loader2,
  Check,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  addGaPropertyAction,
  disableGaPropertyAction,
} from "@/app/(dashboard)/settings/actions";

export type GaPropertyItem = {
  id: string;
  label: string;
  property_id: string;
  measurement_id: string;
  tistory_url: string;
};

export function GaPropertiesManager({
  properties,
}: {
  properties: GaPropertyItem[];
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(properties.length === 0);
  const [label, setLabel] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [measurementId, setMeasurementId] = useState("");
  const [tistoryUrl, setTistoryUrl] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  const reset = () => {
    setLabel("");
    setPropertyId("");
    setMeasurementId("");
    setTistoryUrl("");
  };

  const handleAdd = () => {
    setMsg(null);
    start(async () => {
      const res = await addGaPropertyAction({
        label,
        property_id: propertyId,
        measurement_id: measurementId,
        tistory_url: tistoryUrl,
      });
      if (res.ok) {
        reset();
        setShowForm(false);
        setMsg({ kind: "ok", text: "추가됨" });
        router.refresh();
      } else {
        setMsg({ kind: "err", text: res.error });
      }
    });
  };

  const handleRemove = (id: string, label: string) => {
    if (!confirm(`"${label}" 블로그 GA를 제거할까요? (분석 페이지에서 빠짐)`))
      return;
    start(async () => {
      const res = await disableGaPropertyAction(id);
      if (res.ok) router.refresh();
      else setMsg({ kind: "err", text: res.error });
    });
  };

  return (
    <div className="space-y-3">
      {/* 등록된 properties 목록 */}
      {properties.length === 0 ? (
        <div className="text-[12px] text-ink-500 bg-ink-50 rounded-lg p-3">
          등록된 GA 블로그가 없습니다. 아래 폼으로 추가하세요.
        </div>
      ) : (
        <div className="space-y-2">
          {properties.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-xl border border-ink-200 p-3"
            >
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-extrabold text-ink-900 truncate">
                  {p.label}
                </div>
                <div className="text-[11px] text-ink-500 font-mono mt-0.5">
                  property:{p.property_id}
                  {p.measurement_id && (
                    <span className="ml-2">· {p.measurement_id}</span>
                  )}
                </div>
                {p.tistory_url && (
                  <a
                    href={p.tistory_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-brand-600 hover:underline inline-flex items-center gap-0.5 mt-0.5"
                  >
                    {p.tistory_url.replace(/^https?:\/\//, "")}
                    <ExternalLink size={9} />
                  </a>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleRemove(p.id, p.label)}
                disabled={pending}
                className="text-ink-400 hover:text-rose-500 disabled:opacity-50 transition flex-shrink-0"
                title="제거"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

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
          {msg.kind === "ok" && <Check size={13} strokeWidth={3} />}
          {msg.text}
        </div>
      )}

      {/* 추가 폼 토글 */}
      {!showForm ? (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="h-9 px-3 rounded-xl border border-dashed border-ink-300 hover:bg-ink-50 text-[12px] font-bold text-ink-600 flex items-center gap-1.5 transition"
        >
          <Plus size={13} />
          블로그 GA 추가
        </button>
      ) : (
        <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-3 space-y-2">
          <div className="text-[12px] font-bold text-ink-800">
            새 GA4 블로그 추가
          </div>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="블로그 이름 (예: 메인 블로그)"
            className="w-full h-9 px-3 rounded-lg border border-ink-200 text-[13px] focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
          />
          <input
            type="text"
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            placeholder="Property ID (숫자만, 예: 1234567890)"
            className="w-full h-9 px-3 rounded-lg border border-ink-200 text-[13px] font-mono focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
          />
          <input
            type="text"
            value={measurementId}
            onChange={(e) => setMeasurementId(e.target.value)}
            placeholder="Measurement ID (선택, G-XXXXXXX)"
            className="w-full h-9 px-3 rounded-lg border border-ink-200 text-[13px] font-mono focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
          />
          <input
            type="text"
            value={tistoryUrl}
            onChange={(e) => setTistoryUrl(e.target.value)}
            placeholder="티스토리 URL (선택, https://...)"
            className="w-full h-9 px-3 rounded-lg border border-ink-200 text-[13px] focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAdd}
              disabled={pending || !label.trim() || !propertyId.trim()}
              className="h-9 px-4 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white text-[12px] font-bold flex items-center gap-1.5"
            >
              {pending ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Plus size={13} />
              )}
              추가
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                reset();
              }}
              disabled={pending}
              className="h-9 px-3 rounded-xl border border-ink-200 hover:bg-white text-[12px] font-bold text-ink-700 flex items-center gap-1"
            >
              <X size={13} />
              취소
            </button>
          </div>
          <div className="text-[10px] text-ink-500 leading-relaxed mt-1">
            <strong>Property ID 찾는 법:</strong> GA4 → 좌하단 ⚙️ 관리 → 속성
            설정 → 우상단에 9~12자리 숫자.
            <code className="ml-1 bg-white px-1 py-0.5 rounded">G-XXXXX</code>
            아님!
          </div>
        </div>
      )}
    </div>
  );
}
