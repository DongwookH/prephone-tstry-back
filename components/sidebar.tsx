"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  FileText,
  Sparkles,
  LineChart,
  Settings,
  HelpCircle,
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

  return (
    <aside className="w-[248px] flex-shrink-0 bg-white border-r border-ink-100 flex flex-col">
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
    </aside>
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
