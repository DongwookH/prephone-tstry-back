"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  getThreadsDraftById,
  getThreadsDrafts,
  updateThreadsDraft,
  getActiveThreadsKeywords,
  pickThreadsKeywords,
} from "@/lib/sheets";
import { getThreadsToken, postThreadWithReplies } from "@/lib/threads";
import { generateThreadsDraftsFromPosts } from "@/lib/threads-research";

async function requireAuth(): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "로그인이 필요합니다" };
  return { ok: true };
}

/** 초안 본문 + 주제 태그 + 셀프 댓글 수정 저장. */
export async function saveDraftTextAction(
  id: string,
  text: string,
  topicTag?: string,
  selfReplies?: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const a = await requireAuth();
  if (!a.ok) return { ok: false, error: a.error! };

  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "본문이 비어있습니다" };
  if (trimmed.length > 500)
    return { ok: false, error: "Threads는 500자 제한입니다" };

  const tag = (topicTag || "").replace(/[.&]/g, "").trim().slice(0, 50);
  const replies = Array.isArray(selfReplies)
    ? selfReplies.map((r) => r.trim()).filter(Boolean).slice(0, 3)
    : [];

  try {
    const found = await updateThreadsDraft(id, {
      draft_text: trimmed,
      topic_tag: tag,
      self_replies: JSON.stringify(replies),
    });
    if (!found) return { ok: false, error: "초안을 찾을 수 없습니다" };
    revalidatePath("/threads");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** 초안 반려 (status=rejected). */
export async function rejectDraftAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const a = await requireAuth();
  if (!a.ok) return { ok: false, error: a.error! };

  try {
    const found = await updateThreadsDraft(id, { status: "rejected" });
    if (!found) return { ok: false, error: "초안을 찾을 수 없습니다" };
    revalidatePath("/threads");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * 초안 승인 & Threads 발행.
 * 1) 최신 본문 확정 저장 (전달된 text가 있으면)
 * 2) postToThreads
 * 3) status=published + published_id/at 기록
 */
export async function approveAndPublishAction(
  id: string,
  text?: string,
  topicTag?: string,
  selfReplies?: string[],
): Promise<
  | {
      ok: true;
      postId: string;
      replyIds: string[];
      replyErrors: string[];
    }
  | { ok: false; error: string }
> {
  const a = await requireAuth();
  if (!a.ok) return { ok: false, error: a.error! };

  try {
    const draft = await getThreadsDraftById(id);
    if (!draft) return { ok: false, error: "초안을 찾을 수 없습니다" };
    if (draft.status === "published")
      return { ok: false, error: "이미 발행된 초안입니다" };

    const finalText = (text?.trim() || draft.draft_text || "").slice(0, 500);
    if (!finalText) return { ok: false, error: "본문이 비어있습니다" };

    // 주제 태그 — UI에서 전달 우선, 없으면 시트 저장값
    const tagInput =
      topicTag !== undefined ? topicTag : draft.topic_tag || "";
    const tag = tagInput.replace(/[.&]/g, "").trim().slice(0, 50);

    // 셀프 댓글 — UI에서 전달 우선, 없으면 시트 저장값(JSON 파싱)
    let replies: string[] = [];
    if (selfReplies !== undefined) {
      replies = selfReplies.map((r) => r.trim()).filter(Boolean);
    } else if (draft.self_replies) {
      try {
        const parsed = JSON.parse(draft.self_replies);
        if (Array.isArray(parsed))
          replies = parsed.filter((r) => typeof r === "string" && r.trim());
      } catch {
        /* ignore */
      }
    }
    replies = replies.slice(0, 3);

    const tok = await getThreadsToken();
    if (!tok)
      return {
        ok: false,
        error: "Threads 연결이 없습니다 (설정에서 연결하세요)",
      };

    // 변경된 필드 시트 먼저 저장 (발행 실패해도 변경분 유지)
    if (
      finalText !== draft.draft_text ||
      tag !== (draft.topic_tag || "") ||
      JSON.stringify(replies) !== (draft.self_replies || "[]")
    ) {
      await updateThreadsDraft(id, {
        draft_text: finalText,
        topic_tag: tag,
        self_replies: JSON.stringify(replies),
      });
    }

    // 메인 글 + 셀프 댓글 묶음 발행
    const { mainId, replyIds, replyErrors } = await postThreadWithReplies({
      accessToken: tok.access_token,
      userId: tok.user_id,
      mainText: finalText,
      selfReplies: replies,
      topicTag: tag || undefined,
    });

    await updateThreadsDraft(id, {
      status: "published",
      published_id: mainId,
      published_at: new Date().toISOString(),
    });

    revalidatePath("/threads");
    return { ok: true, postId: mainId, replyIds, replyErrors };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** 단일 초안 예약 — status=pending → status=scheduled. */
export async function scheduleDraftAction(
  id: string,
  text?: string,
  topicTag?: string,
  selfReplies?: string[],
  scheduledAt?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const a = await requireAuth();
  if (!a.ok) return { ok: false, error: a.error! };

  try {
    const draft = await getThreadsDraftById(id);
    if (!draft) return { ok: false, error: "초안 없음" };
    if (draft.status === "published")
      return { ok: false, error: "이미 발행됨" };

    const finalText = (text?.trim() || draft.draft_text || "").slice(0, 500);
    if (!finalText) return { ok: false, error: "본문이 비어있습니다" };

    const tag =
      topicTag !== undefined
        ? topicTag.replace(/[.&]/g, "").trim().slice(0, 50)
        : draft.topic_tag;
    const replies =
      selfReplies !== undefined
        ? selfReplies.map((r) => r.trim()).filter(Boolean).slice(0, 3)
        : undefined;

    await updateThreadsDraft(id, {
      draft_text: finalText,
      status: "scheduled",
      topic_tag: tag,
      self_replies:
        replies !== undefined ? JSON.stringify(replies) : undefined,
      scheduled_at: scheduledAt ?? undefined,
    });
    revalidatePath("/threads");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** 일괄 승인 — 인자 id 배열의 모든 pending → scheduled. */
export async function bulkScheduleAction(
  ids: string[],
): Promise<
  | { ok: true; scheduled: number; skipped: number }
  | { ok: false; error: string }
> {
  const a = await requireAuth();
  if (!a.ok) return { ok: false, error: a.error! };

  try {
    const all = await getThreadsDrafts();
    const map = new Map(all.map((d) => [d.id, d]));
    let scheduled = 0;
    let skipped = 0;
    for (const id of ids) {
      const d = map.get(id);
      if (!d || d.status !== "pending") {
        skipped++;
        continue;
      }
      await updateThreadsDraft(id, { status: "scheduled" });
      scheduled++;
    }
    revalidatePath("/threads");
    return { ok: true, scheduled, skipped };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * 반려글 1건 재생성 — 가장 오래된 rejected(+scheduled_at) 1건을 새 키워드로 재작성.
 * UI에서 반복 호출해 N개 처리. Vercel 60초 한도 안에 1건만 처리해 안전.
 *
 * 반환:
 *   ok=true: { remaining, oldKeyword, newKeyword }
 *   ok=true + done: 반려글 없음
 *   ok=false: error
 */
export async function regenerateOneRejectedAction(): Promise<
  | { ok: true; done: true }
  | {
      ok: true;
      done: false;
      remaining: number;
      oldKeyword: string;
      newKeyword: string;
    }
  | { ok: false; error: string }
> {
  const a = await requireAuth();
  if (!a.ok) return { ok: false, error: a.error! };

  try {
    const all = await getThreadsDrafts();
    // 주간 자동화 안에 있는 반려글만 (scheduled_at 있는 것)
    const rejected = all.filter(
      (d) => d.status === "rejected" && !!d.scheduled_at,
    );
    if (rejected.length === 0) return { ok: true, done: true };

    const target = rejected[0];

    const pool = await getActiveThreadsKeywords();
    if (pool.length === 0)
      return { ok: false, error: "키워드 풀이 비어 있습니다" };

    const usedSet = new Set(
      all
        .filter((d) => d.id !== target.id)
        .map((d) => d.keyword)
        .filter(Boolean),
    );
    const fresh = pool.filter((k) => !usedSet.has(k.keyword));
    const candidatePool = fresh.length > 0 ? fresh : pool;

    const picked = pickThreadsKeywords(candidatePool, 1, 0, target.id);
    const newKeyword = picked[0]?.keyword;
    if (!newKeyword) return { ok: false, error: "키워드 픽 실패" };

    const drafts = await generateThreadsDraftsFromPosts({
      keyword: newKeyword,
      posts: [],
      count: 1,
    });
    const draft = drafts[0];
    if (!draft) return { ok: false, error: "Gemini가 초안을 만들지 못함" };

    await updateThreadsDraft(target.id, {
      keyword: newKeyword,
      draft_text: draft.draft_text,
      insight: draft.insight,
      topic_tag: draft.topic_tag,
      self_replies: JSON.stringify(draft.self_replies),
      status: "pending",
      publish_error: "",
    });

    revalidatePath("/threads");
    return {
      ok: true,
      done: false,
      remaining: rejected.length - 1,
      oldKeyword: target.keyword,
      newKeyword,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** 예약 취소 — scheduled → pending. */
export async function unscheduleDraftAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const a = await requireAuth();
  if (!a.ok) return { ok: false, error: a.error! };

  try {
    const d = await getThreadsDraftById(id);
    if (!d) return { ok: false, error: "초안 없음" };
    if (d.status !== "scheduled")
      return { ok: false, error: `현재 상태(${d.status})는 취소 불가` };
    await updateThreadsDraft(id, { status: "pending" });
    revalidatePath("/threads");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
