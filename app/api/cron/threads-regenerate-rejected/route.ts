import { NextResponse } from "next/server";
import {
  getThreadsDrafts,
  updateThreadsDraft,
  getActiveThreadsKeywords,
  pickThreadsKeywords,
} from "@/lib/sheets";
import { generateThreadsDraftsFromPosts } from "@/lib/threads-research";

export const maxDuration = 60;

/**
 * POST /api/cron/threads-regenerate-rejected
 *
 * status="rejected" 초안을 새 키워드로 본문 재생성. 한 호출에 1건.
 * 기본은 scheduled_at가 있는 것만 (주간 자동화 안에 들어있는 반려글) 처리.
 * 옛 스크레이퍼 시대 반려글(scheduled_at 없음)은 includeLegacy=true 일 때만.
 *
 * body: { dryRun?: boolean, includeLegacy?: boolean }
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    dryRun?: boolean;
    includeLegacy?: boolean;
  };
  const dryRun = !!body.dryRun;
  const includeLegacy = !!body.includeLegacy;

  const all = await getThreadsDrafts();
  const rejected = all.filter(
    (d) =>
      d.status === "rejected" && (includeLegacy ? true : !!d.scheduled_at),
  );

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      count: rejected.length,
      rejected: rejected.map((d) => ({
        id: d.id,
        keyword: d.keyword,
        scheduled_at: d.scheduled_at,
      })),
    });
  }

  if (rejected.length === 0) {
    return NextResponse.json({
      ok: true,
      done: true,
      message: "재생성할 반려 초안이 없습니다.",
    });
  }

  // 1건 처리
  const target = rejected[0];

  // 새 키워드 — 이미 다른 초안에서 쓰이는 키워드 피함
  const pool = await getActiveThreadsKeywords();
  if (pool.length === 0) {
    return NextResponse.json(
      { ok: false, error: "active threads_keywords 풀이 비어 있습니다." },
      { status: 400 },
    );
  }
  const usedSet = new Set(
    all.filter((d) => d.id !== target.id).map((d) => d.keyword).filter(Boolean),
  );
  const fresh = pool.filter((k) => !usedSet.has(k.keyword));
  const candidatePool = fresh.length > 0 ? fresh : pool;

  // seed = target.id → idempotent
  const picked = pickThreadsKeywords(candidatePool, 1, 0, target.id);
  const newKeyword = picked[0]?.keyword;
  if (!newKeyword) {
    return NextResponse.json(
      { ok: false, error: "교체 키워드 픽 실패" },
      { status: 500 },
    );
  }

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

  // 상태는 pending으로 (재생성된 새 콘텐츠는 다시 검토 필요)
  const updated = await updateThreadsDraft(target.id, {
    keyword: newKeyword,
    draft_text: draft.draft_text,
    insight: draft.insight,
    topic_tag: draft.topic_tag,
    self_replies: JSON.stringify(draft.self_replies),
    status: "pending",
    publish_error: "",
  });

  return NextResponse.json({
    ok: true,
    replaced: updated,
    targetId: target.id,
    oldKeyword: target.keyword,
    newKeyword,
    remaining: rejected.length - 1,
  });
}
