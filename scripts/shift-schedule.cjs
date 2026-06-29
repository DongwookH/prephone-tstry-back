#!/usr/bin/env node
/**
 * threads_drafts의 미발행 예약 글들을 N일(기본 +1) 뒤로 시프트.
 * 오늘(KST 00:00) 이후 scheduled_at을 가진 scheduled/pending/failed 글만 대상.
 *
 *   node scripts/shift-schedule.cjs dry        # 대상 미리보기 (+1일)
 *   node scripts/shift-schedule.cjs apply       # 적용
 *   node scripts/shift-schedule.cjs apply 2     # +2일
 */
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

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

const kst = (iso) =>
  iso
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "numeric",
        day: "numeric",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(iso))
    : "-";

async function main() {
  const mode = process.argv[2] || "dry";
  const days = parseInt(process.argv[3] || "1", 10);

  // 오늘 00:00 KST 의 UTC 시각
  const nowKst = new Date(Date.now() + 9 * 3600 * 1000);
  nowKst.setUTCHours(0, 0, 0, 0);
  const todayStartUtc = nowKst.getTime() - 9 * 3600 * 1000;

  const auth = new google.auth.JWT({
    email: env.GOOGLE_SHEETS_CLIENT_EMAIL,
    key: (env.GOOGLE_SHEETS_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: env.GOOGLE_SHEETS_ID,
    range: "threads_drafts!A:M",
  });
  const rows = r.data.values || [];

  const shiftMs = days * 24 * 3600 * 1000;
  const targets = [];
  for (let i = 1; i < rows.length; i++) {
    const x = rows[i];
    const status = x[6];
    const schAt = x[11];
    const published = x[7];
    if (published) continue;
    if (!["scheduled", "pending", "failed"].includes(status)) continue;
    if (!schAt) continue;
    const t = new Date(schAt).getTime();
    if (!isFinite(t) || t < todayStartUtc) continue; // 오늘 이전은 건드리지 않음
    const next = new Date(t + shiftMs).toISOString();
    targets.push({
      row: i + 1,
      status,
      kw: x[2],
      from: kst(schAt),
      to: kst(next),
      nextIso: next,
      hadErr: !!(x[12] || "").trim(),
    });
  }
  targets.sort((a, b) => new Date(a.from) - new Date(b.from));

  console.log(`오늘 00:00 KST 이후 미발행 글을 +${days}일 시프트`);
  console.log(`대상 ${targets.length}건:`);
  for (const t of targets)
    console.log(
      `  행${t.row} [${t.status}] ${t.from} → ${t.to}  ${t.kw}`,
    );

  if (mode === "apply" && targets.length) {
    const data = [];
    for (const t of targets) {
      data.push({
        range: `threads_drafts!L${t.row}`,
        values: [[t.nextIso]],
      });
      if (t.hadErr)
        data.push({ range: `threads_drafts!M${t.row}`, values: [[""]] }); // stale/실패 사유 클리어
    }
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: env.GOOGLE_SHEETS_ID,
      requestBody: { valueInputOption: "RAW", data },
    });
    console.log(`\n✅ ${targets.length}건 +${days}일 시프트 완료`);
  } else if (mode === "dry") {
    console.log("\n(dry-run — 변경 안 함)");
  }
}

main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
