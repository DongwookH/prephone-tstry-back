import { GoogleGenerativeAI } from "@google/generative-ai";
import type {
  GenerativeModel,
  GenerationConfig,
  Tool,
} from "@google/generative-ai";

/**
 * Gemini API 다중 키 fallback 클라이언트.
 *
 * - GEMINI_API_KEYS=key1,key2,key3 (콤마 구분, 공백 허용)
 * - 첫 번째 키부터 순서대로 시도
 * - 일시적 오류(429 rate limit, 5xx)에서만 fallback, 인증 오류(401/403)는 즉시 중단
 * - 모든 키 소진 시 마지막 에러 throw
 *
 * 사용 예:
 *   const text = await generateText("선불폰 글 써줘");
 *   const json = await generateJSON("키워드 10개 JSON으로");
 */

const RAW =
  process.env.GEMINI_API_KEYS ?? process.env.GEMINI_API_KEY ?? "";

const KEYS = RAW.split(",")
  .map((k) => k.trim())
  .filter(Boolean);

if (KEYS.length === 0 && process.env.NODE_ENV !== "test") {
  console.warn(
    "[Gemini] ⚠️ GEMINI_API_KEYS 환경변수가 비어있습니다. 글 생성이 동작하지 않습니다.",
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
  if (KEYS.length === 0) {
    throw new Error(
      "GEMINI_API_KEYS가 설정되지 않았습니다. .env.local을 확인하세요.",
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
 * 텍스트 생성 (가장 자주 쓰는 형태).
 */
export async function generateText(
  prompt: string,
  options: {
    model?: string;
    generationConfig?: GenerationConfig;
  } = {},
): Promise<string> {
  return generateWithFallback(async (model) => {
    const result = await model.generateContent(prompt);
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
  const text = await generateWithFallback(async (model) => {
    const result = await model.generateContent(prompt);
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
  } catch (err) {
    throw new Error(
      `Gemini JSON 파싱 실패: ${(err as Error).message}\n원본: ${text.slice(0, 200)}…`,
    );
  }
}

/**
 * 디버그용. 현재 등록된 키 개수와 마스킹된 첫 키 미리보기.
 */
export function geminiKeyStatus() {
  return {
    count: KEYS.length,
    keys: KEYS.map(maskKey),
    model: DEFAULT_MODEL,
  };
}
