"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Copy } from "lucide-react";
import type { PostRow as PostRowType } from "@/lib/sheets";
import { cn } from "@/lib/utils";
import { togglePublishedAction } from "@/app/(dashboard)/posts/actions";

function seoTone(score: number) {
  if (score >= 90) return "bg-mint-50 text-mint-700";
  if (score >= 80) return "bg-brand-50 text-brand-700";
  if (score >= 70) return "bg-amber-50 text-amber-700";
  return "bg-ink-100 text-ink-600";
}

function formatTime(iso: string): { time: string; date: string } {
  if (!iso) return { time: "-", date: "" };
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return { time: iso.slice(0, 16), date: "" };
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const yest = new Date(now);
    yest.setDate(yest.getDate() - 1);
    const isYesterday = d.toDateString() === yest.toDateString();

    const hh = d.getHours().toString().padStart(2, "0");
    const mm = d.getMinutes().toString().padStart(2, "0");
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const dayOfWeek = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];

    let time: string;
    if (isToday) time = `오늘 ${hh}:${mm}`;
    else if (isYesterday) time = `어제 ${hh}:${mm}`;
    else time = `${month}월 ${day}일 ${hh}:${mm}`;

    return { time, date: `${month}월 ${day}일 (${dayOfWeek})` };
  } catch {
    return { time: iso.slice(0, 16), date: "" };
  }
}

export function PostRow({ post }: { post: PostRowType }) {
  const seo = parseInt(post.seo_score || "0", 10);
  const chars = parseInt(post.char_count || "0", 10);
  const t = formatTime(post.created_at);
  const [isPending, startTransition] = useTransition();
  const [isPublished, setIsPublished] = useState(post.status === "published");
  const [error, setError] = useState<string | null>(null);

  const handleToggle = (e: React.MouseEvent | React.ChangeEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const target = isPublished ? "ready" : "published";
    setIsPublished(!isPublished);
    setError(null);
    startTransition(async () => {
      const r = await togglePublishedAction(post.id, isPublished ? "published" : "ready");
      if (!r.ok) {
        // 롤백
        setIsPublished(isPublished);
        setError(r.error || "저장 실패");
      }
    });
  };

  return (
    <Link
      href={`/posts/${post.id}`}
      className="row group grid grid-cols-[56px_minmax(0,1fr)_140px_110px_90px_72px_56px] items-center gap-4 px-5 py-4 hover:bg-ink-50/60 transition cursor-pointer"
    >
      <label
        className="flex items-center justify-center cursor-pointer relative"
        onClick={handleToggle}
        title={
          error
            ? `❌ ${error}`
            : isPending
              ? "저장 중…"
              : isPublished
                ? "발행 완료 (클릭하면 대기로)"
                : "발행 대기 (클릭하면 발행 완료로)"
        }
      >
        <input
          type="checkbox"
          checked={isPublished}
          onChange={() => {}}
          className="peer sr-only"
        />
        <span
          className={cn(
            "block w-[18px] h-[18px] rounded-md border-2 transition relative",
            isPublished
              ? "bg-brand-500 border-brand-500"
              : "border-ink-300",
            isPending && "opacity-50",
          )}
        >
          <svg
            className={cn(
              "absolute -top-px -left-px w-[18px] h-[18px] text-white pointer-events-none transition-opacity",
              isPublished ? "opacity-100" : "opacity-0",
            )}
            viewBox="0 0 24 24"
            fill="none"
          >
            <path
              d="M6 12L10 16L18 8"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </label>

      <div className="min-w-0">
        <div className="text-[14px] font-bold text-ink-900 truncate group-hover:text-brand-600 transition">
          {post.title}
        </div>
        <div className="text-[12px] text-ink-500 truncate mt-0.5">
          {post.content_html
            ? post.content_html
                .replace(/<[^>]+>/g, " ")
                .replace(/&[a-z]+;/gi, " ")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 80)
            : post.category || "-"}
        </div>
      </div>

      <div>
        <span className="text-[11px] font-bold bg-brand-50 text-brand-700 rounded-md px-2 py-1">
          {post.keyword || "-"}
        </span>
      </div>

      <div>
        <div className="text-[12px] font-bold text-ink-700">{t.time}</div>
        <div className="text-[11px] text-ink-400 mt-0.5">{t.date}</div>
      </div>

      <div className="text-right text-[13px] font-bold tabular-nums text-ink-700">
        {chars > 0 ? `${chars.toLocaleString()}자` : "-"}
      </div>

      <div className="text-center">
        <span
          className={cn(
            "inline-flex items-center justify-center min-w-[40px] h-7 px-2 rounded-md text-[12px] font-extrabold tabular-nums",
            seoTone(seo),
          )}
        >
          {seo > 0 ? seo : "-"}
        </span>
      </div>

      <button
        className="opacity-0 group-hover:opacity-100 transition w-9 h-9 rounded-lg hover:bg-ink-100 flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
        title="복사"
      >
        <Copy size={14} strokeWidth={2} className="text-ink-700" />
      </button>
    </Link>
  );
}

export function PostRowHeader() {
  return (
    <div className="grid grid-cols-[56px_minmax(0,1fr)_140px_110px_90px_72px_56px] items-center gap-4 px-5 py-3.5 border-b border-ink-100 bg-ink-50/60">
      <div className="text-center text-[11px] font-bold text-ink-500 tracking-wider">
        발행
      </div>
      <div className="text-[11px] font-bold text-ink-500 tracking-wider">
        제목
      </div>
      <div className="text-[11px] font-bold text-ink-500 tracking-wider">
        키워드
      </div>
      <div className="text-[11px] font-bold text-ink-500 tracking-wider">
        생성 시간
      </div>
      <div className="text-right text-[11px] font-bold text-ink-500 tracking-wider">
        글자수
      </div>
      <div className="text-center text-[11px] font-bold text-ink-500 tracking-wider">
        SEO
      </div>
      <div></div>
    </div>
  );
}

export function EmptyPostsState({
  message,
  hint,
}: {
  message: string;
  hint?: string;
}) {
  return (
    <div className="px-5 py-16 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-ink-100 mb-4">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <rect
            x="5"
            y="4"
            width="14"
            height="16"
            rx="2"
            stroke="#8B95A1"
            strokeWidth="2"
          />
          <path
            d="M9 9H15M9 13H15M9 17H12"
            stroke="#8B95A1"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <p className="text-[15px] font-bold text-ink-700 mb-1">{message}</p>
      {hint && <p className="text-[13px] text-ink-500">{hint}</p>}
    </div>
  );
}
