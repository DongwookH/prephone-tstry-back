import { NextResponse } from "next/server";
import {
  sendTelegram,
  answerCallback,
  getTgState,
  setTgState,
} from "@/lib/telegram";
import {
  publishDueThreads,
  threadsStatusText,
} from "@/lib/threads-publish-core";
import { handleNaturalMessage } from "@/lib/telegram-nlu";

export const maxDuration = 60;

/**
 * POST /api/telegram/webhook
 *
 * Telegram Bot 웹훅 — 형님이 봇에 명령을 보내면 Telegram이 여기로 POST.
 *
 * 지원:
 *  - /status          현재 발행 현황
 *  - /publish         예약시간 지난 승인 초안 즉시 발행 (호출당 1건)
 *  - 인라인 버튼      "publish" / "status" callback
 *  - 자연어 질문      명령이 아닌 일반 문장은 NLU 모듈이 해석해 응답
 *
 * 보안:
 *  - setWebhook 때 지정한 secret_token 헤더 검증
 *  - TELEGRAM_CHAT_ID 외 채팅은 무시
 *  - update_id 중복(재전송) 방지 — settings 시트 tg_state
 */

type TgUpdate = {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number } };
  };
};

const HELP = [
  "🤖 <b>앤텔레콤 Threads 봇</b>",
  "",
  "/status — 오늘 발행 현황·다음 예약 확인",
  "/publish — 밀린(연체) 승인 초안 즉시 발행",
  "",
  "일반 문장으로 물어봐도 돼요 (예: \"2시꺼 발행됐어?\", \"내일 뭐 나가?\")",
  "",
  "발행이 밀리면 제가 먼저 알림을 보내드려요.",
].join("\n");

async function runPublishAndReport() {
  const result = await publishDueThreads();
  if (!result.ok) {
    await sendTelegram(`❌ 발행 실패: ${result.error || "원인 불명"}`);
    return;
  }
  if (result.published === 0 && result.failed === 0) {
    await sendTelegram(
      `ℹ️ 지금 발행할 대상이 없어요.\n${result.message || ""}`.trim(),
    );
    return;
  }
  const lines: string[] = [];
  for (const r of result.results) {
    if (r.ok)
      lines.push(
        `✅ <b>${r.keyword}</b> 발행 완료 (댓글 ${r.replyIds?.length ?? 0}개)`,
      );
    else lines.push(`❌ ${r.keyword} 실패: ${r.error}`);
  }
  if (result.remaining > 0)
    lines.push(
      `\n⏳ 남은 발행 대기 ${result.remaining}건 — 아래 버튼으로 이어서 발행하세요.`,
    );
  await sendTelegram(lines.join("\n"), {
    buttons:
      result.remaining > 0
        ? [
            { text: "🚀 이어서 발행", callback_data: "publish" },
            { text: "📊 상태", callback_data: "status" },
          ]
        : [{ text: "📊 상태", callback_data: "status" }],
  });
}

export async function POST(req: Request) {
  // 1) 시크릿 헤더 검증
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (
    !process.env.TELEGRAM_WEBHOOK_SECRET ||
    secret !== process.env.TELEGRAM_WEBHOOK_SECRET
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update = (await req.json().catch(() => null)) as TgUpdate | null;
  if (!update) return NextResponse.json({ ok: true });

  // 2) 허용 채팅 검증 (다른 사람이 봇을 찾아 눌러도 무시)
  const chatId =
    update.message?.chat.id ?? update.callback_query?.message?.chat.id;
  const allowed = process.env.TELEGRAM_CHAT_ID;
  if (!allowed || String(chatId) !== String(allowed)) {
    return NextResponse.json({ ok: true }); // 200으로 조용히 무시 (재전송 방지)
  }

  // 3) update_id 중복 방지 — Telegram은 응답 지연 시 같은 update를 재전송함.
  //    처리 시작 전에 선점 기록 → 재전송이 와도 스킵 (중복 발행 방지).
  try {
    const last = Number((await getTgState("last_update_id")) || "0");
    if (update.update_id <= last) return NextResponse.json({ ok: true });
    await setTgState("last_update_id", String(update.update_id));
  } catch {
    /* 상태 저장 실패해도 명령은 처리 (발행 자체는 멱등에 가까움) */
  }

  // 4) 인라인 버튼
  if (update.callback_query) {
    const data = update.callback_query.data || "";
    await answerCallback(update.callback_query.id, "처리 중…");
    if (data === "publish") await runPublishAndReport();
    else if (data === "status") await sendTelegram(await threadsStatusText());
    return NextResponse.json({ ok: true });
  }

  // 5) 텍스트 명령
  const text = (update.message?.text || "").trim();
  if (text.startsWith("/publish")) {
    await runPublishAndReport();
  } else if (text.startsWith("/status")) {
    await sendTelegram(await threadsStatusText(), {
      buttons: [{ text: "🚀 밀린 것 발행", callback_data: "publish" }],
    });
  } else if (text.startsWith("/start") || text.startsWith("/help")) {
    await sendTelegram(HELP);
  } else if (text) {
    // 명령이 아닌 일반 문장 — 자연어 처리 모듈에 위임
    try {
      const result = await handleNaturalMessage(text);
      await sendTelegram(result.text, { buttons: result.buttons });
    } catch {
      // NLU 실패 시 기존 도움말로 폴백
      await sendTelegram(`모르는 명령이에요.\n\n${HELP}`);
    }
  }

  return NextResponse.json({ ok: true });
}
