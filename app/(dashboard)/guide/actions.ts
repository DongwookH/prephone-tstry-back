"use server";

import { revalidatePath } from "next/cache";
import { getViewerContext } from "@/lib/tenant-context";
import {
  saveTenantGuideRaw,
  GUIDE_SECTION_DEFS,
  type TenantGuideRaw,
} from "@/lib/tenant-config";

/**
 * 「내 가이드」 화면 전용 서버 액션.
 *
 * 오너는 대상이 아니다 — 오너 가이드는 코드·CLAUDE.md에 고정돼 있고 시트에
 * 없기 때문. 멤버만 본인 시트에 쓴다. 시트 ID는 클라이언트가 보내지 않고
 * 매 호출 getViewerContext()로 세션에서 다시 구한다.
 */
async function resolveMemberSheetId(): Promise<
  { ok: true; sheetId: string } | { ok: false; error: string }
> {
  const ctx = await getViewerContext();
  if (!ctx) return { ok: false, error: "로그인이 필요합니다" };
  if (ctx.isOwner)
    return { ok: false, error: "관리자 계정은 이 화면을 사용하지 않습니다" };
  if (!ctx.sheetId) {
    return {
      ok: false,
      error: "전용 시트가 아직 발급되지 않았습니다 — 관리자에게 문의해 주세요",
    };
  }
  return { ok: true, sheetId: ctx.sheetId };
}

/** http(s) URL이거나 빈 값이면 통과. */
function invalidUrl(value: string): boolean {
  const v = (value || "").trim();
  if (!v) return false;
  return !/^https?:\/\/\S+$/i.test(v);
}

/**
 * 가이드 저장. 필수 항목이 비어 있어도 저장은 허용한다 (중간 저장 → 나중에
 * 이어서 작성). 완성 여부는 화면이 진행률로 알려주고, 미완성이면 생성 크론이
 * 그 테넌트를 건너뛴다.
 */
export async function saveGuideAction(
  input: Partial<TenantGuideRaw>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const scoped = await resolveMemberSheetId();
  if (!scoped.ok) return { ok: false, error: scoped.error };

  if (invalidUrl(input.link_site ?? ""))
    return {
      ok: false,
      error: "개통 사이트 링크는 http:// 또는 https://로 시작해야 합니다",
    };
  if (invalidUrl(input.link_kakao ?? ""))
    return {
      ok: false,
      error: "카카오톡 채널 링크는 http:// 또는 https://로 시작해야 합니다",
    };

  // 알려진 섹션만 추려서 저장 (클라이언트가 보낸 임의 키 무시)
  const raw = {} as TenantGuideRaw;
  for (const { key } of GUIDE_SECTION_DEFS) {
    raw[key] = (input[key] ?? "").toString().trim();
  }

  try {
    await saveTenantGuideRaw(scoped.sheetId, raw);
    revalidatePath("/guide");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
