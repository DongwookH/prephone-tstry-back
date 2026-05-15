"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  addGeminiKey,
  disableGeminiKey,
} from "@/lib/sheets";
import { invalidateGeminiKeyCache } from "@/lib/gemini";

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
