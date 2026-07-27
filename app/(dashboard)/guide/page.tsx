import { redirect } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { GuideForm } from "@/components/guide-form";
import { getViewerContext } from "@/lib/tenant-context";
import { loadTenantGuideRaw } from "@/lib/tenant-config";
import { ExternalLink, FileText } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * 「내 가이드」 — 멤버가 시트를 열지 않고 세부 가이드를 작성하는 화면.
 * 오너는 대상이 아니다 (오너 가이드는 코드·CLAUDE.md 고정) → /settings로 보낸다.
 */
export default async function GuidePage() {
  const ctx = await getViewerContext();
  if (!ctx) redirect("/login");
  if (ctx.isOwner) redirect("/settings");

  if (!ctx.sheetId) {
    return (
      <>
        <Topbar
          crumbs={[{ label: "워크스페이스" }, { label: "내 가이드", bold: true }]}
        />
        <div className="px-8 py-8 max-w-[900px] mx-auto">
          <div className="bg-white rounded-2xl shadow-card p-16 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-ink-100 mb-4">
              <FileText size={20} className="text-ink-400" />
            </div>
            <h2 className="text-[16px] font-extrabold text-ink-900 mb-1.5">
              전용 시트 발급 대기 중
            </h2>
            <p className="text-[13px] text-ink-500">관리자에게 문의해 주세요.</p>
          </div>
        </div>
      </>
    );
  }

  const raw = await loadTenantGuideRaw(ctx.sheetId);
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${ctx.sheetId}`;

  return (
    <>
      <Topbar
        crumbs={[{ label: "워크스페이스" }, { label: "내 가이드", bold: true }]}
      />
      <div className="px-8 py-8 max-w-[900px] mx-auto animate-fade-up">
        <div className="mb-6">
          <h1 className="text-[26px] font-extrabold text-ink-900 tracking-tight">
            내 가이드
          </h1>
          <p className="mt-2 text-[14px] text-ink-600 leading-relaxed">
            여기 적은 내용으로 매일 아침 글이 만들어집니다. 필수 항목을 채우면
            다음 날부터 자동 생성이 시작됩니다.
          </p>
          <a
            href={sheetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-3 text-[12px] font-bold text-ink-500 hover:text-brand-600 transition"
          >
            내 시트에서 직접 보기 <ExternalLink size={11} />
          </a>
        </div>

        <GuideForm initial={raw} />
      </div>
    </>
  );
}
