"use server";

import { auth } from "@/auth";
import { revalidatePath } from "next/cache";

/**
 * 수동 생성 — 로그인된 사용자가 백오피스 버튼으로 즉시 cron 트리거.
 * 내부적으로 /api/cron/generate POST + Bearer CRON_SECRET 호출.
 */
export async function generateNowAction(): Promise<{
  ok: boolean;
  saved?: number;
  track1Count?: number;
  track2Count?: number;
  failedCount?: number;
  durationMs?: number;
  error?: string;
}> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "로그인이 필요합니다" };
  }
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return { ok: false, error: "CRON_SECRET 환경변수 미설정" };
  }
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

  try {
    const res = await fetch(`${baseUrl}/api/cron/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cronSecret}`,
      },
      // Vercel은 maxDuration 안에서, 로컬은 무제한
      signal: AbortSignal.timeout(280_000),
    });
    const data = await res.json();
    revalidatePath("/");
    revalidatePath("/posts");
    revalidatePath("/analytics");
    revalidatePath("/keywords");
    if (!res.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return {
      ok: true,
      saved: data.saved,
      track1Count: data.summary?.track1Count,
      track2Count: data.summary?.track2Count,
      failedCount: data.summary?.failedCount,
      durationMs: data.durationMs,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
