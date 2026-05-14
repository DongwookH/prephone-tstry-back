import { Sidebar } from "@/components/sidebar";
import { getSidebarCounts } from "@/lib/sheets";

// 사이드바 카운트는 60초마다 다시 읽기
export const revalidate = 60;

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const counts = await getSidebarCounts();
  return (
    <div className="flex min-h-screen">
      <Sidebar variant="full" counts={counts} />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
