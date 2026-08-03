// v2 마이그레이션용 구시트 덤프 — 읽기 전용, 시트 변경 없음.
// 실행: node scripts/dump-for-migration.mjs (web 디렉토리에서)
import { google } from "googleapis";
import { readFileSync, writeFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const t = line.trim();
  if (t && !t.startsWith("#") && t.includes("=")) {
    const i = t.indexOf("=");
    const k = t.slice(0, i);
    if (!process.env[k]) process.env[k] = t.slice(i + 1).replace(/^"|"$/g, "");
  }
}

const auth = new google.auth.JWT({
  email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
  key: process.env.GOOGLE_SHEETS_PRIVATE_KEY.replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth });
const ID = process.env.GOOGLE_SHEETS_ID;

const OUT = "/private/tmp/claude-501/-Users-mac-Desktop---------/a23c689e-b6ea-4892-94a5-d1ed0029ca91/scratchpad/old-data";
import { mkdirSync } from "node:fs";
mkdirSync(OUT, { recursive: true });

async function dump(tab, range) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: ID,
      range: `${tab}!${range}`,
    });
    const rows = res.data.values ?? [];
    writeFileSync(`${OUT}/${tab}.json`, JSON.stringify(rows));
    console.log(`${tab}: ${rows.length}행`);
  } catch (e) {
    console.log(`${tab}: 실패 — ${e.message}`);
  }
}

await dump("posts", "A:W");
await dump("threads_drafts", "A:M");
await dump("chat_logs", "A:F");
await dump("metrics_daily", "A:H");
await dump("threads_metrics", "A:K");
