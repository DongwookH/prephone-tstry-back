import { ChevronRight } from "lucide-react";

export function Topbar({
  crumbs,
  right,
}: {
  crumbs: { label: string; href?: string; bold?: boolean }[];
  right?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-10 bg-ink-50/80 backdrop-blur-xl border-b border-ink-100 px-8 h-[68px] flex items-center justify-between">
      <div className="flex items-center gap-2 min-w-0">
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-2">
            {i > 0 && <ChevronRight size={14} className="text-ink-300" />}
            {c.href ? (
              <a
                href={c.href}
                className={
                  c.bold
                    ? "text-[14px] font-bold text-ink-900"
                    : "text-[14px] font-semibold text-ink-700 hover:text-ink-900"
                }
              >
                {c.label}
              </a>
            ) : (
              <span
                className={
                  c.bold
                    ? "text-[14px] font-bold text-ink-900"
                    : "text-[14px] font-semibold text-ink-700"
                }
              >
                {c.label}
              </span>
            )}
          </span>
        ))}
      </div>
      {right}
    </header>
  );
}
