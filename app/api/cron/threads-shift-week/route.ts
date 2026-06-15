import { NextResponse } from "next/server";
import { getThreadsDrafts, updateThreadsDraft } from "@/lib/sheets";

export const maxDuration = 60;

/**
 * POST /api/cron/threads-shift-week
 *
 * 미발행(scheduled_at < cutoff) 초안의 scheduled_at을 +7일 시프트.
 * 기본 cutoff = 다음 주 월요일 00:00 KST → 지난주/이번주 초안만 시프트, 그 이후는 건드리지 않음.
 *
 * body:
 *   { dryRun?: boolean, cutoffIso?: string }
 *   - dryRun: true면 대상만 보고
 *   - cutoffIso: 시프트 대상 cutoff (이 시각보다 이른 scheduled_at만) — 생략 시 다음 주 월요일 자동 계산
 *
 * 발행 완료(published_id 있음)는 절대 건드리지 않음.
 * status는 그대로 유지. stale publish_error는 클리어 (다시 fresh가 되므로).
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    dryRun?: boolean;
    cutoffIso?: string;
  };
  const dryRun = !!body.dryRun;

  // cutoff = 다음 주 월요일 00:00 KST (= 이번 주 일요일 UTC 15:00)
  const cutoffMs = body.cutoffIso
    ? new Date(body.cutoffIso).getTime()
    : nextMondayKstStartUtc().getTime();
  if (!isFinite(cutoffMs)) {
    return NextResponse.json(
      { ok: false, error: "잘못된 cutoffIso" },
      { status: 400 },
    );
  }

  const all = await getThreadsDrafts();
  const target = all.filter((d) => {
    if (d.published_id) return false;
    if (!d.scheduled_at) return false;
    const t = new Date(d.scheduled_at).getTime();
    return isFinite(t) && t < cutoffMs;
  });

  const shifted: {
    id: string;
    keyword: string;
    status: string;
    from: string;
    to: string;
  }[] = [];

  for (const d of target) {
    const oldMs = new Date(d.scheduled_at).getTime();
    const newIso = new Date(oldMs + 7 * 24 * 3600 * 1000).toISOString();
    shifted.push({
      id: d.id,
      keyword: d.keyword,
      status: d.status,
      from: d.scheduled_at,
      to: newIso,
    });

    if (!dryRun) {
      // stale 마킹이 있었다면 클리어
      const clearStale = d.publish_error?.startsWith("⏰ stale")
        ? { publish_error: "" }
        : {};
      await updateThreadsDraft(d.id, {
        scheduled_at: newIso,
        ...clearStale,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    cutoffIso: new Date(cutoffMs).toISOString(),
    cutoffKst: kstLabel(cutoffMs),
    count: shifted.length,
    shifted: shifted
      .sort((a, b) => a.from.localeCompare(b.from))
      .map((s) => ({
        ...s,
        fromKst: kstLabel(new Date(s.from).getTime()),
        toKst: kstLabel(new Date(s.to).getTime()),
      })),
  });
}

function nextMondayKstStartUtc(): Date {
  const now = new Date();
  const refKstMs = now.getTime() + 9 * 3600 * 1000;
  const refKst = new Date(refKstMs);
  const dayKst = refKst.getUTCDay(); // 0=일, 1=월, ..., 6=토
  // 다음 주 월요일까지 일수 — 오늘이 월요일이면 7, 일요일이면 1, 토요일이면 2 ...
  const daysToNextMonday = ((8 - dayKst) % 7) || 7;
  const nextMonKstMs = refKstMs + daysToNextMonday * 24 * 3600 * 1000;
  const d = new Date(nextMonKstMs);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - 9 * 3600 * 1000);
}

function kstLabel(ms: number): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}
