import NextAuth, { type DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";
import type { JWT } from "next-auth/jwt";

const allowlist = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const GA_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

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
          // GA Data API 읽기 + offline access (refresh token 발급용)
          scope: `openid email profile ${GA_SCOPE}`,
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
      if (allowlist.length === 0) return true;
      return allowlist.includes(email);
    },
    async jwt({ token, account }) {
      // 최초 로그인 — account 정보로 토큰 채우기
      if (account) {
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
