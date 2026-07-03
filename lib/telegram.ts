import {
  ensureSettingsSheet,
  readSettings,
  appendRow,
  updateCell,
  readRange,
  mainSheetId,
} from "./sheets";

/**
 * 텔레그램 발행 알림·수동발행 봇 헬퍼.
 *
 * 환경변수:
 *  - TELEGRAM_BOT_TOKEN     : BotFather 토큰
 *  - TELEGRAM_CHAT_ID       : 알림 받을 채팅 (형님 개인 챗)
 *  - TELEGRAM_WEBHOOK_SECRET: setWebhook 시 지정한 시크릿 (헤더 검증용)
 *
 * 상태(중복 알림 방지 등)는 settings 시트에 type="tg_state" 행으로 저장:
 *   id=tg-<key> | type=tg_state | value=<값> | label=<key>
 */

const TG_API = () =>
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

export function telegramEnabled(): boolean {
  return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

export type TgButton = { text: string; callback_data: string };

/** 알림 전송 (HTML 모드). buttons는 한 줄에 배치. 실패해도 throw 안 함. */
export async function sendTelegram(
  text: string,
  opts?: { buttons?: TgButton[]; chatId?: string },
): Promise<boolean> {
  if (!process.env.TELEGRAM_BOT_TOKEN) return false;
  const chatId = opts?.chatId ?? process.env.TELEGRAM_CHAT_ID;
  if (!chatId) return false;
  try {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: text.slice(0, 4000),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };
    if (opts?.buttons?.length) {
      body.reply_markup = { inline_keyboard: [opts.buttons] };
    }
    const res = await fetch(`${TG_API()}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error("[telegram] sendMessage 실패:", await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("[telegram] sendMessage 에러:", err);
    return false;
  }
}

/** 인라인 버튼 탭 응답 (스피너 제거). */
export async function answerCallback(
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
  try {
    await fetch(`${TG_API()}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text?.slice(0, 190),
      }),
    });
  } catch {
    /* best-effort */
  }
}

// ─── tg_state (settings 시트 key-value) ──────────────────────

async function findStateRow(
  key: string,
): Promise<{ rowNum: number; value: string } | null> {
  const raw = await readRange(mainSheetId(), "settings!A:H");
  let headerIdx = 0;
  if (raw[0]?.[0]?.startsWith("💡")) headerIdx = 1;
  for (let i = headerIdx + 1; i < raw.length; i++) {
    if (raw[i]?.[1] === "tg_state" && raw[i]?.[3] === key) {
      return { rowNum: i + 1, value: raw[i]?.[2] || "" };
    }
  }
  return null;
}

export async function getTgState(key: string): Promise<string> {
  try {
    const all = await readSettings();
    const row = all.find((r) => r.type === "tg_state" && r.label === key);
    return row?.value || "";
  } catch {
    return "";
  }
}

export async function setTgState(key: string, value: string): Promise<void> {
  await ensureSettingsSheet();
  const sheetId = mainSheetId();
  const existing = await findStateRow(key);
  if (existing) {
    await updateCell(sheetId, `settings!C${existing.rowNum}`, value);
  } else {
    await appendRow(sheetId, "settings", [
      `tg-${key}`,
      "tg_state",
      value,
      key,
      "1",
      new Date().toISOString(),
      "",
      "0",
    ]);
  }
}
