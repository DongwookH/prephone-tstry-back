import { ShieldCheck } from "lucide-react";
import { signIn } from "@/auth";

export default function LoginPage() {
  async function loginWithGoogle() {
    "use server";
    await signIn("google", { redirectTo: "/" });
  }

  return (
    <main className="min-h-screen bg-ink-50 flex items-center justify-center px-6">
      <div className="w-full max-w-[440px] animate-fade-up">
        <div className="flex flex-col items-center mb-12">
          <div className="w-16 h-16 rounded-3xl bg-brand-500 flex items-center justify-center shadow-press">
            <svg width={30} height={30} viewBox="0 0 24 24" fill="none">
              <path
                d="M4 7C4 5.34 5.34 4 7 4H17C18.66 4 20 5.34 20 7V17C20 18.66 18.66 20 17 20H7C5.34 20 4 18.66 4 17V7Z"
                stroke="white"
                strokeWidth="2"
              />
              <path
                d="M8 9H16M8 13H16M8 17H12"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <span className="mt-4 text-[13px] font-semibold text-ink-500 tracking-wider">
            TISTORY AUTO
          </span>
        </div>

        <div className="bg-white rounded-3xl shadow-card p-10">
          <h1 className="text-[26px] font-extrabold leading-tight text-ink-900">
            티스토리 자동화 백오피스
          </h1>
          <p className="mt-3 text-[15px] text-ink-600 leading-relaxed">
            매일 오전 9시,
            <br />
            AI가 만든 글 10개를 만나보세요.
          </p>

          <form action={loginWithGoogle}>
            <button
              type="submit"
              className="mt-9 w-full h-[58px] rounded-2xl border border-ink-200 bg-white hover:bg-ink-50 active:bg-ink-100 transition flex items-center justify-center gap-3 font-semibold text-ink-800"
            >
              <svg width={22} height={22} viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              <span className="text-[16px]">Google 계정으로 로그인</span>
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-ink-100">
            <div className="flex items-start gap-2.5">
              <ShieldCheck
                size={16}
                strokeWidth={1.8}
                className="mt-0.5 flex-shrink-0 text-ink-500"
              />
              <div>
                <p className="text-[13px] font-semibold text-ink-700">
                  허용된 이메일만 접근 가능합니다.
                </p>
                <p className="text-[12px] text-ink-500 mt-0.5 leading-relaxed">
                  사전에 등록되지 않은 계정은 로그인이 차단됩니다.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 flex items-center justify-center gap-3 text-[12px] text-ink-400">
          <span>© 2026 Tistory Auto</span>
          <span className="w-1 h-1 rounded-full bg-ink-300"></span>
          <a href="#" className="hover:text-ink-600 transition">
            도움말
          </a>
        </div>
      </div>
    </main>
  );
}
