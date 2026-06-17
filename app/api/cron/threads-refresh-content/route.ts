import { NextResponse } from "next/server";
import { getThreadsDrafts, updateThreadsDraft } from "@/lib/sheets";
import { generateThreadsDraftsFromPosts } from "@/lib/threads-research";

export const maxDuration = 60;

/**
 * POST /api/cron/threads-refresh-content
 *
 * 미발행 초안의 본문을 같은 키워드로 새 프롬프트(cliffhanger+망선택+프로필유도)로 재생성.
 * keyword·scheduled_at·status는 유지, draft_text/self_replies/topic_tag/insight만 교체.
 * 한 호출에 1건 처리 (Gemini 한도 + Vercel 60초).
 *
 * 대상:
 *  - published_id 없음 (이미 발행된 글은 절대 안 건드림)
 *  - scheduled_at >= cutoff (기본: 내일 00:00 KST)
 *  - status in (scheduled, pending, failed)
 *
 * body:
 *  { dryRun?: boolean, fromIso?: string }
 *   - fromIso 생략 시 내일 00:00 KST 자동 계산
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    dryRun?: boolean;
    fromIso?: string;
  };
  const dryRun = !!body.dryRun;

  const cutoffMs = body.fromIso
    ? new Date(body.fromIso).getTime()
    : tomorrowKstStartUtc().getTime();
  if (!isFinite(cutoffMs)) {
    return NextResponse.json(
      { ok: false, error: "잘못된 fromIso" },
      { status: 400 },
    );
  }

  const all = await getThreadsDrafts();
  const targets = all
    .filter((d) => {
      if (d.published_id) return false;
      if (!d.scheduled_at) return false;
      const t = new Date(d.scheduled_at).getTime();
      if (!isFinite(t) || t < cutoffMs) return false;
      return (
        d.status === "scheduled" ||
        d.status === "pending" ||
        d.status === "failed"
      );
    })
    // 이미 새 형식으로 갱신된 건 건너뜀 (refreshed 마킹)
    .filter((d) => !d.insight?.startsWith("[v2]"))
    .sort((a, b) => (a.scheduled_at || "").localeCompare(b.scheduled_at || ""));

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      cutoffIso: new Date(cutoffMs).toISOString(),
      cutoffKst: kstLabel(cutoffMs),
      count: targets.length,
      targets: targets.map((d) => ({
        id: d.id,
        keyword: d.keyword,
        status: d.status,
        scheduled_at: d.scheduled_at,
        scheduledKst: kstLabel(new Date(d.scheduled_at).getTime()),
      })),
    });
  }

  if (targets.length === 0) {
    return NextResponse.json({
      ok: true,
      done: true,
      message: "재생성할 미발행 초안이 없습니다 (모두 갱신 완료).",
    });
  }

  // 1건 처리
  const target = targets[0];

  let drafts: Awaited<ReturnType<typeof generateThreadsDraftsFromPosts>>;
  try {
    drafts = await generateThreadsDraftsFromPosts({
      keyword: target.keyword,
      posts: [],
      count: 1,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: (err as Error).message,
        targetId: target.id,
        keyword: target.keyword,
      },
      { status: 500 },
    );
  }
  const draft = drafts[0];
  if (!draft) {
    return NextResponse.json(
      {
        ok: false,
        error: "Gemini가 초안을 만들지 못함",
        targetId: target.id,
        keyword: target.keyword,
      },
      { status: 500 },
    );
  }

  // status: failed였으면 pending으로 (재검토), 그 외는 유지
  const newStatus = target.status === "failed" ? "pending" : target.status;
  // insight에 [v2] 마킹 — 재실행 시 중복 처리 방지
  const taggedInsight = `[v2] ${draft.insight || ""}`.trim();

  const updated = await updateThreadsDraft(target.id, {
    draft_text: draft.draft_text,
    insight: taggedInsight,
    topic_tag: draft.topic_tag,
    self_replies: JSON.stringify(draft.self_replies),
    status: newStatus,
    publish_error: "",
  });

  return NextResponse.json({
    ok: true,
    updated,
    targetId: target.id,
    keyword: target.keyword,
    scheduledKst: kstLabel(new Date(target.scheduled_at).getTime()),
    newStatus,
    remaining: targets.length - 1,
    preview: {
      draft_text: draft.draft_text,
      self_replies: draft.self_replies,
      topic_tag: draft.topic_tag,
    },
  });
}

function tomorrowKstStartUtc(): Date {
  const now = new Date();
  const refKstMs = now.getTime() + 9 * 3600 * 1000;
  const d = new Date(refKstMs);
  d.setUTCHours(0, 0, 0, 0); // 오늘 00:00 KST (UTC 기준 표현)
  const todayKstStartMs = d.getTime();
  const tomorrowKstStartMs = todayKstStartMs + 24 * 3600 * 1000;
  return new Date(tomorrowKstStartMs - 9 * 3600 * 1000);
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
