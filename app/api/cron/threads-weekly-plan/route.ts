import { NextResponse } from "next/server";
import {
  getActiveThreadsKeywords,
  pickThreadsKeywords,
  appendThreadsDraft,
  getThreadsDrafts,
} from "@/lib/sheets";
import {
  generateThreadsDraftsFromPosts,
  buildWeeklySchedule,
  getUpcomingMondayKstStart,
} from "@/lib/threads-research";

export const maxDuration = 60;

/**
 * POST /api/cron/threads-weekly-plan
 *
 * 매주 월요일 KST 06:00 GHA가 호출.
 * 1주치 21개 초안(메인 글 + 셀프 댓글 3개 묶음) 생성.
 *
 * 한 번 호출에 1개 키워드 처리 — Vercel 60초 한도 회피.
 * GHA에서 21번 직렬 호출 (각각 키워드 인덱스 0~20).
 *
 * body: { index: 0~20, weekStartIso?: string }
 *  - index 없으면 다음 미생성 슬롯 자동 선택
 *  - weekStartIso 없으면 이번 주 월요일 자동 계산
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    index?: number;
    weekStartIso?: string;
  };

  // 1) 주 시작 결정
  const weekStart = body.weekStartIso
    ? new Date(body.weekStartIso)
    : getUpcomingMondayKstStart();

  // 2) 이번 주 이미 만든 초안 확인 (중복 방지)
  const allDrafts = await getThreadsDrafts();
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3600 * 1000);
  const existing = allDrafts.filter((d) => {
    if (!d.scheduled_at) return false;
    const t = new Date(d.scheduled_at).getTime();
    return t >= weekStart.getTime() && t < weekEnd.getTime();
  });

  // 3) 스케줄 21개 미리 계산 (같은 주 안에선 동일 시간대 보장)
  // GHA가 21번 호출하므로, 매번 같은 시간대 분포가 나오게 키 = weekStart ISO
  // 단, 랜덤 jitter는 매번 다르게 가지만 시간대 분포는 동일.
  // 간단화: GHA가 index 받으면 그 index만 처리 — 시간대는 그때 계산.
  const allSlots = buildWeeklySchedule(weekStart);

  // 4) 처리할 index 결정
  const TOTAL = 21;
  let index = typeof body.index === "number" ? body.index : -1;
  if (index < 0) {
    // 다음 미처리 슬롯 자동 선택
    index = existing.length;
  }
  if (index >= TOTAL) {
    return NextResponse.json({
      ok: true,
      message: `이번 주(${weekStart.toISOString()}) 21개 초안 모두 생성 완료`,
      existingCount: existing.length,
    });
  }

  // 5) 키워드 풀 → 21개 픽 (한 번에 픽해서 index로 잘라 씀)
  //    seed = weekStart ISO → 같은 주 내 모든 호출에서 동일한 21개 순서 보장.
  //    used_count 변동에 영향받지 않으므로 호출 간 일관성 유지.
  const pool = await getActiveThreadsKeywords();
  if (pool.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "threads_keywords 풀이 비어 있습니다. 시드 키워드를 추가하세요.",
      },
      { status: 400 },
    );
  }
  const picked = pickThreadsKeywords(pool, TOTAL, 7, weekStart.toISOString());
  const kw = picked[index]?.keyword;
  if (!kw) {
    return NextResponse.json(
      { ok: false, error: `픽 실패 index=${index}` },
      { status: 500 },
    );
  }

  // 6) 초안 1개 생성 (인기글 데이터 없으므로 KB 기반)
  let drafts: Awaited<ReturnType<typeof generateThreadsDraftsFromPosts>>;
  try {
    drafts = await generateThreadsDraftsFromPosts({
      keyword: kw,
      posts: [], // 주간 자동화는 인기글 데이터 없음 → KB만 사용
      count: 1,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message, keyword: kw, index },
      { status: 500 },
    );
  }
  const draft = drafts[0];
  if (!draft) {
    return NextResponse.json(
      { ok: false, error: "Gemini가 초안을 만들지 못함", keyword: kw, index },
      { status: 500 },
    );
  }

  // 7) 시트 저장 + 키워드 used_count++
  const scheduledIso = allSlots[index];
  const { id } = await appendThreadsDraft({
    keyword: kw,
    draft_text: draft.draft_text,
    insight: draft.insight,
    source_posts: [],
    topic_tag: draft.topic_tag,
    self_replies: draft.self_replies,
    scheduled_at: scheduledIso,
  });
  await bumpThreadsKeywordUsage([kw]).catch(() => {});

  return NextResponse.json({
    ok: true,
    id,
    index,
    keyword: kw,
    scheduled_at: scheduledIso,
    weekStart: weekStart.toISOString(),
    nextIndex: index + 1,
    done: index + 1 >= TOTAL,
  });
}
