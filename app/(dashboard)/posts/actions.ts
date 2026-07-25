"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getViewerContext } from "@/lib/tenant-context";
import {
  updatePostStatus,
  deletePostsByIds,
  blacklistKeyword,
} from "@/lib/sheets";

/**
 * 이 요청을 보낸 뷰어가 스코프해야 할 sheetId를 서버에서 직접 해석.
 * 클라이언트가 보낸 값은 절대 신뢰하지 않고, 매 액션 호출마다 getViewerContext()를
 * 다시 호출해 세션 기준으로 판단한다.
 *  - 오너: sheetId=undefined → 기존 동작(메인 시트) 그대로
 *  - 멤버: 본인 시트로 스코프. 시트 미발급이면 에러 반환
 */
async function resolveScopedSheetId(): Promise<
  { ok: true; sheetId: string | undefined } | { ok: false; error: string }
> {
  const ctx = await getViewerContext();
  if (!ctx) return { ok: false, error: "로그인이 필요합니다" };
  if (ctx.isOwner) return { ok: true, sheetId: undefined };
  if (!ctx.sheetId) {
    return {
      ok: false,
      error: "전용 시트가 아직 발급되지 않았습니다 — 관리자에게 문의해 주세요",
    };
  }
  return { ok: true, sheetId: ctx.sheetId };
}

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
  const scoped = await resolveScopedSheetId();
  if (!scoped.ok) {
    return { ok: false, newStatus: currentStatus, error: scoped.error };
  }
  const newStatus = currentStatus === "published" ? "ready" : "published";
  try {
    const r = await updatePostStatus(postId, newStatus, undefined, scoped.sheetId);
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
  const scoped = await resolveScopedSheetId();
  if (!scoped.ok) {
    return { ok: false, error: scoped.error };
  }

  try {
    // 1) 글 삭제
    const delResult = await deletePostsByIds([input.postId], scoped.sheetId);
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
  const scoped = await resolveScopedSheetId();
  if (!scoped.ok) return { ok: false, error: scoped.error };
  try {
    const status = markPublished ? "published" : "ready";
    const r = await updatePostStatus(postId, status, tistoryUrl, scoped.sheetId);
    if (!r.ok) return { ok: false, error: "post not found" };
    revalidatePath("/");
    revalidatePath("/posts");
    revalidatePath(`/posts/${postId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
