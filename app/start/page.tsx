import type { Metadata } from "next";
import type { ComponentType, ReactNode } from "react";
import { auth } from "@/auth";
import {
  LayoutDashboard,
  FileText,
  Search,
  BarChart3,
  Rss,
  MessageSquare,
  Settings,
  ArrowRight,
  ExternalLink,
  KeyRound,
  AlertTriangle,
  BookOpen,
  Sparkles,
  Clock,
  Mail,
  Lightbulb,
  ListChecks,
  ShieldCheck,
  LogIn,
  FileSpreadsheet,
  NotebookPen,
  CalendarCheck,
  Compass,
  HelpCircle,
} from "lucide-react";

export const metadata: Metadata = {
  title: "시작 가이드 · 블로그 자동화 백오피스",
  description:
    "처음 시작하는 분도 그대로 따라 하면 되는 블로그 자동화 백오피스 이용 안내입니다. 승인 요청부터 API 키 발급, 세부 가이드 작성, 매일 검수·발행까지 순서대로 설명합니다.",
};

/* ────────────────────────────────────────────
   데이터
──────────────────────────────────────────── */

const TOC_ITEMS = [
  { href: "#what-it-does", label: "이 서비스가 하는 일" },
  { href: "#checklist", label: "시작 전 준비물" },
  { href: "#security", label: "구글 2단계 인증 (필수)" },
  { href: "#step1", label: "STEP 1 · 이용 승인 받기" },
  { href: "#step2", label: "STEP 2 · API 키 발급 (Gemini · 이미지)" },
  { href: "#step3", label: "STEP 3 · 로그인 & 키 등록" },
  { href: "#step4", label: "STEP 4 · 내 데이터 시트 확인" },
  { href: "#step5", label: "STEP 5 · 내 가이드 작성" },
  { href: "#step6", label: "STEP 6 · 매일 하는 일" },
  { href: "#menu", label: "백오피스 메뉴 소개" },
  { href: "#faq", label: "자주 묻는 질문" },
];

const GEMINI_STEPS = [
  {
    title: "AI Studio 페이지 열기",
    desc: (
      <>
        새 탭을 열고{" "}
        <a
          href="https://aistudio.google.com/apikey"
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:text-brand-600 underline underline-offset-2"
        >
          aistudio.google.com/apikey
          <ExternalLink size={13} strokeWidth={2.2} />
        </a>{" "}
        주소로 접속합니다. 주소를 직접 입력하기 번거로우면 위 링크를 그대로 눌러도 됩니다.
      </>
    ),
  },
  {
    title: "구글 계정으로 로그인",
    desc: "백오피스에 사용할 예정인 구글 계정과 동일한 계정으로 로그인합니다. 이미 로그인되어 있다면 이 단계는 자동으로 건너뜁니다.",
  },
  {
    title: '"Create API key" 버튼 클릭',
    desc: (
      <>
        화면에 보이는 파란색(또는 남색) <code className="px-1 py-0.5 rounded bg-ink-100 text-[12.5px] font-mono text-ink-800">Create API key</code> 버튼을 누릅니다. 한글 화면에서는 <code className="px-1 py-0.5 rounded bg-ink-100 text-[12.5px] font-mono text-ink-800">API 키 만들기</code>로 표시될 수 있습니다.
      </>
    ),
  },
  {
    title: "프로젝트 선택 (처음이면 자동 생성)",
    desc: "기존에 만들어 둔 구글 클라우드 프로젝트가 있으면 목록에서 선택하고, 처음 사용하는 계정이라면 \"새 프로젝트에서 만들기\" 같은 항목이 자동으로 준비되어 있으니 그대로 눌러도 됩니다. 별도로 결제 정보를 입력하라는 요구는 없습니다.",
  },
  {
    title: "발급된 키 복사",
    desc: (
      <>
        키가 만들어지면 <code className="px-1 py-0.5 rounded bg-ink-100 text-[12.5px] font-mono text-ink-800">AIza...</code> 또는 <code className="px-1 py-0.5 rounded bg-ink-100 text-[12.5px] font-mono text-ink-800">AQ....</code>로 시작하는 긴 문자열이 화면에 나타납니다. 두 형식 모두 정상이니 나오는 그대로 쓰시면 됩니다. 옆에 있는 복사 아이콘을 눌러 전체를 복사합니다. 이 화면을 벗어나기 전에 꼭 복사해 두세요.
      </>
    ),
  },
  {
    title: "백오피스 설정 메뉴로 이동",
    desc: "복사한 키를 그대로 들고 백오피스로 돌아옵니다. 다음 STEP 3에서 이 키를 붙여넣는 방법을 이어서 안내합니다.",
  },
];

const NVIDIA_STEPS = [
  {
    title: "NVIDIA 빌드 사이트 열기",
    desc: (
      <>
        새 탭에서{" "}
        <a
          href="https://build.nvidia.com/settings/api-keys"
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:text-brand-600 underline underline-offset-2"
        >
          build.nvidia.com/settings/api-keys
          <ExternalLink size={13} strokeWidth={2.2} />
        </a>{" "}
        에 접속합니다. 화면이 영어로만 나오는데, 아래 순서대로 버튼만 누르면 됩니다.
      </>
    ),
  },
  {
    title: "계정 만들기 (처음이면)",
    desc: '오른쪽 위 "Login" 또는 "Sign Up"을 누르고 이메일로 가입합니다. 구글 계정으로도 가입할 수 있어 그 방법이 가장 빠릅니다. 가입 후 이메일로 온 인증 링크를 한 번 눌러야 다음 단계로 넘어갑니다.',
  },
  {
    title: '"Generate API Key" 버튼 클릭',
    desc: (
      <>
        API Keys 화면에서 초록색{" "}
        <code className="px-1 py-0.5 rounded bg-ink-100 text-[12.5px] font-mono text-ink-800">
          Generate API Key
        </code>{" "}
        버튼을 누릅니다. 이름을 물어보면 아무거나(예: blog) 적어도 됩니다.
      </>
    ),
  },
  {
    title: "키 복사 — 이 화면을 벗어나면 다시 못 봅니다",
    desc: (
      <>
        <code className="px-1 py-0.5 rounded bg-ink-100 text-[12.5px] font-mono text-ink-800">
          nvapi-
        </code>
        로 시작하는 긴 문자열이 나타납니다. 옆의 복사 버튼을 눌러 전체를 복사하세요.{" "}
        <strong className="font-bold text-ink-900">
          창을 닫으면 다시 확인할 수 없어
        </strong>{" "}
        새로 발급받아야 하니, 이 단계에서 꼭 복사해 두세요.
      </>
    ),
  },
  {
    title: "백오피스에 등록",
    desc: '백오피스 설정 화면 아래쪽 「이미지 생성 API」 칸에서 「키 추가」를 누르고 붙여넣은 뒤 저장합니다.',
  },
];

const SHEET_TABS = [
  {
    name: "posts",
    desc: "매일 자동으로 생성된 글이 여기에 쌓입니다. 백오피스 \"글 관리\" 화면에서 보는 목록과 같은 데이터입니다.",
  },
  {
    name: "keywords",
    desc: "글감이 되는 키워드를 모아두는 곳입니다. 여기에 키워드가 쌓여 있어야 AI가 어떤 주제로 글을 쓸지 정할 수 있습니다.",
  },
  {
    name: "settings",
    desc: "Gemini API 키 등 개인 설정 값이 저장되는 곳입니다. 보통 백오피스 화면에서 저장하면 이 탭에 자동 반영되므로, 직접 손댈 일은 거의 없습니다.",
  },
  {
    name: "guide",
    desc: "나만의 세부 가이드가 저장되는 탭입니다. 백오피스 「내 가이드」 화면에서 입력하면 이 탭에 자동 저장되므로 직접 손댈 일은 없습니다. STEP 5에서 자세히 설명합니다.",
  },
];

const GUIDE_SECTIONS = [
  {
    name: "판매점명",
    required: true,
    desc: "글에 표기할 상호/브랜드명을 한 줄로 적습니다. 예: \"홍길동텔레콤\". 글 속 소개 문장과 마무리 버튼 옆에 이 이름이 들어갑니다.",
    note: "비어 있으면 글이 생성되지 않습니다.",
  },
  {
    name: "개통 사이트 링크",
    required: true,
    desc: "손님이 신청하러 들어올 주소입니다. 글 맨 위 첫 번째 버튼이 됩니다. 사이트가 없으면 비워두고 카카오톡 채널만 넣어도 됩니다.",
    note: "카카오톡 채널과 둘 중 하나는 필수입니다.",
  },
  {
    name: "카카오톡 채널 링크",
    required: true,
    desc: "카카오톡 채널 관리자센터에서 채널 홈 URL을 복사해 붙여넣습니다. 글 맨 위 두 번째 버튼이 됩니다.",
    note: "개통 사이트와 둘 중 하나는 필수입니다.",
  },
  {
    name: "전화번호 · 영업시간",
    required: true,
    desc: "상담 전화번호와 영업시간을 적습니다. 적어둔 항목만 글의 회사 소개 문장으로 자동 조립됩니다.",
    note: "전화·영업시간·회사 소개 중 하나는 필수입니다.",
  },
  {
    name: "타깃 독자",
    required: false,
    desc: "이 글을 읽을 독자의 유형을 적습니다. 예를 들어 \"처음 알아보는 20대 사회초년생\", \"가격 비교 중인 자영업자\"처럼 적어두면 그 눈높이에 맞춰 글이 써집니다.",
    note: "비워두면 공통 기본값이 적용됩니다.",
  },
  {
    name: "쓰면 안 되는 말",
    required: false,
    desc: "글에 절대 쓰면 안 되는 단어를 콤마(,)로 구분해 나열합니다. 여기에 적은 단어는 공통 금지어 목록에 추가로 더해집니다.",
    note: "공통 금지어에 추가로 적용됩니다.",
  },
  {
    name: "추가 규칙",
    required: false,
    desc: "그 밖에 지켜야 할 나만의 자유 규칙을 문장으로 적습니다. 예: \"항상 존댓말로 쓴다\", \"이모지는 쓰지 않는다\" 등.",
    note: "공통 가이드와 내용이 겹치면 이 항목이 우선 적용됩니다.",
  },
  {
    name: "자주 받는 질문",
    required: false,
    desc: "고객에게 자주 받는 질문과 그에 대한 답변을 적어둡니다. AI가 글을 쓸 때 사실 근거로 활용합니다.",
    note: "적어둔 만큼 글의 정확도가 올라갑니다.",
  },
];

const WORKSPACE_ROWS = [
  { icon: LayoutDashboard, name: "대시보드", desc: "오늘 생성된 글과 발행 현황을 한눈에 확인합니다." },
  { icon: FileText, name: "글 관리", desc: "생성된 글을 검수하고 내용을 복사해 발행합니다." },
  { icon: NotebookPen, name: "내 가이드", desc: "판매점명·링크·연락처 등 내 정보를 입력합니다. 여기를 채워야 글이 생성됩니다." },
  { icon: Search, name: "키워드", desc: "어떤 주제로 글을 쓸지 글감 키워드를 등록합니다." },
  { icon: BarChart3, name: "분석", desc: "GA4 연동 시 글별 유입·클릭 성과를 확인합니다." },
  { icon: Rss, name: "Threads", desc: "블로그 글을 스레드 콘텐츠로 자동 발행합니다." },
  { icon: MessageSquare, name: "챗봇 질문", desc: "사이트에 방문한 사용자의 챗봇 질문 로그를 확인합니다." },
  { icon: Settings, name: "설정", desc: "Gemini API 키를 등록하고 사용량을 확인합니다." },
];

const FAQS = [
  {
    q: "이용에 비용이 드나요?",
    a: "Gemini API는 무료 티어로도 하루치 글 생성에 충분한 사용량을 제공합니다. 신용카드를 등록하지 않아도 발급·사용이 가능하고, 각자 본인의 키로 본인 사용량만 쓰는 구조이기 때문에 백오피스 이용 자체에는 별도 비용이 들지 않습니다.",
  },
  {
    q: "글은 정확히 몇 시에 생성되나요?",
    a: "매일 정해진 시각에 자동으로 새 글이 만들어집니다. 정확한 생성 시각은 운영 상황에 따라 조정될 수 있어, 가장 확실한 방법은 아침에 대시보드에 접속해 \"오늘 생성된 글\"이 올라와 있는지 확인하는 것입니다.",
  },
  {
    q: "이용 승인은 얼마나 걸리나요?",
    a: "관리자에게 구글 이메일을 전달하면 보통 빠르게 처리됩니다. 다만 정확한 소요 시간을 못박아 안내하기는 어려우니, 급하게 필요하다면 이메일 전달 시 함께 알려주세요.",
  },
  {
    q: "API 키가 유출된 것 같아요. 어떻게 하나요?",
    a: "당황하지 말고 Google AI Studio(aistudio.google.com/apikey)에서 해당 키를 즉시 삭제한 뒤, 새 키를 발급받아 백오피스 설정 메뉴에 다시 등록하세요. 키를 삭제하는 순간 기존 키는 더 이상 작동하지 않습니다.",
  },
  {
    q: "블로그는 몇 개까지 연결할 수 있나요?",
    a: "계정당 최대 5개의 티스토리 블로그를 연결해 운영할 수 있습니다.",
  },
  {
    q: "생성된 글을 그대로 쓰지 않고 수정해서 발행해도 되나요?",
    a: "네, 얼마든지 자유롭게 수정하셔도 됩니다. AI가 만든 글은 초안에 가깝기 때문에, 내 상황에 맞게 문장을 다듬거나 정보를 보완한 뒤 발행하는 것을 권장합니다.",
  },
  {
    q: "로그인은 되는데 글이 하나도 생성되지 않아요. 뭘 확인해야 하나요?",
    a: "가장 흔한 원인 세 가지를 순서대로 확인해 보세요. 첫째, 설정 메뉴에 Gemini API 키가 정상적으로 등록되어 있는지 확인합니다. 둘째, 왼쪽 메뉴 「내 가이드」에 들어가 진행률이 3/3인지 확인합니다. 셋째, 「키워드」 화면에 글감이 하나라도 등록돼 있는지 확인합니다. 셋 중 하나라도 비어 있으면 그날 글 생성은 건너뜁니다. 대시보드 위쪽에도 무엇이 비었는지 안내가 표시됩니다.",
  },
  {
    q: "구글 계정을 여러 개 쓰는데 아무 계정으로나 로그인해도 되나요?",
    a: "안 됩니다. 관리자에게 전달해 승인받은 바로 그 구글 이메일로만 로그인할 수 있습니다. 다른 계정으로 로그인을 시도하면 접근이 차단됩니다.",
  },
  {
    q: "구글 2단계 인증을 꼭 켜야 하나요?",
    a: "네, 필수입니다. 백오피스·데이터 시트·API 키가 전부 구글 계정 하나에 연결되기 때문에, 계정이 뚫리면 전부 함께 노출됩니다. 위 SECURITY 섹션의 5단계를 따라 켠 뒤(5분 소요) 관리자에게 승인을 요청해 주세요. 이미 켜져 있다면 추가로 할 일은 없습니다.",
  },
];

/* ────────────────────────────────────────────
   재사용 컴포넌트
──────────────────────────────────────────── */

function Callout({
  type,
  children,
}: {
  type: "info" | "warning";
  children: ReactNode;
}) {
  const isWarning = type === "warning";
  return (
    <div
      className={
        "my-5 rounded-2xl p-4 sm:p-5 flex items-start gap-3 " +
        (isWarning ? "bg-amber-50" : "bg-brand-50")
      }
    >
      {isWarning ? (
        <AlertTriangle
          size={18}
          strokeWidth={2}
          className="mt-0.5 flex-shrink-0 text-amber-700"
        />
      ) : (
        <Lightbulb
          size={18}
          strokeWidth={2}
          className="mt-0.5 flex-shrink-0 text-brand-700"
        />
      )}
      <div
        className={
          "text-[13.5px] leading-relaxed [&_strong]:font-bold " +
          (isWarning ? "text-amber-800" : "text-ink-700")
        }
      >
        {children}
      </div>
    </div>
  );
}

function Toggle({
  summary,
  children,
}: {
  summary: string;
  children: ReactNode;
}) {
  return (
    <details className="group my-5 rounded-2xl border border-ink-200 bg-white overflow-hidden">
      <summary className="flex items-center justify-between gap-3 cursor-pointer list-none px-4 sm:px-5 py-3.5 select-none">
        <span className="text-[13.5px] font-bold text-ink-800">
          {summary}
        </span>
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-ink-100 flex items-center justify-center text-ink-600 text-[13px] font-bold group-open:rotate-45 transition-transform">
          +
        </span>
      </summary>
      <div className="px-4 sm:px-5 pb-4.5 -mt-1 text-[13.5px] text-ink-600 leading-relaxed">
        {children}
      </div>
    </details>
  );
}

function DocH2({
  id,
  eyebrow,
  icon: Icon,
  title,
  desc,
}: {
  id: string;
  eyebrow: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  title: string;
  desc?: string;
}) {
  return (
    <div id={id} className="scroll-mt-24 mb-5">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-ink-100 flex items-center justify-center flex-shrink-0">
          <Icon size={14} strokeWidth={2.2} className="text-ink-700" />
        </div>
        <span className="text-[11.5px] font-bold text-ink-400 tracking-wider">
          {eyebrow}
        </span>
      </div>
      <h2 className="mt-2.5 text-[21px] sm:text-[24px] font-extrabold text-ink-900 leading-tight tracking-tight">
        {title}
      </h2>
      {desc && (
        <p className="mt-2 text-[14px] text-ink-600 leading-relaxed">
          {desc}
        </p>
      )}
    </div>
  );
}

function OrderedMini({
  items,
}: {
  items: { title: ReactNode; desc: ReactNode }[];
}) {
  return (
    <ol className="space-y-4">
      {items.map((step, i) => (
        <li key={i} className="flex gap-3.5">
          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-ink-100 text-ink-700 flex items-center justify-center text-[11.5px] font-extrabold mt-0.5">
            {i + 1}
          </div>
          <div>
            <p className="text-[13.5px] font-bold text-ink-900">
              {step.title}
            </p>
            <p className="mt-0.5 text-[13.5px] text-ink-600 leading-relaxed">
              {step.desc}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ────────────────────────────────────────────
   페이지
──────────────────────────────────────────── */

export default async function StartPage() {
  const session = await auth();
  const ctaHref = session ? "/" : "/login";
  const ctaLabel = session ? "대시보드로 이동" : "로그인하러 가기";

  return (
    <main className="min-h-screen bg-ink-50">
      {/* 상단 스티키 바 */}
      <header className="sticky top-0 z-20 bg-ink-50/80 backdrop-blur-xl border-b border-ink-100">
        <div className="max-w-[1040px] mx-auto px-5 sm:px-8 h-[56px] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-brand-500 flex items-center justify-center">
              <Sparkles size={14} color="white" strokeWidth={2.2} />
            </div>
            <span className="text-[13px] font-extrabold text-ink-900 tracking-wide">
              블로그 자동화 백오피스
            </span>
          </div>
          <a
            href={ctaHref}
            className="h-8 px-3.5 rounded-lg bg-ink-900 text-white text-[12.5px] font-bold flex items-center hover:bg-ink-800 transition"
          >
            {ctaLabel}
          </a>
        </div>
      </header>

      {/* 본문: 좁은 문서 칼럼 + 데스크톱 사이드 목차 */}
      <div className="max-w-[1040px] mx-auto px-5 sm:px-8 pt-10 sm:pt-14 pb-24 lg:flex lg:items-start lg:gap-12">
        <article className="max-w-[760px] mx-auto lg:mx-0 lg:flex-1 lg:max-w-[760px] min-w-0">
          {/* 모바일 전용 접이식 목차 */}
          <details className="lg:hidden group mb-8 rounded-2xl border border-ink-200 bg-white overflow-hidden">
            <summary className="flex items-center justify-between cursor-pointer list-none px-4 py-3 select-none">
              <span className="text-[13px] font-bold text-ink-800">
                목차 펼쳐보기
              </span>
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-ink-100 flex items-center justify-center text-ink-600 text-[13px] font-bold group-open:rotate-45 transition-transform">
                +
              </span>
            </summary>
            <nav className="px-4 pb-4 -mt-1">
              <ul className="space-y-2.5">
                {TOC_ITEMS.map((item) => (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      className="text-[13px] text-ink-600 hover:text-brand-700"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </details>

          {/* 문서 헤더 */}
          <div className="animate-fade-up">
            <span className="inline-flex items-center h-6 px-2.5 rounded-full bg-brand-50 text-brand-700 text-[11.5px] font-bold">
              처음 시작하는 분을 위한 안내
            </span>
            <h1 className="mt-4 text-[28px] sm:text-[36px] font-extrabold text-ink-900 leading-[1.25] tracking-tight">
              블로그 자동화 백오피스 시작 가이드
            </h1>
            <p className="mt-3 text-[15px] text-ink-600 leading-relaxed">
              개발 지식이 없어도 순서대로 따라오시면 됩니다. 이용 승인 받기부터
              Gemini API 키 발급, 나만의 세부 가이드 작성, 매일 글을 검수하고
              발행하는 방법까지 처음부터 끝까지 이 문서 하나로 안내합니다.
            </p>
            <div className="mt-4 inline-flex items-center gap-1.5 text-ink-500 text-[12.5px] font-semibold">
              <Clock size={14} strokeWidth={2.2} />
              예상 소요 시간 약 15분
            </div>
          </div>

          <hr className="my-10 border-ink-100" />

          {/* 1. 이 서비스가 하는 일 */}
          <section>
            <DocH2
              id="what-it-does"
              eyebrow="OVERVIEW"
              icon={Compass}
              title="이 서비스가 하는 일"
            />
            <p className="text-[14.5px] text-ink-700 leading-[1.8]">
              이 백오피스는 블로그 글쓰기 노동을 대신 해주는 조수라고 생각하면
              이해가 쉽습니다. 매일 정해진 시간이 되면 자동화 시스템이 미리
              등록해 둔 내 정보(판매점명, 연락처, 규칙 등)와 공통 요금표를 참고해서
              블로그에 올릴 만한 글을 AI로 미리 여러 편 만들어 둡니다. 아침에
              백오피스에 들어가 보면, 밤사이 만들어진 글이 이미{" "}
              <code className="px-1 py-0.5 rounded bg-ink-100 text-[12.5px] font-mono text-ink-800">
                글 관리
              </code>{" "}
              목록에 쌓여 있는 식입니다. 사람이 할 일은 그 글을 읽어 보고
              마음에 드는 글을 골라 실제 티스토리 블로그에 옮겨 붙여 발행
              버튼을 누르는 것, 그게 전부입니다.
            </p>
            <p className="mt-4 text-[14.5px] text-ink-700 leading-[1.8]">
              전체 흐름을 순서대로 정리하면 다음과 같습니다.
            </p>
            <ol className="mt-4 space-y-2.5 list-decimal list-inside text-[14px] text-ink-700 leading-relaxed marker:font-bold marker:text-brand-600">
              <li>키워드 발굴 — 어떤 주제로 글을 쓸지 키워드가 쌓입니다.</li>
              <li>
                AI 글 생성 — 매일 정해진 시각에 AI가 키워드와 내 세부 가이드를
                참고해 글 초안을 작성합니다.
              </li>
              <li>검수 — 생성된 글을 읽어 보고 발행할지 판단합니다.</li>
              <li>
                발행 — 마음에 드는 글을 티스토리에 직접 붙여넣어 올리고,
                백오피스에서 발행 완료로 표시합니다.
              </li>
              <li>
                분석 — GA4를 연결해 두면 발행한 글의 유입 성과를 확인할 수
                있습니다.
              </li>
            </ol>

            <div className="mt-6 rounded-2xl border border-ink-200 overflow-hidden">
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="bg-ink-50">
                    <th className="text-left font-bold text-ink-700 px-4 py-3 w-1/2">
                      내가 할 일
                    </th>
                    <th className="text-left font-bold text-ink-700 px-4 py-3 w-1/2 border-l border-ink-200">
                      자동으로 되는 일
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  <tr>
                    <td className="px-4 py-3 text-ink-700 align-top">
                      가끔 키워드 아이디어 등록하기
                    </td>
                    <td className="px-4 py-3 text-ink-700 align-top border-l border-ink-100">
                      매일 정해진 시각에 글 초안 생성
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-ink-700 align-top">
                      생성된 글 읽고 검수하기
                    </td>
                    <td className="px-4 py-3 text-ink-700 align-top border-l border-ink-100">
                      내 세부 가이드를 반영해 초안 작성
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-ink-700 align-top">
                      티스토리에 붙여넣고 발행하기
                    </td>
                    <td className="px-4 py-3 text-ink-700 align-top border-l border-ink-100">
                      발행은 자동으로 되지 않음 (직접 발행)
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-ink-700 align-top">
                      백오피스에서 발행 완료 표시하기
                    </td>
                    <td className="px-4 py-3 text-ink-700 align-top border-l border-ink-100">
                      GA4 연동 시 성과 데이터 자동 수집
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <hr className="my-10 border-ink-100" />

          {/* 2. 시작 전 준비물 */}
          <section>
            <DocH2
              id="checklist"
              eyebrow="CHECKLIST"
              icon={ListChecks}
              title="시작 전 준비물"
              desc="아래 네 가지가 준비되면 바로 시작할 수 있습니다."
            />
            <ul className="space-y-3">
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-md border-2 border-ink-300" />
                <span className="text-[14px] text-ink-700 leading-relaxed">
                  <strong className="font-bold text-ink-900">구글 계정</strong>{" "}
                  — 백오피스 로그인에 사용합니다. 평소 쓰는 지메일이면
                  충분합니다.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-md border-2 border-ink-300" />
                <span className="text-[14px] text-ink-700 leading-relaxed">
                  <strong className="font-bold text-ink-900">
                    티스토리 블로그
                  </strong>{" "}
                  — 글을 최종적으로 발행할 곳입니다. 없다면 아래 토글을 열어
                  개설 방법을 확인해 주세요.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-md border-2 border-ink-300" />
                <span className="text-[14px] text-ink-700 leading-relaxed">
                  <strong className="font-bold text-ink-900">
                    Gemini API 키
                  </strong>{" "}
                  — 글 생성에 사용되는 열쇠입니다. 아직 없어도 괜찮습니다.
                  아래 STEP 2에서 발급 방법을 처음부터 안내합니다.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-md border-2 border-ink-300" />
                <span className="text-[14px] text-ink-700 leading-relaxed">
                  <strong className="font-bold text-ink-900">
                    구글 2단계 인증 켜기{" "}
                    <span className="text-rose-600">(필수)</span>
                  </strong>{" "}
                  — 계정 보안 장치입니다. 켜져 있지 않으면 이용 승인이
                  어렵습니다. 바로 아래에서 설정 방법을 안내합니다.
                </span>
              </li>
            </ul>

            <Toggle summary="티스토리 블로그가 아직 없다면? (개설 방법 보기)">
              <OrderedMini
                items={[
                  {
                    title: "티스토리 접속",
                    desc: "tistory.com 에 접속합니다.",
                  },
                  {
                    title: "카카오 계정으로 로그인",
                    desc: "티스토리는 카카오 계정으로 가입·로그인합니다. 카카오 계정이 없다면 먼저 카카오 계정을 만들어 주세요.",
                  },
                  {
                    title: '"블로그 만들기" 진행',
                    desc: "안내에 따라 블로그 주소(URL)와 블로그 이름을 정합니다. 나중에 바꿀 수 있는 항목도 있으니 너무 오래 고민하지 않아도 됩니다.",
                  },
                  {
                    title: "스킨(디자인) 선택",
                    desc: "기본 제공되는 스킨 중 하나를 골라 적용합니다. 이후 언제든 다른 스킨으로 바꿀 수 있습니다.",
                  },
                  {
                    title: "생성 완료",
                    desc: "여기까지 마치면 블로그가 만들어집니다. 이후 STEP 6에서 이 블로그에 글을 붙여넣어 발행하게 됩니다.",
                  },
                ]}
              />
            </Toggle>
          </section>

          <hr className="my-10 border-ink-100" />

          {/* 구글 2단계 인증 (필수) */}
          <section>
            <DocH2
              id="security"
              eyebrow="SECURITY"
              icon={ShieldCheck}
              title="구글 2단계 인증 켜기 (필수)"
              desc="이 백오피스는 구글 계정이 곧 열쇠입니다. 이용 승인 전에 반드시 켜주세요."
            />
            <p className="text-[14.5px] text-ink-700 leading-[1.8]">
              백오피스 로그인, 내 데이터 시트, Gemini API 키가 전부 구글 계정
              하나에 연결됩니다. 계정을 도둑맞으면 이 모든 것이 함께 노출되기
              때문에, 비밀번호가 유출돼도 휴대폰 확인 없이는 로그인할 수 없게
              막아주는 <strong className="font-bold">2단계 인증</strong>을 필수로
              요구합니다. 한 번만 켜두면 되고, 5분이면 끝납니다.
            </p>
            <div className="mt-5">
              <OrderedMini
                items={[
                  {
                    title: "구글 계정 보안 페이지 접속",
                    desc: (
                      <>
                        새 탭에서{" "}
                        <a
                          href="https://myaccount.google.com/signinoptions/twosv"
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:text-brand-600 underline underline-offset-2"
                        >
                          myaccount.google.com/signinoptions/twosv
                          <ExternalLink size={13} strokeWidth={2.2} />
                        </a>{" "}
                        에 접속합니다. 백오피스에 쓸 구글 계정으로 로그인돼
                        있는지 오른쪽 위 프로필을 확인해 주세요.
                      </>
                    ),
                  },
                  {
                    title: "2단계 인증 화면 확인",
                    desc: '위 링크를 누르면 "2단계 인증" 화면이 바로 열립니다. 이미 "사용 중"으로 표시돼 있다면 이 섹션은 건너뛰어도 됩니다.',
                  },
                  {
                    title: '"시작하기" 후 본인 확인',
                    desc: "시작하기를 누르면 비밀번호를 다시 입력하라고 나옵니다. 본인 확인 절차이니 그대로 진행합니다.",
                  },
                  {
                    title: "휴대폰 등록",
                    desc: "안내에 따라 휴대폰을 등록합니다. 스마트폰에 구글 앱이 로그인돼 있으면 \"휴대전화로 메시지 받기\" 방식이 자동으로 잡히고, 아니면 전화번호를 입력해 문자 인증 코드를 받는 방식을 선택하면 됩니다.",
                  },
                  {
                    title: '"사용 설정" 눌러 완료',
                    desc: "마지막 화면에서 사용 설정을 누르면 끝입니다. 이후 새 기기에서 로그인할 때만 휴대폰 확인이 한 번씩 추가되고, 평소 쓰던 기기에서는 거의 체감되지 않습니다.",
                  },
                ]}
              />
            </div>
            <Callout type="warning">
              2단계 인증이 꺼진 계정은 비밀번호 하나만 뚫리면 백오피스의 글과
              시트, API 키까지 전부 넘어갑니다. 그래서 이용 승인 전 필수
              조건입니다. 관리자에게 승인을 요청할 때 &quot;2단계 인증 켰다&quot;고 함께
              알려주세요.
            </Callout>
          </section>

          <hr className="my-10 border-ink-100" />

          {/* STEP 1 */}
          <section>
            <DocH2
              id="step1"
              eyebrow="STEP 1"
              icon={ShieldCheck}
              title="이용 승인 받기"
            />
            <p className="text-[14.5px] text-ink-700 leading-[1.8]">
              이 백오피스는 아무나 로그인할 수 없고, 미리 승인된 구글 계정만
              들어올 수 있습니다. 방법은 간단합니다. 위 SECURITY 섹션대로{" "}
              <strong className="font-bold">2단계 인증을 먼저 켠 뒤</strong>,
              본인이 로그인에 사용할 구글 이메일 주소를 관리자에게 전달하세요
              (이때 &quot;2단계 인증 켰다&quot;고 함께 알려주면 승인이 빨라집니다). 그
              이메일이 등록되면 그때부터 로그인할 수 있습니다.
            </p>
            <p className="mt-4 text-[14.5px] text-ink-700 leading-[1.8]">
              혹시 등록되지 않은 계정으로 먼저 로그인을 시도하면 어떻게 될지
              궁금하실 텐데, 이 경우 로그인 절차가 끝까지 진행되지 않고
              접근이 차단된 화면이 표시됩니다. 이 화면을 보게 되더라도
              오류가 아니니 당황하지 마세요. 전달한 이메일 주소가 정확한지
              한 번 더 확인한 뒤, 관리자에게 등록 여부를 다시 확인해 달라고
              요청하면 됩니다.
            </p>
          </section>

          <hr className="my-10 border-ink-100" />

          {/* STEP 2 */}
          <section>
            <DocH2
              id="step2"
              eyebrow="STEP 2"
              icon={KeyRound}
              title="API 키 발급"
              desc="가장 낯설 수 있는 단계라 화면 단위로 안내합니다. 글 생성용 Gemini 키는 필수, 이미지 생성용 NVIDIA 키는 선택입니다."
            />
            <p className="text-[14.5px] text-ink-700 leading-[1.8]">
              Gemini는 구글이 만든 AI 모델로, 이 백오피스가 블로그 글을 쓸 때
              사용하는 엔진입니다. 이 AI를 사용하려면 나만의 열쇠인 API 키가
              필요한데, 발급 자체는 무료이고 신용카드 등록도 요구하지
              않습니다. 무료 제공량만으로도 하루 분량의 글을 생성하기에
              충분합니다.
            </p>
            <div className="mt-6">
              <OrderedMini items={GEMINI_STEPS} />
            </div>
            <Callout type="warning">
              <strong>API 키는 비밀번호처럼 취급하세요.</strong> 다른 사람에게
              공유하거나 화면 녹화·캡처에 그대로 노출하지 마세요. 키 하나로
              내 계정의 사용량이 청구되는 구조이기 때문에, 외부에 유출되면
              의도치 않은 사용량이 발생할 수 있습니다. 만약 유출되었다면
              Google AI Studio에서 해당 키를 즉시 삭제한 뒤 새 키를
              재발급받으세요.
            </Callout>
          </section>

          <hr className="my-10 border-ink-100" />

          {/* STEP 3 */}
          <section>
            <DocH2
              id="step3"
              eyebrow="STEP 3"
              icon={LogIn}
              title="백오피스 로그인 & 키 등록"
            />
            <OrderedMini
              items={[
                {
                  title: "로그인 페이지에서 「구글로 로그인」 누르기",
                  desc: "관리자에게 승인받은 그 구글 계정으로 로그인합니다. 다른 계정으로 로그인하면 들어올 수 없습니다.",
                },
                {
                  title: '"Google에서 확인하지 않은 앱입니다" 화면이 나오면',
                  desc: (
                    <>
                      <strong className="font-bold text-ink-900">
                        정상입니다. 놀라지 마세요.
                      </strong>{" "}
                      개인이 만들어 소수만 쓰는 서비스라 구글의 별도 심사를 받지
                      않아서 뜨는 안내입니다.{" "}
                      <strong className="font-bold text-ink-900">
                        「고급」
                      </strong>{" "}
                      을 누른 뒤 아래에 나오는{" "}
                      <strong className="font-bold text-ink-900">
                        「(안전하지 않음)으로 이동」
                      </strong>
                      을 누르면 계속 진행됩니다. 이 화면이 안 나오면 그냥
                      다음으로 넘어가세요.
                    </>
                  ),
                },
                {
                  title: "권한 요청 화면에서 「계속」",
                  desc: (
                    <>
                      이름·이메일 외에 두 가지를 더 요청합니다.{" "}
                      <strong className="font-bold text-ink-900">
                        Google Drive 파일 만들기
                      </strong>
                      는 내 전용 시트를 만들기 위해,{" "}
                      <strong className="font-bold text-ink-900">
                        애널리틱스 읽기
                      </strong>
                      는 글 조회수를 가져오기 위해 필요합니다. 이 서비스가 만든
                      파일 외에 내 드라이브의 다른 파일은 열어보지 않습니다.
                    </>
                  ),
                },
                {
                  title: (
                    <>
                      좌측 메뉴에서{" "}
                      <code className="px-1 py-0.5 rounded bg-ink-100 text-[12.5px] font-mono text-ink-800">
                        설정
                      </code>{" "}
                      메뉴 클릭
                    </>
                  ),
                  desc: "로그인 후 왼쪽 메뉴 목록에서 설정 화면으로 이동합니다.",
                },
                {
                  title: "Gemini API 키 붙여넣기",
                  desc: "STEP 2에서 복사해 둔 키를 입력창에 붙여넣습니다.",
                },
                {
                  title: "저장",
                  desc: "저장 버튼을 누르면 등록이 완료됩니다. 이후부터 이 키로 내 글이 생성됩니다.",
                },
              ]}
            />
            <div className="mt-10">
              <h3 className="text-[17px] font-extrabold text-ink-900">
                선택 · 이미지 생성 키 (NVIDIA)
              </h3>
              <p className="mt-2 text-[14.5px] text-ink-700 leading-[1.8]">
                글에 들어갈 썸네일과 카드뉴스 이미지를 만들 때 쓰는 키입니다.
                Gemini 키와 마찬가지로 무료이고 신용카드도 필요 없습니다.{" "}
                <strong className="font-bold text-ink-900">
                  등록하지 않아도 글은 정상적으로 생성됩니다
                </strong>
                — 이미지가 붙지 않을 뿐입니다. 지금은 미리 등록해 두는 단계이고,
                이미지 자동 생성 기능은 준비 중입니다. 나중에 하셔도 되니
                부담 없이 건너뛰셔도 됩니다.
              </p>
              <div className="mt-6">
                <OrderedMini items={NVIDIA_STEPS} />
              </div>
            </div>
          </section>

          <hr className="my-10 border-ink-100" />

          {/* STEP 4 */}
          <section>
            <DocH2
              id="step4"
              eyebrow="STEP 4"
              icon={FileSpreadsheet}
              title="내 데이터 시트 확인"
            />
            <p className="text-[14.5px] text-ink-700 leading-[1.8]">
              이용 승인이 완료되면 나만 사용하는 전용 구글 시트가 등록한
              이메일로 공유됩니다. 메일함에서{" "}
              <strong className="font-bold text-ink-900">
                &ldquo;블로그 자동화 — (내 이름)&rdquo;
              </strong>{" "}
              형태의 제목을 가진 초대 메일을 찾아 열어 보세요. 이 시트가 내
              글, 키워드, 설정, 세부 가이드가 저장되는 실제 저장 공간입니다.
              시트 안에는 아래 4개의 탭이 있습니다.
            </p>
            <div className="mt-6 rounded-2xl border border-ink-200 overflow-hidden">
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="bg-ink-50">
                    <th className="text-left font-bold text-ink-700 px-4 py-3 w-[120px]">
                      탭 이름
                    </th>
                    <th className="text-left font-bold text-ink-700 px-4 py-3 border-l border-ink-200">
                      역할
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {SHEET_TABS.map((tab) => (
                    <tr key={tab.name}>
                      <td className="px-4 py-3 align-top">
                        <code className="px-1.5 py-0.5 rounded bg-ink-100 text-[12.5px] font-mono text-ink-800">
                          {tab.name}
                        </code>
                      </td>
                      <td className="px-4 py-3 text-ink-700 align-top border-l border-ink-100 leading-relaxed">
                        {tab.desc}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-[13.5px] text-ink-500 leading-relaxed">
              시트를 직접 열어서 수정할 필요는 없습니다. 모든 작업은 백오피스
              화면에서 하면 시트에 자동으로 반영됩니다. 시트는 내 데이터가
              실제로 어디에 쌓이는지 확인하고 싶을 때만 열어보시면 됩니다.
            </p>
          </section>

          <hr className="my-10 border-ink-100" />

          {/* STEP 5 */}
          <section>
            <DocH2
              id="step5"
              eyebrow="STEP 5"
              icon={NotebookPen}
              title="내 가이드 작성"
              desc="가장 중요한 단계입니다. 여기를 채운 만큼 내 브랜드에 맞는 글이 만들어집니다."
            />
            <p className="text-[14.5px] text-ink-700 leading-[1.8]">
              AI는 글을 쓸 때 두 겹의 가이드를 함께 참고합니다. 하나는 모든
              사용자에게 공통으로 적용되는{" "}
              <strong className="font-bold text-ink-900">공통 가이드</strong>
              이고, 다른 하나는{" "}
              <strong className="font-bold text-ink-900">
                나만의 세부 가이드
              </strong>
              입니다. 두 가이드의 내용이 겹칠 경우, 항상 내 세부 가이드가
              공통 가이드보다 먼저 적용됩니다. 즉 세부 가이드에 적어두지 않은
              부분만 공통 가이드를 따르는 구조입니다. 그래서 세부 가이드를
              꼼꼼히 채울수록 내 브랜드, 내 상품에 딱 맞는 글이 만들어집니다.
            </p>
            <Callout type="info">
              <strong>구글 시트를 열지 않아도 됩니다.</strong> 세부 가이드는
              백오피스 왼쪽 메뉴의{" "}
              <strong className="font-bold text-ink-900">「내 가이드」</strong>
              화면에서 칸을 채우면 됩니다. 판매점명·카카오톡 채널 링크·개통
              사이트 링크처럼 항목별로 입력칸이 나뉘어 있어 그대로 적기만 하면
              시트에 자동 저장됩니다.{" "}
              <strong className="font-bold text-ink-900">
                아직 다 못 채웠어도 저장
              </strong>
              해 두고 나중에 이어서 작성할 수 있고, 화면 위쪽 진행률에 무엇이
              남았는지 표시됩니다. 필수 항목이 덜 채워져 있으면 메뉴의 「내
              가이드」 옆에 빨간 점이 붙습니다.
            </Callout>
            <p className="mt-6 text-[14.5px] text-ink-700 leading-[1.8]">
              「내 가이드」 화면에서 채우는 항목은 아래와 같습니다. 필수 항목이
              하나라도 비어 있으면 글이 생성되지 않습니다.
            </p>
            <div className="mt-6 rounded-2xl border border-ink-200 overflow-hidden">
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="bg-ink-50">
                    <th className="text-left font-bold text-ink-700 px-3 sm:px-4 py-3 w-[130px]">
                      섹션
                    </th>
                    <th className="text-left font-bold text-ink-700 px-3 sm:px-4 py-3 border-l border-ink-200">
                      무엇을 적나요
                    </th>
                    <th className="text-left font-bold text-ink-700 px-3 sm:px-4 py-3 border-l border-ink-200 w-[190px]">
                      비고
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {GUIDE_SECTIONS.map((sec) => (
                    <tr key={sec.name}>
                      <td className="px-3 sm:px-4 py-3 align-top">
                        <code className="px-1.5 py-0.5 rounded bg-ink-100 text-[12.5px] font-mono text-ink-800">
                          {sec.name}
                        </code>
                        {sec.required && (
                          <span className="mt-1.5 inline-flex items-center h-5 px-1.5 rounded-md bg-rose-50 text-rose-700 text-[10.5px] font-bold">
                            필수
                          </span>
                        )}
                      </td>
                      <td className="px-3 sm:px-4 py-3 text-ink-700 align-top border-l border-ink-100 leading-relaxed">
                        {sec.desc}
                      </td>
                      <td
                        className={
                          "px-3 sm:px-4 py-3 align-top border-l border-ink-100 leading-relaxed text-[12.5px] " +
                          (sec.required
                            ? "text-rose-700 font-semibold"
                            : "text-ink-500")
                        }
                      >
                        {sec.note}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Callout type="warning">
              <strong>판매점명 · 링크 · 연락처는 반드시 본인의 실제 정보로</strong>{" "}
              채워주세요. 이 세 가지가 비어 있으면 글 자체가 생성되지 않습니다.
              화면 위쪽 진행률이 3/3이 되면 준비가 끝난 것입니다. 예시로 적어둔
              값을 그대로 두면 내 글에 엉뚱한 상호명이나 연락처가 들어갈 수
              있으니, 처음 시작할 때는 항목을 처음부터 끝까지 한 번 훑어보며 내
              정보로 채워져 있는지 확인해 주세요. 요금은 공통 요금표를 그대로
              사용하므로 따로 적지 않습니다.
            </Callout>
          </section>

          <hr className="my-10 border-ink-100" />

          {/* STEP 6 */}
          <section>
            <DocH2
              id="step6"
              eyebrow="STEP 6"
              icon={CalendarCheck}
              title="매일 하는 일 (검수·발행)"
              desc="설정이 끝난 이후에는 이 단계만 매일 반복하면 됩니다."
            />
            <OrderedMini
              items={[
                {
                  title: "아침에 대시보드 확인",
                  desc: "백오피스에 로그인해 오늘 새로 생성된 글이 있는지 확인합니다.",
                },
                {
                  title: (
                    <>
                      <code className="px-1 py-0.5 rounded bg-ink-100 text-[12.5px] font-mono text-ink-800">
                        글 관리
                      </code>
                      에서 내용 확인·복사
                    </>
                  ),
                  desc: "글 관리 화면에서 생성된 글을 읽어 보고, 발행하고 싶은 글의 내용을 복사합니다.",
                },
                {
                  title: "티스토리 글쓰기 화면에서 HTML 모드로 붙여넣기",
                  desc: "티스토리 글쓰기 화면을 HTML 모드로 전환한 뒤 복사한 내용을 붙여넣습니다. 전환 방법이 낯설다면 아래 토글을 열어 확인해 주세요.",
                },
                {
                  title: "발행",
                  desc: "내용과 제목을 최종 확인한 뒤 티스토리에서 발행 버튼을 누릅니다.",
                },
                {
                  title: "백오피스에서 발행 처리 표시",
                  desc: "다시 백오피스로 돌아와 해당 글을 발행 완료로 표시합니다. 이렇게 해야 이후 통계와 목록 관리가 꼬이지 않습니다.",
                },
              ]}
            />
            <Toggle summary="티스토리 글쓰기를 HTML 모드로 바꾸는 방법">
              <p className="mb-3">
                티스토리 글쓰기 화면은 기본적으로 일반 에디터 모드로
                열립니다. 백오피스에서 복사한 글은 HTML 형식으로 되어 있기
                때문에, 그대로 붙여넣으면 태그가 텍스트로 그대로 보이는
                문제가 생길 수 있습니다. 다음 순서로 모드를 바꿔주세요.
              </p>
              <OrderedMini
                items={[
                  {
                    title: "글쓰기 화면 상단 메뉴 확인",
                    desc: "티스토리 글쓰기 화면 상단(또는 우측 상단)에 에디터 모드를 전환하는 메뉴가 있습니다.",
                  },
                  {
                    title: '"HTML" 모드 선택',
                    desc: "기본 모드에서 HTML 모드로 전환합니다.",
                  },
                  {
                    title: "붙여넣기",
                    desc: "전환된 HTML 입력창에 복사해 둔 글 내용을 그대로 붙여넣습니다.",
                  },
                  {
                    title: "미리보기로 확인",
                    desc: "붙여넣은 뒤 미리보기 기능으로 실제 화면이 정상적으로 보이는지 한 번 확인하고 발행합니다.",
                  },
                ]}
              />
            </Toggle>
          </section>

          <hr className="my-10 border-ink-100" />

          {/* 백오피스 메뉴 소개 */}
          <section>
            <DocH2
              id="menu"
              eyebrow="WORKSPACE"
              icon={LayoutDashboard}
              title="백오피스 메뉴 소개"
              desc="로그인 후 왼쪽 메뉴에서 아래 화면들을 이용할 수 있습니다."
            />
            <div className="rounded-2xl border border-ink-200 overflow-hidden">
              <table className="w-full text-[13.5px]">
                <tbody className="divide-y divide-ink-100">
                  {WORKSPACE_ROWS.map((row) => (
                    <tr key={row.name}>
                      <td className="px-4 py-3.5 align-middle w-[150px]">
                        <div className="flex items-center gap-2.5">
                          <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-ink-100 flex items-center justify-center">
                            <row.icon
                              size={14}
                              strokeWidth={2.2}
                              className="text-ink-700"
                            />
                          </div>
                          <span className="font-bold text-ink-900">
                            {row.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-ink-600 align-middle border-l border-ink-100 leading-relaxed">
                        {row.desc}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <hr className="my-10 border-ink-100" />

          {/* FAQ */}
          <section>
            <DocH2 id="faq" eyebrow="FAQ" icon={HelpCircle} title="자주 묻는 질문" />
            <div className="rounded-2xl border border-ink-200 bg-white divide-y divide-ink-100 overflow-hidden">
              {FAQS.map((f) => (
                <details key={f.q} className="group p-4 sm:p-5">
                  <summary className="flex items-center justify-between cursor-pointer list-none gap-3">
                    <span className="text-[14px] font-bold text-ink-900">
                      {f.q}
                    </span>
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-ink-100 flex items-center justify-center text-ink-600 text-[13px] font-bold group-open:rotate-45 transition-transform">
                      +
                    </span>
                  </summary>
                  <p className="mt-3 text-[13.5px] text-ink-600 leading-relaxed">
                    {f.a}
                  </p>
                </details>
              ))}
            </div>
          </section>

          <hr className="my-10 border-ink-100" />

          {/* 하단 CTA */}
          <section className="bg-ink-900 rounded-3xl p-8 sm:p-10 text-center relative overflow-hidden">
            <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-brand-500/30 blur-3xl" />
            <div className="absolute -left-10 -bottom-10 w-40 h-40 rounded-full bg-brand-500/20 blur-3xl" />
            <div className="relative">
              <h2 className="text-[20px] sm:text-[24px] font-extrabold text-white leading-tight">
                준비가 끝났다면, 지금 시작해 보세요
              </h2>
              <p className="mt-2 text-[13.5px] text-white/60">
                구글 이메일 승인 요청은 관리자에게 직접 전달해 주세요.
              </p>
              <a
                href={ctaHref}
                className="mt-7 inline-flex h-12 px-7 rounded-2xl bg-brand-500 text-white text-[14px] font-bold items-center gap-2 shadow-press hover:bg-brand-600 transition"
              >
                {ctaLabel}
                <ArrowRight size={16} strokeWidth={2.4} />
              </a>
            </div>
          </section>

          <div className="flex items-center justify-center gap-2 text-[12px] text-ink-400 pt-6">
            <Mail size={13} strokeWidth={2} />
            <span>궁금한 점은 관리자에게 직접 문의해 주세요.</span>
          </div>
        </article>

        {/* 데스크톱 사이드 목차 */}
        <aside className="hidden lg:block w-[220px] flex-shrink-0 sticky top-[76px] self-start">
          <div className="flex items-center gap-1.5 text-ink-400 text-[11px] font-bold tracking-wider mb-3">
            <BookOpen size={12} strokeWidth={2.4} />
            목차
          </div>
          <nav>
            <ul className="space-y-2.5 border-l border-ink-200">
              {TOC_ITEMS.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    className="block pl-3.5 -ml-px border-l-2 border-transparent text-[12.5px] text-ink-500 hover:text-brand-700 hover:border-brand-500 transition leading-snug"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
      </div>
    </main>
  );
}
