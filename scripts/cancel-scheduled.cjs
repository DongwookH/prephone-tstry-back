#!/usr/bin/env node
/**
 * threads_drafts에서 cutoff(기본 2026-06-23T11:00:00Z = KST 6/23 20:00) 이후
 * scheduled 글을 pending으로 되돌린다(발행 취소). 새 batch 검토 전환용.
 *
 *   node scripts/cancel-scheduled.cjs dry            # 대상만 출력
 *   node scripts/cancel-scheduled.cjs apply          # 실제 변경
 *   node scripts/cancel-scheduled.cjs dry 2026-06-24T00:00:00Z  # cutoff 변경
 */
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

function loadEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

async function main() {
  const mode = process.argv[2] || "dry";
  const cutoffIso = process.argv[3] || "2026-06-23T11:00:00Z";
  const cutoff = new Date(cutoffIso).getTime();

  const env = loadEnv(path.join(__dirname, "..", ".env.local"));
  const email = env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const key = (env.GOOGLE_SHEETS_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const sheetId = env.GOOGLE_SHEETS_ID;
  if (!email || !key || !sheetId) throw new Error("env 누락");

  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "threads_drafts!A:M",
  });
  const rows = res.data.values || [];
  const fmt = (iso) =>
    new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "numeric",
      day: "numeric",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));

  if (mode === "today") {
    // 오늘(KST, 자동) scheduled 글의 id 목록 (due/future)
    const todayKst = new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "numeric",
      day: "numeric",
    }).format(new Date()); // 예: "6. 23."
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (r[6] !== "scheduled" || !r[11]) continue;
      const kst = fmt(r[11]);
      if (!kst.includes(todayKst)) continue;
      const due = new Date(r[11]).getTime() <= Date.now() ? "due" : "future";
      console.log(`${r[0]} | 행${i + 1} | ${kst} | ${due} | ${r[2]}`);
    }
    return;
  }

  if (mode === "setstatus") {
    const id = process.argv[3];
    const st = process.argv[4];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] !== id) continue;
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: [{ range: `threads_drafts!G${i + 1}`, values: [[st]] }],
        },
      });
      console.log(`✅ 행${i + 1} (${rows[i][2]}) status → ${st}`);
      return;
    }
    console.log("id 못 찾음:", id);
    return;
  }

  if (mode === "debug") {
    // cutoff 이후 모든 scheduled/pending을 created_at 순으로 — 배치 구분용
    const items = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const status = r[6];
      const schAt = r[11];
      if (!schAt || !["scheduled", "pending"].includes(status)) continue;
      const t = new Date(schAt).getTime();
      if (!isFinite(t) || t < cutoff) continue;
      items.push({
        row: i + 1,
        status,
        created: r[1],
        kst: fmt(schAt),
        keyword: r[2],
      });
    }
    items.sort((a, b) => (a.created || "").localeCompare(b.created || ""));
    console.log("created_at              | status    | 슬롯(KST)        | 키워드");
    for (const it of items)
      console.log(
        `${(it.created || "").padEnd(24)}| ${it.status.padEnd(9)} | ${it.kst.padEnd(15)} | ${it.keyword}`,
      );
    return;
  }

  // 신 배치(06-21~) 보호: created_at이 이 시점 이후면 취소 대상에서 제외.
  const createdCutoff = new Date(
    process.argv[4] || "2026-06-20T00:00:00Z",
  ).getTime();
  const targets = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const status = r[6];
    const schAt = r[11];
    const published = r[7];
    if (status !== "scheduled" || !schAt || published) continue;
    const t = new Date(schAt).getTime();
    if (!isFinite(t) || t < cutoff) continue;
    const created = new Date(r[1]).getTime();
    if (isFinite(created) && created >= createdCutoff) continue; // 신 배치 보호
    targets.push({
      sheetRow: i + 1,
      kst: fmt(schAt),
      keyword: r[2],
      schAt,
      created: r[1],
    });
  }
  targets.sort((a, b) => new Date(a.schAt) - new Date(b.schAt));

  console.log(`cutoff: ${cutoffIso} (KST ${fmt(cutoffIso)})`);
  console.log(`대상(scheduled→pending) ${targets.length}건:`);
  for (const t of targets)
    console.log(`  행${t.sheetRow}  ${t.kst}  ${t.keyword}`);

  if (mode === "apply" && targets.length) {
    const data = targets.map((t) => ({
      range: `threads_drafts!G${t.sheetRow}`,
      values: [["pending"]],
    }));
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: "RAW", data },
    });
    console.log(`\n✅ ${targets.length}건 pending으로 변경 완료`);
  } else if (mode === "dry") {
    console.log("\n(dry-run — 변경 안 함)");
  }
}

main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
