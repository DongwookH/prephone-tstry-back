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
 * 임의 작업을 키 fallback과 함께 실행.
 * fn은 GenerativeModel을 받아 Promise를 반환하면 됨.
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

  const modelName = options.model ?? DEFAULT_MODEL;
  let lastError: unknown;

  for (let i = 0; i < KEYS.length; i++) {
    const key = KEYS[i];
    const label = `${i + 1}/${KEYS.length} (${maskKey(key)})`;
    try {
      const genAI = new GoogleGenerativeAI(key);
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: options.generationConfig,
        tools: options.tools,
      });
      const result = await fn(model);
      if (i > 0) {
        console.info(`[Gemini] ✅ 키 ${label}로 fallback 성공`);
      }
      return result;
    } catch (err) {
      lastError = err;
      const retryable = isRetryableError(err);
      const status =
        (err as { status?: number })?.status ?? "no-status";
      console.warn(
        `[Gemini] 키 ${label} 실패 (status=${status}): ${
          (err as Error)?.message ?? err
        }${retryable ? " — 다음 키로 fallback" : " — 즉시 중단"}`,
      );
      if (!retryable) throw err;
    }
  }

  throw new Error(
    `모든 Gemini API 키(${KEYS.length}개) 소진. 마지막 에러: ${
      (lastError as Error)?.message ?? lastError
    }`,
  );
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
