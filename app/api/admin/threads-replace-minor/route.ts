import { NextResponse } from "next/server";
import {
  getThreadsDrafts,
  updateThreadsDraft,
  getActiveThreadsKeywords,
  pickThreadsKeywords,
  isMinorRelatedKeyword,
} from "@/lib/sheets";
import { generateThreadsDraftsFromPosts } from "@/lib/threads-research";

export const maxDuration = 60;

/**
 * POST /api/admin/threads-replace-minor
 *
 * 기존 threads_drafts 중 미성년자 관련 키워드로 만들어진 초안을 안전한 키워드로 교체.
 * - 발행 완료(published) 초안은 건드리지 않고 보고만 함 (이미 외부에 나간 글이라 수동 처리 필요)
 * - 그 외(pending/scheduled/failed/rejected/빈값) 초안은 새 키워드로 본문 재생성 후 시트 업데이트
 *
 * 한 번 호출에 1건 처리 (Gemini 한도 + Vercel 60초 안전선).
 * body: { dryRun?: boolean } — true면 대상만 보고하고 변경 안 함
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { dryRun?: boolean };
  const dryRun = !!body.dryRun;

  const allDrafts = await getThreadsDrafts();
  const minorDrafts = allDrafts.filter((d) => isMinorRelatedKeyword(d.keyword));

  const publishedMinor = minorDrafts.filter((d) => d.status === "published");
  const replaceable = minorDrafts.filter((d) => d.status !== "published");

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      total: minorDrafts.length,
      published: publishedMinor.map((d) => ({
        id: d.id,
        keyword: d.keyword,
        published_at: d.published_at,
      })),
      replaceable: replaceable.map((d) => ({
        id: d.id,
        keyword: d.keyword,
        status: d.status,
        scheduled_at: d.scheduled_at,
      })),
    });
  }

  if (replaceable.length === 0) {
    return NextResponse.json({
      ok: true,
      done: true,
      message: "교체할 미성년자 키워드 초안이 없습니다.",
      publishedMinor: publishedMinor.map((d) => ({
        id: d.id,
        keyword: d.keyword,
        published_at: d.published_at,
      })),
    });
  }

  // 한 건 처리
  const target = replaceable[0];

  // 새 키워드 풀에서 — 이미 이번 주에 쓰인 키워드는 피하기 위해 기존 active 풀을 그대로 사용
  // (isMinorRelatedKeyword가 getActiveThreadsKeywords에서 이미 걸러줌)
  const pool = await getActiveThreadsKeywords();
  if (pool.length === 0) {
    return NextResponse.json(
      { ok: false, error: "active threads_keywords 풀이 비어 있습니다." },
      { status: 400 },
    );
  }
  // 이미 다른 초안에서 사용 중인 키워드는 피함 (중복 방지)
  const usedSet = new Set(
    allDrafts
      .filter((d) => d.id !== target.id)
      .map((d) => d.keyword)
      .filter(Boolean),
  );
  const fresh = pool.filter((k) => !usedSet.has(k.keyword));
  const candidatePool = fresh.length > 0 ? fresh : pool;

  // seed = target.id → 같은 draft에 대해 idempotent
  const picked = pickThreadsKeywords(candidatePool, 1, 0, target.id);
  const newKeyword = picked[0]?.keyword;
  if (!newKeyword) {
    return NextResponse.json(
      { ok: false, error: "교체 키워드 픽 실패" },
      { status: 500 },
    );
  }

  // 새 초안 생성
  let drafts: Awaited<ReturnType<typeof generateThreadsDraftsFromPosts>>;
  try {
    drafts = await generateThreadsDraftsFromPosts({
      keyword: newKeyword,
      posts: [],
      count: 1,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: (err as Error).message,
        targetId: target.id,
        newKeyword,
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
        newKeyword,
      },
      { status: 500 },
    );
  }

  // 시트 업데이트 — keyword, draft_text, insight, topic_tag, self_replies
  // status는 그대로 유지 (pending이었으면 pending, scheduled였으면 scheduled),
  // 단 scheduled였으면 내용 바뀌었으니 다시 검토하라고 pending으로 되돌림
  const newStatus =
    target.status === "scheduled" || target.status === "failed"
      ? "pending"
      : target.status;
  const updated = await updateThreadsDraft(target.id, {
    keyword: newKeyword,
    draft_text: draft.draft_text,
    insight: draft.insight,
    topic_tag: draft.topic_tag,
    self_replies: JSON.stringify(draft.self_replies),
    status: newStatus,
    publish_error: "", // 실패 메시지 초기화
  });

  return NextResponse.json({
    ok: true,
    replaced: updated,
    targetId: target.id,
    oldKeyword: target.keyword,
    newKeyword,
    newStatus,
    remaining: replaceable.length - 1,
    publishedMinor: publishedMinor.map((d) => ({
      id: d.id,
      keyword: d.keyword,
      published_at: d.published_at,
    })),
  });
}
