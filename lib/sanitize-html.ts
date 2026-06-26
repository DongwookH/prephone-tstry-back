/**
 * 티스토리 sanitizer 안전 후처리 — Gemini가 prompt 규칙을 어겨도 자동 복구.
 *
 * 핵심 변환:
 *  0) 마크다운 강조(**, __) → <strong> (텍스트 노드만, attribute 안 *는 건드림 X)
 *  1) <details>/<summary> → <section> + 헤더 <div> + 본문 (평탄 구조)
 *     - 사용자가 티스토리 비주얼 에디터에서 이미지 자유 삽입 가능
 *     - 토글 기능 제거 (default 펼침 == 항상 펼침)
 *     - summary 안 자식 태그/마커는 텍스트만 추출, ▼ 마커도 제거
 *
 * 정규식 기반 idempotent — 이미 변환된 HTML에 재호출해도 안전.
 * client/server 양쪽 모두 사용 가능 (외부 의존성 없음).
 */

export function sanitizeForTistory(html: string): string {
  if (!html) return html;

  // (00) <script>/<style>/<noscript> 블록 제거 (가장 먼저).
  //   블로그 본문에 불필요하고, 티스토리/정적 사이트에선 실행되지 않아
  //   코드가 그대로 "SCRIPT" 텍스트로 노출됨. 인라인 style="" 속성은 건드리지 않음.
  let out = stripScriptStyleBlocks(html);

  // (0) 마크다운 잔재 → HTML
  out = transformMarkdownEmphasis(out);

  // (1) <details>/<summary> 블록을 <section> + 헤더 div + 본문으로 변환
  //     중첩 details도 안전 — 가장 안쪽부터 반복 변환
  let pass = 0;
  while (pass < 5) {
    const before = out;
    out = out.replace(
      // 가장 안쪽 details (안에 다른 details가 없는 패턴)
      /<details\b([^>]*?)>((?:(?!<details\b)[\s\S])*?)<\/details>/gi,
      (full, detailsAttrs: string, detailsInner: string) => {
        // 1-A. summary 추출
        const summaryMatch = detailsInner.match(
          /<summary\b([^>]*)>([\s\S]*?)<\/summary>/i,
        );
        if (!summaryMatch) {
          return `<section${detailsAttrs.replace(/\sopen(?=[\s>=]|$)/gi, "")}>${detailsInner}</section>`;
        }
        const summaryAttrs = summaryMatch[1];
        const summaryInner = summaryMatch[2];

        // 1-B. summary 텍스트 정리 (▼ 마커 제거, 자식 태그 텍스트만)
        const titleText = summaryInner
          .replace(/<[^>]+>/g, "")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/^[▼▶▽▸\s]+/, "")
          .replace(/[−–—+\-▼▲▾▿\s]+$/, "")
          .replace(/\s+/g, " ")
          .trim();

        if (!titleText) {
          return `<section${detailsAttrs.replace(/\sopen(?=[\s>=]|$)/gi, "")}>${detailsInner}</section>`;
        }

        // 1-C. summary style 정리 (cursor:pointer, list-style:none 제거)
        const summaryStyleMatch = summaryAttrs.match(/style="([^"]*)"/i);
        const summaryStyle = summaryStyleMatch
          ? summaryStyleMatch[1]
              .replace(/cursor\s*:\s*[^;]+;?/gi, "")
              .replace(/list-style\s*:\s*[^;]+;?/gi, "")
              .replace(/^\s*;+|;+\s*$/g, "")
              .trim()
          : "padding:20px 24px 6px;background:linear-gradient(135deg,#F4F9E0 0%,#EAF5BD 100%);font-size:18px;font-weight:800;color:#191F28;line-height:1.4;";

        // 1-D. details attributes에서 open 제거
        const sectionAttrs = detailsAttrs
          .replace(/\sopen(?=[\s>=]|$)/gi, "")
          .replace(/\sopen$/gi, "");

        // 1-E. summary 제거한 inner
        const innerWithoutSummary = detailsInner.replace(summaryMatch[0], "");

        return `<section${sectionAttrs}><div style="${summaryStyle}">${titleText}</div>${innerWithoutSummary}</section>`;
      },
    );
    if (out === before) break;
    pass += 1;
  }

  // (2) <section id="section-N"> → <div class="ntc-section" id="section-N">
  //     티스토리 비주얼 에디터가 <section>을 한 덩어리로 인식해
  //     내부 이미지 삽입을 막는 문제 회피.
  out = out.replace(
    /<section\b([^>]*)>/gi,
    (_match, attrs: string) => {
      // 이미 ntc-section class 있으면 그대로
      if (/class\s*=\s*["'][^"']*ntc-section/i.test(attrs)) {
        return `<div${attrs}>`;
      }
      // class 속성 있으면 ntc-section 추가
      if (/class\s*=\s*["']([^"']*)["']/i.test(attrs)) {
        const newAttrs = attrs.replace(
          /class\s*=\s*["']([^"']*)["']/i,
          (_m, c) => `class="ntc-section ${c}"`,
        );
        return `<div${newAttrs}>`;
      }
      // class 없으면 추가
      return `<div class="ntc-section"${attrs}>`;
    },
  );
  out = out.replace(/<\/section>/gi, "</div>");

  return out;
}

/**
 * <script>/<style>/<noscript> 블록과 짝 없는 잔여 태그를 제거.
 * 인라인 style="..." 속성은 보존 (블록 태그만 대상).
 */
function stripScriptStyleBlocks(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, "")
    // 닫는 태그 누락 등으로 남은 단독 script/style/noscript 태그
    .replace(/<\/?(?:script|style|noscript)\b[^>]*>/gi, "");
}

/**
 * HTML 태그 바깥의 텍스트 노드에서만 마크다운 강조를 HTML로 변환.
 * 태그 attribute 안의 * 는 건드리지 않음.
 */
function transformMarkdownEmphasis(html: string): string {
  const parts = html.split(/(<[^>]+>)/g);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (part.startsWith("<") && part.endsWith(">")) continue;
    let text = part;
    text = text.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/__([^_\n]+?)__/g, "<strong>$1</strong>");
    parts[i] = text;
  }
  return parts.join("");
}
