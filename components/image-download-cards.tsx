"use client";

import { useRef, useState } from "react";
import { Download, Loader2, Check } from "lucide-react";
import html2canvas from "html2canvas";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  keyword: string;
  category: string;
  metaDescription?: string;
  idForFilename: string;
};

type CardSpec = {
  key: string;
  label: string;
  filename: string;
  width: number;
  height: number;
};

const CARDS: CardSpec[] = [
  { key: "thumb", label: "썸네일 (OG)", filename: "thumbnail", width: 1200, height: 630 },
  { key: "core", label: "핵심 정보 카드", filename: "core", width: 1080, height: 1080 },
  { key: "step", label: "5단계 인포그래픽", filename: "steps", width: 1200, height: 800 },
  { key: "cta", label: "CTA 배너", filename: "cta", width: 1200, height: 500 },
  { key: "faq", label: "Q&A 카드", filename: "faq", width: 1080, height: 1080 },
];

export function ImageDownloadCards({
  title,
  keyword,
  category,
  metaDescription,
  idForFilename,
}: Props) {
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  const download = async (spec: CardSpec) => {
    const el = refs.current[spec.key];
    if (!el) return;
    setBusy(spec.key);
    try {
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        backgroundColor: null,
        logging: false,
      });
      const link = document.createElement("a");
      link.download = `${idForFilename}-${spec.filename}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      setDone((s) => new Set(s).add(spec.key));
      setTimeout(
        () =>
          setDone((s) => {
            const ns = new Set(s);
            ns.delete(spec.key);
            return ns;
          }),
        2000,
      );
    } catch (err) {
      console.error("이미지 생성 실패", err);
      alert(`이미지 생성 실패: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const downloadAll = async () => {
    for (const c of CARDS) await download(c);
  };

  return (
    <>
      <div className="bg-white rounded-2xl shadow-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-[15px] font-extrabold text-ink-900">
              섹션 이미지
            </h3>
            <p className="text-[11px] text-ink-500 mt-0.5">
              5장 · 클릭해서 PNG 다운로드
            </p>
          </div>
          <button
            onClick={downloadAll}
            disabled={busy !== null}
            className="h-9 px-3 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-50 transition text-white text-[12px] font-bold flex items-center gap-1.5"
          >
            <Download size={13} strokeWidth={2.2} />
            전체 다운로드
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {CARDS.map((spec) => (
            <button
              key={spec.key}
              onClick={() => download(spec)}
              disabled={busy !== null}
              className={cn(
                "relative aspect-[4/3] rounded-xl overflow-hidden group cursor-pointer transition border-2",
                done.has(spec.key)
                  ? "border-mint-500"
                  : "border-transparent hover:border-brand-300",
                busy === spec.key && "opacity-60",
              )}
            >
              <CardPreview spec={spec} title={title} keyword={keyword} category={category} />
              <div className="absolute inset-0 flex items-end p-3 bg-gradient-to-t from-black/50 to-transparent">
                <span className="text-[11px] font-bold text-white">
                  {spec.label}
                </span>
              </div>
              <div className="absolute top-2 right-2 w-7 h-7 rounded-lg bg-white/95 backdrop-blur flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                {busy === spec.key ? (
                  <Loader2 size={13} className="animate-spin text-ink-700" />
                ) : done.has(spec.key) ? (
                  <Check size={13} strokeWidth={3} className="text-mint-700" />
                ) : (
                  <Download size={13} className="text-ink-700" />
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* === 실제 캡처 대상 (off-screen, 고해상도) === */}
      <div
        style={{
          position: "fixed",
          left: "-99999px",
          top: 0,
          pointerEvents: "none",
        }}
        aria-hidden="true"
      >
        {/* 1. 썸네일 (1200x630) */}
        <div
          ref={(el) => {
            refs.current["thumb"] = el;
          }}
          style={{
            width: 1200,
            height: 630,
            background: "linear-gradient(135deg,#F4F9E0 0%,#EAF5BD 100%)",
            padding: 80,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            fontFamily: "Pretendard Variable, sans-serif",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 40,
              right: 50,
              width: 220,
              height: 220,
              borderRadius: "50%",
              background: "rgba(157,201,26,0.18)",
            }}
          />
          <div style={{ position: "relative", zIndex: 1 }}>
            <div
              style={{
                display: "inline-block",
                background: "#9DC91A",
                color: "white",
                padding: "8px 18px",
                borderRadius: 999,
                fontSize: 18,
                fontWeight: 800,
                marginBottom: 20,
              }}
            >
              {category}
            </div>
            <h1
              style={{
                fontSize: 56,
                fontWeight: 900,
                color: "#191F28",
                lineHeight: 1.25,
                margin: 0,
                letterSpacing: "-0.02em",
              }}
            >
              {title.length > 40 ? title.slice(0, 40) + "…" : title}
            </h1>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              position: "relative",
              zIndex: 1,
            }}
          >
            <span style={{ fontSize: 22, fontWeight: 700, color: "#5F7C0E" }}>
              # {keyword}
            </span>
            <span
              style={{
                fontSize: 18,
                fontWeight: 800,
                color: "#191F28",
                background: "white",
                padding: "10px 20px",
                borderRadius: 12,
              }}
            >
              앤텔레콤 안심개통
            </span>
          </div>
        </div>

        {/* 2. 핵심 정보 카드 (1080x1080) */}
        <div
          ref={(el) => {
            refs.current["core"] = el;
          }}
          style={{
            width: 1080,
            height: 1080,
            background: "white",
            padding: 90,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            fontFamily: "Pretendard Variable, sans-serif",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
              background: "#9DC91A",
              color: "white",
              padding: "10px 22px",
              borderRadius: 999,
              fontSize: 20,
              fontWeight: 800,
              alignSelf: "flex-start",
              marginBottom: 32,
            }}
          >
            ✦ 핵심
          </div>
          <h2
            style={{
              fontSize: 56,
              fontWeight: 900,
              color: "#191F28",
              lineHeight: 1.3,
              margin: "0 0 32px",
              letterSpacing: "-0.02em",
            }}
          >
            {keyword}, 5분 안에 끝내는 비대면 셀프개통
          </h2>
          <div
            style={{
              background: "linear-gradient(135deg,#F4F9E0 0%,#EAF5BD 100%)",
              border: "1px solid #D4E89C",
              borderRadius: 20,
              padding: 36,
              fontSize: 26,
              fontWeight: 600,
              color: "#333D4B",
              lineHeight: 1.7,
            }}
          >
            {metaDescription
              ? metaDescription.slice(0, 100)
              : `${keyword} 진행에 필요한 모든 정보를 한 번에 확인하세요.`}
          </div>
          <div
            style={{
              marginTop: 40,
              display: "flex",
              justifyContent: "flex-end",
              fontSize: 22,
              fontWeight: 800,
              color: "#5F7C0E",
            }}
          >
            ntelecomsafe.com
          </div>
        </div>

        {/* 3. 5단계 인포그래픽 (1200x800) */}
        <div
          ref={(el) => {
            refs.current["step"] = el;
          }}
          style={{
            width: 1200,
            height: 800,
            background: "white",
            padding: 70,
            fontFamily: "Pretendard Variable, sans-serif",
          }}
        >
          <h2
            style={{
              fontSize: 42,
              fontWeight: 900,
              color: "#191F28",
              marginBottom: 16,
              letterSpacing: "-0.02em",
            }}
          >
            5분 비대면 셀프개통
          </h2>
          <p
            style={{
              fontSize: 22,
              color: "#5F7C0E",
              fontWeight: 600,
              marginBottom: 36,
            }}
          >
            {keyword} — 5단계로 끝
          </p>
          <div style={{ display: "flex", gap: 20 }}>
            {[
              { n: 1, t: "신청서 작성", d: "공식 페이지 접속" },
              { n: 2, t: "본인 인증", d: "PASS·카카오·삼성페이" },
              { n: 3, t: "유심 정보 입력", d: "KT 바로유심 / LG 원칩" },
              { n: 4, t: "요금제 선택", d: "사용 패턴에 맞춰" },
              { n: 5, t: "충전 완료", d: "5분 안에 사용 가능" },
            ].map((s, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  background:
                    i === 4
                      ? "linear-gradient(135deg,#9DC91A 0%,#7FA512 100%)"
                      : "#F4F9E0",
                  border: "1px solid #D4E89C",
                  borderRadius: 16,
                  padding: 24,
                  textAlign: "center",
                  color: i === 4 ? "white" : "#191F28",
                }}
              >
                <div
                  style={{
                    fontSize: 48,
                    fontWeight: 900,
                    marginBottom: 12,
                    color: i === 4 ? "#FFFFFF" : "#5F7C0E",
                  }}
                >
                  {s.n}
                </div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 800,
                    marginBottom: 8,
                  }}
                >
                  {s.t}
                </div>
                <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.5 }}>
                  {s.d}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 4. CTA 배너 (1200x500) */}
        <div
          ref={(el) => {
            refs.current["cta"] = el;
          }}
          style={{
            width: 1200,
            height: 500,
            background: "linear-gradient(135deg,#9DC91A 0%,#7FA512 100%)",
            padding: 80,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontFamily: "Pretendard Variable, sans-serif",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: "white",
                marginBottom: 16,
                opacity: 0.9,
              }}
            >
              📱 {keyword}, 지금 시작
            </div>
            <h2
              style={{
                fontSize: 56,
                fontWeight: 900,
                color: "white",
                lineHeight: 1.2,
                margin: "0 0 24px",
                letterSpacing: "-0.02em",
              }}
            >
              5분이면 끝
              <br />
              비대면 셀프개통
            </h2>
            <div style={{ fontSize: 20, fontWeight: 600, color: "white", opacity: 0.92 }}>
              신용조회 X · 약정 X · 위약금 X
            </div>
          </div>
          <div
            style={{
              background: "white",
              borderRadius: 20,
              padding: "32px 48px",
              fontSize: 28,
              fontWeight: 900,
              color: "#5F7C0E",
              boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
            }}
          >
            지금 개통 →
          </div>
        </div>

        {/* 5. Q&A 카드 (1080x1080) */}
        <div
          ref={(el) => {
            refs.current["faq"] = el;
          }}
          style={{
            width: 1080,
            height: 1080,
            background: "linear-gradient(135deg,#F4F9E0 0%,#EAF5BD 100%)",
            padding: 80,
            fontFamily: "Pretendard Variable, sans-serif",
          }}
        >
          <h2
            style={{
              fontSize: 48,
              fontWeight: 900,
              color: "#191F28",
              marginBottom: 50,
              letterSpacing: "-0.02em",
            }}
          >
            자주 묻는 질문
          </h2>
          {[
            { q: "신용조회 정말 안 하나요?", a: "네, 선불제라 신용 평가 불필요합니다." },
            { q: "약정·위약금 있나요?", a: "전혀 없습니다. 언제든 중단 가능." },
            { q: "외국인도 가능한가요?", a: "외국인등록증으로 가능합니다." },
            { q: "5분이면 진짜 끝?", a: "비대면 셀프로 평균 4~6분 안에 완료." },
          ].map((item, i) => (
            <div
              key={i}
              style={{
                background: "white",
                borderRadius: 16,
                padding: 28,
                marginBottom: 16,
                boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
              }}
            >
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 800,
                  color: "#191F28",
                  marginBottom: 10,
                }}
              >
                Q. {item.q}
              </div>
              <div
                style={{
                  fontSize: 19,
                  color: "#4E5968",
                  lineHeight: 1.6,
                  fontWeight: 500,
                }}
              >
                A. {item.a}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function CardPreview({
  spec,
  title,
  keyword,
  category,
}: {
  spec: CardSpec;
  title: string;
  keyword: string;
  category: string;
}) {
  // 미리보기는 단순한 색상 카드 (실제 이미지는 off-screen에서 캡처)
  const styles: Record<string, React.CSSProperties> = {
    thumb: {
      background: "linear-gradient(135deg,#F4F9E0 0%,#EAF5BD 100%)",
      padding: 12,
      color: "#191F28",
    },
    core: {
      background: "white",
      padding: 12,
      border: "1px solid #E5E8EB",
      color: "#191F28",
    },
    step: {
      background: "white",
      padding: 12,
      color: "#191F28",
    },
    cta: {
      background: "linear-gradient(135deg,#9DC91A 0%,#7FA512 100%)",
      padding: 12,
      color: "white",
    },
    faq: {
      background: "linear-gradient(135deg,#F4F9E0 0%,#EAF5BD 100%)",
      padding: 12,
      color: "#191F28",
    },
  };
  const label: Record<string, string> = {
    thumb: title.slice(0, 20),
    core: "✦ 핵심",
    step: "1 → 2 → 3 → 4 → 5",
    cta: "5분 비대면",
    faq: "Q&A",
  };
  return (
    <div
      style={styles[spec.key]}
      className="w-full h-full flex flex-col justify-center items-center text-center"
    >
      <div className="text-[10px] font-extrabold leading-tight px-2 line-clamp-3">
        {label[spec.key]}
      </div>
    </div>
  );
}
