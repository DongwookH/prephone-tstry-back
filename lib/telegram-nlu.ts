import { getThreadsDrafts } from "./sheets";
import type { ThreadsDraftRow } from "./sheets";
import { findOverdue, kstLabel } from "./threads-publish-core";
import { generateJSON } from "./gemini";

/**
 * 텔레그램 봇용 자연어 이해(NLU) 모듈.
 *
 * 운영자(1명, 한국어)가 "2시꺼 발행됐어?", "내일 뭐 나가?",
 * "이번주 몇 개 남았어?" 같은 일반 문장을 보내면,
 * Threads 발행 시트의 실제 데이터를 근거로 자연어로 답한다.
 *
 * 안전 원칙 (중요):
 *  - 이 모듈은 발행을 절대 실행하지 않는다. 발행 함수는 import조차 하지 않는다.
 *  - intent가 "publish"여도 확인 문구 + 버튼만 반환 →
 *    실제 발행은 기존 웹훅의 버튼 핸들러(callback_data="publish")가 수행.
 *  - Gemini는 컨텍스트에 있는 사실만 답하도록 강제 (환각 금지).
 */

/** NLU 결과 — 텔레그램 전송용 텍스트 + 선택 버튼. */
type NluResult = {
  text: string;
  buttons?: { text: string; callback_data: string }[];
};

/** Gemini에 강제하는 출력 JSON 스키마. */
type NluJson = {
  intent: "status" | "publish" | "other";
  reply: string;
};

/** 컨텍스트에 포함할 KST 범위 — 과거 2일 ~ 미래 8일. */
const CONTEXT_PAST_DAYS = 2;
const CONTEXT_FUTURE_DAYS = 8;

/**
 * 텔레그램 parse_mode=HTML로 전송되므로 <, >, & 를 이스케이프.
 * Gemini 출력에 이 문자들이 섞여 들어와 HTML 태그로 오인되는 것을 막는다.
 * (모델이 <b> 등을 직접 쓰지 않게 프롬프트로도 지시하지만, 이중 안전장치.)
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 드래프트 상태 코드를 사람이 읽을 한국어 라벨로. */
function statusLabel(d: ThreadsDraftRow): string {
  if (d.published_id) return "published(발행완료)";
  switch (d.status) {
    case "published":
      return "published(발행완료)";
    case "scheduled":
      return "scheduled(승인됨)";
    case "pending":
      return "pending(검토대기)";
    case "failed":
      return "failed(실패)";
    case "rejected":
      return "rejected(반려)";
    default:
      return d.status || "unknown";
  }
}

/** 오늘(KST) 발행분인지 — scheduled_at 우선, 없으면 published_at 기준. */
function isTodayKst(iso: string, todayKst: string): boolean {
  if (!iso) return false;
  return (
    new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }) ===
    todayKst
  );
}

/**
 * getThreadsDrafts() 전체에서 KST 과거 2일~미래 8일 범위만 추려
 * 컴팩트한 텍스트 컨텍스트를 만든다 (전체 140건 덤프 금지, 2~4KB 이내).
 *
 * 포함 정보:
 *  - 현재 KST 시각
 *  - 오늘 발행 수
 *  - 연체(findOverdue) 목록
 *  - 검토대기 총 수
 *  - 범위 내 항목: KST 예약시각 / 키워드 / 상태 / 발행여부
 */
function buildContext(all: ThreadsDraftRow[], now: number): string {
  const lowerBound = now - CONTEXT_PAST_DAYS * 24 * 60 * 60 * 1000;
  const upperBound = now + CONTEXT_FUTURE_DAYS * 24 * 60 * 60 * 1000;
  const todayKst = new Date(now).toLocaleDateString("en-CA", {
    timeZone: "Asia/Seoul",
  });

  // 범위 판정용 기준 시각 — 예약시각 우선, 없으면 발행시각.
  const inRange = all.filter((d) => {
    const ref = d.scheduled_at || d.published_at;
    if (!ref) return false;
    const t = new Date(ref).getTime();
    return isFinite(t) && t >= lowerBound && t <= upperBound;
  });

  // 시간순 정렬 (오래된 것 → 미래 순).
  inRange.sort((a, b) => {
    const ra = a.scheduled_at || a.published_at || "";
    const rb = b.scheduled_at || b.published_at || "";
    return ra.localeCompare(rb);
  });

  const publishedToday = all.filter(
    (d) =>
      d.published_id &&
      isTodayKst(d.scheduled_at || d.published_at, todayKst),
  );
  const overdue = findOverdue(all, now);
  const pendingReview = all.filter(
    (d) => d.status === "pending" && !d.published_id,
  );

  const lines: string[] = [];
  lines.push(`현재 KST 시각: ${kstLabel(new Date(now).toISOString())}`);
  lines.push(`오늘(KST ${todayKst}) 발행 수: ${publishedToday.length}건`);
  lines.push(`검토대기(pending) 총 수: ${pendingReview.length}건`);
  lines.push(
    `상태 의미: 발행완료=이미 게시됨 / 승인됨=예약시각에 자동 발행됨 / 검토대기=아직 승인 전이라 승인하지 않으면 발행되지 않음`,
  );

  lines.push("");
  lines.push(`연체(예약시각 지났는데 미발행): ${overdue.length}건`);
  for (const d of overdue) {
    lines.push(`  - ${kstLabel(d.scheduled_at)} | ${d.keyword}`);
  }

  lines.push("");
  lines.push(
    `예약/발행 목록 (KST 과거 ${CONTEXT_PAST_DAYS}일~미래 ${CONTEXT_FUTURE_DAYS}일, ${inRange.length}건):`,
  );
  if (inRange.length === 0) {
    lines.push("  (해당 범위에 항목 없음)");
  }

  // 날짜별 그룹 헤더 — 모델이 옆 행/옆 날짜와 혼동(잘못된 바인딩)하는 것을 막는다.
  const dayKey = (iso: string) =>
    new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const dayTag = (key: string) => {
    const diff =
      (new Date(key + "T00:00:00+09:00").getTime() -
        new Date(todayKst + "T00:00:00+09:00").getTime()) /
      86400000;
    if (diff === 0) return " ← 오늘";
    if (diff === 1) return " ← 내일";
    if (diff === -1) return " ← 어제";
    return "";
  };
  let curDay = "";
  for (const d of inRange) {
    const ref = d.scheduled_at || d.published_at;
    const k = dayKey(ref);
    if (k !== curDay) {
      curDay = k;
      lines.push(`■ ${kstLabel(ref).replace(/\s\d{2}:\d{2}$/, "")}${dayTag(k)}`);
    }
    const timeOnly = kstLabel(ref).match(/\d{2}:\d{2}$/)?.[0] ?? "";
    const publishedMark = d.published_id ? "발행됨" : "미발행";
    lines.push(
      `  - ${timeOnly} | 키워드: ${d.keyword} | ${statusLabel(d)} | ${publishedMark}`,
    );
  }

  return lines.join("\n");
}

/** Gemini에 보낼 프롬프트 구성. */
function buildPrompt(userText: string, context: string): string {
  return [
    "당신은 Threads 발행 자동화 시스템의 상태 안내 비서입니다.",
    "운영자(한국어 사용, 1명)가 보낸 메시지에 대해, 아래 실제 데이터만 근거로 답하세요.",
    "",
    "=== 데이터(사실) ===",
    context,
    "=== 데이터 끝 ===",
    "",
    "규칙:",
    "1. 위 데이터에 있는 사실만으로 답하세요. 데이터에 없는 내용은 지어내지 말고 '데이터에 없어요'라고 말하세요. (환각 절대 금지)",
    "   답하기 전에 해당 행을 정확히 찾고, 그 행의 시각·키워드·상태·발행여부를 **그 행에서 그대로** 인용하세요. 다른 행과 절대 섞지 마세요.",
    "   날짜가 언급되면(오늘/내일/요일) 반드시 해당 ■ 날짜 그룹 안의 행만 사용하세요.",
    "2. intent 판정:",
    "   - 발행 실행을 요구하면(예: '발행해줘', '올려줘', '지금 내보내') → \"publish\"",
    "   - 현황/확인 질문(예: '2시꺼 발행됐어?', '내일 뭐 나가?', '이번주 몇 개 남았어?') → \"status\"",
    "   - 그 외 잡담/무관한 내용 → \"other\"",
    "3. reply 작성 규칙:",
    "   - 짧게(2~6줄), 줄바꿈으로 끊어서, 질문에 콕 맞는 답만 하세요.",
    "   - 시각은 '오후 2시(13:59)' 같은 친근한 표현을 쓰세요.",
    "   - reply는 평문으로만 쓰세요. <b> 같은 HTML 태그나 <, >, & 기호를 직접 넣지 마세요.",
    "4. intent가 'publish'면 reply에 '지금 밀린 발행을 진행할까요?' 같은 확인 문구를 넣으세요 (실제 발행은 하지 않습니다).",
    "",
    `운영자 메시지: ${userText}`,
    "",
    '출력은 반드시 이 JSON 스키마만: { "intent": "status" | "publish" | "other", "reply": "사용자에게 보낼 한국어 답변" }',
  ].join("\n");
}

/**
 * 자연어 메시지를 처리해 텔레그램 전송용 답변을 만든다.
 *
 * 다른 에이전트가 이 시그니처로 이미 통합 중이므로 계약을 지킨다.
 *
 * 흐름:
 *  1. getThreadsDrafts()로 전체 드래프트 로드 → KST 범위 컨텍스트 구축
 *  2. Gemini(generateJSON)로 intent + reply 판정
 *  3. intent에 맞는 버튼 부착 (publish여도 실행하지 않고 버튼만)
 *  4. HTML 이스케이프 후 반환
 *
 * 실패 시 throw하지 않고 안내 폴백 텍스트를 반환한다.
 */
export async function handleNaturalMessage(
  text: string,
): Promise<{ text: string; buttons?: { text: string; callback_data: string }[] }> {
  const fallback: NluResult = {
    text: "잘 못 알아들었어요. /status (현황) 또는 /publish (밀린 발행) 을 써주세요.",
  };

  try {
    const now = Date.now();
    const all = await getThreadsDrafts();
    const context = buildContext(all, now);
    const prompt = buildPrompt(text, context);

    const parsed = await generateJSON<NluJson>(prompt, {
      // NLU는 하루 몇 번 호출이라 비용 무관 — 행 바인딩 정확도가 중요해서
      // 기본(flash-lite)보다 강한 flash를 명시 사용. (lite는 표 정독에 약해 옆 행과 섞음)
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.25,
        maxOutputTokens: 1024,
      },
    });

    const reply = typeof parsed?.reply === "string" ? parsed.reply.trim() : "";
    if (!reply) return fallback;

    const safeReply = escapeHtml(reply);
    const intent = parsed.intent;

    if (intent === "publish") {
      // 발행은 실행하지 않는다 — 확인 버튼만 붙여 웹훅 핸들러로 위임.
      return {
        text: safeReply,
        buttons: [{ text: "🚀 발행 진행", callback_data: "publish" }],
      };
    }

    if (intent === "status") {
      return {
        text: safeReply,
        buttons: [{ text: "📊 전체 현황", callback_data: "status" }],
      };
    }

    // other — 버튼 없이 답변만.
    return { text: safeReply };
  } catch (err) {
    console.warn("[telegram-nlu] 처리 실패 — 폴백 반환:", err);
    return fallback;
  }
}
