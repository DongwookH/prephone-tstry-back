"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  getThreadsDraftById,
  updateThreadsDraft,
} from "@/lib/sheets";
import { getThreadsToken, postThreadWithReplies } from "@/lib/threads";

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
  | { ok: true; postId: string; replyIds: string[] }
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
    const { mainId, replyIds } = await postThreadWithReplies({
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
    return { ok: true, postId: mainId, replyIds };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
