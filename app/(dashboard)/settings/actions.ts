"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getViewerContext } from "@/lib/tenant-context";
import {
  addGeminiKey,
  addNvidiaKey,
  disableGeminiKey,
  addGaProperty,
  disableGaProperty,
} from "@/lib/sheets";
import { invalidateGeminiKeyCache } from "@/lib/gemini";
import {
  getThreadsToken,
  disableThreadsToken,
  postToThreads,
} from "@/lib/threads";
import {
  addTenant,
  updateTenantStatus,
  updateTenantSpreadsheetId,
  isAdminEmail,
  listTenants,
} from "@/lib/tenants";
import { provisionTenantSheet } from "@/lib/tenant-provision";

async function requireAuth(): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "로그인이 필요합니다" };
  }
  return { ok: true };
}

/**
 * 이 액션 호출자가 스코프해야 할 sheetId. 클라이언트 입력은 신뢰하지 않고
 * 매 호출마다 getViewerContext()로 세션 기준 재확인한다.
 *  - 오너: undefined → 기존 동작(메인 시트) 그대로
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

/** 새 Gemini 키 추가. */
export async function addGeminiKeyAction(input: {
  value: string;
  label: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const scoped = await resolveScopedSheetId();
  if (!scoped.ok) return { ok: false, error: scoped.error };

  const value = input.value.trim();
  const label = input.label.trim();
  if (!value) return { ok: false, error: "키 값을 입력하세요" };
  // 구글이 2026년 새 키 형식(AQ.…)을 발급하기 시작했다. 기존 AIza…와 공존하므로
  // 둘 다 허용한다 (2026-07-28: AQ. 키가 등록을 거부당해 확인된 사항).
  if (!/^(AIza|AQ\.)/.test(value))
    return {
      ok: false,
      error: "Google API 키는 AIza 또는 AQ. 로 시작합니다 — 전체를 복사했는지 확인해 주세요",
    };
  if (value.length < 30)
    return { ok: false, error: "키가 너무 짧습니다 — 전체를 복사했는지 확인해 주세요" };

  try {
    const { id } = await addGeminiKey(value, label, scoped.sheetId);
    invalidateGeminiKeyCache();
    revalidatePath("/settings");
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * NVIDIA NIM API 키 추가 (썸네일·카드뉴스 배경 이미지 생성용).
 * ⚠️ 현재 테넌트 이미지 생성 파이프라인은 아직 연결되지 않았다 —
 *    키는 저장만 되고, 기능이 켜지는 시점에 그대로 쓰인다.
 */
export async function addNvidiaKeyAction(input: {
  value: string;
  label: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const scoped = await resolveScopedSheetId();
  if (!scoped.ok) return { ok: false, error: scoped.error };

  const value = input.value.trim();
  const label = input.label.trim();
  if (!value) return { ok: false, error: "키 값을 입력하세요" };
  if (!value.startsWith("nvapi-"))
    return { ok: false, error: "NVIDIA 키는 nvapi- 로 시작합니다" };
  if (value.length < 20)
    return { ok: false, error: "키가 너무 짧습니다 — 전체를 복사했는지 확인해 주세요" };

  try {
    const { id } = await addNvidiaKey(value, label, scoped.sheetId);
    revalidatePath("/settings");
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Gemini 키 비활성화 (실제 삭제 X). */
export async function disableGeminiKeyAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const scoped = await resolveScopedSheetId();
  if (!scoped.ok) return { ok: false, error: scoped.error };

  try {
    const found = await disableGeminiKey(id, scoped.sheetId);
    if (!found) return { ok: false, error: "해당 키를 찾을 수 없습니다" };
    invalidateGeminiKeyCache();
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── GA Properties (블로그별 GA4) ──────────────

/** GA4 property 추가. */
export async function addGaPropertyAction(input: {
  label: string;
  property_id: string;
  measurement_id?: string;
  tistory_url?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const a = await requireAuth();
  if (!a.ok) return { ok: false, error: a.error! };

  const label = input.label.trim();
  const property_id = input.property_id.replace(/\D/g, "").trim();
  if (!label) return { ok: false, error: "블로그 이름(라벨)을 입력하세요" };
  if (!property_id)
    return {
      ok: false,
      error: "Property ID(숫자 9~12자리)를 입력하세요 — GA4 관리 > 속성 설정",
    };
  if (property_id.length < 8 || property_id.length > 14)
    return { ok: false, error: "Property ID 형식 확인 — 숫자 9~12자리" };

  try {
    const { id } = await addGaProperty({
      label,
      property_id,
      measurement_id: input.measurement_id,
      tistory_url: input.tistory_url,
    });
    revalidatePath("/settings");
    revalidatePath("/analytics");
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** GA4 property 비활성화. */
export async function disableGaPropertyAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const a = await requireAuth();
  if (!a.ok) return { ok: false, error: a.error! };
  try {
    const ok = await disableGaProperty(id);
    if (!ok) return { ok: false, error: "해당 항목을 찾을 수 없습니다" };
    revalidatePath("/settings");
    revalidatePath("/analytics");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── Threads ──────────────────────────────────────

/** Threads 연결 해제 — settings 시트 토큰 enabled=0. */
export async function disconnectThreadsAction(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const a = await requireAuth();
  if (!a.ok) return { ok: false, error: a.error! };

  try {
    const tok = await getThreadsToken();
    if (!tok) return { ok: false, error: "연결된 Threads 계정이 없습니다" };
    await disableThreadsToken(tok.user_id);
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Threads 테스트 글 발행 — "{기본 텍스트} - {ISO}" 형태. */
export async function testPostThreadsAction(
  text?: string,
): Promise<
  { ok: true; id: string } | { ok: false; error: string }
> {
  const a = await requireAuth();
  if (!a.ok) return { ok: false, error: a.error! };

  try {
    const tok = await getThreadsToken();
    if (!tok) return { ok: false, error: "Threads 연결이 없습니다" };

    const defaultText = `테스트 발행 (${new Date().toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
    })}) — 앤텔레콤 안심개통 백오피스 연동 확인용`;

    const { id } = await postToThreads({
      accessToken: tok.access_token,
      userId: tok.user_id,
      text: (text?.trim() || defaultText).slice(0, 500),
    });
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── 사용자 관리 (멀티테넌트 화이트리스트) ──────────────

/** 로그인 + 관리자(role=owner 또는 env ALLOWED_EMAILS) 확인. */
async function requireAdmin(): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "로그인이 필요합니다" };
  const admin = await isAdminEmail(email);
  if (!admin) return { ok: false, error: "관리자 권한이 필요합니다" };
  return { ok: true };
}

/** 테넌트(사용자) 추가 — 관리자만. 전용 시트 프로비저닝까지 시도. */
export async function addTenantAction(input: {
  email: string;
  name?: string;
}): Promise<
  | { ok: true; id: string; warning?: string }
  | { ok: false; error: string }
> {
  const a = await requireAdmin();
  if (!a.ok) return { ok: false, error: a.error! };

  try {
    const result = await addTenant({ email: input.email, name: input.name });
    if ("error" in result) return { ok: false, error: result.error };

    // 전용 시트 발급 — 실패해도 사용자 등록 자체는 유지 (재시도 버튼으로 복구)
    let warning: string | undefined;
    const prov = await provisionTenantSheet({
      email: input.email.trim().toLowerCase(),
      name: input.name || "",
    });
    if (prov.ok) {
      await updateTenantSpreadsheetId(result.id, prov.spreadsheetId);
    } else {
      warning = `등록은 완료됐지만 전용 시트 발급에 실패했습니다 — ${prov.error}`;
    }

    revalidatePath("/settings");
    return { ok: true, id: result.id, warning };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** 전용 시트 재발급 시도 — spreadsheet_id가 비어 있는 테넌트용. */
export async function provisionTenantSheetAction(
  id: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const a = await requireAdmin();
  if (!a.ok) return { ok: false, error: a.error! };

  try {
    const all = await listTenants();
    const t = all.find((x) => x.id === id);
    if (!t) return { ok: false, error: "해당 사용자를 찾을 수 없습니다" };
    if (t.spreadsheet_id) {
      return { ok: false, error: "이미 시트가 발급된 사용자입니다" };
    }
    const prov = await provisionTenantSheet({ email: t.email, name: t.name });
    if (!prov.ok) return { ok: false, error: prov.error };
    await updateTenantSpreadsheetId(id, prov.spreadsheetId);
    revalidatePath("/settings");
    return { ok: true, url: prov.url };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** 테넌트 상태 변경 (active ↔ suspended) — 관리자만. */
export async function setTenantStatusAction(
  id: string,
  status: "active" | "suspended",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const a = await requireAdmin();
  if (!a.ok) return { ok: false, error: a.error! };
  if (status !== "active" && status !== "suspended") {
    return { ok: false, error: "허용되지 않는 상태값입니다" };
  }

  try {
    const ok = await updateTenantStatus(id, status);
    if (!ok) return { ok: false, error: "해당 사용자를 찾을 수 없습니다" };
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
