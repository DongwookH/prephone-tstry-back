import { Topbar } from "@/components/topbar";
import {
  Settings2,
  Users,
  Shield,
  UserCircle2,
  Clock,
  Link2,
  AlertTriangle,
  Plus,
  Trash2,
  Eye,
} from "lucide-react";

export default function SettingsPage() {
  return (
    <>
      <Topbar
        crumbs={[{ label: "워크스페이스" }, { label: "설정", bold: true }]}
      />
      <div className="px-8 py-8 max-w-[1400px] mx-auto grid grid-cols-[220px_1fr] gap-8">
        <aside>
          <h2 className="text-[20px] font-extrabold text-ink-900 mb-4">설정</h2>
          <nav className="flex flex-col gap-1">
            <NavItem href="#general" Icon={Settings2} label="일반" active />
            <NavItem href="#whitelist" Icon={Users} label="화이트리스트" />
            <NavItem href="#api" Icon={Shield} label="API 키" />
            <NavItem href="#persona" Icon={UserCircle2} label="페르소나" />
            <NavItem href="#schedule" Icon={Clock} label="발행 시간" />
            <NavItem href="#cta" Icon={Link2} label="CTA · UTM" />
            <div className="h-px bg-ink-100 my-2"></div>
            <NavItem
              href="#danger"
              Icon={AlertTriangle}
              label="위험 영역"
              danger
            />
          </nav>
        </aside>

        <div className="space-y-6 animate-fade-up">
          <Card id="general" title="일반" desc="워크스페이스 기본 정보">
            <Field label="워크스페이스 이름" value="앤텔레콤 안심개통" />
            <Field
              label="티스토리 블로그 URL"
              value="https://dajjis.tistory.com"
            />
            <Field label="메인 사이트" value="https://ntelecomsafe.com" />
            <Field
              label="시간대"
              value="Asia/Seoul (KST · UTC+9)"
              disabled
            />
          </Card>

          <Card
            id="whitelist"
            title="화이트리스트"
            desc="등록된 Google 계정만 백오피스에 로그인할 수 있어요."
            action={
              <button className="h-9 px-3 rounded-xl bg-ink-900 hover:bg-ink-800 transition text-white text-[12px] font-bold flex items-center gap-1.5">
                <Plus size={11} strokeWidth={2.4} />
                이메일 추가
              </button>
            }
          >
            <div className="divide-y divide-ink-100 -mx-2">
              <UserRow
                initial="N"
                email="admin@ntelecomsafe.com"
                role="소유자"
                roleColor="bg-brand-50 text-brand-700"
                meta="소유자 · 마지막 로그인 1시간 전"
                gradient="from-brand-500 to-brand-700"
                deletable={false}
              />
              <UserRow
                initial="K"
                email="kim.editor@gmail.com"
                role="편집자"
                roleColor="bg-mint-50 text-mint-700"
                meta="편집자 · 마지막 로그인 어제"
                gradient="from-mint-500 to-mint-700"
              />
              <UserRow
                initial="P"
                email="park.assist@gmail.com"
                role="대기"
                roleColor="bg-amber-50 text-amber-700"
                meta="읽기 전용 · 초대 대기 중"
                gradient="from-amber-500 to-amber-700"
              />
            </div>
          </Card>

          <Card id="api" title="API 키" desc="외부 서비스 연동 키. 서버 환경변수로만 저장됩니다.">
            <div className="space-y-3">
              <ApiCard
                name="Gemini API"
                desc="글 자동 생성 · 이미지 HTML 생성"
                status="connected"
                masked="AIza••••••••••••••••••••••••••••0xKn"
                Icon={Shield}
                iconColor="#3182F6"
                iconBg="bg-brand-50"
              />
              <ApiCard
                name="Google Sheets API"
                desc="데이터베이스"
                status="connected"
                masked="service-account-•••••••••@gserviceaccount.com"
                Icon={Shield}
                iconColor="#00A076"
                iconBg="bg-mint-50"
              />
              <ApiCard
                name="Google Analytics 4"
                desc="전환 · 트래픽 추적"
                status="pending"
                Icon={Shield}
                iconColor="#D67700"
                iconBg="bg-amber-50"
              />
              <ApiCard
                name="Vercel Blob Storage"
                desc="이미지 저장소"
                status="connected"
                Icon={Shield}
                iconColor="#4E5968"
                iconBg="bg-ink-100"
              />
            </div>
          </Card>

          <Card
            id="persona"
            title="페르소나"
            desc="동일 패턴 글 양산 방지를 위해 페르소나를 로테이션합니다."
            action={
              <button className="h-9 px-3 rounded-xl bg-ink-900 hover:bg-ink-800 transition text-white text-[12px] font-bold flex items-center gap-1.5">
                <Plus size={11} strokeWidth={2.4} />
                추가
              </button>
            }
          >
            <div className="grid grid-cols-3 gap-3">
              <PersonaCard
                emoji="👨‍💻"
                name="IT 직장인"
                desc="30대, 합리적·데이터 기반. 친절한 존댓말, 가벼운 이모지 1~2개."
                stats="43개 글 · 평균 SEO 91"
                active
              />
              <PersonaCard
                emoji="👨‍🔧"
                name="자영업자"
                desc="40대, 실용적·결론부터. 짧은 문장, 격식 있는 존댓말."
                stats="52개 글 · 평균 SEO 88"
              />
              <PersonaCard
                emoji="🎓"
                name="대학생"
                desc="20대, 캐주얼·솔직. 반말+존댓말 혼용, 절약 키워드 강조."
                stats="33개 글 · 평균 SEO 89"
              />
            </div>
          </Card>

          <Card id="schedule" title="발행 시간" desc="매일 자동 생성 시간과 글 개수를 설정합니다.">
            <Field label="자동 생성 시간" value="09:00" hint="매일 KST 기준" />
            <Field
              label="하루 생성 개수"
              value="10"
              hint="최대 20개까지 설정 가능"
            />
          </Card>

          <div className="sticky bottom-4 flex items-center justify-between bg-ink-900 text-white rounded-2xl shadow-press px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-bold">
                저장되지 않은 변경사항이 있습니다
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button className="h-9 px-4 rounded-lg hover:bg-white/10 transition text-[13px] font-bold">
                취소
              </button>
              <button className="h-9 px-5 rounded-lg bg-brand-500 hover:bg-brand-600 transition text-[13px] font-extrabold">
                변경사항 저장
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function NavItem({
  href,
  Icon,
  label,
  active,
  danger,
}: {
  href: string;
  Icon: React.ElementType;
  label: string;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <a
      href={href}
      className={
        active
          ? "px-3 py-2.5 rounded-xl bg-brand-50 text-brand-700 text-[13px] font-bold flex items-center gap-2"
          : danger
            ? "px-3 py-2.5 rounded-xl text-rose-700 hover:bg-rose-50 transition text-[13px] font-bold flex items-center gap-2"
            : "px-3 py-2.5 rounded-xl text-ink-700 hover:bg-ink-100 transition text-[13px] font-bold flex items-center gap-2"
      }
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
  action,
}: {
  id: string;
  title: string;
  desc: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section id={id} className="bg-white rounded-2xl shadow-card p-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[16px] font-extrabold text-ink-900">{title}</h3>
        {action}
      </div>
      <p className="text-[12px] text-ink-500 mb-5">{desc}</p>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  hint,
  disabled,
}: {
  label: string;
  value: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-[160px_1fr] items-center gap-4">
      <label className="text-[13px] font-bold text-ink-700">{label}</label>
      <div className="flex items-center gap-3">
        <input
          type="text"
          defaultValue={value}
          disabled={disabled}
          className={
            disabled
              ? "h-11 px-3 rounded-xl border border-ink-200 bg-ink-50 text-[13px] font-medium text-ink-500 flex-1"
              : "h-11 px-3 rounded-xl border border-ink-200 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 outline-none text-[13px] font-medium transition flex-1"
          }
        />
        {hint && <span className="text-[12px] text-ink-500 whitespace-nowrap">{hint}</span>}
      </div>
    </div>
  );
}

function UserRow({
  initial,
  email,
  role,
  roleColor,
  meta,
  gradient,
  deletable = true,
}: {
  initial: string;
  email: string;
  role: string;
  roleColor: string;
  meta: string;
  gradient: string;
  deletable?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-2 py-3">
      <div
        className={`w-8 h-8 rounded-full bg-gradient-to-br ${gradient} text-white font-bold text-[12px] flex items-center justify-center`}
      >
        {initial}
      </div>
      <div className="flex-1">
        <div className="text-[13px] font-bold text-ink-900">{email}</div>
        <div className="text-[11px] text-ink-500">{meta}</div>
      </div>
      <span
        className={`text-[11px] font-bold ${roleColor} rounded-full px-2.5 py-1`}
      >
        {role}
      </span>
      {deletable && (
        <button className="w-8 h-8 rounded-lg hover:bg-rose-50 hover:text-rose-700 text-ink-400 transition flex items-center justify-center">
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

function ApiCard({
  name,
  desc,
  status,
  masked,
  Icon,
  iconColor,
  iconBg,
}: {
  name: string;
  desc: string;
  status: "connected" | "pending";
  masked?: string;
  Icon: React.ElementType;
  iconColor: string;
  iconBg: string;
}) {
  return (
    <div className="rounded-xl border border-ink-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center`}
          >
            <Icon size={16} color={iconColor} strokeWidth={2} />
          </div>
          <div>
            <div className="text-[13px] font-extrabold text-ink-900">{name}</div>
            <div className="text-[11px] text-ink-500 font-medium">{desc}</div>
          </div>
        </div>
        <span
          className={
            status === "connected"
              ? "text-[11px] font-bold bg-mint-50 text-mint-700 rounded-full px-2.5 py-1"
              : "text-[11px] font-bold bg-amber-50 text-amber-700 rounded-full px-2.5 py-1"
          }
        >
          {status === "connected" ? "연결됨" : "미연결"}
        </span>
      </div>
      {masked ? (
        <div className="flex items-center gap-2 mt-3 h-10 px-3 rounded-lg bg-ink-50 font-mono text-[12px] text-ink-700">
          {masked}
          <button className="ml-auto w-7 h-7 rounded hover:bg-ink-200 transition flex items-center justify-center">
            <Eye size={13} strokeWidth={2} className="text-ink-700" />
          </button>
        </div>
      ) : (
        <button className="mt-3 w-full h-10 rounded-lg border-2 border-dashed border-ink-300 hover:border-brand-500 hover:text-brand-600 text-ink-500 text-[12px] font-bold transition">
          + 측정 ID 입력
        </button>
      )}
    </div>
  );
}

function PersonaCard({
  emoji,
  name,
  desc,
  stats,
  active,
}: {
  emoji: string;
  name: string;
  desc: string;
  stats: string;
  active?: boolean;
}) {
  return (
    <div
      className={
        active
          ? "rounded-xl border-2 border-brand-500 bg-brand-50/40 p-4"
          : "rounded-xl border border-ink-200 p-4 hover:border-brand-300 transition"
      }
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[20px]">{emoji}</span>
        <span className="text-[13px] font-extrabold text-ink-900">{name}</span>
        <span
          className={
            active
              ? "ml-auto text-[10px] font-bold bg-brand-500 text-white rounded px-1.5 py-0.5"
              : "ml-auto text-[10px] font-bold bg-ink-100 text-ink-600 rounded px-1.5 py-0.5"
          }
        >
          활성
        </span>
      </div>
      <p className="text-[11px] text-ink-600 leading-relaxed">{desc}</p>
      <div className="flex items-center gap-1 mt-3 text-[10px] font-bold text-ink-500">
        <span>{stats}</span>
      </div>
    </div>
  );
}
