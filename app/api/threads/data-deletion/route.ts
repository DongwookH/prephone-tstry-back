import { NextResponse } from "next/server";
import { createHmac, randomBytes } from "crypto";
import { disableThreadsToken } from "@/lib/threads";

export const dynamic = "force-dynamic";

/**
 * POST /api/threads/data-deletion
 *
 * Meta가 사용자 데이터 삭제 요청 시 호출. signed_request 검증 후
 * 1) 시트에서 해당 user_id 토큰 비활성화 (실제 삭제는 아니지만 사용 중단)
 * 2) Meta가 요구하는 응답 형식 반환:
 *    { "url": "<삭제 진행 상태 확인 URL>", "confirmation_code": "<unique code>" }
 *
 * 명세: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 */
export async function POST(req: Request) {
  const base =
    process.env.NEXTAUTH_URL ||
    "https://prephone-tstry-back.vercel.app";

  try {
    const form = await req.formData();
    const signed = form.get("signed_request");
    if (typeof signed !== "string") {
      // 그래도 응답 형식은 맞춰서 반환 (Meta 요구사항)
      return jsonDeletionResponse(base, generateConfirmationCode());
    }

    const payload = parseSignedRequest(signed);
    const userId =
      payload && typeof payload.user_id === "string" ? payload.user_id : null;
    const confirmationCode = generateConfirmationCode();

    if (userId) {
      try {
        await disableThreadsToken(userId);
        console.info(
          `[Threads data-deletion] user_id ${userId} 토큰 비활성화 (확인 코드: ${confirmationCode})`,
        );
      } catch (err) {
        console.warn("[Threads data-deletion] 비활성화 실패:", err);
      }
    }

    return jsonDeletionResponse(base, confirmationCode);
  } catch (err) {
    console.warn("[Threads data-deletion] 처리 실패:", err);
    return jsonDeletionResponse(base, generateConfirmationCode());
  }
}

function generateConfirmationCode(): string {
  return `tt-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

function jsonDeletionResponse(base: string, code: string) {
  return NextResponse.json({
    url: `${base}/api/threads/data-deletion/status?code=${code}`,
    confirmation_code: code,
  });
}

// === signed_request 검증 (deauthorize와 동일) ===
function parseSignedRequest(
  signed: string,
): { user_id?: string; algorithm?: string } | null {
  const secret = process.env.THREADS_APP_SECRET;
  if (!secret) return null;
  const [encSig, encPayload] = signed.split(".");
  if (!encSig || !encPayload) return null;
  const base64UrlDecode = (s: string) =>
    Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const sig = base64UrlDecode(encSig);
  const data = base64UrlDecode(encPayload);
  const expected = createHmac("sha256", secret).update(encPayload).digest();
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) {
    return null;
  }
  try {
    return JSON.parse(data.toString("utf8"));
  } catch {
    return null;
  }
}

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
