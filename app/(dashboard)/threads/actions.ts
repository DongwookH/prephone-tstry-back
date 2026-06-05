"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  getThreadsDraftById,
  updateThreadsDraft,
} from "@/lib/sheets";
import { getThreadsToken, postToThreads } from "@/lib/threads";

async function requireAuth(): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "로그인이 필요합니다" };
  return { ok: true };
}

/** 초안 본문 수정 저장. */
export async function saveDraftTextAction(
  id: string,
  text: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const a = await requireAuth();
  if (!a.ok) return { ok: false, error: a.error! };

  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "본문이 비어있습니다" };
  if (trimmed.length > 500)
    return { ok: false, error: "Threads는 500자 제한입니다" };

  try {
    const found = await updateThreadsDraft(id, { draft_text: trimmed });
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
): Promise<{ ok: true; postId: string } | { ok: false; error: string }> {
  const a = await requireAuth();
  if (!a.ok) return { ok: false, error: a.error! };

  try {
    const draft = await getThreadsDraftById(id);
    if (!draft) return { ok: false, error: "초안을 찾을 수 없습니다" };
    if (draft.status === "published")
      return { ok: false, error: "이미 발행된 초안입니다" };

    const finalText = (text?.trim() || draft.draft_text || "").slice(0, 500);
    if (!finalText) return { ok: false, error: "본문이 비어있습니다" };

    const tok = await getThreadsToken();
    if (!tok)
      return {
        ok: false,
        error: "Threads 연결이 없습니다 (설정에서 연결하세요)",
      };

    // 본문이 바뀌었으면 먼저 저장
    if (finalText !== draft.draft_text) {
      await updateThreadsDraft(id, { draft_text: finalText });
    }

    const { id: postId } = await postToThreads({
      accessToken: tok.access_token,
      userId: tok.user_id,
      text: finalText,
    });

    await updateThreadsDraft(id, {
      status: "published",
      published_id: postId,
      published_at: new Date().toISOString(),
    });

    revalidatePath("/threads");
    return { ok: true, postId };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
