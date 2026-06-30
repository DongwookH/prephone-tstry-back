"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import {
  LayoutGrid,
  FileText,
  Sparkles,
  LineChart,
  Settings,
  HelpCircle,
  AtSign,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { UserMenu } from "./user-menu";

const adminItems = [
  { href: "/settings", label: "설정", icon: Settings },
  { href: "/help", label: "도움말", icon: HelpCircle },
];

type SidebarCounts = {
  postsCount?: number;
  keywordsCount?: number;
};

type SidebarUser = {
  name: string;
  email: string;
  image: string | null;
};

export function Sidebar({
  variant = "full",
  counts,
  user,
}: {
  variant?: "full" | "compact";
  counts?: SidebarCounts;
  user?: SidebarUser;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // 라우트 이동 시 모바일 드로어 자동 닫기
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const items: Array<{
    href: string;
    label: string;
    icon: typeof LayoutGrid;
    badge?: string;
    count?: number;
  }> = [
    { href: "/", label: "대시보드", icon: LayoutGrid, badge: "NEW" },
    {
      href: "/posts",
      label: "글 목록",
      icon: FileText,
      count: counts?.postsCount,
    },
    {
      href: "/keywords",
      label: "키워드",
      icon: Sparkles,
      count: counts?.keywordsCount,
    },
    { href: "/analytics", label: "분석", icon: LineChart },
    { href: "/threads", label: "Threads", icon: AtSign },
  ];

  if (variant === "compact") {
    return (
      <aside className="w-[72px] flex-shrink-0 bg-white border-r border-ink-100 flex flex-col items-center py-5">
        <Link
          href="/"
          className="w-10 h-10 rounded-xl bg-brand-500 flex items-center justify-center mb-8"
        >
          <BlogMark />
        </Link>
        <nav className="flex-1 flex flex-col gap-1.5 w-full px-3">
          {[...items, ...adminItems].map((it) => {
            const Icon = it.icon;
            const active =
              it.href === "/"
                ? pathname === "/"
                : pathname.startsWith(it.href);
            return (
              <Link
                key={it.href}
                href={it.href}
                title={it.label}
                className={cn(
                  "aspect-square rounded-xl transition flex items-center justify-center",
                  active
                    ? "bg-brand-50 text-brand-700"
                    : "text-ink-600 hover:bg-ink-50",
                )}
              >
                <Icon size={20} strokeWidth={2} />
              </Link>
            );
          })}
        </nav>
        {user ? (
          <UserMenu user={user} variant="compact" />
        ) : (
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-[13px]">
            N
          </div>
        )}
      </aside>
    );
  }

  const panel = (
    <>
      <div className="px-6 pt-7 pb-6">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-brand-500 flex items-center justify-center">
            <BlogMark />
          </div>
          <div>
            <div className="text-[15px] font-extrabold tracking-tight">
              Tistory Auto
            </div>
            <div className="text-[11px] text-ink-500 font-medium">v0.1 beta</div>
          </div>
        </Link>
      </div>

      <div className="px-4 pb-3">
        <div className="flex items-center gap-2 h-10 px-3 rounded-xl bg-ink-50 hover:bg-ink-100 transition cursor-text">
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="7" stroke="#8B95A1" strokeWidth="2" />
            <path
              d="M20 20L17 17"
              stroke="#8B95A1"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <span className="text-[13px] text-ink-500 flex-1">검색</span>
          <kbd className="text-[10px] font-semibold text-ink-500 bg-white border border-ink-200 rounded px-1.5 py-0.5">
            ⌘K
          </kbd>
        </div>
      </div>

      <nav className="flex-1 px-3 py-2 overflow-y-auto">
        <div className="px-3 py-2 text-[11px] font-bold text-ink-400 tracking-wider">
          워크스페이스
        </div>
        {items.map((it) => {
          const Icon = it.icon;
          const active =
            it.href === "/" ? pathname === "/" : pathname.startsWith(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 mt-1 first:mt-0 rounded-xl transition",
                active
                  ? "bg-brand-50 text-brand-700"
                  : "text-ink-700 hover:bg-ink-50",
              )}
            >
              <Icon size={18} strokeWidth={2} />
              <span
                className={cn(
                  "text-[14px] flex-1",
                  active ? "font-bold" : "font-semibold",
                )}
              >
                {it.label}
              </span>
              {it.badge && (
                <span className="text-[10px] font-bold bg-brand-500 text-white rounded-full px-1.5 py-0.5">
                  {it.badge}
                </span>
              )}
              {it.count !== undefined && (
                <span className="text-[12px] text-ink-500 font-medium">
                  {it.count}
                </span>
              )}
            </Link>
          );
        })}

        <div className="px-3 pt-6 pb-2 text-[11px] font-bold text-ink-400 tracking-wider">
          관리
        </div>
        {adminItems.map((it) => {
          const Icon = it.icon;
          const active = pathname.startsWith(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 mt-1 first:mt-0 rounded-xl transition",
                active
                  ? "bg-brand-50 text-brand-700"
                  : "text-ink-700 hover:bg-ink-50",
              )}
            >
              <Icon size={18} strokeWidth={2} />
              <span
                className={cn(
                  "text-[14px] flex-1",
                  active ? "font-bold" : "font-semibold",
                )}
              >
                {it.label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-ink-100 p-3">
        {user ? (
          <UserMenu user={user} />
        ) : (
          <Link
            href="/login"
            className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-ink-50 transition"
          >
            <div className="w-9 h-9 rounded-full bg-ink-200 text-ink-700 flex items-center justify-center font-bold text-[14px]">
              ?
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="text-[13px] font-bold text-ink-900">
                로그인 필요
              </div>
              <div className="text-[11px] text-ink-500">계정 연결 안 됨</div>
            </div>
          </Link>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* 모바일 상단바 (md 미만) */}
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between h-14 px-4 bg-white border-b border-ink-100">
        <Link
          href="/"
          onClick={() => setOpen(false)}
          className="flex items-center gap-2"
        >
          <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center">
            <BlogMark />
          </div>
          <span className="text-[15px] font-extrabold tracking-tight">
            Tistory Auto
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="메뉴 열기"
          className="-mr-2 w-10 h-10 flex items-center justify-center rounded-lg text-ink-700 hover:bg-ink-50 transition"
        >
          <Menu size={22} />
        </button>
      </header>

      {/* 모바일 드로어 */}
      {open && (
        <div className="md:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-ink-900/40 animate-fade-in"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-[268px] max-w-[82vw] bg-white border-r border-ink-100 flex flex-col shadow-hover animate-slide-in-left">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="메뉴 닫기"
              className="absolute right-3 top-4 z-10 w-9 h-9 flex items-center justify-center rounded-lg text-ink-500 hover:bg-ink-50 transition"
            >
              <X size={20} />
            </button>
            {panel}
          </aside>
        </div>
      )}

      {/* 데스크톱 사이드바 (md 이상) */}
      <aside className="hidden md:flex w-[248px] flex-shrink-0 bg-white border-r border-ink-100 flex-col">
        {panel}
      </aside>
    </>
  );
}

function BlogMark() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <path
        d="M4 7C4 5.34 5.34 4 7 4H17C18.66 4 20 5.34 20 7V17C20 18.66 18.66 20 17 20H7C5.34 20 4 18.66 4 17V7Z"
        stroke="white"
        strokeWidth="2"
      />
      <path
        d="M8 9H16M8 13H16M8 17H12"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
