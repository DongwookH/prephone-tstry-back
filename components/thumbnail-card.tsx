"use client";

import { useState } from "react";
import { ImageIcon, Download, AlertCircle } from "lucide-react";

/**
 * 글 상세 — 자동 생성된 썸네일 미리보기 + 다운로드.
 * /thumbnails/{postId}.png 를 표시. 없으면 안내.
 */
export function ThumbnailCard({
  postId,
  title,
}: {
  postId: string;
  title: string;
}) {
  const [errored, setErrored] = useState(false);
  const src = `/thumbnails/${postId}.png`;

  return (
    <section className="bg-white rounded-2xl shadow-card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <ImageIcon size={16} className="text-brand-600" />
        <h3 className="text-[14px] font-extrabold text-ink-900">
          썸네일 (자동 생성)
        </h3>
      </div>

      {errored ? (
        <div className="flex items-center gap-2 text-[12px] text-ink-500 bg-ink-50 rounded-xl px-4 py-6 justify-center">
          <AlertCircle size={14} />
          이 글은 아직 썸네일이 생성되지 않았어요 (글 생성 시 자동 생성됩니다)
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl overflow-hidden border border-ink-100 bg-ink-50 max-w-[360px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={`${title} 썸네일`}
              className="w-full h-auto block"
              onError={() => setErrored(true)}
            />
          </div>
          <a
            href={src}
            download={`${postId}.png`}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-[12px] font-bold transition"
          >
            <Download size={13} />
            썸네일 다운로드
          </a>
        </div>
      )}
    </section>
  );
}
