import { GoogleGenerativeAI } from "@google/generative-ai";
import type {
  GenerativeModel,
  GenerationConfig,
  Tool,
  GenerateContentResult,
} from "@google/generative-ai";
import { getGeminiKeysFromSheet, bumpGeminiUsage } from "./sheets";

/**
 * Gemini API 다중 키 fallback 클라이언트.
 *
 * 키 우선순위:
 *   1. settings 시트의 enabled=1 키 (백오피스에서 관리)
 *   2. fallback: GEMINI_API_KEYS env (콤마 구분)
 *
 * - 첫 번째 키부터 순서대로 시도
 * - 일시적 오류(429 rate limit, 5xx)에서만 fallback, 인증 오류(401/403)도 fallback
 * - 모든 키 소진 시 마지막 에러 throw
 * - 호출마다 usageMetadata 캡처 → bumpGeminiUsage()로 시트에 누적
 */

const ENV_RAW = process.env.GEMINI_API_KEYS ?? process.env.GEMINI_API_KEY ?? "";

const ENV_KEYS = ENV_RAW.split(",")
  .map((k) => k.trim())
  .filter(Boolean);

// 시트 키는 짧게 캐시 (60초) — 너무 자주 시트 API 부르지 않도록
let cachedSheetKeys: { keys: string[]; fetchedAt: number } | null = null;
const SHEET_KEY_TTL_MS = 60_000;

async function getSheetKeys(): Promise<string[]> {
  const now = Date.now();
  if (
    cachedSheetKeys &&
    now - cachedSheetKeys.fetchedAt < SHEET_KEY_TTL_MS
  ) {
    return cachedSheetKeys.keys;
  }
  try {
    const rows = await getGeminiKeysFromSheet();
    const keys = rows.map((r) => r.value).filter(Boolean);
    cachedSheetKeys = { keys, fetchedAt: now };
    return keys;
  } catch (err) {
    console.warn("[Gemini] settings 시트 키 로드 실패 — env fallback:", err);
    return [];
  }
}

/** 시트 + env 합쳐서 최종 키 목록 반환 (시트 우선, env는 fallback). */
async function resolveKeys(): Promise<string[]> {
  const sheetKeys = await getSheetKeys();
  if (sheetKeys.length > 0) return sheetKeys;
  return ENV_KEYS;
}

/** 다음 시도 시 시트 키를 다시 읽도록. settings 변경 후 호출. */
export function invalidateGeminiKeyCache() {
  cachedSheetKeys = null;
}

if (ENV_KEYS.length === 0 && process.env.NODE_ENV !== "test") {
  console.warn(
    "[Gemini] ⚠️ GEMINI_API_KEYS env 비어있음 — settings 시트 키만 사용 가능합니다.",
  );
}

const DEFAULT_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

/**
 * 모델 폴백 체인 — 한 모델이 일시 과부하(503)/한도(429)로 모든 키에서 막혀도
 * 같은 계열 다른 모델 서버는 멀쩡한 경우가 많아 자동으로 갈아탄다.
 * (Free Tier RPD 한도는 모델별로 분리돼 있어 429에도 효과 있음.)
 */
const MODEL_FALLBACKS: Record<string, string[]> = {
  "gemini-2.5-flash-lite": ["gemini-2.5-flash", "gemini-2.0-flash"],
  "gemini-2.5-flash": ["gemini-2.5-flash-lite", "gemini-2.0-flash"],
  "gemini-2.5-pro": ["gemini-2.5-flash"],
  "gemini-2.0-flash": ["gemini-2.0-flash-lite", "gemini-2.5-flash"],
};

/** primary 모델 + 폴백 모델들 (primary 중복 제거). */
function modelsToTry(primary: string): string[] {
  const fallbacks = MODEL_FALLBACKS[primary] ?? [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
  ];
  return [primary, ...fallbacks.filter((m) => m !== primary)];
}

function maskKey(key: string) {
  if (key.length < 12) return "***";
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

/**
 * 일시적 오류인지 판정. 일시적이면 다음 키로 fallback.
 * - 429: rate limit (분당/일일 한도 초과)
 * - 500/502/503/504: 서버 일시 오류
 * - 408: 타임아웃
 *
 * 401/403은 키 자체가 잘못된 것이므로 fallback 의미 있음 → true
 *  (다음 키가 정상일 수 있음)
 * 400(잘못된 요청), 404 등은 fallback해도 같은 결과 → false
 */
function isRetryableError(err: unknown): boolean {
  const status =
    (err as { status?: number })?.status ??
    (err as { response?: { status?: number } })?.response?.status ??
    (err as { httpStatus?: number })?.httpStatus;

  // 메시지 기반 휴리스틱 (Gemini SDK는 status를 항상 채우진 않음)
  const message = String((err as Error)?.message ?? "").toLowerCase();
  const messageSuggestsTransient =
    message.includes("rate limit") ||
    message.includes("quota") ||
    message.includes("resource_exhausted") ||
    message.includes("overloaded") ||
    message.includes("unavailable") ||
    message.includes("timeout") ||
    message.includes("internal error") ||
    message.includes("api key not valid") ||
    message.includes("permission denied");

  if (status) {
    return [401, 403, 408, 429, 500, 502, 503, 504].includes(status);
  }
  return messageSuggestsTransient;
}

/**
 * "모델 서버 전체" 문제인지 판정 (503/5xx/overloaded).
 * 이 경우 같은 모델에 다른 키를 써도 동일하게 실패하므로,
 * 키를 더 돌리지 말고 즉시 다음 폴백 "모델"로 점프해야 한다(시간 절약 + 504 회피).
 * 반면 429/401/403은 키 단위 문제 → 다음 "키"로 가는 게 맞다.
 */
function isModelWideError(err: unknown): boolean {
  const status =
    (err as { status?: number })?.status ??
    (err as { response?: { status?: number } })?.response?.status;
  if (status) return [500, 502, 503, 504].includes(status);
  const lower = String((err as Error)?.message ?? "").toLowerCase();
  return (
    lower.includes("unavailable") ||
    lower.includes("overloaded") ||
    lower.includes("high demand") ||
    lower.includes("internal error")
  );
}

/**
 * 최종 실패 메시지 — 마지막 에러 종류(503/429/인증/기타)에 맞춰
 * 사용자가 바로 이해·대응할 수 있는 문구를 만든다.
 * (기존 "모든 키 소진" 문구는 503에도 떠서 "할당량 소진"으로 오해를 부름)
 */
function describeFinalError(
  lastError: unknown,
  keysCount: number,
  models: string[],
): string {
  const msg = String((lastError as Error)?.message ?? lastError ?? "");
  const lower = msg.toLowerCase();
  const status =
    (lastError as { status?: number })?.status ??
    (lastError as { response?: { status?: number } })?.response?.status;
  const tried = `키 ${keysCount}개 × 모델 ${models.length}종(${models.join(
    ", ",
  )}) 모두 시도함`;

  // 503/5xx/overloaded → 구글 서버 일시 과부하 (할당량과 무관)
  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    lower.includes("unavailable") ||
    lower.includes("overloaded") ||
    lower.includes("high demand") ||
    lower.includes("internal error")
  ) {
    return `⏳ Gemini 서버 일시 과부하(${status ?? "5xx"}) — 구글 쪽 일시 현상이라 내 할당량과 무관합니다. ${tried}. 보통 1~5분 뒤 다시 시도하면 됩니다. 마지막 에러: ${msg}`;
  }
  // 429/quota → 호출 한도
  if (
    status === 429 ||
    lower.includes("quota") ||
    lower.includes("rate limit") ||
    lower.includes("resource_exhausted")
  ) {
    return `🚦 Gemini 호출 한도 도달(429) — 분당/일일 한도일 수 있습니다. ${tried}. 잠시 후 재시도하거나 키를 추가하세요. 마지막 에러: ${msg}`;
  }
  // 401/403 → 키 인증 문제
  if (
    status === 401 ||
    status === 403 ||
    lower.includes("api key not valid") ||
    lower.includes("permission denied")
  ) {
    return `🔑 Gemini API 키 인증 실패 — 키가 잘못됐거나 권한이 없습니다. 백오피스/env 키를 확인하세요. 마지막 에러: ${msg}`;
  }
  return `Gemini 호출 실패 — ${tried}. 마지막 에러: ${msg}`;
}

/**
 * 임의 작업을 키 + 모델 fallback과 함께 실행.
 * fn은 GenerativeModel을 받아 Promise를 반환하면 됨.
 * 순서: primary 모델로 키 전부 → 실패 시 폴백 모델로 키 전부 → …
 */
export async function generateWithFallback<T>(
  fn: (model: GenerativeModel) => Promise<T>,
  options: {
    model?: string;
    generationConfig?: GenerationConfig;
    tools?: Tool[];
  } = {},
): Promise<T> {
  const KEYS = await resolveKeys();
  if (KEYS.length === 0) {
    throw new Error(
      "Gemini API 키가 없습니다 — 백오피스 설정 또는 GEMINI_API_KEYS env 등록 필요.",
    );
  }

  const primary = options.model ?? DEFAULT_MODEL;
  const models = modelsToTry(primary);
  let lastError: unknown;

  for (let mi = 0; mi < models.length; mi++) {
    const modelName = models[mi];
    for (let i = 0; i < KEYS.length; i++) {
      const key = KEYS[i];
      const label = `${i + 1}/${KEYS.length} (${maskKey(key)})·${modelName}`;
      try {
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: options.generationConfig,
          tools: options.tools,
        });
        const result = await fn(model);
        if (i > 0 || mi > 0) {
          console.info(`[Gemini] ✅ ${label}로 fallback 성공`);
        }
        return result;
      } catch (err) {
        lastError = err;
        if (!isRetryableError(err)) throw err;
        const status = (err as { status?: number })?.status ?? "no-status";
        if (isModelWideError(err)) {
          // 모델 서버 과부하(503 등) — 같은 모델에 다른 키도 동일 실패 →
          // 남은 키 생략하고 즉시 다음 모델로 (시간 절약, 60초 타임아웃 회피)
          console.warn(
            `[Gemini] ${label} 모델 과부하(${status}) — 남은 키 생략, 다음 모델로`,
          );
          break;
        }
        // 키 단위 문제(429/인증) — 다음 키로
        console.warn(`[Gemini] ${label} 실패 (status=${status}) — 다음 키로`);
      }
    }
    if (mi < models.length - 1) {
      console.warn(`[Gemini] 모델 ${modelName} 실패 — 폴백 모델(${models[mi + 1]})로 전환`);
    }
  }

  throw new Error(describeFinalError(lastError, KEYS.length, models));
}

/**
 * 토큰 사용량 캡처 + 시트 누적 — generateContent 결과에서 usageMetadata 추출.
 * 실패해도 본 호출에 영향 없도록 try/catch.
 */
async function trackUsage(
  modelName: string,
  result: GenerateContentResult,
): Promise<void> {
  try {
    const usage = result.response.usageMetadata;
    if (!usage) return;
    await bumpGeminiUsage({
      model: modelName,
      inputTokens: usage.promptTokenCount ?? 0,
      outputTokens: usage.candidatesTokenCount ?? 0,
    });
  } catch (err) {
    console.warn("[Gemini] usage 기록 실패 (무시):", err);
  }
}

/**
 * 텍스트 생성 (가장 자주 쓰는 형태).
 */
export async function generateText(
  prompt: string,
  options: {
    model?: string;
    generationConfig?: GenerationConfig;
  } = {},
): Promise<string> {
  const modelName = options.model ?? DEFAULT_MODEL;
  return generateWithFallback(async (model) => {
    const result = await model.generateContent(prompt);
    await trackUsage(modelName, result);
    return result.response.text();
  }, options);
}

/**
 * JSON 출력 강제. 모델에 responseMimeType을 application/json으로 지정.
 * 자동 파싱 후 반환. 파싱 실패 시 원본 텍스트도 같이 throw.
 */
export async function generateJSON<T = unknown>(
  prompt: string,
  options: {
    model?: string;
    generationConfig?: GenerationConfig;
  } = {},
): Promise<T> {
  const modelName = options.model ?? DEFAULT_MODEL;
  const text = await generateWithFallback(async (model) => {
    const result = await model.generateContent(prompt);
    await trackUsage(modelName, result);
    return result.response.text();
  }, {
    ...options,
    generationConfig: {
      responseMimeType: "application/json",
      ...options.generationConfig,
    },
  });

  try {
    return JSON.parse(text) as T;
  } catch {
    // Gemini가 문자열 값 안에 raw 제어문자(줄바꿈/탭 등)를 넣어서
    // "Bad control character in string literal" 파싱 실패가 종종 발생.
    // → 문자열 리터럴 내부의 제어문자를 escape 처리 후 재시도.
    try {
      return JSON.parse(sanitizeJsonControlChars(text)) as T;
    } catch (err2) {
      throw new Error(
        `Gemini JSON 파싱 실패: ${(err2 as Error).message}\n원본: ${text.slice(0, 200)}…`,
      );
    }
  }
}

/**
 * JSON 문자열에서 "문자열 리터럴 내부"의 raw 제어문자를 escape.
 * 따옴표 안(in-string)일 때만 \n, \r, \t 등을 변환 — 구조용 공백은 보존.
 */
function sanitizeJsonControlChars(s: string): string {
  let out = "";
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = s.charCodeAt(i);
    if (inStr) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        out += ch;
        inStr = false;
        continue;
      }
      // 문자열 내부의 raw 제어문자 → escape
      if (code < 0x20) {
        if (ch === "\n") out += "\\n";
        else if (ch === "\r") out += "\\r";
        else if (ch === "\t") out += "\\t";
        else out += " "; // 기타 제어문자는 공백으로
        continue;
      }
      out += ch;
    } else {
      out += ch;
      if (ch === '"') inStr = true;
    }
  }
  return out;
}

/**
 * 모델별 Free Tier 일일 한도 (RPD = Requests Per Day).
 *
 * 출처: https://ai.google.dev/gemini-api/docs/rate-limits
 * 공식 문서는 정확한 수치를 AI Studio에서 보라 하지만, 2026년 검증된 값:
 *   - gemini-2.5-flash-lite: 1500 RPD
 *   - gemini-2.5-flash: 1500 RPD (Lite와 동일)
 *   - gemini-2.5-pro: 250 RPD
 *
 * .env.local에 GEMINI_RPD_OVERRIDE 설정 시 그 값 우선 사용.
 */
const MODEL_DAILY_LIMITS: Record<string, number> = {
  "gemini-2.5-flash-lite": 1500,
  "gemini-2.5-flash": 1500,
  "gemini-2.5-pro": 250,
  "gemini-2.0-flash-lite": 1500,
  "gemini-2.0-flash": 1500,
  "gemini-1.5-flash": 1500,
  "gemini-1.5-flash-8b": 1500,
  "gemini-1.5-pro": 50,
};

/** 현재 사용 중인 모델의 Free Tier RPD 한도. */
export function getDailyRpdPerKey(model: string = DEFAULT_MODEL): number {
  const envOverride = process.env.GEMINI_RPD_OVERRIDE;
  if (envOverride && /^\d+$/.test(envOverride)) {
    return parseInt(envOverride, 10);
  }
  return MODEL_DAILY_LIMITS[model] ?? 1500;
}

/**
 * 현재 키 상태 — async (시트 + env 합본).
 */
export async function geminiKeyStatus() {
  const keys = await resolveKeys();
  const sheetKeys = await getSheetKeys();
  const rpdPerKey = getDailyRpdPerKey(DEFAULT_MODEL);
  return {
    count: keys.length,
    keys: keys.map(maskKey),
    model: DEFAULT_MODEL,
    source:
      sheetKeys.length > 0 ? ("sheet" as const) : ("env" as const),
    envCount: ENV_KEYS.length,
    sheetCount: sheetKeys.length,
    /** 모델별 키 1개당 무료 일일 한도 (RPD). */
    rpdPerKey,
    /** 키 N개 합산 일일 한도. 키 5개 × 1500 = 7500. */
    dailyLimit: keys.length * rpdPerKey,
  };
}
