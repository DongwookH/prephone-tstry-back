"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  PlugZap,
  Send,
  Unplug,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  disconnectThreadsAction,
  testPostThreadsAction,
} from "@/app/(dashboard)/settings/actions";

export type ThreadsCardData =
  | {
      connected: true;
      userId: string;
      expiresAt: string;
      refreshedAt: string;
      daysLeft: number;
    }
  | {
      connected: false;
      envReady: boolean;
    };

export function ThreadsCard({ data }: { data: ThreadsCardData }) {
  const router = useRouter();
  const params = useSearchParams();
  const callbackStatus = params.get("threads");
  const callbackReason = params.get("reason") || params.get("msg") || "";

  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  const handleDisconnect = () => {
    if (!confirm("Threads 연결을 해제할까요? (Meta 측 권한은 별도로 취소해야 함)"))
      return;
    start(async () => {
      const res = await disconnectThreadsAction();
      if (res.ok) {
        setMsg({ kind: "ok", text: "연결이 해제되었습니다" });
        router.refresh();
      } else {
        setMsg({ kind: "err", text: res.error });
      }
    });
  };

  const handleTestPost = () => {
    start(async () => {
      const res = await testPostThreadsAction();
      if (res.ok) {
        setMsg({
          kind: "ok",
          text: `테스트 글 발행 완료 — id: ${res.id}`,
        });
      } else {
        setMsg({ kind: "err", text: res.error });
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* OAuth 콜백 배너 */}
      {callbackStatus && <CallbackBanner status={callbackStatus} reason={callbackReason} />}

      {/* 인라인 액션 결과 메시지 */}
      {msg && (
        <div
          className={cn(
            "px-3 py-2 rounded-lg text-[12px] font-bold flex items-center gap-2",
            msg.kind === "ok"
              ? "bg-mint-50 text-mint-700"
              : "bg-rose-50 text-rose-700",
          )}
        >
          {msg.kind === "ok" ? (
            <CheckCircle2 size={13} strokeWidth={3} />
          ) : (
            <XCircle size={13} strokeWidth={3} />
          )}
          {msg.text}
        </div>
      )}

      {data.connected ? (
        <ConnectedView data={data} pending={pending} onDisconnect={handleDisconnect} onTestPost={handleTestPost} />
      ) : (
        <DisconnectedView envReady={data.envReady} />
      )}
    </div>
  );
}

function CallbackBanner({ status, reason }: { status: string; reason: string }) {
  const map: Record<string, { kind: "ok" | "err"; text: string }> = {
    connected: { kind: "ok", text: "Threads 계정이 연결되었습니다!" },
    denied: {
      kind: "err",
      text: `사용자가 인증을 거부했습니다${reason ? ` (${reason})` : ""}`,
    },
    "missing-params": {
      kind: "err",
      text: "콜백 파라미터 누락 — Meta 앱 설정의 redirect URI를 확인하세요",
    },
    "state-mismatch": {
      kind: "err",
      text: "CSRF state 검증 실패 — 다시 시도해주세요",
    },
    error: {
      kind: "err",
      text: `토큰 교환 실패${reason ? `: ${reason}` : ""}`,
    },
  };
  const info = map[status];
  if (!info) return null;
  return (
    <div
      className={cn(
        "px-4 py-3 rounded-xl text-[13px] font-bold flex items-center gap-2",
        info.kind === "ok"
          ? "bg-mint-50 text-mint-700 border border-mint-200"
          : "bg-rose-50 text-rose-700 border border-rose-200",
      )}
    >
      {info.kind === "ok" ? (
        <CheckCircle2 size={15} strokeWidth={3} />
      ) : (
        <XCircle size={15} strokeWidth={3} />
      )}
      {info.text}
    </div>
  );
}

function ConnectedView({
  data,
  pending,
  onDisconnect,
  onTestPost,
}: {
  data: Extract<ThreadsCardData, { connected: true }>;
  pending: boolean;
  onDisconnect: () => void;
  onTestPost: () => void;
}) {
  const expiringSoon = data.daysLeft < 7;
  return (
    <>
      <div className="flex items-center gap-4 p-3 bg-ink-50 rounded-xl">
        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#000] to-[#333] flex items-center justify-center text-white">
          <ThreadsLogo size={26} />
        </div>
        <div className="flex-1">
          <div className="text-[15px] font-extrabold text-ink-900">
            User ID: {data.userId}
          </div>
          <div className="text-[12px] text-ink-600 font-semibold">
            연결됨 · 토큰 만료까지{" "}
            <span
              className={expiringSoon ? "text-rose-600" : "text-mint-700"}
            >
              D-{data.daysLeft}
            </span>{" "}
            ({new Date(data.expiresAt).toLocaleDateString("ko-KR")})
          </div>
          <div className="flex items-center gap-1.5 mt-1.5">
            <CheckCircle2 size={11} className="text-mint-600" />
            <span className="text-[11px] font-bold text-mint-700">
              Threads API 인증 활성
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onTestPost}
          disabled={pending}
          className="h-10 px-4 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-[12px] font-bold flex items-center gap-1.5 transition"
        >
          {pending ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Send size={13} />
          )}
          테스트 글 발행
        </button>
        <a
          href={`https://www.threads.net/@${data.userId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="h-10 px-4 rounded-xl border border-ink-200 hover:bg-ink-50 text-ink-700 text-[12px] font-bold flex items-center gap-1.5 transition"
        >
          내 Threads 열기 <ExternalLink size={11} />
        </a>
        <button
          type="button"
          onClick={onDisconnect}
          disabled={pending}
          className="h-10 px-4 rounded-xl border border-rose-200 hover:bg-rose-50 text-rose-600 text-[12px] font-bold flex items-center gap-1.5 transition ml-auto disabled:opacity-50"
        >
          <Unplug size={13} />
          연결 해제
        </button>
      </div>

      {expiringSoon && (
        <div className="bg-rose-50/70 rounded-xl p-3 text-[11px] text-rose-800 leading-relaxed">
          <strong>⚠️ 토큰 만료 임박:</strong> 7일 이내 만료됩니다. 만료 전
          재연결하지 않으면 자동 포스팅이 중단됩니다. "연결 해제" 후 다시 "Threads
          연결"을 클릭하세요.
        </div>
      )}
    </>
  );
}

function DisconnectedView({ envReady }: { envReady: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="p-4 bg-ink-50 rounded-xl flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-ink-200 flex items-center justify-center text-ink-500">
          <ThreadsLogo size={22} />
        </div>
        <div className="flex-1">
          <div className="text-[13px] font-extrabold text-ink-700">
            Threads 미연결
          </div>
          <div className="text-[11px] text-ink-500 mt-0.5">
            연결하면 글 발행 후 자동으로 Threads에 공유할 수 있습니다.
          </div>
        </div>
      </div>

      {!envReady ? (
        <div className="bg-rose-50/70 rounded-xl p-3 text-[12px] text-rose-800 leading-relaxed">
          <strong>⚠️ 환경변수 미설정:</strong> Vercel에{" "}
          <code className="bg-white px-1.5 py-0.5 rounded">THREADS_APP_ID</code>,
          <code className="bg-white px-1.5 py-0.5 rounded ml-1">THREADS_APP_SECRET</code>,
          <code className="bg-white px-1.5 py-0.5 rounded ml-1">THREADS_REDIRECT_URI</code>
          를 등록한 후 재배포하세요.
        </div>
      ) : (
        <a
          href="/api/threads/connect"
          className="h-12 px-5 rounded-xl bg-gradient-to-br from-[#000] to-[#222] hover:from-[#111] hover:to-[#333] text-white text-[14px] font-extrabold flex items-center justify-center gap-2 transition shadow-press"
        >
          <PlugZap size={16} />
          Threads 연결
        </a>
      )}
    </div>
  );
}

function ThreadsLogo({ size = 24 }: { size?: number }) {
  // 단순한 Threads 로고 모티프 (@ 기호 변형)
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 22C7.03 22 3 17.97 3 13s4.03-9 9-9 9 4.03 9 9c0 3.5-2.5 6-5 6-1.5 0-2.5-1-2.5-2.5V12c0-1.5-1-2.5-2.5-2.5S8.5 10.5 8.5 12s1 2.5 2.5 2.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
