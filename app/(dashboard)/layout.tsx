import { Sidebar } from "@/components/sidebar";
import { getSidebarCounts } from "@/lib/sheets";
import { auth } from "@/auth";
import { getViewerContext } from "@/lib/tenant-context";

// 사이드바 카운트는 60초마다 다시 읽기
export const revalidate = 60;

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [ctx, session] = await Promise.all([getViewerContext(), auth()]);

  // 오너(또는 세션 해석 불가): 기존 그대로 메인 시트 카운트
  // 멤버: 본인 시트로 스코프. 시트 미발급(sheetId="")이면 조회 생략하고 0 카운트
  const isOwner = !ctx || ctx.isOwner;
  const counts = isOwner
    ? await getSidebarCounts()
    : ctx.sheetId
      ? await getSidebarCounts(ctx.sheetId)
      : { postsCount: 0, keywordsCount: 0 };

  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      <Sidebar
        variant="full"
        counts={counts}
        isOwner={isOwner}
        user={{
          name: session?.user?.name ?? "관리자",
          email: session?.user?.email ?? "",
          image: session?.user?.image ?? null,
        }}
      />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
