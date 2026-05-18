"use client";

import { useRef, useState, useMemo } from "react";
import { Download, Loader2, Check, Images } from "lucide-react";
import html2canvas from "html2canvas";
import { cn } from "@/lib/utils";
import {
  extractCardData,
  type CardData,
  type CoverCard,
  type SectionCard,
} from "@/lib/extract-card-data";

type Props = {
  title: string;
  keyword: string;
  category: string;
  contentHtml: string;
  idForFilename: string;
};

const CARD_SIZE = 1080; // 1080x1080 인스타 정사각형

export function CardNewsCards({
  title,
  keyword,
  category,
  contentHtml,
  idForFilename,
}: Props) {
  const cards = useMemo(
    () =>
      extractCardData({
        title,
        keyword,
        category,
        contentHtml,
      }),
    [title, keyword, category, contentHtml],
  );

  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [doneAll, setDoneAll] = useState(false);
  const [done, setDone] = useState<Set<number>>(new Set());

  const sectionCount = cards.filter((c) => c.type === "section").length;

  const downloadOne = async (idx: number) => {
    const key = `card-${idx}`;
    const el = refs.current[key];
    if (!el) return;
    setBusy(idx);
    try {
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        backgroundColor: null,
        logging: false,
      });
      const link = document.createElement("a");
      const suffix =
        cards[idx].type === "cover"
          ? "cover"
          : `card-${(cards[idx] as SectionCard).pageNum}`;
      link.download = `${idForFilename}-${suffix}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      setDone((s) => new Set(s).add(idx));
      setTimeout(
        () =>
          setDone((s) => {
            const ns = new Set(s);
            ns.delete(idx);
            return ns;
          }),
        2000,
      );
    } catch (err) {
      console.error("카드뉴스 생성 실패", err);
      alert(`이미지 생성 실패: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const downloadAll = async () => {
    setDoneAll(false);
    for (let i = 0; i < cards.length; i++) {
      await downloadOne(i);
      // 너무 빠르게 연속 다운로드되면 브라우저가 막을 수 있어 약간 텀
      await new Promise((r) => setTimeout(r, 200));
    }
    setDoneAll(true);
    setTimeout(() => setDoneAll(false), 3000);
  };

  if (sectionCount === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-card p-6">
        <h3 className="text-[15px] font-extrabold text-ink-900 mb-2">
          카드뉴스
        </h3>
        <p className="text-[12px] text-ink-500">
          본문에서 H2 섹션을 찾지 못해 카드 생성 불가합니다.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white rounded-2xl shadow-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-[15px] font-extrabold text-ink-900 flex items-center gap-1.5">
              <Images size={14} className="text-brand-600" />
              카드뉴스
            </h3>
            <p className="text-[11px] text-ink-500 mt-0.5">
              {cards.length}장 · 1080×1080 인스타 · Q&A 제외
            </p>
          </div>
          <button
            onClick={downloadAll}
            disabled={busy !== null}
            className={cn(
              "h-9 px-3 rounded-xl transition text-[12px] font-bold flex items-center gap-1.5",
              doneAll
                ? "bg-mint-500 text-white"
                : "bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white",
            )}
          >
            {doneAll ? (
              <>
                <Check size={13} strokeWidth={3} />
                전체 완료
              </>
            ) : (
              <>
                <Download size={13} strokeWidth={2.2} />
                전체 다운로드
              </>
            )}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          {cards.map((card, idx) => (
            <button
              key={idx}
              onClick={() => downloadOne(idx)}
              disabled={busy !== null}
              className={cn(
                "relative aspect-square rounded-xl overflow-hidden group cursor-pointer transition border-2 bg-ink-50",
                done.has(idx)
                  ? "border-mint-500"
                  : "border-transparent hover:border-brand-300",
                busy === idx && "opacity-60",
              )}
            >
              <CardThumbnail card={card} />
              <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/60 text-white text-[10px] font-bold">
                {card.type === "cover"
                  ? "표지"
                  : `${card.pageNum}/${card.totalPages}`}
              </div>
              <div className="absolute top-1.5 right-1.5 w-7 h-7 rounded-lg bg-white/95 backdrop-blur flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                {busy === idx ? (
                  <Loader2 size={13} className="animate-spin text-ink-700" />
                ) : done.has(idx) ? (
                  <Check size={13} strokeWidth={3} className="text-mint-700" />
                ) : (
                  <Download size={13} className="text-ink-700" />
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* === 실제 캡처 대상 (off-screen, 1080x1080) === */}
      <div
        style={{
          position: "fixed",
          left: "-99999px",
          top: 0,
          pointerEvents: "none",
        }}
        aria-hidden="true"
      >
        {cards.map((card, idx) => (
          <div
            key={idx}
            ref={(el) => {
              refs.current[`card-${idx}`] = el;
            }}
            style={{
              width: CARD_SIZE,
              height: CARD_SIZE,
              fontFamily:
                "Pretendard Variable, Pretendard, -apple-system, system-ui, sans-serif",
              letterSpacing: "-0.02em",
              overflow: "hidden",
              position: "relative",
            }}
          >
            {card.type === "cover" ? (
              <CoverCardRender card={card} />
            ) : (
              <SectionCardRender card={card} />
            )}
          </div>
        ))}
      </div>
    </>
  );
}

// ─── 미니 썸네일 (UI 그리드용) ─────────────────────
function CardThumbnail({ card }: { card: CardData }) {
  if (card.type === "cover") {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center p-2 text-center"
        style={{
          background: "linear-gradient(135deg,#F4F9E0 0%,#EAF5BD 100%)",
        }}
      >
        <div
          className="text-[8px] font-bold mb-1 px-1.5 py-0.5 rounded-full"
          style={{ background: "#9DC91A", color: "white" }}
        >
          {card.category}
        </div>
        <div className="text-[10px] font-extrabold text-ink-900 line-clamp-3 leading-tight px-1">
          {card.title}
        </div>
      </div>
    );
  }
  return (
    <div
      className="w-full h-full flex flex-col p-2"
      style={{ background: "white" }}
    >
      <div
        className="text-[7px] font-bold inline-block self-start px-1.5 py-0.5 rounded mb-1"
        style={{ background: "#F4F9E0", color: "#5F7C0E" }}
      >
        {card.pageNum}/{card.totalPages}
      </div>
      <div className="text-[9px] font-extrabold text-ink-900 line-clamp-3 leading-tight">
        {card.title}
      </div>
      {card.subtitle && (
        <div
          className="text-[7px] font-bold mt-0.5 line-clamp-1"
          style={{ color: "#5F7C0E" }}
        >
          {card.subtitle}
        </div>
      )}
    </div>
  );
}

// ─── 표지 카드 (1080×1080) ─────────────────────
function CoverCardRender({ card }: { card: CoverCard }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "linear-gradient(135deg,#F4F9E0 0%,#EAF5BD 100%)",
        padding: 80,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        position: "relative",
      }}
    >
      {/* 우상단 라임 원 */}
      <div
        style={{
          position: "absolute",
          top: -60,
          right: -60,
          width: 280,
          height: 280,
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
            padding: "10px 22px",
            borderRadius: 999,
            fontSize: 22,
            fontWeight: 800,
            marginBottom: 28,
          }}
        >
          {card.category}
        </div>
        <h1
          style={{
            fontSize: 64,
            fontWeight: 900,
            color: "#191F28",
            lineHeight: 1.25,
            margin: 0,
            letterSpacing: "-0.02em",
            wordBreak: "keep-all",
          }}
        >
          {card.title.length > 50 ? card.title.slice(0, 50) + "…" : card.title}
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
        <span
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: "#5F7C0E",
          }}
        >
          # {card.keyword}
        </span>
        <span
          style={{
            fontSize: 22,
            fontWeight: 800,
            color: "#191F28",
            background: "white",
            padding: "12px 22px",
            borderRadius: 14,
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          }}
        >
          앤텔레콤 안심개통
        </span>
      </div>
    </div>
  );
}

// ─── 섹션 카드 (1080×1080) ─────────────────────
function SectionCardRender({ card }: { card: SectionCard }) {
  // 제목에서 숫자) 부분 분리
  const numberMatch = card.title.match(/^(\d+\))\s*(.+)$/);
  const num = numberMatch ? numberMatch[1] : null;
  const titleRest = numberMatch ? numberMatch[2] : card.title;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "white",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* 상단 라임 헤더 */}
      <div
        style={{
          background: "linear-gradient(135deg,#F4F9E0 0%,#EAF5BD 100%)",
          padding: "60px 70px 40px",
          borderBottom: "1px solid #D4E89C",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 24,
          }}
        >
          {num ? (
            <div
              style={{
                background: "#9DC91A",
                color: "white",
                width: 64,
                height: 64,
                borderRadius: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                fontWeight: 900,
              }}
            >
              {num.replace(")", "")}
            </div>
          ) : (
            <div style={{ width: 64 }} />
          )}
          <div
            style={{
              fontSize: 18,
              fontWeight: 800,
              color: "#5F7C0E",
              background: "rgba(255,255,255,0.7)",
              padding: "8px 18px",
              borderRadius: 999,
            }}
          >
            {card.pageNum} / {card.totalPages}
          </div>
        </div>
        <h2
          style={{
            fontSize: 52,
            fontWeight: 900,
            color: "#191F28",
            lineHeight: 1.25,
            margin: 0,
            letterSpacing: "-0.02em",
            wordBreak: "keep-all",
          }}
        >
          {titleRest.length > 45 ? titleRest.slice(0, 45) + "…" : titleRest}
        </h2>
        {card.subtitle && (
          <p
            style={{
              fontSize: 22,
              color: "#5F7C0E",
              fontWeight: 700,
              margin: "16px 0 0",
              lineHeight: 1.5,
              wordBreak: "keep-all",
            }}
          >
            {card.subtitle.length > 60
              ? card.subtitle.slice(0, 60) + "…"
              : card.subtitle}
          </p>
        )}
      </div>

      {/* 본문 영역 */}
      <div
        style={{
          flex: 1,
          padding: "50px 70px 40px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        {card.body ? (
          <p
            style={{
              fontSize: 28,
              lineHeight: 1.7,
              color: "#191F28",
              margin: 0,
              fontWeight: 500,
              wordBreak: "keep-all",
            }}
          >
            {card.body.length > 180 ? card.body.slice(0, 180) + "…" : card.body}
          </p>
        ) : (
          <div />
        )}

        {/* 푸터 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 32,
            borderTop: "1px solid #E5E8EB",
          }}
        >
          <span
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: "#191F28",
            }}
          >
            앤텔레콤 안심개통
          </span>
          <span
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#5F7C0E",
            }}
          >
            ntelecomsafe.com
          </span>
        </div>
      </div>
    </div>
  );
}
