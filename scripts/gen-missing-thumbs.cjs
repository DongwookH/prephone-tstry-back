#!/usr/bin/env node
/** 메타는 있는데 public/thumbnails PNG가 없는 글들의 메타를 JSON으로 출력. */
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

const has = (id) =>
  fs.existsSync(path.join(__dirname, "..", "public", "thumbnails", `${id}.png`));

(async () => {
  const auth = new google.auth.JWT({
    email: env.GOOGLE_SHEETS_CLIENT_EMAIL,
    key: (env.GOOGLE_SHEETS_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: env.GOOGLE_SHEETS_ID,
    range: "posts!A:T",
  });
  const out = [];
  for (const x of r.data.values || []) {
    const id = x[0] || "";
    if (!id.startsWith("p-")) continue;
    let meta = null;
    try {
      meta = JSON.parse(x[13] || "");
    } catch {
      /* no meta */
    }
    if (meta && (meta.lines || meta.theme) && !has(id))
      out.push({ id, thumbnail: meta });
  }
  fs.writeFileSync("/tmp/missing_thumbs.json", JSON.stringify(out));
  console.error(`대상 ${out.length}개 → /tmp/missing_thumbs.json`);
})().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
