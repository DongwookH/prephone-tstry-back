"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { updatePostStatus } from "@/lib/sheets";

/**
 * 글의 발행 상태를 토글.
 *  - 현재 published면 ready로
 *  - 그 외(ready/failed/빈값)이면 published로
 *
 * 호출 후 대시보드/글 목록/상세 페이지를 즉시 갱신.
 */
export async function togglePublishedAction(
  postId: string,
  currentStatus: string,
): Promise<{ ok: boolean; newStatus: string; error?: string }> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, newStatus: currentStatus, error: "Unauthorized" };
  }
  const newStatus = currentStatus === "published" ? "ready" : "published";
  try {
    const r = await updatePostStatus(postId, newStatus);
    if (!r.ok) {
      return { ok: false, newStatus: currentStatus, error: "post not found" };
    }
    revalidatePath("/");
    revalidatePath("/posts");
    revalidatePath(`/posts/${postId}`);
    revalidatePath("/analytics");
    return { ok: true, newStatus };
  } catch (err) {
    return {
      ok: false,
      newStatus: currentStatus,
      error: (err as Error).message,
    };
  }
}

/**
 * 티스토리 URL 저장 + status를 published로 (선택).
 */
export async function savePostMetaAction(
  postId: string,
  tistoryUrl: string,
  markPublished: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Unauthorized" };
  try {
    const status = markPublished ? "published" : "ready";
    const r = await updatePostStatus(postId, status, tistoryUrl);
    if (!r.ok) return { ok: false, error: "post not found" };
    revalidatePath("/");
    revalidatePath("/posts");
    revalidatePath(`/posts/${postId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
