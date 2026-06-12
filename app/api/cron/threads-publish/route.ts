import { NextResponse } from "next/server";
import { getThreadsDrafts, updateThreadsDraft } from "@/lib/sheets";
import { getThreadsToken, postThreadWithReplies } from "@/lib/threads";

export const maxDuration = 60;

/**
 * POST /api/cron/threads-publish
 *
 * GHA가 매시간 정시 호출 (KST 9~21 시간대만 실제 발행 발생).
 * status="scheduled" + scheduled_at <= now 인 초안을 발행.
 *
 * 한 호출에 최대 3개까지 발행 (60초 한도 안전망 — 각 발행 메인+댓글 ~15초).
 * 더 있으면 다음 호출이 처리.
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const all = await getThreadsDrafts();
  const now = Date.now();

  // 발행 대상: status=scheduled + 시간 도래 + 아직 발행 안 된 것
  const due = all
    .filter(
      (d) =>
        d.status === "scheduled" &&
        d.scheduled_at &&
        new Date(d.scheduled_at).getTime() <= now &&
        !d.published_id,
    )
    .sort((a, b) =>
      (a.scheduled_at || "").localeCompare(b.scheduled_at || ""),
    );

  if (due.length === 0) {
    return NextResponse.json({ ok: true, published: 0, message: "발행 대상 없음" });
  }

  // 토큰 확보
  const tok = await getThreadsToken();
  if (!tok) {
    return NextResponse.json(
      { ok: false, error: "Threads 토큰 없음 — 설정에서 연결 필요" },
      { status: 400 },
    );
  }

  const MAX_PER_RUN = 3;
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

    // 발행 간 살짝 텀 (Threads API 보호)
    await new Promise((r) => setTimeout(r, 1000));
  }

  return NextResponse.json({
    ok: true,
    published: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    remaining: due.length - target.length,
    results,
  });
}
