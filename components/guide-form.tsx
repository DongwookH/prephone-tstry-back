"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Check,
  AlertTriangle,
  ChevronDown,
  Store,
  Link2,
  MessageCircle,
  Phone,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { saveGuideAction } from "@/app/(dashboard)/guide/actions";
import type { TenantGuideRaw } from "@/lib/tenant-config";

/**
 * 「내 가이드」 폼.
 *
 * 필수 3묶음(판매점명 · 링크 · 회사 정보)을 도메인 용어의 개별 칸으로
 * 나눠서 받고, 선택 항목과 자유형식 원문은 접어 둔다. 진행률은 서버의
 * missingRequiredGuideSections와 같은 규칙을 클라이언트에서도 계산해 즉시
 * 반영한다 — 저장 전에도 "지금 채우면 통과인지"가 보여야 하기 때문.
 */

type Fields = TenantGuideRaw;

const REQUIRED_GROUPS = [
  { key: "brand_name", label: "판매점명" },
  { key: "links", label: "링크" },
  { key: "company", label: "회사 정보" },
] as const;

/** 서버의 missingRequiredGuideSections와 동일 규칙 (조립 후 기준). */
function missingGroups(f: Fields): string[] {
  const out: string[] = [];
  if (!f.brand_name.trim()) out.push("brand_name");
  const hasLink =
    !!f.link_site.trim() || !!f.link_kakao.trim() || /https?:\/\//i.test(f.links);
  if (!hasLink) out.push("links");
  const hasCompany =
    !!f.phone.trim() || !!f.hours.trim() || !!f.company.trim();
  if (!hasCompany) out.push("company");
  // 요금표는 입력 항목이 없다 — 항상 공통 요금표를 쓴다 (2026-07-28 결정)
  return out;
}

export function GuideForm({ initial }: { initial: Fields }) {
  const router = useRouter();
  const [f, setF] = useState<Fields>(initial);
  const [openOptional, setOpenOptional] = useState(false);
  const [openAdvanced, setOpenAdvanced] = useState(
    !!initial.company || !!initial.links,
  );
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  const set = (key: keyof Fields) => (value: string) =>
    setF((prev) => ({ ...prev, [key]: value }));

  const missing = missingGroups(f);
  const done = REQUIRED_GROUPS.length - missing.length;

  const handleSave = () => {
    setMsg(null);
    start(async () => {
      const res = await saveGuideAction(f);
      if (res.ok) {
        setMsg({
          kind: "ok",
          text:
            missing.length === 0
              ? "저장했습니다 — 내일 아침부터 글이 생성됩니다"
              : "저장했습니다 (아직 필수 항목이 남아 있어요)",
        });
        router.refresh();
      } else {
        setMsg({ kind: "err", text: res.error });
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* ── 진행률 ── */}
      <section className="bg-white rounded-2xl shadow-card p-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-[15px] font-extrabold text-ink-900">
              작성 진행률
            </h3>
            <p className="text-[12px] text-ink-500 mt-0.5">
              {missing.length === 0
                ? "필수 항목을 모두 채웠습니다. 글 생성 조건 충족!"
                : `필수 ${REQUIRED_GROUPS.length}개 중 ${done}개 완료 — 나머지를 채워야 글이 생성됩니다`}
            </p>
          </div>
          <span
            className={cn(
              "text-[13px] font-extrabold tabular-nums",
              missing.length === 0 ? "text-mint-700" : "text-amber-700",
            )}
          >
            {done} / {REQUIRED_GROUPS.length}
          </span>
        </div>
        <div className="h-2 bg-ink-100 rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              missing.length === 0 ? "bg-mint-500" : "bg-amber-500",
            )}
            style={{ width: `${(done / REQUIRED_GROUPS.length) * 100}%` }}
          />
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          {REQUIRED_GROUPS.map((g) => {
            const ok = !missing.includes(g.key);
            return (
              <span
                key={g.key}
                className={cn(
                  "inline-flex items-center gap-1.5 text-[11px] font-bold rounded-full px-2.5 py-1",
                  ok
                    ? "bg-mint-50 text-mint-700"
                    : "bg-amber-50 text-amber-700",
                )}
              >
                {ok ? <Check size={11} strokeWidth={3} /> : <AlertTriangle size={11} />}
                {g.label}
              </span>
            );
          })}
        </div>
      </section>

      {/* ── 필수 ── */}
      <section className="bg-white rounded-2xl shadow-card p-6">
        <h3 className="text-[16px] font-extrabold text-ink-900">기본 정보</h3>
        <p className="text-[12px] text-ink-500 mb-5 mt-1">
          글에 들어갈 내 가게 정보입니다. 여기 적은 내용만 글에 표기됩니다.
          요금표는 공통 요금표를 그대로 사용하므로 따로 적지 않아도 됩니다.
        </p>
        <div className="space-y-4">
          <Field
            Icon={Store}
            label="판매점명"
            required
            value={f.brand_name}
            onChange={set("brand_name")}
            placeholder="예: 홍길동텔레콤"
            hint="글 본문과 상단 배너에 표기될 이름입니다."
          />
          <Field
            Icon={Link2}
            label="개통 사이트 링크"
            value={f.link_site}
            onChange={set("link_site")}
            placeholder="https://내사이트.com/신청"
            hint="글 상단 첫 번째 버튼이 됩니다. 사이트가 없으면 비워두세요."
          />
          <Field
            Icon={MessageCircle}
            label="카카오톡 채널 링크"
            value={f.link_kakao}
            onChange={set("link_kakao")}
            placeholder="https://pf.kakao.com/_xxxxx"
            hint="카카오톡 채널 관리자센터 → 채널 홈 URL을 복사해 붙여넣으세요."
          />
          <Callout show={missing.includes("links")}>
            개통 사이트·카카오톡 채널 중 <strong>최소 하나</strong>는 있어야
            합니다. 글에서 손님이 눌러 들어올 곳이 없으면 글을 쓸 수 없습니다.
          </Callout>
          <Field
            Icon={Phone}
            label="전화번호"
            value={f.phone}
            onChange={set("phone")}
            placeholder="예: 010-0000-0000"
          />
          <Field
            Icon={Clock}
            label="영업시간"
            value={f.hours}
            onChange={set("hours")}
            placeholder="예: 평일 09:00~19:00, 주말 휴무"
          />
          <Callout show={missing.includes("company")}>
            전화번호·영업시간·회사 소개 중 <strong>최소 하나</strong>는 필요합니다.
          </Callout>
        </div>
      </section>

      {/* ── 선택 ── */}
      <Collapsible
        title="글쓰기 취향 (선택)"
        desc="비워두면 공통 기본값을 사용합니다."
        open={openOptional}
        onToggle={() => setOpenOptional((v) => !v)}
      >
        <Field
          label="타깃 독자"
          multiline
          rows={3}
          value={f.personas}
          onChange={set("personas")}
          placeholder={"한 줄에 하나씩\n예: 가격 비교 중인 30대 직장인"}
        />
        <Field
          label="쓰면 안 되는 말"
          multiline
          rows={2}
          value={f.banned_words}
          onChange={set("banned_words")}
          placeholder="콤마로 구분. 예: 최저가, 업계1위"
          hint="공통 금지어에 더해서 적용됩니다."
        />
        <Field
          label="추가 규칙"
          multiline
          rows={3}
          value={f.extra_rules}
          onChange={set("extra_rules")}
          placeholder="예: 이모지는 쓰지 않는다. 존댓말로만 쓴다."
          hint="공통 가이드와 충돌하면 여기 적은 내용이 우선합니다."
        />
        <Field
          label="자주 받는 질문"
          multiline
          rows={5}
          value={f.faq}
          onChange={set("faq")}
          placeholder={"Q. 당일 개통 되나요?\nA. 영업시간 내 접수 시 당일 처리됩니다."}
          hint="글의 Q&A 부분에 반영됩니다."
        />
      </Collapsible>

      {/* ── 고급 ── */}
      <Collapsible
        title="고급: 직접 입력"
        desc="위 칸으로 표현이 안 되는 내용을 원문 그대로 넣는 자리입니다."
        open={openAdvanced}
        onToggle={() => setOpenAdvanced((v) => !v)}
      >
        <Field
          label="회사 소개 (추가)"
          multiline
          rows={3}
          value={f.company}
          onChange={set("company")}
          placeholder="판매점명·전화·영업시간은 자동으로 붙습니다. 그 외 덧붙일 소개만 적으세요."
        />
        <Field
          label="추가 링크"
          multiline
          rows={3}
          value={f.links}
          onChange={set("links")}
          placeholder={"한 줄에 하나씩 '이름: URL'\n예: 블로그: https://..."}
          hint="개통 사이트·카카오톡 외에 더 넣고 싶을 때만 사용하세요."
        />
      </Collapsible>

      {/* ── 저장 ── */}
      <div className="sticky bottom-0 bg-ink-50/90 backdrop-blur-xl border-t border-ink-200 -mx-8 px-8 py-4 flex items-center justify-between gap-4">
        <div className="text-[12px] font-semibold min-h-[18px]">
          {msg && (
            <span
              className={
                msg.kind === "ok" ? "text-mint-700" : "text-rose-500"
              }
            >
              {msg.text}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="h-11 px-6 rounded-xl bg-brand-500 text-white text-[14px] font-extrabold hover:bg-brand-600 transition disabled:opacity-60 flex items-center gap-2"
        >
          {pending ? (
            <>
              <Loader2 size={15} className="animate-spin" /> 저장 중
            </>
          ) : (
            "저장하기"
          )}
        </button>
      </div>
    </div>
  );
}

// ─── 조각들 ─────────────────────────────────

function Field({
  Icon,
  label,
  required,
  value,
  onChange,
  placeholder,
  hint,
  multiline,
  rows = 3,
}: {
  Icon?: React.ElementType;
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  multiline?: boolean;
  rows?: number;
}) {
  const base =
    "w-full px-3 py-2.5 rounded-xl border border-ink-200 bg-white text-[13.5px] text-ink-900 placeholder:text-ink-400 focus:outline-none focus:border-brand-500 transition";
  return (
    <div>
      <label className="flex items-center gap-1.5 text-[13px] font-bold text-ink-800 mb-1.5">
        {Icon && <Icon size={13} className="text-ink-500" />}
        {label}
        {required && <span className="text-rose-500">*</span>}
      </label>
      {multiline ? (
        <textarea
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(base, "resize-y leading-relaxed")}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(base, "h-11 py-0")}
        />
      )}
      {hint && (
        <p className="text-[11px] text-ink-500 mt-1.5 leading-relaxed">{hint}</p>
      )}
    </div>
  );
}

function Callout({
  show,
  children,
}: {
  show: boolean;
  children: React.ReactNode;
}) {
  if (!show) return null;
  return (
    <div className="flex items-start gap-2 bg-amber-50/70 rounded-xl p-3 text-[11.5px] text-amber-800 leading-relaxed">
      <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

function Collapsible({
  title,
  desc,
  open,
  onToggle,
  children,
}: {
  title: string;
  desc: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-2xl shadow-card overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-4 p-6 text-left hover:bg-ink-50/50 transition"
      >
        <div>
          <h3 className="text-[16px] font-extrabold text-ink-900">{title}</h3>
          <p className="text-[12px] text-ink-500 mt-1">{desc}</p>
        </div>
        <ChevronDown
          size={18}
          className={cn(
            "text-ink-500 flex-shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && <div className="px-6 pb-6 space-y-4">{children}</div>}
    </section>
  );
}
