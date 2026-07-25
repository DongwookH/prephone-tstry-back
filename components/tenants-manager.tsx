"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  addTenantAction,
  setTenantStatusAction,
} from "@/app/(dashboard)/settings/actions";
import type { TenantRow } from "@/lib/tenants";

export function TenantsManager({
  tenants,
  isAdmin,
}: {
  tenants: TenantRow[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  if (!isAdmin) return null;

  const handleAdd = () => {
    setMsg(null);
    start(async () => {
      const res = await addTenantAction({ email, name });
      if (res.ok) {
        setEmail("");
        setName("");
        setMsg({ kind: "ok", text: "추가되었습니다" });
        router.refresh();
      } else {
        setMsg({ kind: "err", text: res.error });
      }
    });
  };

  const handleToggleStatus = (t: TenantRow) => {
    const next: "active" | "suspended" =
      t.status === "suspended" ? "active" : "suspended";
    const label = next === "suspended" ? "정지" : "재개";
    if (!confirm(`${t.email} 계정을 ${label}할까요?`)) return;
    setMsg(null);
    setBusyId(t.id);
    start(async () => {
      const res = await setTenantStatusAction(t.id, next);
      setBusyId(null);
      if (res.ok) {
        setMsg({ kind: "ok", text: `${label}되었습니다` });
        router.refresh();
      } else {
        setMsg({ kind: "err", text: res.error });
      }
    });
  };

  return (
    <div className="space-y-3">
      {/* 등록된 사용자 목록 */}
      <div className="rounded-xl border border-ink-200 overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-ink-50 text-ink-500 text-[11px] font-bold">
              <th className="text-left px-3 py-2">이메일</th>
              <th className="text-left px-3 py-2">이름</th>
              <th className="text-left px-3 py-2">역할</th>
              <th className="text-left px-3 py-2">상태</th>
              <th className="text-left px-3 py-2">등록일</th>
              <th className="text-right px-3 py-2">관리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {tenants.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-6 text-center text-ink-500"
                >
                  등록된 사용자가 없습니다 — 아래에서 추가하세요
                </td>
              </tr>
            )}
            {tenants.map((t) => {
              const isOwner = t.role === "owner";
              const isBusy = pending && busyId === t.id;
              return (
                <tr key={t.id}>
                  <td className="px-3 py-2.5 font-semibold text-ink-900">
                    {t.email}
                  </td>
                  <td className="px-3 py-2.5 text-ink-700">
                    {t.name || "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={cn(
                        "text-[10px] font-bold rounded px-1.5 py-0.5",
                        isOwner
                          ? "bg-brand-50 text-brand-700"
                          : "bg-ink-100 text-ink-600",
                      )}
                    >
                      {isOwner ? "오너" : "멤버"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={cn(
                        "text-[10px] font-bold rounded-full px-2 py-0.5",
                        t.status === "active"
                          ? "bg-mint-50 text-mint-700"
                          : t.status === "suspended"
                            ? "bg-rose-50 text-rose-700"
                            : "bg-ink-100 text-ink-500",
                      )}
                    >
                      {t.status === "active"
                        ? "활성"
                        : t.status === "suspended"
                          ? "정지"
                          : "대기"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-ink-500">
                    {t.created_at?.slice(0, 10) || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {!isOwner && (
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(t)}
                        disabled={pending}
                        className={cn(
                          "h-7 px-2.5 rounded-lg text-[11px] font-bold disabled:opacity-40 inline-flex items-center gap-1",
                          t.status === "suspended"
                            ? "bg-mint-500 hover:bg-mint-600 text-white"
                            : "bg-rose-50 hover:bg-rose-100 text-rose-700",
                        )}
                      >
                        {isBusy && (
                          <Loader2 size={11} className="animate-spin" />
                        )}
                        {t.status === "suspended" ? "재개" : "정지"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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

      {/* 추가 폼 */}
      <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-3 space-y-2">
        <div className="text-[12px] font-bold text-ink-800">사용자 추가</div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="이메일 (필수)"
            className="flex-1 h-9 px-3 rounded-lg border border-ink-200 text-[13px] focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
          />
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="이름 (선택)"
            className="sm:w-40 h-9 px-3 rounded-lg border border-ink-200 text-[13px] focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={pending || !email.trim()}
            className="h-9 px-4 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white text-[12px] font-bold flex items-center justify-center gap-1.5 flex-shrink-0"
          >
            {pending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Plus size={13} />
            )}
            추가
          </button>
        </div>
      </div>
    </div>
  );
}
