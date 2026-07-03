#!/usr/bin/env node
/**
 * 텔레그램 봇 셋업 도우미.
 *
 *   node scripts/setup-telegram.cjs chatid   → 봇에 온 메시지의 chat_id 확인
 *   node scripts/setup-telegram.cjs webhook  → 프로덕션 웹훅 등록 (secret 포함)
 *   node scripts/setup-telegram.cjs info     → 현재 웹훅 상태 확인
 *   node scripts/setup-telegram.cjs test     → 테스트 메시지 발송
 *
 * .env.local 필요: TELEGRAM_BOT_TOKEN, (webhook/test는) TELEGRAM_CHAT_ID,
 *                  TELEGRAM_WEBHOOK_SECRET, PRODUCTION_URL(또는 인자로 전달)
 */
const fs = require("fs");
const path = require("path");

const env = {};
for (const l of fs
  .readFileSync(path.join(__dirname, "..", ".env.local"), "utf8")
  .split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  let v = m[2];
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  )
    v = v.slice(1, -1);
  env[m[1]] = v;
}

const TOKEN = env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN이 .env.local에 없습니다.");
  process.exit(1);
}
const API = `https://api.telegram.org/bot${TOKEN}`;

const mode = process.argv[2] || "info";

(async () => {
  if (mode === "chatid") {
    const r = await fetch(`${API}/getUpdates`).then((r) => r.json());
    const chats = new Map();
    for (const u of r.result || []) {
      const c = u.message?.chat;
      if (c) chats.set(c.id, c.first_name || c.title || "");
    }
    if (chats.size === 0) {
      console.log(
        "아직 봇에 온 메시지가 없습니다. 텔레그램에서 봇에게 아무 메시지나 보내고 다시 실행하세요.",
      );
    } else {
      for (const [id, name] of chats) console.log(`chat_id=${id}  (${name})`);
    }
    return;
  }

  if (mode === "webhook") {
    const base = process.argv[3] || env.PRODUCTION_URL;
    const secret = env.TELEGRAM_WEBHOOK_SECRET;
    if (!base || !secret) {
      console.error(
        "PRODUCTION_URL(인자 또는 env)과 TELEGRAM_WEBHOOK_SECRET가 필요합니다.",
      );
      process.exit(1);
    }
    const url = `${base.replace(/\/$/, "")}/api/telegram/webhook`;
    const r = await fetch(`${API}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        secret_token: secret,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true,
      }),
    }).then((r) => r.json());
    console.log("setWebhook:", JSON.stringify(r));
    return;
  }

  if (mode === "test") {
    if (!env.TELEGRAM_CHAT_ID) {
      console.error("TELEGRAM_CHAT_ID가 .env.local에 없습니다.");
      process.exit(1);
    }
    const r = await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: "✅ 봇 연결 테스트 — 앤텔레콤 Threads 알림봇이 준비됐어요.",
      }),
    }).then((r) => r.json());
    console.log("sendMessage:", r.ok ? "OK" : JSON.stringify(r));
    return;
  }

  // info
  const r = await fetch(`${API}/getWebhookInfo`).then((r) => r.json());
  console.log(JSON.stringify(r.result, null, 2));
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
