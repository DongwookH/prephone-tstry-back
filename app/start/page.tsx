import type { Metadata } from "next";
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
  CircleCheckBig,
  Sparkles,
  Clock,
  Mail,
} from "lucide-react";

export const metadata: Metadata = {
  title: "시작하기 · 블로그 자동화 백오피스",
  description:
    "키워드 발굴부터 AI 글 생성, 검수·발행, 성과 분석까지 이어지는 블로그 자동화 백오피스 이용 안내입니다.",
};

const START_STEPS = [
  {
    title: "구글 계정 준비",
    desc: "백오피스는 구글 계정으로 로그인합니다. 사용할 구글 이메일 주소를 미리 확인해 두세요.",
  },
  {
    title: "이용 승인 요청",
    desc: "관리자에게 구글 이메일 주소를 전달해 사용 승인(화이트리스트 등록)을 요청합니다. 등록되지 않은 계정은 로그인이 차단됩니다.",
  },
  {
    title: "구글 계정으로 로그인",
    desc: "승인이 완료되면 로그인 페이지에서 동일한 구글 계정으로 로그인합니다.",
  },
  {
    title: "Gemini API 키 등록",
    desc: "설정 메뉴에서 본인의 Gemini API 키를 등록합니다. 글 생성에 사용되는 키로, 아래에서 발급 방법을 안내합니다.",
  },
  {
    title: "세부 가이드 작성",
    desc: "설정 메뉴에서 브랜드명, 페르소나, 금지 표현 등 본인만의 세부 가이드를 작성합니다.",
  },
  {
    title: "매일 글 검수·발행",
    desc: "매일 자동으로 생성되는 글을 검수한 뒤, 마음에 드는 글을 골라 발행합니다.",
  },
];

const GEMINI_STEPS = [
  {
    title: "Google AI Studio 접속",
    desc: (
      <>
        <a
          href="https://aistudio.google.com/apikey"
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:text-brand-600 underline underline-offset-2"
        >
          aistudio.google.com/apikey
          <ExternalLink size={13} strokeWidth={2.2} />
        </a>
        {" "}주소로 접속합니다.
      </>
    ),
  },
  { title: "구글 로그인", desc: "백오피스에 사용할 구글 계정으로 로그인합니다." },
  { title: "API 키 만들기", desc: "\"API 키 만들기\" 버튼을 눌러 새 키를 발급받습니다." },
  { title: "키 복사", desc: "발급된 키 문자열을 복사합니다." },
  {
    title: "백오피스 설정에 등록",
    desc: "백오피스의 설정 메뉴로 돌아와 복사한 키를 붙여넣고 저장합니다.",
  },
];

const FAQS = [
  {
    q: "이용에 비용이 드나요?",
    a: "Gemini API는 무료 티어로도 충분히 사용할 수 있고, 각자 본인의 키를 등록해 사용하기 때문에 백오피스 이용 자체에는 비용이 들지 않습니다.",
  },
  {
    q: "글은 언제 생성되나요?",
    a: "매일 정해진 시간에 자동으로 새 글이 생성됩니다. 대시보드에서 오늘 생성된 글을 바로 확인할 수 있습니다.",
  },
  {
    q: "이용 승인은 어떻게 받나요?",
    a: "구글 이메일 주소를 관리자에게 전달해 화이트리스트 등록을 요청하면 됩니다. 등록 전에는 로그인이 차단됩니다.",
  },
  {
    q: "API 키가 유출된 것 같아요.",
    a: "Google AI Studio에서 해당 키를 즉시 삭제한 뒤 새 키를 발급받아 백오피스 설정에 다시 등록하세요.",
  },
  {
    q: "블로그는 몇 개까지 연결할 수 있나요?",
    a: "계정당 최대 5개의 티스토리 블로그를 연결해 운영할 수 있습니다.",
  },
];

const WORKSPACE_CARDS = [
  {
    icon: LayoutDashboard,
    name: "대시보드",
    desc: "오늘 생성된 글과 발행 현황을 한눈에 확인합니다.",
  },
  {
    icon: FileText,
    name: "글 관리",
    desc: "생성된 글을 검수하고 내용을 복사해 발행합니다.",
  },
  {
    icon: Search,
    name: "키워드",
    desc: "키워드를 발굴하고 생성 대기열을 관리합니다.",
  },
  {
    icon: BarChart3,
    name: "분석",
    desc: "GA4 연동 시 글별 유입·클릭 성과를 확인합니다.",
  },
  {
    icon: Rss,
    name: "Threads",
    desc: "블로그 글을 스레드 콘텐츠로 자동 발행합니다.",
  },
  {
    icon: MessageSquare,
    name: "챗봇 질문",
    desc: "사이트에 방문한 사용자의 챗봇 질문 로그를 확인합니다.",
  },
  {
    icon: Settings,
    name: "설정",
    desc: "Gemini API 키, 세부 가이드 등 개인 설정을 관리합니다.",
  },
];

function StepNumber({ n }: { n: number }) {
  return (
    <div className="flex-shrink-0 w-9 h-9 rounded-full bg-brand-500 text-white flex items-center justify-center text-[14px] font-extrabold shadow-press">
      {n}
    </div>
  );
}

function SectionLabel({
  eyebrow,
  title,
  desc,
}: {
  eyebrow: string;
  title: string;
  desc?: string;
}) {
  return (
    <div className="mb-6 sm:mb-8">
      <span className="text-[12px] font-bold text-brand-600 tracking-wider">
        {eyebrow}
      </span>
      <h2 className="mt-2 text-[22px] sm:text-[26px] font-extrabold text-ink-900 leading-tight tracking-tight">
        {title}
      </h2>
      {desc && (
        <p className="mt-2 text-[14px] sm:text-[15px] text-ink-600 leading-relaxed">
          {desc}
        </p>
      )}
    </div>
  );
}

export default function StartPage() {
  return (
    <main className="min-h-screen bg-ink-50">
      {/* Top bar */}
      <header className="sticky top-0 z-10 bg-ink-50/80 backdrop-blur-xl border-b border-ink-100">
        <div className="max-w-[880px] mx-auto px-5 sm:px-8 h-[64px] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-brand-500 flex items-center justify-center">
              <Sparkles size={16} color="white" strokeWidth={2.2} />
            </div>
            <span className="text-[13px] font-extrabold text-ink-900 tracking-wide">
              블로그 자동화 백오피스
            </span>
          </div>
          <a
            href="/login"
            className="h-9 px-4 rounded-xl bg-ink-900 text-white text-[13px] font-bold flex items-center hover:bg-ink-800 transition"
          >
            로그인
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-[880px] mx-auto px-5 sm:px-8 pt-14 sm:pt-20 pb-12 sm:pb-16">
        <div className="animate-fade-up">
          <span className="inline-flex items-center h-7 px-3 rounded-full bg-brand-50 text-brand-700 text-[12px] font-bold">
            시작하기 전에 꼭 읽어주세요
          </span>
          <h1 className="mt-5 text-[30px] sm:text-[42px] font-extrabold text-ink-900 leading-[1.2] tracking-tight">
            키워드 발굴부터 발행까지,
            <br />
            블로그 운영을 자동화하는 백오피스입니다
          </h1>
          <p className="mt-4 text-[15px] sm:text-[16px] text-ink-600 leading-relaxed max-w-[620px]">
            키워드를 발굴하고, 등록된 지식베이스를 바탕으로 AI가 글을 생성하고,
            검수·발행을 관리하고, 성과를 분석하는 과정까지 하나의 워크스페이스에서
            이어집니다. 아래 안내를 따라 차근차근 시작해 보세요.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href="/login"
              className="h-12 px-6 rounded-2xl bg-brand-500 text-white text-[14px] font-bold flex items-center gap-2 shadow-press hover:bg-brand-600 transition"
            >
              로그인하러 가기
              <ArrowRight size={16} strokeWidth={2.4} />
            </a>
            <a
              href="#steps"
              className="h-12 px-6 rounded-2xl bg-white border border-ink-200 text-ink-800 text-[14px] font-bold flex items-center hover:bg-ink-100 transition"
            >
              시작 절차 보기
            </a>
          </div>
        </div>
      </section>

      <div className="max-w-[880px] mx-auto px-5 sm:px-8 pb-24 space-y-16 sm:space-y-20">
        {/* 서비스 소개 */}
        <section>
          <SectionLabel
            eyebrow="SERVICE"
            title="서비스 소개"
            desc="네 단계 흐름이 자동으로 이어집니다."
          />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { icon: Search, label: "키워드 발굴" },
              { icon: Sparkles, label: "AI 글 생성" },
              { icon: CircleCheckBig, label: "검수·발행 관리" },
              { icon: BarChart3, label: "성과 분석" },
            ].map((s, i) => (
              <div
                key={s.label}
                className="bg-white rounded-2xl shadow-card p-4 sm:p-5 flex flex-col gap-3"
              >
                <div className="flex items-center justify-between">
                  <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center">
                    <s.icon size={16} strokeWidth={2.2} className="text-brand-600" />
                  </div>
                  <span className="text-[11px] font-bold text-ink-300">
                    0{i + 1}
                  </span>
                </div>
                <span className="text-[13px] font-bold text-ink-900 leading-snug">
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* 시작 절차 */}
        <section id="steps" className="scroll-mt-20">
          <SectionLabel
            eyebrow="GETTING STARTED"
            title="시작 절차"
            desc="총 6단계입니다. 순서대로 진행해 주세요."
          />
          <div className="bg-white rounded-3xl shadow-card p-5 sm:p-8">
            <ol className="space-y-6 sm:space-y-7">
              {START_STEPS.map((step, i) => (
                <li key={step.title} className="flex gap-4">
                  <StepNumber n={i + 1} />
                  <div className="pt-0.5">
                    <p className="text-[15px] font-bold text-ink-900">
                      {step.title}
                    </p>
                    <p className="mt-1 text-[13.5px] text-ink-600 leading-relaxed">
                      {step.desc}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Gemini API 키 발급 */}
        <section>
          <SectionLabel
            eyebrow="GEMINI API KEY"
            title="Gemini API 키 발급 방법"
            desc="글 생성에 필요한 본인 전용 키입니다. 무료 티어로도 충분히 사용할 수 있어 별도 비용이 발생하지 않습니다."
          />
          <div className="bg-white rounded-3xl shadow-card p-5 sm:p-8">
            <ol className="space-y-5">
              {GEMINI_STEPS.map((step, i) => (
                <li key={step.title} className="flex gap-4">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-ink-100 text-ink-700 flex items-center justify-center text-[12px] font-extrabold">
                    {i + 1}
                  </div>
                  <div>
                    <p className="text-[14px] font-bold text-ink-900">
                      {step.title}
                    </p>
                    <p className="mt-0.5 text-[13.5px] text-ink-600 leading-relaxed">
                      {step.desc}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-6 pt-5 border-t border-ink-100 flex items-start gap-2.5">
              <KeyRound size={16} strokeWidth={1.8} className="mt-0.5 flex-shrink-0 text-ink-500" />
              <p className="text-[12.5px] text-ink-500 leading-relaxed">
                발급받은 키는 본인만 사용하고 타인과 공유하지 마세요. 키 하나로
                본인 계정의 API 사용량이 청구되기 때문에, 외부에 노출되면
                의도치 않은 사용량이 발생할 수 있습니다.
              </p>
            </div>
          </div>
        </section>

        {/* 블로그 준비 */}
        <section>
          <SectionLabel eyebrow="BLOG" title="블로그 준비" />
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl shadow-card p-5 sm:p-6">
              <div className="w-8 h-8 rounded-lg bg-mint-50 flex items-center justify-center mb-3">
                <FileText size={16} strokeWidth={2.2} className="text-mint-700" />
              </div>
              <p className="text-[14px] font-bold text-ink-900">
                티스토리 블로그 개설
              </p>
              <p className="mt-1.5 text-[13.5px] text-ink-600 leading-relaxed">
                계정당 최대 5개까지 티스토리 블로그를 연결해 운영할 수 있습니다.
                백오피스에서 생성된 글을 복사해 티스토리에 직접 붙여넣어
                발행하는 방식입니다.
              </p>
            </div>
            <div className="bg-white rounded-2xl shadow-card p-5 sm:p-6">
              <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center mb-3">
                <BarChart3 size={16} strokeWidth={2.2} className="text-violet-700" />
              </div>
              <p className="text-[14px] font-bold text-ink-900">
                GA4 연결 (선택)
              </p>
              <p className="mt-1.5 text-[13.5px] text-ink-600 leading-relaxed">
                Google Analytics 4를 연결하면 분석 메뉴에서 글별 유입과 클릭
                성과를 확인할 수 있습니다. 연결하지 않아도 다른 기능은 모두
                사용할 수 있습니다.
              </p>
            </div>
          </div>
        </section>

        {/* 백오피스 구성 소개 */}
        <section>
          <SectionLabel
            eyebrow="WORKSPACE"
            title="백오피스 구성"
            desc="로그인 후 왼쪽 메뉴에서 아래 화면들을 이용할 수 있습니다."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {WORKSPACE_CARDS.map((c) => (
              <div
                key={c.name}
                className="bg-white rounded-2xl shadow-card p-4 sm:p-5 flex items-start gap-3.5"
              >
                <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-ink-100 flex items-center justify-center">
                  <c.icon size={16} strokeWidth={2.2} className="text-ink-700" />
                </div>
                <div>
                  <p className="text-[14px] font-bold text-ink-900">{c.name}</p>
                  <p className="mt-0.5 text-[13px] text-ink-600 leading-relaxed">
                    {c.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 글 작성 가이드 구조 */}
        <section>
          <SectionLabel
            eyebrow="GUIDE"
            title="글 작성 가이드 구조"
            desc="AI는 두 겹의 가이드를 함께 참고해 글을 씁니다."
          />
          <div className="bg-white rounded-3xl shadow-card p-5 sm:p-8">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1 rounded-2xl border border-ink-100 p-4 sm:p-5">
                <div className="flex items-center gap-2 mb-2">
                  <BookOpen size={15} strokeWidth={2.2} className="text-ink-500" />
                  <span className="text-[13px] font-bold text-ink-700">
                    공통 가이드
                  </span>
                </div>
                <p className="text-[13px] text-ink-600 leading-relaxed">
                  글 구조, 톤, 품질 규칙 등 모든 사용자에게 적용되는 기본
                  가이드입니다.
                </p>
              </div>
              <div className="flex items-center justify-center text-ink-300">
                <ArrowRight
                  size={18}
                  strokeWidth={2.4}
                  className="hidden sm:block"
                />
                <span className="sm:hidden text-[12px] font-bold">
                  ↓ 우선 적용
                </span>
              </div>
              <div className="flex-1 rounded-2xl border border-brand-200 bg-brand-50/50 p-4 sm:p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Settings size={15} strokeWidth={2.2} className="text-brand-700" />
                  <span className="text-[13px] font-bold text-brand-700">
                    나의 세부 가이드
                  </span>
                </div>
                <p className="text-[13px] text-ink-700 leading-relaxed">
                  브랜드명, 연락처, 요금, 금지어, 페르소나 등 본인만의 설정으로,
                  공통 가이드보다 우선 적용됩니다.
                </p>
              </div>
            </div>
            <p className="mt-5 text-[13px] text-ink-600 leading-relaxed">
              세부 가이드에 없는 부분만 공통 가이드를 따릅니다. 즉, 세부
              가이드를 채울수록 내 브랜드에 맞는 글이 만들어집니다.
            </p>
            <div className="mt-5 rounded-2xl bg-amber-50 p-4 flex items-start gap-2.5">
              <AlertTriangle
                size={16}
                strokeWidth={2}
                className="mt-0.5 flex-shrink-0 text-amber-700"
              />
              <p className="text-[12.5px] text-amber-700 leading-relaxed">
                회사 정보, 연락처 등 세부 가이드의 각 항목은 반드시 본인의
                정보로 채워주세요. 비워두거나 다른 사람의 정보가 남아 있으면
                내 글에 다른 사람의 정보가 그대로 들어갈 수 있습니다.
              </p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section>
          <SectionLabel eyebrow="FAQ" title="자주 묻는 질문" />
          <div className="bg-white rounded-3xl shadow-card divide-y divide-ink-100 overflow-hidden">
            {FAQS.map((f) => (
              <details key={f.q} className="group p-5 sm:p-6">
                <summary className="flex items-center justify-between cursor-pointer list-none">
                  <span className="text-[14px] sm:text-[15px] font-bold text-ink-900 pr-4">
                    {f.q}
                  </span>
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-ink-100 flex items-center justify-center text-ink-600 text-[14px] font-bold group-open:rotate-45 transition-transform">
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

        {/* 하단 CTA */}
        <section className="bg-ink-900 rounded-3xl p-8 sm:p-12 text-center relative overflow-hidden">
          <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-brand-500/30 blur-3xl"></div>
          <div className="absolute -left-10 -bottom-10 w-40 h-40 rounded-full bg-brand-500/20 blur-3xl"></div>
          <div className="relative">
            <div className="inline-flex items-center gap-1.5 text-white/60 text-[12px] font-bold mb-3">
              <Clock size={13} strokeWidth={2.2} />
              승인은 보통 빠르게 처리됩니다
            </div>
            <h2 className="text-[22px] sm:text-[26px] font-extrabold text-white leading-tight">
              준비가 끝났다면, 로그인해서 시작해 보세요
            </h2>
            <p className="mt-2 text-[13.5px] sm:text-[14px] text-white/60">
              구글 이메일 승인 요청은 관리자에게 직접 전달해 주세요.
            </p>
            <a
              href="/login"
              className="mt-7 inline-flex h-12 px-7 rounded-2xl bg-brand-500 text-white text-[14px] font-bold items-center gap-2 shadow-press hover:bg-brand-600 transition"
            >
              로그인하러 가기
              <ArrowRight size={16} strokeWidth={2.4} />
            </a>
          </div>
        </section>

        <div className="flex items-center justify-center gap-2 text-[12px] text-ink-400 pt-2">
          <Mail size={13} strokeWidth={2} />
          <span>이용 승인 및 문의는 관리자에게 직접 연락해 주세요.</span>
        </div>
      </div>
    </main>
  );
}
