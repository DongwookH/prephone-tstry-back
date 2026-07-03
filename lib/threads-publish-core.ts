import { getThreadsDrafts, updateThreadsDraft } from "./sheets";
import { getThreadsToken, postThreadWithReplies } from "./threads";
import type { ThreadsDraftRow } from "./sheets";

/**
 * Threads 발행 코어 — cron 라우트(threads-publish)와 텔레그램 웹훅이 공유.
 *
 * 발행 정책은 기존 cron 라우트에서 그대로 옮김:
 *  - status="scheduled"|"failed" + scheduled_at<=now + 미발행 → due
 *  - FRESHNESS_WINDOW_MIN(12h) 초과 과거 슬롯은 stale 마킹 (자동 발행 안 함)
 *  - 호출당 MAX_PER_RUN(1)건만 발행 — 글 간 자연스러운 간격 유지
 */

export const FRESHNESS_WINDOW_MIN = 720;
export const MAX_PER_RUN = 1;

export function kstLabel(iso: string): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return iso;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(t));
}

export type PublishRunResult = {
  ok: boolean;
  published: number;
  failed: number;
  remaining: number;
  staleSkipped: number;
  newlyStaleMarked: number;
  message?: string;
  error?: string;
  results: {
    id: string;
    keyword: string;
    ok: boolean;
    mainId?: string;
    replyIds?: string[];
    error?: string;
  }[];
};

/** 예약 시각이 지났는데 미발행인 승인 초안 (stale 제외). */
export function findDue(all: ThreadsDraftRow[], now: number) {
  const freshCutoff = now - FRESHNESS_WINDOW_MIN * 60 * 1000;
  return all
    .filter(
      (d) =>
        (d.status === "scheduled" || d.status === "failed") &&
        d.scheduled_at &&
        !d.published_id,
    )
    .filter((d) => {
      const t = new Date(d.scheduled_at).getTime();
      return isFinite(t) && t <= now && t >= freshCutoff;
    })
    .sort((a, b) => (a.scheduled_at || "").localeCompare(b.scheduled_at || ""));
}

/** due 중 예약시각이 graceMin분 이상 지난 것 — "크론이 놓친" 신호. */
export function findOverdue(
  all: ThreadsDraftRow[],
  now: number,
  graceMin = 20,
) {
  return findDue(all, now).filter(
    (d) => new Date(d.scheduled_at).getTime() <= now - graceMin * 60 * 1000,
  );
}

/** due 발행 실행 — 호출당 최대 MAX_PER_RUN건. */
export async function publishDueThreads(): Promise<PublishRunResult> {
  const all = await getThreadsDrafts();
  const now = Date.now();
  const freshCutoff = now - FRESHNESS_WINDOW_MIN * 60 * 1000;

  const scheduledDrafts = all.filter(
    (d) =>
      (d.status === "scheduled" || d.status === "failed") &&
      d.scheduled_at &&
      !d.published_id,
  );

  // stale 마킹 (이미 마킹된 건 재기록 안 함 — write quota 절약)
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

  const due = findDue(all, now);

  if (due.length === 0) {
    return {
      ok: true,
      published: 0,
      failed: 0,
      remaining: 0,
      staleSkipped: stale.length,
      newlyStaleMarked: newlyStale.length,
      message:
        stale.length > 0
          ? `발행 대상 없음 (오래된 슬롯 ${stale.length}건은 stale 처리 — 수동 검토 필요)`
          : "발행 대상 없음",
      results: [],
    };
  }

  const tok = await getThreadsToken();
  if (!tok) {
    return {
      ok: false,
      published: 0,
      failed: 0,
      remaining: due.length,
      staleSkipped: stale.length,
      newlyStaleMarked: newlyStale.length,
      error: "Threads 토큰 없음 — 설정에서 연결 필요",
      results: [],
    };
  }

  const target = due.slice(0, MAX_PER_RUN);
  const results: PublishRunResult["results"] = [];

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
        replyErrors.length > 0
          ? `댓글 일부 실패: ${replyErrors.join(" / ")}`
          : "";
      await updateThreadsDraft(d.id, {
        status: "published",
        published_id: mainId,
        published_at: new Date().toISOString(),
        publish_error: errMsg,
      });
      results.push({ id: d.id, keyword: d.keyword, ok: true, mainId, replyIds });
    } catch (err) {
      const msg = (err as Error).message.slice(0, 200);
      await updateThreadsDraft(d.id, {
        status: "failed",
        publish_error: msg,
      });
      results.push({ id: d.id, keyword: d.keyword, ok: false, error: msg });
    }
  }

  return {
    ok: true,
    published: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    remaining: due.length - target.length,
    staleSkipped: stale.length,
    newlyStaleMarked: newlyStale.length,
    results,
  };
}

/** 오늘(KST) 기준 현황 요약 — 텔레그램 /status 용. */
export async function threadsStatusText(): Promise<string> {
  const all = await getThreadsDrafts();
  const now = Date.now();
  const todayKst = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Seoul",
  });

  const isToday = (iso: string) =>
    !!iso &&
    new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }) ===
      todayKst;

  const publishedToday = all.filter(
    (d) => d.published_id && isToday(d.scheduled_at || d.published_at),
  );
  const due = findDue(all, now);
  const overdue = findOverdue(all, now);
  const upcoming = all
    .filter(
      (d) =>
        !d.published_id &&
        d.scheduled_at &&
        new Date(d.scheduled_at).getTime() > now,
    )
    .sort((a, b) => (a.scheduled_at || "").localeCompare(b.scheduled_at || ""))
    .slice(0, 4);
  const pendingReview = all.filter(
    (d) => d.status === "pending" && !d.published_id,
  );

  const lines: string[] = [];
  lines.push(`📊 <b>Threads 현황</b> (${kstLabel(new Date(now).toISOString())})`);
  lines.push("");
  lines.push(`✅ 오늘 발행: ${publishedToday.length}건`);
  for (const d of publishedToday)
    lines.push(`   · ${kstLabel(d.scheduled_at)} ${d.keyword}`);
  if (overdue.length > 0) {
    lines.push(`⚠️ <b>연체(미발행): ${overdue.length}건</b>`);
    for (const d of overdue)
      lines.push(`   · ${kstLabel(d.scheduled_at)} ${d.keyword}`);
  } else if (due.length > 0) {
    lines.push(`⏳ 발행 대기(due): ${due.length}건`);
  } else {
    lines.push(`⏳ 연체 없음`);
  }
  lines.push(`🕐 다음 예약:`);
  if (upcoming.length === 0) lines.push(`   (없음)`);
  for (const d of upcoming)
    lines.push(
      `   · ${kstLabel(d.scheduled_at)} [${d.status === "scheduled" ? "승인됨" : "검토대기"}] ${d.keyword}`,
    );
  lines.push(`📝 검토대기 전체: ${pendingReview.length}건`);
  return lines.join("\n");
}
