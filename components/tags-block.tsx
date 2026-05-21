"use client";

import { useState, useMemo } from "react";
import { Tag, Copy, Check } from "lucide-react";

/**
 * 티스토리 발행용 태그 블록.
 * - tagsRaw (Gemini가 만든 태그) 우선 사용
 * - 비어있으면 keyword/category/persona 기반 fallback 자동 생성
 * - chip 클릭 → 개별 복사, "전체 복사" → 쉼표 구분 전체
 */
export function TagsBlock({
  tagsRaw,
  fallback,
}: {
  tagsRaw?: string;
  fallback?: {
    keyword?: string;
    category?: string;
    persona?: string;
  };
}) {
  const isFallback = !tagsRaw || !tagsRaw.trim();
  const tags = useMemo(() => {
    if (!isFallback) {
      return (tagsRaw || "")
        .split(/[,，、]/g)
        .map((t) => t.trim())
        .filter(Boolean);
    }
    // Fallback — keyword + category + persona + 공통 도메인 태그
    const list: string[] = [];
    const norm = (s: string) => s.replace(/\s+/g, "");
    if (fallback?.keyword) list.push(norm(fallback.keyword));
    if (fallback?.category && fallback.category !== "일반") {
      list.push(norm(fallback.category));
    }
    // 페르소나별 태그 매핑
    const personaTag: Record<string, string> = {
      IT: "직장인",
      자영업자: "자영업",
      대학생: "대학생",
      일반: "",
    };
    const pt = personaTag[fallback?.persona ?? ""];
    if (pt) list.push(pt);
    // 도메인 공통 태그
    const common = ["선불폰", "비대면개통", "5분개통", "앤텔레콤"];
    for (const t of common) {
      if (!list.includes(t)) list.push(t);
      if (list.length >= 7) break;
    }
    // 중복/빈값 제거
    return Array.from(new Set(list.filter(Boolean)));
  }, [tagsRaw, isFallback, fallback]);
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
        {isFallback && (
          <span className="ml-1 text-amber-700 font-bold">
            (자동 생성 — Gemini 태그 없는 옛 글)
          </span>
        )}
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
