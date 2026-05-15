import { Topbar } from "@/components/topbar";
import { auth } from "@/auth";
import { geminiKeyStatus } from "@/lib/gemini";
import {
  getGeminiKeysFromSheet,
  getGeminiUsage,
} from "@/lib/sheets";
import { GeminiKeyManager, type GeminiKeyItem } from "@/components/gemini-key-manager";
import { UsageChart } from "@/components/usage-chart";
import {
  Settings2,
  Shield,
  Clock,
  LineChart,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Users,
  KeyRound,
  Database,
} from "lucide-react";

export const dynamic = "force-dynamic";

function maskKeyPartial(key: string): string {
  if (key.length < 12) return "***";
  return `${key.slice(0, 8)}${"•".repeat(20)}${key.slice(-4)}`;
}

export default async function SettingsPage() {
  const session = await auth();
  const [keyStatus, sheetKeys, usage] = await Promise.all([
    geminiKeyStatus(),
    getGeminiKeysFromSheet(),
    getGeminiUsage(14),
  ]);

  // 시트 키들을 상세 표시 + env 키들도 마스킹해서 표시
  const sheetKeyItems: GeminiKeyItem[] = sheetKeys.map((k) => ({
    id: k.id,
    masked: maskKeyPartial(k.value),
    label: k.label,
    createdAt: k.created_at,
    source: "sheet" as const,
    usage: parseInt(k.usage_count || "0", 10),
  }));

  // 시트 키가 없을 때만 env 키 표시 (실제 사용 중일 때)
  const envKeyItems: GeminiKeyItem[] =
    sheetKeys.length === 0
      ? keyStatus.keys.map((masked, i) => ({
          id: `env-${i}`,
          masked,
          label: "환경변수",
          createdAt: "",
          source: "env" as const,
          usage: 0,
        }))
      : [];
  const allKeyItems = [...sheetKeyItems, ...envKeyItems];

  // 사용량 차트 데이터 — 모델 합산
  const usageMap = new Map<
    string,
    { date: string; inputTokens: number; outputTokens: number; calls: number }
  >();
  for (const u of usage) {
    const cur = usageMap.get(u.date) ?? {
      date: u.date,
      inputTokens: 0,
      outputTokens: 0,
      calls: 0,
    };
    cur.inputTokens += parseInt(u.input_tokens || "0", 10);
    cur.outputTokens += parseInt(u.output_tokens || "0", 10);
    cur.calls += parseInt(u.calls || "0", 10);
    usageMap.set(u.date, cur);
  }
  const usageData = Array.from(usageMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  const totalCalls = usageData.reduce((a, d) => a + d.calls, 0);
  const totalIn = usageData.reduce((a, d) => a + d.inputTokens, 0);
  const totalOut = usageData.reduce((a, d) => a + d.outputTokens, 0);
  const totalTokens = totalIn + totalOut;

  // 오늘 사용량
  const todayKST = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const today = usageData.find((d) => d.date === todayKST) ?? {
    inputTokens: 0,
    outputTokens: 0,
    calls: 0,
  };
  const todayTotal = today.inputTokens + today.outputTokens;

  // Gemini 무료 한도 (gemini-2.5-flash-lite 기준 ~1500 RPD, 토큰 한도는 별도)
  // 일일 호출 한도 1500회 기준으로 표시 (정확한 수치는 모델마다 다름)
  const DAILY_CALL_LIMIT = 1500;
  const callsPct = Math.min((today.calls / DAILY_CALL_LIMIT) * 100, 100);

  const gaConnected =
    !!process.env.GA_PROPERTY_ID && !!session?.accessToken;

  return (
    <>
      <Topbar
        crumbs={[{ label: "워크스페이스" }, { label: "설정", bold: true }]}
      />
      <div className="px-8 py-8 max-w-[1400px] mx-auto grid grid-cols-[220px_1fr] gap-8">
        <aside>
          <h2 className="text-[20px] font-extrabold text-ink-900 mb-4">설정</h2>
          <nav className="flex flex-col gap-1">
            <NavItem href="#general" Icon={Settings2} label="일반" />
            <NavItem href="#account" Icon={Users} label="내 계정" />
            <NavItem href="#gemini" Icon={KeyRound} label="Gemini API" />
            <NavItem href="#usage" Icon={LineChart} label="API 사용량" />
            <NavItem href="#integrations" Icon={Shield} label="연동 상태" />
            <NavItem href="#schedule" Icon={Clock} label="자동 생성" />
          </nav>
        </aside>

        <div className="space-y-6 animate-fade-up">
          {/* ─── 일반 ─── */}
          <Card id="general" title="일반" desc="워크스페이스 기본 정보">
            <ReadField label="워크스페이스" value="앤텔레콤 안심개통" />
            <ReadField
              label="티스토리 블로그"
              value={process.env.TISTORY_BLOG_URL ?? "https://ntelecomsafe.tistory.com"}
              external
            />
            <ReadField
              label="메인 사이트"
              value="https://ntelecomsafe.com"
              external
            />
            <ReadField label="시간대" value="Asia/Seoul (KST · UTC+9)" />
          </Card>

          {/* ─── 내 계정 ─── */}
          <Card
            id="account"
            title="내 계정"
            desc="현재 로그인된 Google 계정 정보"
          >
            <div className="flex items-center gap-4 p-3 bg-ink-50 rounded-xl">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-[20px] overflow-hidden">
                {session?.user?.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={session.user.image}
                    alt={session.user.name ?? ""}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  (session?.user?.name ?? "U").charAt(0).toUpperCase()
                )}
              </div>
              <div className="flex-1">
                <div className="text-[15px] font-extrabold text-ink-900">
                  {session?.user?.name ?? "—"}
                </div>
                <div className="text-[12px] text-ink-600 font-semibold">
                  {session?.user?.email ?? "—"}
                </div>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <CheckCircle2 size={11} className="text-mint-600" />
                  <span className="text-[11px] font-bold text-mint-700">
                    Google OAuth 로그인 중
                  </span>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-ink-500 leading-relaxed">
              화이트리스트는 Vercel <code className="bg-ink-100 px-1.5 py-0.5 rounded">ALLOWED_EMAILS</code> env로 관리됩니다.
              사이드바 좌측 하단 프로필 아이콘 → 로그아웃.
            </p>
          </Card>

          {/* ─── Gemini API 키 관리 ─── */}
          <Card
            id="gemini"
            title="Gemini API"
            desc={`글 자동 생성 모델 — 현재 ${keyStatus.model} · 키 ${keyStatus.count}개 활성`}
          >
            <GeminiKeyManager
              keys={allKeyItems}
              envCount={keyStatus.envCount}
            />
            <div className="bg-amber-50/60 rounded-xl p-3 text-[11px] text-amber-800 leading-relaxed">
              <strong>💡 키 변경 즉시 반영:</strong> 시트에 키를 추가/삭제하면
              다음 API 호출부터 자동 적용됩니다 (재배포 불필요, 60초 캐시).
              GitHub Actions cron은 영향 없음 — Vercel runtime이 키를 읽기 때문에.
            </div>
          </Card>

          {/* ─── API 사용량 ─── */}
          <Card
            id="usage"
            title="API 사용량"
            desc={`최근 ${usageData.length || 14}일 Gemini 토큰 사용량 — 매 호출마다 자동 누적`}
          >
            <div className="grid grid-cols-4 gap-3 mb-5">
              <MiniKPI
                label="오늘 호출"
                value={today.calls.toLocaleString()}
                sub={`/ ${DAILY_CALL_LIMIT} (무료 한도)`}
                pct={callsPct}
              />
              <MiniKPI
                label="오늘 토큰"
                value={todayTotal.toLocaleString()}
                sub={`입력 ${today.inputTokens.toLocaleString()}`}
              />
              <MiniKPI
                label="누적 호출"
                value={totalCalls.toLocaleString()}
                sub={`${usageData.length}일`}
              />
              <MiniKPI
                label="누적 토큰"
                value={
                  totalTokens >= 1_000_000
                    ? `${(totalTokens / 1_000_000).toFixed(1)}M`
                    : totalTokens >= 1000
                      ? `${(totalTokens / 1000).toFixed(1)}K`
                      : totalTokens.toString()
                }
                sub={`출력 ${(totalOut / Math.max(totalIn + totalOut, 1) * 100).toFixed(0)}%`}
              />
            </div>
            <div className="flex items-center gap-4 mb-3 text-[11px] font-bold text-ink-700">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-[#A8D533]"></span>
                입력 토큰
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-[#7FA512]"></span>
                출력 토큰
              </span>
            </div>
            <UsageChart data={usageData} />
            <div className="text-[11px] text-ink-500 mt-3 leading-relaxed">
              ※ Gemini API 무료 한도는 모델·계정에 따라 다릅니다. 위 한도(1500
              호출/일)는 <code className="bg-ink-100 px-1.5 py-0.5 rounded">gemini-2.5-flash-lite</code> 기준 추정치.
              실제 한도는{" "}
              <a
                href="https://ai.google.dev/pricing"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 font-bold hover:underline"
              >
                Google AI Studio
              </a>
              에서 확인.
            </div>
          </Card>

          {/* ─── 연동 상태 ─── */}
          <Card
            id="integrations"
            title="연동 상태"
            desc="외부 서비스 연결 상태. 키는 마스킹되어 표시됩니다."
          >
            <div className="grid grid-cols-2 gap-3">
              <IntegrationRow
                Icon={Database}
                name="Google Sheets"
                status="connected"
                detail={`${process.env.GOOGLE_SHEETS_CLIENT_EMAIL?.split("@")[0] ?? "service-account"}@…`}
              />
              <IntegrationRow
                Icon={KeyRound}
                name="Gemini API"
                status={keyStatus.count > 0 ? "connected" : "missing"}
                detail={`${keyStatus.count}개 키 · ${keyStatus.source === "sheet" ? "시트" : "env"} 소스`}
              />
              <IntegrationRow
                Icon={LineChart}
                name="Google Analytics 4"
                status={gaConnected ? "connected" : "pending"}
                detail={
                  gaConnected
                    ? `Property ${process.env.GA_PROPERTY_ID} · ${process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? ""}`
                    : process.env.GA_PROPERTY_ID
                      ? "재로그인 필요 (analytics scope)"
                      : "GA_PROPERTY_ID 미설정"
                }
                actionHref={
                  gaConnected ? "https://analytics.google.com" : "/analytics"
                }
                actionLabel={gaConnected ? "GA 열기" : "분석 페이지"}
              />
              <IntegrationRow
                Icon={Shield}
                name="Naver Search Ads"
                status={
                  process.env.NAVER_AD_API_KEY ? "connected" : "missing"
                }
                detail={
                  process.env.NAVER_AD_CUSTOMER_ID
                    ? `Customer ${process.env.NAVER_AD_CUSTOMER_ID}`
                    : "키 없음"
                }
              />
            </div>
          </Card>

          {/* ─── 자동 생성 (cron) ─── */}
          <Card
            id="schedule"
            title="자동 생성"
            desc="매일 KST 09:00에 GitHub Actions가 자동으로 10편 생성"
          >
            <ReadField label="실행 시간" value="매일 09:00 KST (UTC 00:00)" />
            <ReadField label="생성 개수" value="10편 (Track 1 사용자 키워드 5 + Track 2 GSG 발굴 5)" />
            <ReadField
              label="워크플로우"
              value="https://github.com/DongwookH/prephone-tstry-back/actions"
              external
            />
            <p className="text-[11px] text-ink-500 leading-relaxed">
              ※ 시간/개수 변경은 <code className="bg-ink-100 px-1.5 py-0.5 rounded">.github/workflows/generate-posts.yml</code>의 cron + matrix slot 수정.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

// ─── 컴포넌트 ─────────────────────────────────

function NavItem({
  href,
  Icon,
  label,
}: {
  href: string;
  Icon: React.ElementType;
  label: string;
}) {
  return (
    <a
      href={href}
      className="px-3 py-2.5 rounded-xl text-ink-700 hover:bg-ink-100 transition text-[13px] font-bold flex items-center gap-2"
    >
      <Icon size={14} strokeWidth={2} />
      {label}
    </a>
  );
}

function Card({
  id,
  title,
  desc,
  children,
}: {
  id: string;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="bg-white rounded-2xl shadow-card p-6 scroll-mt-24"
    >
      <h3 className="text-[16px] font-extrabold text-ink-900">{title}</h3>
      <p className="text-[12px] text-ink-500 mb-5 mt-1">{desc}</p>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function ReadField({
  label,
  value,
  external,
}: {
  label: string;
  value: string;
  external?: boolean;
}) {
  return (
    <div className="grid grid-cols-[160px_1fr] items-center gap-4">
      <label className="text-[13px] font-bold text-ink-700">{label}</label>
      <div className="h-11 px-3 rounded-xl border border-ink-200 bg-ink-50 text-[13px] font-medium text-ink-700 flex items-center justify-between gap-2">
        <span className="truncate">{value}</span>
        {external && value.startsWith("http") && (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 text-ink-500 hover:text-brand-600"
          >
            <ExternalLink size={13} />
          </a>
        )}
      </div>
    </div>
  );
}

function MiniKPI({
  label,
  value,
  sub,
  pct,
}: {
  label: string;
  value: string;
  sub: string;
  pct?: number;
}) {
  return (
    <div className="rounded-xl border border-ink-200 p-3">
      <div className="text-[10px] font-bold text-ink-500 tracking-wider mb-1">
        {label}
      </div>
      <div className="text-[18px] font-extrabold tabular-nums text-ink-900">
        {value}
      </div>
      <div className="text-[10px] font-bold text-ink-500 mt-0.5">{sub}</div>
      {pct !== undefined && (
        <div className="h-1.5 bg-ink-100 rounded-full mt-2 overflow-hidden">
          <div
            className={
              pct > 80
                ? "h-full bg-rose-500 rounded-full"
                : pct > 50
                  ? "h-full bg-amber-500 rounded-full"
                  : "h-full bg-mint-500 rounded-full"
            }
            style={{ width: `${pct}%` }}
          ></div>
        </div>
      )}
    </div>
  );
}

function IntegrationRow({
  Icon,
  name,
  status,
  detail,
  actionHref,
  actionLabel,
}: {
  Icon: React.ElementType;
  name: string;
  status: "connected" | "pending" | "missing";
  detail: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  const statusColor =
    status === "connected"
      ? "bg-mint-50 text-mint-700"
      : status === "pending"
        ? "bg-amber-50 text-amber-700"
        : "bg-rose-50 text-rose-700";
  const statusLabel =
    status === "connected" ? "연결됨" : status === "pending" ? "대기" : "미연결";
  return (
    <div className="rounded-xl border border-ink-200 p-3">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <Icon size={14} className="text-ink-700" />
          <span className="text-[13px] font-extrabold text-ink-900">
            {name}
          </span>
        </div>
        <span
          className={`text-[10px] font-bold ${statusColor} rounded-full px-2 py-0.5 flex items-center gap-1`}
        >
          {status === "connected" ? (
            <CheckCircle2 size={9} strokeWidth={3} />
          ) : (
            <XCircle size={9} strokeWidth={3} />
          )}
          {statusLabel}
        </span>
      </div>
      <div className="text-[11px] text-ink-600 font-medium truncate">
        {detail}
      </div>
      {actionHref && actionLabel && (
        <a
          href={actionHref}
          target={actionHref.startsWith("http") ? "_blank" : undefined}
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 mt-2 text-[11px] font-bold text-brand-600 hover:text-brand-700"
        >
          {actionLabel} <ExternalLink size={10} />
        </a>
      )}
    </div>
  );
}
