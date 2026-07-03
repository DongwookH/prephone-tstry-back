import { NextResponse } from "next/server";
import { getThreadsDrafts } from "@/lib/sheets";
import {
  findOverdue,
  kstLabel,
  threadsStatusText,
} from "@/lib/threads-publish-core";
import {
  sendTelegram,
  telegramEnabled,
  getTgState,
  setTgState,
} from "@/lib/telegram";

export const maxDuration = 30;

// 예약시각 +20분까지는 정상 지연으로 간주 (발행 크론이 20분 간격이므로)
const GRACE_MIN = 20;
// 같은 연체 상황 반복 알림 최소 간격
const ALERT_COOLDOWN_MIN = 60;
// 일일 요약 발송 시작 시각 (KST)
const SUMMARY_HOUR_KST = 21;

/**
 * POST /api/cron/threads-watchdog
 *
 * 초경량 감시 — 발행은 하지 않음.
 *  1) 연체(예약+20분 초과 미발행 승인 초안) 발견 → 텔레그램 알림 + [지금 발행] 버튼
 *     (같은 알림은 60분에 1번만)
 *  2) KST 21시 이후 첫 실행 → 오늘 요약 1회 발송
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!telegramEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: "telegram env 미설정",
    });
  }

  const all = await getThreadsDrafts();
  const now = Date.now();
  const actions: string[] = [];

  // ── 1) 연체 감지 ──────────────────────────────
  const overdue = findOverdue(all, now, GRACE_MIN);
  if (overdue.length > 0) {
    const lastAlert = Number((await getTgState("last_overdue_alert")) || "0");
    const cooledDown = now - lastAlert > ALERT_COOLDOWN_MIN * 60 * 1000;
    if (cooledDown) {
      const lines = overdue.map((d) => {
        const lateMin = Math.round(
          (now - new Date(d.scheduled_at).getTime()) / 60000,
        );
        return `· ${kstLabel(d.scheduled_at)} <b>${d.keyword}</b> (${lateMin}분 경과)`;
      });
      const sent = await sendTelegram(
        `⚠️ <b>Threads 발행 밀림 ${overdue.length}건</b>\n${lines.join("\n")}\n\n크론이 이 슬롯을 놓친 것 같아요. 바로 발행할까요?`,
        {
          buttons: [
            { text: "🚀 지금 발행", callback_data: "publish" },
            { text: "📊 상태", callback_data: "status" },
          ],
        },
      );
      if (sent) {
        await setTgState("last_overdue_alert", String(now));
        actions.push(`연체 알림 발송 (${overdue.length}건)`);
      }
    } else {
      actions.push("연체 있으나 쿨다운 중 — 알림 생략");
    }
  }

  // ── 2) 일일 요약 (KST 21시 이후 하루 1회) ──────
  const kstHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      hour12: false,
    }).format(new Date(now)),
  );
  const todayKst = new Date(now).toLocaleDateString("en-CA", {
    timeZone: "Asia/Seoul",
  });
  if (kstHour >= SUMMARY_HOUR_KST) {
    const lastSummary = await getTgState("last_daily_summary");
    if (lastSummary !== todayKst) {
      const sent = await sendTelegram(
        `🌙 <b>오늘의 Threads 요약</b>\n\n${await threadsStatusText()}`,
      );
      if (sent) {
        await setTgState("last_daily_summary", todayKst);
        actions.push("일일 요약 발송");
      }
    }
  }

  return NextResponse.json({
    ok: true,
    overdue: overdue.length,
    actions: actions.length ? actions : ["할 일 없음"],
  });
}
