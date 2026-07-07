"use client";

import { useState } from "react";
import { Images, Download, AlertCircle } from "lucide-react";

/**
 * 글 상세 — 자동 생성된 카드뉴스(인포카드) 미리보기 + 다운로드.
 * /card-news/{postId}-{n}.png (n=1..MAX) 를 표시. 로드 실패한 장은 숨김.
 * (AI 배경 + 정보 오버레이 방식. 옛 html2canvas 카드뉴스를 대체.)
 */
const MAX_CARDS = 4;

export function CardNewsDownload({
  postId,
  title,
}: {
  postId: string;
  title: string;
}) {
  const [failed, setFailed] = useState<number[]>([]);
  const src = (n: number) => `/card-news/${postId}-${n}.png`;
  const markFailed = (n: number) =>
    setFailed((prev) => (prev.includes(n) ? prev : [...prev, n]));

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
      // 연속 다운로드 브라우저 차단 방지용 텀
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
        <div className="grid grid-cols-2 gap-3">
          {pages.map((n) =>
            failed.includes(n) ? null : (
              <div key={n} className="space-y-2">
                <div className="rounded-xl overflow-hidden border border-ink-100 bg-ink-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src(n)}
                    alt={`${title} 카드뉴스 ${n}`}
                    className="w-full h-auto block"
                    onError={() => markFailed(n)}
                  />
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
