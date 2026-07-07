"use client";

import { useState } from "react";
import { Images, Download, AlertCircle, Copy, Check } from "lucide-react";

/**
 * 글 상세 — 자동 생성된 카드뉴스(인포카드) 미리보기 + 다운로드 + 이미지 alt 편집.
 * /card-news/{postId}-{n}.png (n=1..MAX) 를 표시. 로드 실패한 장은 숨김.
 * alt: 카드별로 SEO용 alt 텍스트를 편집/복사 (티스토리 삽입 시 붙여넣기).
 */
const MAX_CARDS = 4;

export function CardNewsDownload({
  postId,
  title,
  keyword,
  cardTitles = [],
}: {
  postId: string;
  title: string;
  keyword?: string;
  /** 각 카드(섹션)의 제목 — alt 기본값 생성용. index 0 = 1번 카드. */
  cardTitles?: string[];
}) {
  const src = (n: number) => `/card-news/${postId}-${n}.png`;

  // 카드별 alt 기본값: "키워드 - 섹션제목(번호 접두 제거)"
  const defaultAlt = (n: number) => {
    const raw = (cardTitles[n - 1] || "").replace(/^\s*\d+\)\s*/, "").trim();
    const base = raw || `${title} 카드뉴스 ${n}`;
    return keyword && !base.includes(keyword) ? `${keyword} ${base}` : base;
  };

  const [failed, setFailed] = useState<number[]>([]);
  const [alts, setAlts] = useState<Record<number, string>>({});
  const [copied, setCopied] = useState<number | null>(null);

  const markFailed = (n: number) =>
    setFailed((prev) => (prev.includes(n) ? prev : [...prev, n]));
  const altOf = (n: number) => (n in alts ? alts[n] : defaultAlt(n));

  const copyAlt = async (n: number) => {
    try {
      await navigator.clipboard.writeText(altOf(n));
      setCopied(n);
      setTimeout(() => setCopied((c) => (c === n ? null : c)), 1500);
    } catch {
      /* clipboard 불가 환경 무시 */
    }
  };

  const pages = Array.from({ length: MAX_CARDS }, (_, i) => i + 1);
  const visible = pages.filter((n) => !failed.includes(n));
  const allFailed = failed.length >= MAX_CARDS;

  const downloadAll = async () => {
    for (const n of visible) {
      const a = document.createElement("a");
      a.href = src(n);
      a.download = `${postId}-${n}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise((r) => setTimeout(r, 350));
    }
  };

  return (
    <section className="bg-white rounded-2xl shadow-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Images size={16} className="text-brand-600" />
          <h3 className="text-[14px] font-extrabold text-ink-900">
            카드뉴스 (자동 생성)
          </h3>
        </div>
        {!allFailed && visible.length > 0 && (
          <button
            type="button"
            onClick={downloadAll}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-[12px] font-bold transition"
          >
            <Download size={13} />
            전체 다운로드
          </button>
        )}
      </div>

      {allFailed ? (
        <div className="flex items-center gap-2 text-[12px] text-ink-500 bg-ink-50 rounded-xl px-4 py-6 justify-center">
          <AlertCircle size={14} />
          이 글은 아직 카드뉴스가 생성되지 않았어요 (글 생성 시 자동 생성됩니다)
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {pages.map((n) =>
            failed.includes(n) ? null : (
              <div key={n} className="space-y-2">
                <div className="rounded-xl overflow-hidden border border-ink-100 bg-ink-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src(n)}
                    alt={altOf(n)}
                    className="w-full h-auto block"
                    onError={() => markFailed(n)}
                  />
                </div>

                {/* 이미지 alt (편집 + 복사) */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-ink-500">
                    이미지 alt (SEO)
                  </label>
                  <div className="flex items-start gap-1.5">
                    <textarea
                      value={altOf(n)}
                      onChange={(e) =>
                        setAlts((prev) => ({ ...prev, [n]: e.target.value }))
                      }
                      rows={2}
                      className="flex-1 text-[12px] leading-snug rounded-lg border border-ink-200 px-2.5 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-brand-400"
                    />
                    <button
                      type="button"
                      onClick={() => copyAlt(n)}
                      title="alt 복사"
                      className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-lg border border-ink-200 hover:bg-ink-50 text-ink-600 transition"
                    >
                      {copied === n ? (
                        <Check size={14} className="text-brand-600" />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                  </div>
                </div>

                <a
                  href={src(n)}
                  download={`${postId}-${n}.png`}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-ink-200 hover:bg-ink-50 text-ink-700 text-[12px] font-bold transition"
                >
                  <Download size={12} />
                  {n}번 다운로드
                </a>
              </div>
            ),
          )}
        </div>
      )}
    </section>
  );
}
