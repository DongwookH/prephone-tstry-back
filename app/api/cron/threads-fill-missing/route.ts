import { NextResponse } from "next/server";
import {
  getThreadsDrafts,
  getActiveThreadsKeywords,
  pickThreadsKeywords,
  appendThreadsDraft,
} from "@/lib/sheets";
import {
  generateThreadsDraftsFromPosts,
  buildWeeklySchedule,
  getUpcomingMondayKstStart,
} from "@/lib/threads-research";

export const maxDuration = 60;

const SLOT_HOURS = [9, 14, 20] as const;
const TOTAL = 21;

/**
 * POST /api/cron/threads-fill-missing
 *
 * 지정한 주의 21개 슬롯 중 비어 있는 것을 찾아 생성. 한 호출에 1건.
 * 슬롯 매칭: KST (요일, 시간±2시간) 기준.
 *
 * body: { weekStartIso?: string, dryRun?: boolean }
 *   - weekStartIso 없으면 다가오는 월요일 (= 이번 주 또는 다음 주 진행 중인 주)
 *   - dryRun: 비어 있는 인덱스만 반환
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    weekStartIso?: string;
    dryRun?: boolean;
  };
  const dryRun = !!body.dryRun;

  const weekStart = body.weekStartIso
    ? new Date(body.weekStartIso)
    : getUpcomingMondayKstStart();
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3600 * 1000);

  const all = await getThreadsDrafts();
  const weekDrafts = all.filter((d) => {
    if (!d.scheduled_at) return false;
    const t = new Date(d.scheduled_at).getTime();
    return t >= weekStart.getTime() && t < weekEnd.getTime();
  });

  // 21개 슬롯별 매칭 — (day-of-week, slot-hour) 기준, ±2시간 허용
  const missing: { index: number; day: number; hour: number }[] = [];
  for (let i = 0; i < TOTAL; i++) {
    const day = Math.floor(i / 3);
    const hour = SLOT_HOURS[i % 3];
    const slotStart = new Date(
      weekStart.getTime() + day * 24 * 3600 * 1000 + hour * 3600 * 1000,
    );
    const slotKstDay = kstDate(slotStart);

    const match = weekDrafts.find((d) => {
      const t = new Date(d.scheduled_at);
      const dKst = kstDate(t);
      if (dKst !== slotKstDay) return false;
      const kstHour = kstHourOf(t);
      return Math.abs(kstHour - hour) <= 2;
    });
    if (!match) missing.push({ index: i, day, hour });
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      weekStart: weekStart.toISOString(),
      total: TOTAL,
      existing: weekDrafts.length,
      missing,
    });
  }

  if (missing.length === 0) {
    return NextResponse.json({
      ok: true,
      done: true,
      weekStart: weekStart.toISOString(),
      message: "비어 있는 슬롯 없음.",
    });
  }

  // 1건 처리
  const slot = missing[0];

  const pool = await getActiveThreadsKeywords();
  if (pool.length === 0) {
    return NextResponse.json(
      { ok: false, error: "active threads_keywords 풀이 비어 있습니다." },
      { status: 400 },
    );
  }
  // 이번 주에서 이미 쓰인 키워드는 피함
  const usedSet = new Set(weekDrafts.map((d) => d.keyword).filter(Boolean));
  const fresh = pool.filter((k) => !usedSet.has(k.keyword));
  const candidatePool = fresh.length > 0 ? fresh : pool;

  // weekStart 기반 seed로 일관성 유지 — index를 섞어서 다른 키워드 선택
  const seedStr = `${weekStart.toISOString()}#${slot.index}`;
  const picked = pickThreadsKeywords(candidatePool, 1, 0, seedStr);
  const kw = picked[0]?.keyword;
  if (!kw) {
    return NextResponse.json(
      { ok: false, error: "키워드 픽 실패" },
      { status: 500 },
    );
  }

  let drafts: Awaited<ReturnType<typeof generateThreadsDraftsFromPosts>>;
  try {
    drafts = await generateThreadsDraftsFromPosts({
      keyword: kw,
      posts: [],
      count: 1,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message, keyword: kw, slot },
      { status: 500 },
    );
  }
  const draft = drafts[0];
  if (!draft) {
    return NextResponse.json(
      { ok: false, error: "Gemini가 초안을 만들지 못함", keyword: kw, slot },
      { status: 500 },
    );
  }

  // 슬롯 시간 — buildWeeklySchedule이 ±15분 jitter 부여
  const allSlots = buildWeeklySchedule(weekStart);
  const scheduledIso = allSlots[slot.index];

  const { id } = await appendThreadsDraft({
    keyword: kw,
    draft_text: draft.draft_text,
    insight: draft.insight,
    source_posts: [],
    topic_tag: draft.topic_tag,
    self_replies: draft.self_replies,
    scheduled_at: scheduledIso,
  });

  return NextResponse.json({
    ok: true,
    id,
    slot,
    keyword: kw,
    scheduled_at: scheduledIso,
    weekStart: weekStart.toISOString(),
    remaining: missing.length - 1,
  });
}

function kstDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
  }).format(d);
}
function kstHourOf(d: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      hour12: false,
    }).format(d),
  );
}
