import { NextResponse } from "next/server";
import { getThreadsDrafts, updateThreadsDraft } from "@/lib/sheets";
import { getThreadsToken, postThreadWithReplies } from "@/lib/threads";

export const maxDuration = 60;

// 정시 cron이 GHA 부하로 몇 시간 건너뛰는 경우(드물지만 자주 발생)를 대비해
// 12시간 윈도우 유지. MAX_PER_RUN=1로 burst가 안 일어나므로 윈도우 넓혀도 안전.
// 12시간 초과 슬롯만 stale 처리 — 그 정도면 사실상 다음 주기 슬롯과 충돌 가능.
const FRESHNESS_WINDOW_MIN = 720;

// 한 호출에 1건만 발행 — Threads 알고리즘은 발행 간격이 중요하고,
// 같은 cron run에서 여러 개를 연달아 발행하면 "동일 시각 발행"으로 보임.
const MAX_PER_RUN = 1;

/**
 * POST /api/cron/threads-publish
 *
 * GHA가 매시간 정시 호출 (KST 9~21 시간대만 실제 발행 발생).
 *
 * 발행 대상: status="scheduled" + scheduled_at가 (now - 70분) ~ now 사이 + 아직 발행 안 된 것
 *   - 70분 윈도우 = cron 정시 트리거가 다음 시간까지 못 잡으면 다음 시간 cron이 처리할 수 있게.
 *   - 70분 초과로 지난 슬롯은 stale → 표시는 남기되 자동 발행 안 함 (사용자가 검토 후 수동 처리).
 * 한 호출에 최대 1건 발행 — 시간당 1개씩 자연스러운 스페이싱.
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const all = await getThreadsDrafts();
  const now = Date.now();
  const freshCutoff = now - FRESHNESS_WINDOW_MIN * 60 * 1000;

  const scheduledDrafts = all.filter(
    (d) =>
      d.status === "scheduled" &&
      d.scheduled_at &&
      !d.published_id,
  );

  // 1) stale 처리 — 70분보다 오래된 과거 슬롯은 자동 발행 안 함
  //    publish_error에 사유 적고 status는 scheduled 유지 (사용자가 보고 직접 발행하거나 취소).
  //    → 다음 cron run에서도 다시 stale로 분류되어 자동 발행 회피.
  //    "stale 이미 마킹된" 것은 다시 마킹하지 않음 (write quota 절약).
  const stale = scheduledDrafts.filter((d) => {
    const t = new Date(d.scheduled_at).getTime();
    return t < freshCutoff;
  });
  const newlyStale = stale.filter(
    (d) => !d.publish_error?.startsWith("⏰ stale"),
  );
  for (const d of newlyStale) {
    await updateThreadsDraft(d.id, {
      publish_error: `⏰ stale — 예약 시각(${new Date(d.scheduled_at).toISOString()})이 ${FRESHNESS_WINDOW_MIN}분 이상 지나 자동 발행 건너뜀. 검토 후 수동 발행 또는 재예약 필요.`,
    });
  }

  // 2) 발행 대상 — 70분 윈도우 안 + 시간 도래
  const due = scheduledDrafts
    .filter((d) => {
      const t = new Date(d.scheduled_at).getTime();
      return t <= now && t >= freshCutoff;
    })
    .sort((a, b) =>
      (a.scheduled_at || "").localeCompare(b.scheduled_at || ""),
    );

  if (due.length === 0) {
    return NextResponse.json({
      ok: true,
      published: 0,
      staleSkipped: stale.length,
      newlyStaleMarked: newlyStale.length,
      message: stale.length > 0
        ? `발행 대상 없음 (오래된 슬롯 ${stale.length}건은 stale 처리 — 수동 검토 필요)`
        : "발행 대상 없음",
    });
  }

  // 토큰 확보
  const tok = await getThreadsToken();
  if (!tok) {
    return NextResponse.json(
      { ok: false, error: "Threads 토큰 없음 — 설정에서 연결 필요" },
      { status: 400 },
    );
  }

  const target = due.slice(0, MAX_PER_RUN);
  const results: {
    id: string;
    keyword: string;
    ok: boolean;
    mainId?: string;
    replyIds?: string[];
    error?: string;
  }[] = [];

  for (const d of target) {
    let replies: string[] = [];
    try {
      const parsed = JSON.parse(d.self_replies || "[]");
      if (Array.isArray(parsed))
        replies = parsed.filter((r) => typeof r === "string" && r.trim());
    } catch {
      /* ignore */
    }

    try {
      const { mainId, replyIds, replyErrors } = await postThreadWithReplies({
        accessToken: tok.access_token,
        userId: tok.user_id,
        mainText: d.draft_text,
        selfReplies: replies,
        topicTag: d.topic_tag || undefined,
      });

      const errMsg =
        replyErrors.length > 0 ? `댓글 일부 실패: ${replyErrors.join(" / ")}` : "";
      await updateThreadsDraft(d.id, {
        status: "published",
        published_id: mainId,
        published_at: new Date().toISOString(),
        publish_error: errMsg,
      });
      results.push({
        id: d.id,
        keyword: d.keyword,
        ok: true,
        mainId,
        replyIds,
      });
    } catch (err) {
      const msg = (err as Error).message.slice(0, 200);
      await updateThreadsDraft(d.id, {
        status: "failed",
        publish_error: msg,
      });
      results.push({ id: d.id, keyword: d.keyword, ok: false, error: msg });
    }
  }

  return NextResponse.json({
    ok: true,
    published: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    remaining: due.length - target.length,
    staleSkipped: stale.length,
    newlyStaleMarked: newlyStale.length,
    results,
  });
}
