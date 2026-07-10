/**
 * GA OAuth refresh token 영속화 + 크론용 access token 발급.
 * 저장소: settings 시트 type='ga_refresh_token' (threads_token과 동일 패턴).
 */
import {
  readSettings,
  appendRow,
  updateCell,
  mainSheetId,
  ensureSettingsSheet,
  readRange,
} from "./sheets";

const TYPE = "ga_refresh_token";

export async function saveGaRefreshToken(refreshToken: string): Promise<void> {
  await ensureSettingsSheet();
  const all = await readSettings();
  const now = new Date().toISOString();
  if (all.some((r) => r.type === TYPE)) {
    const raw = await readRange(mainSheetId(), "settings!A:H");
    let headerIdx = 0;
    if (raw[0]?.[0]?.startsWith("💡")) headerIdx = 1;
    for (let i = headerIdx + 1; i < raw.length; i++) {
      if (raw[i]?.[1] === TYPE) {
        const rowNum = i + 1;
        await updateCell(mainSheetId(), `settings!C${rowNum}`, refreshToken);
        await updateCell(mainSheetId(), `settings!E${rowNum}`, "1");
        await updateCell(mainSheetId(), `settings!G${rowNum}`, now);
        return;
      }
    }
  }
  await appendRow(mainSheetId(), "settings", [
    `ga-${Date.now()}`, TYPE, refreshToken, "GA cron refresh token", "1", now, now, "0",
  ]);
}

/** 크론/스크립트용 — settings의 refresh token으로 access token 발급. */
export async function getGaAccessTokenForCron(): Promise<string> {
  const all = await readSettings();
  const row = all.find((r) => r.type === TYPE && r.value && r.enabled !== "0");
  if (!row) {
    throw new Error("ga_refresh_token 없음 — 대시보드에 로그아웃 후 재로그인하면 저장됩니다.");
  }
  const params = new URLSearchParams({
    client_id: process.env.AUTH_GOOGLE_ID!,
    client_secret: process.env.AUTH_GOOGLE_SECRET!,
    grant_type: "refresh_token",
    refresh_token: row.value,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const j = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || !j.access_token) {
    throw new Error(`GA access token 갱신 실패: ${j.error ?? res.status} — 재로그인 필요`);
  }
  return j.access_token;
}
