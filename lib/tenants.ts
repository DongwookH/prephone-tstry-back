import {
  mainSheetId,
  readSheetAsObjects,
  readRange,
  appendRow,
  updateCell,
  ensureSheetTab,
} from "./sheets";

/**
 * 멀티테넌트 — tenants 탭 (마스터 = 메인 시트).
 *
 * 열 구조:
 *   A id             : t-<timestamp>
 *   B email          : 구글 로그인 이메일 (소문자 정규화)
 *   C name           : 표시 이름
 *   D role           : owner | member
 *   E status         : active | pending | suspended
 *   F spreadsheet_id : 이 테넌트 전용 스프레드시트 ID (오너는 메인 시트, 2단계에서 발급)
 *   G created_at     : ISO
 *   H note           : 메모
 *
 * 화이트리스트 = status=active 인 이메일 ∪ env ALLOWED_EMAILS.
 * env는 시트 장애·부트스트랩 대비 폴백으로 항상 유효하다 (오너 잠금 방지).
 */

export type TenantRow = {
  id: string;
  email: string;
  name: string;
  role: "owner" | "member" | "";
  status: "active" | "pending" | "suspended" | "";
  spreadsheet_id: string;
  created_at: string;
  note: string;
};

const TENANTS_SHEET = "tenants";
const TENANTS_HEADERS = [
  "id",
  "email",
  "name",
  "role",
  "status",
  "spreadsheet_id",
  "created_at",
  "note",
];

function normEmail(email: string): string {
  return (email || "").trim().toLowerCase();
}

function parseRow(r: Record<string, string>): TenantRow {
  const role = (r.role || "").trim().toLowerCase();
  const status = (r.status || "").trim().toLowerCase();
  return {
    id: (r.id || "").trim(),
    email: normEmail(r.email || ""),
    name: (r.name || "").trim(),
    role: role === "owner" || role === "member" ? role : "",
    status:
      status === "active" || status === "pending" || status === "suspended"
        ? status
        : "",
    spreadsheet_id: (r.spreadsheet_id || "").trim(),
    created_at: (r.created_at || "").trim(),
    note: (r.note || "").trim(),
  };
}

/** tenants 탭이 없으면 생성 + 헤더. */
export async function ensureTenantsSheet(): Promise<void> {
  await ensureSheetTab(mainSheetId(), TENANTS_SHEET, [...TENANTS_HEADERS]);
}

// 60초 캐시 — 로그인마다 시트 API 호출하지 않도록 (gemini 키 캐시와 동일 패턴)
let cachedTenants: { rows: TenantRow[]; fetchedAt: number } | null = null;
const TENANTS_TTL_MS = 60_000;

export function invalidateTenantsCache() {
  cachedTenants = null;
}

/** tenants 탭 전체 (탭 미생성이면 빈 배열 — 에러 아님). */
export async function listTenants(): Promise<TenantRow[]> {
  const now = Date.now();
  if (cachedTenants && now - cachedTenants.fetchedAt < TENANTS_TTL_MS) {
    return cachedTenants.rows;
  }
  let rows: TenantRow[] = [];
  try {
    const raw = await readSheetAsObjects<Record<string, string>>(
      mainSheetId(),
      TENANTS_SHEET,
    );
    rows = raw.map(parseRow).filter((t) => t.id && t.email);
  } catch {
    rows = [];
  }
  cachedTenants = { rows, fetchedAt: now };
  return rows;
}

/** 이메일로 테넌트 조회 (상태 무관 — 호출부에서 status 확인). */
export async function getTenantByEmail(
  email: string,
): Promise<TenantRow | null> {
  const e = normEmail(email);
  if (!e) return null;
  const all = await listTenants();
  return all.find((t) => t.email === e) ?? null;
}

/**
 * 로그인 허용 여부 — status=active 테넌트 ∪ env ALLOWED_EMAILS.
 * 시트 조회 실패 시에도 env 목록은 살아있으므로 오너가 잠기지 않는다.
 */
export async function isEmailAllowed(email: string): Promise<boolean> {
  const e = normEmail(email);
  if (!e) return false;
  const envAllow = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (envAllow.includes(e)) return true;
  const t = await getTenantByEmail(e);
  return t?.status === "active";
}

/**
 * 관리자 여부 — env ALLOWED_EMAILS(부트스트랩 오너) 또는 tenants role=owner.
 * 사용자 관리 UI·액션 게이트에 사용.
 */
export async function isAdminEmail(email: string): Promise<boolean> {
  const e = normEmail(email);
  if (!e) return false;
  const envAllow = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (envAllow.includes(e)) return true;
  const t = await getTenantByEmail(e);
  return t?.role === "owner" && t.status === "active";
}

/** 테넌트 추가 (기본 status=active — 관리자가 직접 등록하는 흐름). */
export async function addTenant(opts: {
  email: string;
  name?: string;
  role?: "owner" | "member";
  status?: "active" | "pending" | "suspended";
  spreadsheet_id?: string;
  note?: string;
}): Promise<{ id: string } | { error: string }> {
  const email = normEmail(opts.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "올바른 이메일 형식이 아닙니다." };
  }
  await ensureTenantsSheet();
  const existing = await getTenantByEmail(email);
  if (existing) {
    return { error: `이미 등록된 이메일입니다 (${existing.status || "?"}).` };
  }
  const id = `t-${Date.now()}`;
  await appendRow(mainSheetId(), TENANTS_SHEET, [
    id,
    email,
    (opts.name || "").trim(),
    opts.role || "member",
    opts.status || "active",
    (opts.spreadsheet_id || "").trim(),
    new Date().toISOString(),
    (opts.note || "").trim(),
  ]);
  invalidateTenantsCache();
  return { id };
}

/** 상태 변경 (active ↔ suspended). 행 위치는 A열 id로 찾는다. */
export async function updateTenantStatus(
  tenantId: string,
  status: "active" | "suspended",
): Promise<boolean> {
  const rows = await readRange(mainSheetId(), `${TENANTS_SHEET}!A:A`);
  // rows[0] = 헤더. id 매칭 행의 1-기반 시트 행 번호를 찾는다.
  const idx = rows.findIndex((r) => (r?.[0] ?? "").trim() === tenantId);
  if (idx < 1) return false;
  await updateCell(mainSheetId(), `${TENANTS_SHEET}!E${idx + 1}`, status);
  invalidateTenantsCache();
  return true;
}
