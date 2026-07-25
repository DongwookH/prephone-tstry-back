import NextAuth, { type DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";
import type { JWT } from "next-auth/jwt";

const allowlist = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const GA_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
// 테넌트 전용 시트를 "오너 소유"로 생성하기 위한 스코프 (이 앱이 만든 파일만 접근).
// 서비스 계정은 Drive 저장 용량이 0이라 파일 소유가 불가 → 오너 OAuth로 생성한다.
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

// JWT 타입 확장 — accessToken / refreshToken / expiresAt 보관
declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    error?: "RefreshAccessTokenError";
  }
}

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    error?: "RefreshAccessTokenError";
    user: {
      id?: string;
    } & DefaultSession["user"];
  }
}

/** Google OAuth refresh token으로 access token 갱신. */
async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    if (!token.refreshToken) {
      throw new Error("refresh_token 없음 — 재로그인 필요");
    }
    const url = "https://oauth2.googleapis.com/token";
    const params = new URLSearchParams({
      client_id: process.env.AUTH_GOOGLE_ID!,
      client_secret: process.env.AUTH_GOOGLE_SECRET!,
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
    });
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const refreshed = (await res.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
      scope?: string;
    };
    if (!res.ok) {
      throw new Error(
        `refresh failed: ${(refreshed as unknown as { error?: string }).error}`,
      );
    }
    return {
      ...token,
      accessToken: refreshed.access_token,
      expiresAt: Math.floor(Date.now() / 1000) + refreshed.expires_in,
      refreshToken: refreshed.refresh_token ?? token.refreshToken,
      error: undefined,
    };
  } catch (err) {
    console.error("[auth] refresh access token 실패:", err);
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      authorization: {
        params: {
          // GA Data API 읽기 + Drive(앱 생성 파일) + offline access (refresh token 발급용)
          scope: `openid email profile ${GA_SCOPE} ${DRIVE_FILE_SCOPE}`,
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async signIn({ profile }) {
      const email = profile?.email?.toLowerCase();
      if (!email) return false;
      // 1) env 화이트리스트 — 부트스트랩·시트 장애 폴백 (오너 잠금 방지, 항상 유효)
      if (allowlist.includes(email)) return true;
      // 2) tenants 시트 조회 — node 라우트에 위임 (edge 번들 제약: googleapis 직접 import 불가)
      try {
        const base =
          process.env.NEXTAUTH_URL ??
          process.env.PRODUCTION_URL ??
          "https://prephone-tstry-back.vercel.app";
        if (process.env.CRON_SECRET) {
          const res = await fetch(`${base}/api/cron/allowlist-check`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.CRON_SECRET}`,
            },
            body: JSON.stringify({ email }),
          });
          if (res.ok) {
            const j = (await res.json()) as { allowed?: boolean };
            if (j.allowed === true) return true;
          }
        }
      } catch (e) {
        console.error(
          "[auth] allowlist-check 위임 실패 — env 폴백만 적용:",
          e instanceof Error ? e.message : String(e),
        );
      }
      // 3) 시트에도 없음(또는 조회 불가) — env 화이트리스트가 비어있을 때만 전체 허용(구 동작 보존, dev 용)
      return allowlist.length === 0;
    },
    async jwt({ token, account }) {
      // 최초 로그인 — account 정보로 토큰 채우기
      if (account) {
        if (account.refresh_token) {
          // 크론용 영속화 — 시트 쓰기는 node 라우트에 위임.
          // ⚠️ 여기서 sheets(googleapis)를 import하면(dynamic이라도) middleware의
          //    edge 번들 그래프에 걸려 Vercel Edge 패키징이 배포를 거부한다
          //    (2026-07-10 실측: "unsupported modules: node:http…").
          //    fetch는 edge에서 안전하므로 자체 cron 라우트로 POST만 한다.
          try {
            const base =
              process.env.NEXTAUTH_URL ??
              process.env.PRODUCTION_URL ??
              "https://prephone-tstry-back.vercel.app";
            if (process.env.CRON_SECRET) {
              const res = await fetch(`${base}/api/cron/persist-ga-token`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${process.env.CRON_SECRET}`,
                },
                body: JSON.stringify({ refresh_token: account.refresh_token }),
              });
              if (!res.ok) {
                // 401=CRON_SECRET 불일치, 500=시트 쓰기 실패 — 무음이면 "재로그인 반복" 루프에 빠짐
                console.error(
                  `[auth] GA refresh token 저장 위임 실패: HTTP ${res.status}`,
                );
              }
            } else {
              console.error("[auth] CRON_SECRET 미설정 — GA refresh token 저장 스킵");
            }
          } catch (e) {
            console.error(
              "[auth] GA refresh token 저장 위임 실패 (로그인은 계속):",
              e instanceof Error ? e.message : String(e),
            );
          }
        }
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt:
            typeof account.expires_at === "number"
              ? account.expires_at
              : Math.floor(Date.now() / 1000) + 3600,
        };
      }
      // access token 아직 유효 (만료 1분 전까지)
      if (token.expiresAt && Date.now() < (token.expiresAt - 60) * 1000) {
        return token;
      }
      // 만료 → refresh
      return await refreshAccessToken(token);
    },
    async session({ session, token }) {
      if (token?.sub && session.user) {
        session.user.id = token.sub;
      }
      session.accessToken = token.accessToken;
      session.error = token.error;
      return session;
    },
  },
  session: { strategy: "jwt" },
  trustHost: true,
});
