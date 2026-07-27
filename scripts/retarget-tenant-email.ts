/**
 * 테넌트 이메일 교체 (1회성 운영 스크립트).
 *   npx tsx scripts/retarget-tenant-email.ts <이전이메일> <새이메일>          # 미리보기
 *   npx tsx scripts/retarget-tenant-email.ts <이전이메일> <새이메일> --apply  # 반영
 *
 * 하는 일:
 *   1) tenants 탭 B열(email) 교체
 *   2) 전용 시트를 새 이메일에 공유 (writer, 안내 메일 발송)
 *   3) 이전 이메일의 공유 권한 제거 — 잘못 등록된 계정에 사업 데이터가
 *      남아 있지 않도록. 실수였다면 다시 공유하면 되므로 되돌리기 쉽다.
 *
 * 공유 권한 변경은 파일 소유자(오너) 자격이 필요해 서비스 계정으로는 안 되고,
 * 프로비저닝과 동일하게 오너 OAuth 토큰을 쓴다.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { google } from "googleapis";

function loadEnvLocal() {
  const p = join(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    if (!k || process.env[k] !== undefined) continue;
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    process.env[k] = v;
  }
}
loadEnvLocal();

const [oldEmailArg, newEmailArg] = process.argv.slice(2).filter((a) => a !== "--apply");
const apply = process.argv.includes("--apply");

async function main() {
  if (!oldEmailArg || !newEmailArg) {
    console.error("사용법: retarget-tenant-email.ts <이전이메일> <새이메일> [--apply]");
    process.exit(1);
  }
  const oldEmail = oldEmailArg.toLowerCase();
  const newEmail = newEmailArg.toLowerCase();

  const { readRange, updateCell, mainSheetId } = await import("../lib/sheets");
  const { getGaAccessTokenForCron } = await import("../lib/ga-token");

  const rows = await readRange(mainSheetId(), "tenants!A:H");
  let rowNum = -1;
  let sheetId = "";
  let name = "";
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i]?.[1] ?? "").trim().toLowerCase() === oldEmail) {
      rowNum = i + 1;
      name = rows[i]?.[2] ?? "";
      sheetId = rows[i]?.[5] ?? "";
      break;
    }
  }
  if (rowNum < 0) {
    console.error(`tenants 탭에 ${oldEmail} 행이 없습니다`);
    process.exit(1);
  }

  console.log(`대상: ${name} (행 ${rowNum})`);
  console.log(`  이메일: ${oldEmail}  →  ${newEmail}`);
  console.log(`  전용 시트: ${sheetId ? sheetId.slice(0, 6) + "…" : "(미발급)"}`);

  if (!apply) {
    console.log("\n(미리보기) --apply 를 붙이면 반영합니다");
    return;
  }

  // 1) tenants B열 교체
  await updateCell(mainSheetId(), `tenants!B${rowNum}`, newEmail);
  console.log("  ✅ tenants 이메일 교체");

  if (!sheetId) {
    console.log("  전용 시트 미발급 — 공유 단계 건너뜀");
    return;
  }

  const oauth = new google.auth.OAuth2();
  oauth.setCredentials({ access_token: await getGaAccessTokenForCron() });
  const drive = google.drive({ version: "v3", auth: oauth });

  // 2) 새 이메일 공유
  await drive.permissions.create({
    fileId: sheetId,
    sendNotificationEmail: true,
    emailMessage:
      "블로그 자동화 백오피스의 전용 데이터 시트입니다. 세부 가이드는 백오피스의 「내 가이드」 화면에서 작성하시면 이 시트에 자동 저장됩니다.",
    requestBody: { type: "user", role: "writer", emailAddress: newEmail },
  });
  console.log(`  ✅ ${newEmail} 공유 추가`);

  // 3) 이전 이메일 공유 제거
  const perms = await drive.permissions.list({
    fileId: sheetId,
    fields: "permissions(id,emailAddress,role)",
  });
  for (const p of perms.data.permissions ?? []) {
    if ((p.emailAddress ?? "").toLowerCase() === oldEmail && p.id) {
      await drive.permissions.delete({ fileId: sheetId, permissionId: p.id });
      console.log(`  ✅ ${oldEmail} 공유 제거`);
    }
  }

  const after = await drive.permissions.list({
    fileId: sheetId,
    fields: "permissions(emailAddress,role)",
  });
  console.log("\n최종 공유 상태:");
  for (const p of after.data.permissions ?? []) {
    console.log(`  ${p.emailAddress} → ${p.role}`);
  }
}

main().catch((e) => {
  console.error("실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
