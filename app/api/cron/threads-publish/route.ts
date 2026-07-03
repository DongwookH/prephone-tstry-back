import { NextResponse } from "next/server";
import { getThreadsDrafts } from "@/lib/sheets";
import {
  publishDueThreads,
  findDue,
  kstLabel,
  FRESHNESS_WINDOW_MIN,
} from "@/lib/threads-publish-core";
import { sendTelegram, telegramEnabled } from "@/lib/telegram";

export const maxDuration = 60;

/**
 * GET /api/cron/threads-publish
 *
 * 발행 안 하고 현재 상태만 진단. 서버 시각 기준 due/대기/stale 분류 + 임박 슬롯 목록.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const all = await getThreadsDrafts();
  const now = Date.now();
  const freshCutoff = now - FRESHNESS_WINDOW_MIN * 60 * 1000;

  const counts: Record<string, number> = {};
  for (const d of all) {
    const k = d.published_id ? "published" : d.status || "(빈값)";
    counts[k] = (counts[k] || 0) + 1;
  }

  // 미발행 + scheduled_at 있는 것 — 상태/시각 분류
  const pendingSlots = all
    .filter((d) => !d.published_id && d.scheduled_at)
    .map((d) => {
      const t = new Date(d.scheduled_at).getTime();
      let bucket: string;
      if (!isFinite(t)) bucket = "잘못된시각";
      else if (t > now) bucket = "미래(대기)";
      else if (t < freshCutoff) bucket = "stale(만료)";
      else bucket = "발행대상(due)";
      return {
        kst: kstLabel(d.scheduled_at),
        keyword: d.keyword,
        status: d.status,
        bucket,
        _t: t,
      };
    })
    .sort((a, b) => a._t - b._t);

  // 최근 발행 완료(published) — 시각 내림차순 상위 8
  const publishedRecent = all
    .filter((d) => d.published_id && d.scheduled_at)
    .map((d) => ({
      kst: kstLabel(d.scheduled_at),
      keyword: d.keyword,
      published_id: d.published_id,
      _t: new Date(d.scheduled_at).getTime(),
    }))
    .sort((a, b) => b._t - a._t)
    .slice(0, 8)
    .map(({ _t, ...rest }) => rest);

  return NextResponse.json({
    ok: true,
    serverNowUtc: new Date(now).toISOString(),
    serverNowKst: kstLabel(new Date(now).toISOString()),
    counts,
    dueNow: findDue(all, now).length,
    slots: pendingSlots.map(({ _t, ...rest }) => rest),
    publishedRecent,
  });
}

/**
 * POST /api/cron/threads-publish
 *
 * GHA가 발행 슬롯 시각(KST 9·14·20시) 직후에 호출.
 * 발행 로직은 lib/threads-publish-core.ts 공유 (텔레그램 웹훅과 동일 경로).
 * 발행 실패·신규 stale 발생 시 텔레그램 알림 발송.
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await publishDueThreads();

  // 텔레그램 알림 — 실패/stale은 사람이 봐야 하는 신호 (전송 실패는 무시)
  if (telegramEnabled()) {
    const failed = result.results.filter((r) => !r.ok);
    if (failed.length > 0) {
      await sendTelegram(
        `❌ <b>Threads 발행 실패</b>\n` +
          failed
            .map((f) => `· ${f.keyword}\n  ${f.error || "원인 불명"}`)
            .join("\n") +
          `\n\n다시 시도하려면 아래 버튼 👇`,
        { buttons: [{ text: "🚀 지금 발행", callback_data: "publish" }] },
      );
    }
    if (result.newlyStaleMarked > 0) {
      await sendTelegram(
        `⏰ <b>stale 슬롯 ${result.newlyStaleMarked}건</b> — 예약 후 ${FRESHNESS_WINDOW_MIN / 60}시간 넘게 미발행이라 자동 발행에서 제외했어요.\n백오피스에서 재예약하거나 취소해 주세요.`,
      );
    }
  }

  const status = result.ok ? 200 : 400;
  return NextResponse.json(result, { status });
}
