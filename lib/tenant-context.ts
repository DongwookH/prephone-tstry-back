import { auth } from "@/auth";
import { mainSheetId } from "./sheets";
import { getTenantByEmail, isAdminEmail } from "./tenants";

/**
 * 뷰어(로그인 사용자) → 테넌트 컨텍스트 해석.
 *
 * - 오너(관리자): 메인 시트 그대로 (기존 백오피스 동작 무변경)
 * - 멤버: 본인 전용 시트 — 화면·액션이 이 sheetId로 스코프되어야 한다
 * - 멤버인데 시트 미발급: sheetId="" → 페이지는 "시트 발급 대기" 빈 상태 표시
 *
 * ⚠️ 서버 컴포넌트/서버 액션 전용 (auth() 사용). 클라이언트 import 금지.
 */

export type ViewerContext = {
  email: string;
  /** 오너/관리자 여부 — true면 기존(메인 시트) 백오피스 그대로 */
  isOwner: boolean;
  /** 이 뷰어의 데이터 시트 ID. 멤버인데 미발급이면 "" */
  sheetId: string;
  tenantId?: string;
  tenantName?: string;
};

export async function getViewerContext(): Promise<ViewerContext | null> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return null;

  if (await isAdminEmail(email)) {
    return { email, isOwner: true, sheetId: mainSheetId() };
  }

  const tenant = await getTenantByEmail(email);
  if (tenant && tenant.status === "active") {
    return {
      email,
      isOwner: false,
      sheetId: tenant.spreadsheet_id || "",
      tenantId: tenant.id,
      tenantName: tenant.name,
    };
  }

  // 화이트리스트는 통과했는데 테넌트 행이 없는 예외 상태 —
  // 안전하게 "시트 없음" 멤버로 취급 (오너 데이터 노출 금지)
  return { email, isOwner: false, sheetId: "" };
}
