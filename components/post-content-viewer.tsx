"use client";

import { useState } from "react";
import { Copy, Check, Code2, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = "html" | "preview";

export function PostContentViewer({
  contentHtml,
  charCount,
}: {
  contentHtml: string;
  charCount: number;
}) {
  const [tab, setTab] = useState<Tab>("html");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  const handleCopy = async () => {
    try {
      // 1) ClipboardItem로 HTML + plain text 둘 다 복사
      //    → 티스토리 비주얼 에디터에 붙여넣으면 서식 살아있고,
      //    → 티스토리 HTML 모드 또는 메모장에 붙여넣으면 raw HTML 코드가 그대로
      if (
        typeof ClipboardItem !== "undefined" &&
        navigator.clipboard &&
        window.isSecureContext
      ) {
        const htmlBlob = new Blob([contentHtml], { type: "text/html" });
        const textBlob = new Blob([contentHtml], { type: "text/plain" });
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": htmlBlob,
            "text/plain": textBlob,
          }),
        ]);
        setCopyState("copied");
      } else if (navigator.clipboard && window.isSecureContext) {
        // 2) Fallback — text만 (raw HTML 문자열)
        await navigator.clipboard.writeText(contentHtml);
        setCopyState("copied");
      } else {
        // 3) execCommand fallback (구형 브라우저)
        const ta = document.createElement("textarea");
        ta.value = contentHtml;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        setCopyState(ok ? "copied" : "failed");
      }
    } catch (err) {
      console.error("copy failed", err);
      setCopyState("failed");
    }
    setTimeout(() => setCopyState("idle"), 2000);
  };

  const readMinutes = Math.max(1, Math.round(charCount / 800));

  // iframe srcdoc — 외부 CSS 영향 차단하고 글 인라인 스타일만 적용
  const iframeSrcDoc = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    font-family: "Pretendard Variable", Pretendard, -apple-system, system-ui, sans-serif;
    letter-spacing: -0.01em;
    color: #191F28;
    background: #FFFFFF;
    -webkit-font-smoothing: antialiased;
  }
  body { padding: 24px; }
  img { max-width: 100%; height: auto; }
  details > summary { cursor: pointer; }
  /* details/summary 기본 marker 표시 (브라우저별 ▶ ▼) */
  a { color: inherit; }
</style>
</head>
<body>
${contentHtml || "<p style='color:#8B95A1;'>미리보기할 내용이 없습니다.</p>"}
</body>
</html>`;

  return (
    <div
      className="bg-white rounded-2xl shadow-card overflow-hidden flex flex-col"
      style={{ height: "calc(100vh - 220px)" }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-ink-100">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-ink-100">
          <button
            onClick={() => setTab("html")}
            className={cn(
              "px-4 h-8 rounded-lg text-[12px] flex items-center gap-1.5 transition",
              tab === "html"
                ? "bg-white shadow-card font-bold text-ink-900"
                : "font-semibold text-ink-600 hover:text-ink-900",
            )}
          >
            <Code2 size={13} />
            HTML
          </button>
          <button
            onClick={() => setTab("preview")}
            className={cn(
              "px-4 h-8 rounded-lg text-[12px] flex items-center gap-1.5 transition",
              tab === "preview"
                ? "bg-white shadow-card font-bold text-ink-900"
                : "font-semibold text-ink-600 hover:text-ink-900",
            )}
          >
            <Eye size={13} />
            미리보기
          </button>
        </div>
        <button
          onClick={handleCopy}
          disabled={copyState === "copied"}
          className={cn(
            "h-10 px-5 rounded-xl transition text-[13px] font-bold flex items-center gap-2 shadow-press",
            copyState === "copied"
              ? "bg-mint-500 text-white"
              : copyState === "failed"
                ? "bg-rose-500 text-white"
                : "bg-ink-900 hover:bg-ink-800 text-white",
          )}
        >
          {copyState === "copied" ? (
            <>
              <Check size={14} strokeWidth={3} />
              복사됨!
            </>
          ) : copyState === "failed" ? (
            <>
              <Copy size={14} />
              복사 실패
            </>
          ) : (
            <>
              <Copy size={14} />
              전체 복사
            </>
          )}
        </button>
      </div>

      {/* 본문 영역 */}
      {tab === "html" ? (
        <div className="flex-1 overflow-auto px-5 py-4 bg-ink-50 font-mono text-[12.5px] leading-relaxed text-ink-800">
          <pre className="whitespace-pre-wrap break-all">
            {contentHtml ||
              "// 글 내용이 비어있습니다. 자동 생성이 아직 안 됐거나 실패한 글일 수 있어요."}
          </pre>
        </div>
      ) : (
        <iframe
          srcDoc={iframeSrcDoc}
          title="글 미리보기"
          sandbox="allow-same-origin"
          className="flex-1 w-full border-0 bg-white"
        />
      )}

      <div className="px-5 py-3 border-t border-ink-100 bg-white flex items-center justify-between text-[12px]">
        <div className="flex items-center gap-4 text-ink-500 font-medium">
          <span>
            {tab === "html"
              ? "HTML 소스 (티스토리 HTML 모드 붙여넣기용)"
              : "미리보기 (티스토리 발행 후 모습)"}
          </span>
          <span>·</span>
          <span>{charCount > 0 ? `${charCount.toLocaleString()}자` : "-"}</span>
          <span>·</span>
          <span>읽기 약 {readMinutes}분</span>
        </div>
        <div className="flex items-center gap-1.5 text-mint-700 font-bold">
          <span className="w-1.5 h-1.5 rounded-full bg-mint-500"></span>
          Sheet 연동
        </div>
      </div>
    </div>
  );
}
