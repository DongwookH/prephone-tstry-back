"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { LogOut, Settings, User2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface UserMenuProps {
  user: {
    name: string;
    email: string;
    image: string | null;
  };
  variant?: "full" | "compact";
}

export function UserMenu({ user, variant = "full" }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const initial = (user.name || user.email || "U").charAt(0).toUpperCase();

  // 외부 클릭 닫기
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (variant === "compact") {
    return (
      <div ref={wrapRef} className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-[13px] overflow-hidden"
          title={user.email}
        >
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.image} alt={user.name} className="w-full h-full object-cover" />
          ) : (
            initial
          )}
        </button>
        {open && <Dropdown user={user} onClose={() => setOpen(false)} compact />}
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full flex items-center gap-3 p-2.5 rounded-xl transition",
          open ? "bg-ink-100" : "hover:bg-ink-50",
        )}
      >
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-[14px] overflow-hidden flex-shrink-0">
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.image} alt={user.name} className="w-full h-full object-cover" />
          ) : (
            initial
          )}
        </div>
        <div className="flex-1 text-left min-w-0">
          <div className="text-[13px] font-bold text-ink-900 truncate">
            {user.name}
          </div>
          <div className="text-[11px] text-ink-500 truncate">{user.email}</div>
        </div>
        <svg
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          className={cn(
            "text-ink-500 transition-transform",
            open && "rotate-180",
          )}
        >
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && <Dropdown user={user} onClose={() => setOpen(false)} />}
    </div>
  );
}

function Dropdown({
  user,
  onClose,
  compact,
}: {
  user: { name: string; email: string };
  onClose: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "absolute bg-white rounded-2xl shadow-hover border border-ink-100 overflow-hidden",
        compact
          ? "left-full ml-2 bottom-0 w-[240px]"
          : "left-0 right-0 bottom-[calc(100%+8px)] mx-0",
      )}
      style={{ zIndex: 60 }}
    >
      <div className="px-4 py-3 border-b border-ink-100">
        <div className="text-[12px] font-bold text-ink-900 truncate">
          {user.name}
        </div>
        <div className="text-[11px] text-ink-500 truncate">{user.email}</div>
      </div>
      <div className="py-1">
        <Link
          href="/settings"
          onClick={onClose}
          className="flex items-center gap-2.5 px-4 py-2.5 text-[13px] font-semibold text-ink-700 hover:bg-ink-50"
        >
          <Settings size={14} />
          설정
        </Link>
        <a
          href="https://myaccount.google.com"
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClose}
          className="flex items-center gap-2.5 px-4 py-2.5 text-[13px] font-semibold text-ink-700 hover:bg-ink-50"
        >
          <User2 size={14} />
          Google 계정 관리
        </a>
      </div>
      <div className="border-t border-ink-100 py-1">
        <button
          onClick={async () => {
            onClose();
            await signOut({ callbackUrl: "/login" });
          }}
          className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] font-bold text-rose-600 hover:bg-rose-50 transition"
        >
          <LogOut size={14} />
          로그아웃
        </button>
      </div>
    </div>
  );
}
