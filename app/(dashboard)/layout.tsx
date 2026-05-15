import { Sidebar } from "@/components/sidebar";
import { getSidebarCounts } from "@/lib/sheets";
import { auth } from "@/auth";

// 사이드바 카운트는 60초마다 다시 읽기
export const revalidate = 60;

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [counts, session] = await Promise.all([getSidebarCounts(), auth()]);
  return (
    <div className="flex min-h-screen">
      <Sidebar
        variant="full"
        counts={counts}
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
