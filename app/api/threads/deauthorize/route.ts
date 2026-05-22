import { NextResponse } from "next/server";
import { createHmac } from "crypto";
import { disableThreadsToken } from "@/lib/threads";

export const dynamic = "force-dynamic";

/**
 * POST /api/threads/deauthorize
 *
 * Meta가 사용자 권한 취소 시 ping. signed_request body 검증 후
 * settings 시트에서 해당 user_id 토큰을 비활성화.
 *
 * Meta 명세: https://developers.facebook.com/docs/threads/get-started/long-lived-tokens
 *
 * 응답은 200 OK + 빈 body. Meta는 응답 본문 검사 안 함.
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const signed = form.get("signed_request");
    if (typeof signed !== "string") {
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const payload = parseSignedRequest(signed);
    if (payload && typeof payload.user_id === "string") {
      try {
        await disableThreadsToken(payload.user_id);
        console.info(
          `[Threads deauthorize] user_id ${payload.user_id} 토큰 비활성화`,
        );
      } catch (err) {
        console.warn("[Threads deauthorize] 비활성화 실패:", err);
      }
    }
  } catch (err) {
    // Meta는 ping 실패해도 재시도 안 하므로 silent
    console.warn("[Threads deauthorize] 처리 실패:", err);
  }
  return NextResponse.json({ ok: true });
}

/**
 * Meta의 signed_request 형식: <signature>.<base64url(json)>
 * HMAC-SHA256 (key = APP_SECRET) 검증.
 */
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
