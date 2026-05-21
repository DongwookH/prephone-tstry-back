"use client";

import { useState, useMemo } from "react";
import { Tag, Copy, Check } from "lucide-react";

/**
 * 티스토리 발행용 태그 블록.
 * - 쉼표 구분 문자열을 받아서 chip들로 표시
 * - "전체 복사" → "태그1, 태그2, ..." 클립보드 복사
 * - 개별 chip 클릭 시 그 태그만 복사
 */
export function TagsBlock({ tagsRaw }: { tagsRaw: string }) {
  const tags = useMemo(
    () =>
      tagsRaw
        .split(/[,，、]/g)
        .map((t) => t.trim())
        .filter(Boolean),
    [tagsRaw],
  );
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const copyAll = async () => {
    const csv = tags.join(", ");
    try {
      await navigator.clipboard.writeText(csv);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch (e) {
      console.error(e);
    }
  };

  const copyOne = async (t: string, i: number) => {
    try {
      await navigator.clipboard.writeText(t);
      setCopiedIdx(i);
      setTimeout(() => setCopiedIdx(null), 1500);
    } catch (e) {
      console.error(e);
    }
  };

  if (tags.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl shadow-card p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[15px] font-extrabold text-ink-900 flex items-center gap-1.5">
          <Tag size={14} className="text-brand-600" />
          태그
          <span className="text-[11px] font-bold text-ink-500 ml-1">
            {tags.length}개
          </span>
        </h3>
        <button
          onClick={copyAll}
          className={`h-8 px-3 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition ${
            copiedAll
              ? "bg-mint-500 text-white"
              : "bg-ink-900 hover:bg-ink-800 text-white"
          }`}
        >
          {copiedAll ? (
            <>
              <Check size={11} strokeWidth={3} />
              복사 완료
            </>
          ) : (
            <>
              <Copy size={11} />
              전체 복사
            </>
          )}
        </button>
      </div>
      <p className="text-[11px] text-ink-500 mb-3">
        티스토리 발행 시 태그 입력란에 붙여넣기. 칩 클릭 → 개별 복사.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t, i) => (
          <button
            key={i}
            onClick={() => copyOne(t, i)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-bold transition ${
              copiedIdx === i
                ? "bg-mint-500 text-white"
                : "bg-brand-50 text-brand-700 hover:bg-brand-100"
            }`}
            title="클릭해서 복사"
          >
            {copiedIdx === i ? (
              <>
                <Check size={10} strokeWidth={3} />
                {t}
              </>
            ) : (
              <>#{t}</>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
