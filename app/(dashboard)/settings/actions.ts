"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  addGeminiKey,
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
import { addTenant, updateTenantStatus, isAdminEmail } from "@/lib/tenants";

async function requireAuth(): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "로그인이 필요합니다" };
  }
  return { ok: true };
}

/** 새 Gemini 키 추가. */
export async function addGeminiKeyAction(input: {
  value: string;
  label: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const a = await requireAuth();
  if (!a.ok) return { ok: false, error: a.error! };

  const value = input.value.trim();
  const label = input.label.trim();
  if (!value) return { ok: false, error: "키 값을 입력하세요" };
  if (!value.startsWith("AIza"))
    return { ok: false, error: "Google API 키는 보통 AIza로 시작합니다" };
  if (value.length < 30)
    return { ok: false, error: "키가 너무 짧습니다 (39자 정도 예상)" };

  try {
    const { id } = await addGeminiKey(value, label);
    invalidateGeminiKeyCache();
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
  const a = await requireAuth();
  if (!a.ok) return { ok: false, error: a.error! };

  try {
    const found = await disableGeminiKey(id);
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

/** 테넌트(사용자) 추가 — 관리자만. */
export async function addTenantAction(input: {
  email: string;
  name?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const a = await requireAdmin();
  if (!a.ok) return { ok: false, error: a.error! };

  try {
    const result = await addTenant({ email: input.email, name: input.name });
    if ("error" in result) return { ok: false, error: result.error };
    revalidatePath("/settings");
    return { ok: true, id: result.id };
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
