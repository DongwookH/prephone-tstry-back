"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  updatePostStatus,
  deletePostsByIds,
  blacklistKeyword,
} from "@/lib/sheets";

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
 * 글 삭제 + (선택) 키워드 블랙리스트 등록.
 *  - 시트에서 글 row 삭제
 *  - blacklistKeywordToo=true 면 해당 키워드 status='blacklisted' → 다음 cron부터 픽 안 됨
 *  - 삭제 후 /posts 목록으로 redirect
 */
export async function deletePostWithBlacklistAction(input: {
  postId: string;
  keyword: string;
  blacklistKeywordToo: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "로그인 필요" };
  }

  try {
    // 1) 글 삭제
    const delResult = await deletePostsByIds([input.postId]);
    if (delResult.deleted === 0) {
      return { ok: false, error: "글을 찾을 수 없습니다" };
    }

    // 2) 키워드 블랙리스트 (옵션)
    if (input.blacklistKeywordToo && input.keyword?.trim()) {
      try {
        await blacklistKeyword(input.keyword);
      } catch (err) {
        // 블랙리스트 실패해도 글은 이미 삭제됐으니 ok로 진행 — 경고만
        console.warn("[deletePost] 블랙리스트 실패:", err);
      }
    }

    revalidatePath("/");
    revalidatePath("/posts");
    revalidatePath("/analytics");
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  // redirect는 try/catch 밖에서 — Next.js redirect는 throw 기반
  redirect("/posts");
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
