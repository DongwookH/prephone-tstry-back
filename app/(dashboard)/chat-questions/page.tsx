import { redirect } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { getChatLogsSummary } from "@/lib/sheets";
import {
  ChatQuestionsLive,
  type ChatLogsPayload,
} from "@/components/chat-questions-live";
import { MessageCircleQuestion } from "lucide-react";
import { getViewerContext } from "@/lib/tenant-context";

// 실시간 조회 — 캐시 없이 매 요청 시트 읽기 (이후 갱신은 클라이언트 15초 폴링)
export const dynamic = "force-dynamic";

const INITIAL_LIMIT = 200;

export default async function ChatQuestionsPage() {
  // 오너 전용 페이지 — 멤버가 직접 URL로 접근하면 대시보드로 돌려보낸다.
  const ctx = await getViewerContext();
  if (ctx && !ctx.isOwner) redirect("/");

  let initial: ChatLogsPayload = {
    rows: [],
    total: 0,
    todayCount: 0,
    errorCount: 0,
  };
  try {
    initial = await getChatLogsSummary(INITIAL_LIMIT);
  } catch {
    // 시트 접근 실패 — 빈 상태로 렌더 후 클라이언트 폴링이 재시도
  }

  return (
    <>
      <Topbar
        crumbs={[
          { label: "워크스페이스" },
          { label: "챗봇 질문", bold: true },
        ]}
      />

      <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-[1400px] mx-auto space-y-5 sm:space-y-6 animate-fade-up">
        <section>
          <div className="flex items-center gap-2 mb-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-mint-500 opacity-60"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-mint-500"></span>
            </span>
            <span className="text-[12px] font-bold text-mint-700">
              Google Sheet chat_logs 실시간 연동
            </span>
            <span className="text-[12px] text-ink-500">
              · 15초마다 자동 새로고침
            </span>
          </div>
          <h1 className="text-[20px] sm:text-[28px] font-extrabold text-ink-900 tracking-tight flex items-center gap-2">
            <MessageCircleQuestion size={22} className="text-brand-600" />
            챗봇 질문
          </h1>
          <p className="mt-1 text-[13px] sm:text-[14px] text-ink-600">
            사이트 AI 챗봇에 들어온 질문(개인정보 마스킹 처리)을 최신순으로
            보여줍니다. 이 화면은 읽기 전용입니다.
          </p>
        </section>

        <ChatQuestionsLive initial={initial} />

        <section className="pt-4 pb-8 text-center">
          <p className="text-[12px] text-ink-400">
            데이터 출처: Google Sheet chat_logs 탭 (Worker → Apps Script 수집)
          </p>
        </section>
      </div>
    </>
  );
}
