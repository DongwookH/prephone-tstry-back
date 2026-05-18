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
              {cards.length}장 (표지 1 + 섹션 {cards.length - 1}) · 1080×1080 · Q&A 제외
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
            padding: "12px 22px 10px",
            borderRadius: 999,
            fontSize: 22,
            fontWeight: 800,
            marginBottom: 28,
            lineHeight: 1,
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
            lineHeight: 1,
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
            padding: "14px 22px 12px",
            borderRadius: 14,
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            lineHeight: 1,
          }}
        >
          앤텔레콤 안심개통
        </span>
      </div>
    </div>
  );
}

// ─── 섹션 카드 (1080×1080) — 인포그래픽 스타일 ─────────────────────
function SectionCardRender({ card }: { card: SectionCard }) {
  // 제목에서 숫자) 부분 분리
  const numberMatch = card.title.match(/^(\d+\))\s*(.+)$/);
  const num = numberMatch ? numberMatch[1] : null;
  const titleRest = numberMatch ? numberMatch[2] : card.title;

  // 제목 길이별 폰트 크기 자동 조정
  const titleLen = titleRest.length;
  const titleSize = titleLen > 30 ? 40 : titleLen > 20 ? 46 : 52;

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
      {/* 상단 라임 헤더 (제목까지만 — 부제는 본문 영역으로 옮김) */}
      <div
        style={{
          background: "linear-gradient(135deg,#F4F9E0 0%,#EAF5BD 100%)",
          padding: "56px 70px 40px",
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
                fontSize: 32,
                fontWeight: 900,
                lineHeight: 1,
                // Pretendard의 라틴 숫자 baseline 보정
                paddingTop: 4,
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
              padding: "10px 18px 8px",
              borderRadius: 999,
              lineHeight: 1,
            }}
          >
            {card.pageNum} / {card.totalPages}
          </div>
        </div>
        <h2
          style={{
            fontSize: titleSize,
            fontWeight: 900,
            color: "#191F28",
            lineHeight: 1.25,
            margin: 0,
            letterSpacing: "-0.02em",
            wordBreak: "keep-all",
          }}
        >
          {titleRest}
        </h2>
      </div>

      {/* 본문 영역 — 인포그래픽 (hook + bullets) */}
      <div
        style={{
          flex: 1,
          padding: "44px 70px 40px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {/* Hook — 강조 한 줄 (부제 또는 hook). border-left와 텍스트 정렬 일치. */}
          {(card.subtitle || card.hook) && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 18,
              }}
            >
              <div
                style={{
                  width: 5,
                  alignSelf: "stretch",
                  background: "#9DC91A",
                  borderRadius: 3,
                  minHeight: 40,
                }}
              />
              <div
                style={{
                  fontSize: 26,
                  lineHeight: 1.45,
                  color: "#191F28",
                  fontWeight: 700,
                  wordBreak: "keep-all",
                  flex: 1,
                }}
              >
                {card.subtitle || card.hook}
              </div>
            </div>
          )}

          {/* Bullets — 체크리스트 또는 단계 */}
          {card.bullets && card.bullets.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              {card.bullets.slice(0, 4).map((b, i) => (
                <BulletRow
                  key={i}
                  index={i}
                  text={b}
                  style={card.bulletStyle ?? "checklist"}
                />
              ))}
            </div>
          )}

          {/* fallback: bullets 없으면 hook을 큰 텍스트로 (이미 hook 위에 출력했으니 중복 X) */}
          {!card.bullets && !card.subtitle && !card.hook && (
            <div
              style={{
                fontSize: 24,
                color: "#8B95A1",
                fontStyle: "italic",
              }}
            >
              {/* 의도적으로 비움 — 정보 부족한 카드는 깨끗하게 */}
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 24,
            borderTop: "1px solid #E5E8EB",
            lineHeight: 1,
          }}
        >
          <span
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: "#191F28",
              lineHeight: 1,
            }}
          >
            앤텔레콤 안심개통
          </span>
          <span
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#5F7C0E",
              lineHeight: 1,
            }}
          >
            ntelecomsafe.com
          </span>
        </div>
      </div>
    </div>
  );
}

function BulletRow({
  index,
  text,
  style,
}: {
  index: number;
  text: string;
  style: "checklist" | "steps";
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center", // ← 정중앙 정렬 (text 1줄 가정)
        gap: 16,
        background: "#F8FBE8",
        border: "1px solid #E1EFA8",
        borderRadius: 14,
        padding: "14px 20px",
        minHeight: 72, // ← 일관된 높이 (텍스트 1줄이든 짧든)
      }}
    >
      {style === "steps" ? (
        <div
          style={{
            flexShrink: 0,
            width: 44,
            height: 44,
            borderRadius: 10,
            background: "linear-gradient(135deg,#9DC91A 0%,#7FA512 100%)",
            color: "white",
            fontSize: 24,
            fontWeight: 900,
            lineHeight: 1, // ← 글자 박스 = 정확한 폰트 크기
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            // 한글 폰트의 라틴 숫자 baseline 보정 (Pretendard에서 미세하게 위로 떠 보임)
            paddingTop: 3,
          }}
        >
          {index + 1}
        </div>
      ) : (
        <div
          style={{
            flexShrink: 0,
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: "#9DC91A",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* ✓ 유니코드는 폰트마다 metric이 다르므로 SVG로 정중앙 보장 */}
          <svg
            width={22}
            height={22}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M5 12.5L10 17.5L19.5 7"
              stroke="white"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )}
      <div
        style={{
          fontSize: 24,
          color: "#191F28",
          fontWeight: 600,
          lineHeight: 1.4,
          wordBreak: "keep-all",
          flex: 1,
        }}
      >
        {text.length > 48 ? text.slice(0, 48) + "…" : text}
      </div>
    </div>
  );
}
