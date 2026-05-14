import type { Tool } from "@google/generative-ai";
import { generateWithFallback } from "./gemini";
import { fetchKeywordVolumes, isNaverAdConfigured } from "./naver-keyword";

/**
 * Gemini Search Grounding을 활용한 키워드 자동 발굴.
 *
 * Gemini가 실시간 Google 검색을 수행하여 도메인 관련
 * 트렌드 키워드 + 검색 의도 명확한 키워드를 추출합니다.
 *
 * 네이버 검색광고 API 키가 설정되어 있으면 자동으로
 * 정확한 PC/Mobile 월간 검색량 + 경쟁도를 머지합니다.
 */

export type DiscoveredKeyword = {
  keyword: string;
  intent: "정보탐색" | "비교평가" | "문제해결" | "구매준비";
  reason: string;
  /** Gemini의 거시 추정 (그대로 유지). */
  expectedVolume: "high" | "medium" | "low";
  /** 네이버 광고 API 연결 시 자동 채워지는 정확한 값들. */
  monthlyVolume?: number;
  monthlyPcVolume?: number;
  monthlyMobileVolume?: number;
  competition?: "낮음" | "중간" | "높음" | "-";
  /** 네이버에서 데이터를 못 찾은 경우 사유 */
  volumeNote?: string;
};

const DEFAULT_DOMAIN =
  "한국 선불폰/유심/MVNO (앤텔레콤 안심개통 — ntelecomsafe.com)";

/**
 * Gemini Search Grounding으로 도메인 관련 키워드 N개 자동 발굴.
 *
 * @param opts.domain 도메인 설명. 기본값은 ntelecomsafe.com 컨텍스트.
 * @param opts.count  몇 개 발굴할지. 기본 5.
 * @param opts.excludeKeywords 이미 사용한 키워드 (중복 제거).
 */
export async function discoverKeywords(opts: {
  domain?: string;
  count?: number;
  excludeKeywords?: string[];
  /** 네이버 광고 API로 검색량 머지 (기본 true, 키 있을 때만 동작) */
  enrichWithNaverVolume?: boolean;
} = {}): Promise<DiscoveredKeyword[]> {
  const domain = opts.domain ?? DEFAULT_DOMAIN;
  const count = opts.count ?? 5;
  const excludeList = (opts.excludeKeywords ?? []).slice(0, 50);
  const enrich = opts.enrichWithNaverVolume ?? true;

  const excludeBlock = excludeList.length
    ? `\n\n다음 키워드는 이미 사용했으므로 반드시 제외하세요:\n${excludeList.map((k) => `- ${k}`).join("\n")}`
    : "";

  const prompt = `당신은 한국 SEO 전문가입니다. Google 검색을 활용하여 다음 도메인에서 최근 검색 트렌드와 검색 의도가 명확한 키워드를 정확히 ${count}개 찾아주세요.

도메인: ${domain}

선정 기준:
1. 한국에서 최근 1~3개월 검색량이 의미 있는 수준 (월 500회 이상 추정)
2. 정보 탐색 또는 문제 해결 의도가 명확한 롱테일 (구매 직전 단계 또는 정보 욕구)
3. 너무 일반적이지 않고 (예: "휴대폰" X) 너무 좁지 않은 (예: "갤럭시 S25 256GB 블랙 KT 선불 가입" X) 중간 길이 키워드
4. 한국어 키워드만 (영문 X)
5. 경쟁 블로그가 잘 다루지 않는 빈틈을 우선
${excludeBlock}

응답은 반드시 다음 JSON 배열만 (마크다운 코드펜스나 다른 설명 없이):
[
  {
    "keyword": "외국인 선불폰 비대면 개통",
    "intent": "문제해결",
    "reason": "비자 갱신 시즌과 맞물려 검색 증가, 경쟁이 적음",
    "expectedVolume": "medium"
  }
]

intent 값: "정보탐색" | "비교평가" | "문제해결" | "구매준비" 중 하나
expectedVolume 값: "high" | "medium" | "low" 중 하나`;

  // Gemini Search Grounding 활성화
  // 2.5 모델에서는 googleSearch, 이전 모델은 googleSearchRetrieval
  // 타입 시스템이 둘 다 인식하지 못할 수 있어 unknown으로 캐스팅
  const tools = [{ googleSearch: {} }] as unknown as Tool[];

  const text = await generateWithFallback(
    async (model) => {
      const result = await model.generateContent(prompt);
      return result.response.text();
    },
    {
      tools,
      generationConfig: {
        temperature: 0.7,
        // grounding과 responseMimeType:json은 함께 못 쓰는 경우가 있어
        // 텍스트로 받고 직접 파싱
      },
    },
  );

  const discovered = parseKeywordsResponse(text, count);

  // 네이버 광고 API로 정확한 검색량 머지
  if (enrich && isNaverAdConfigured() && discovered.length > 0) {
    try {
      const volumes = await fetchKeywordVolumes(
        discovered.map((d) => d.keyword),
      );
      // 네이버는 공백 제거된 키워드로 응답하므로 양쪽 정규화 후 매핑
      const normalize = (s: string) => s.replace(/\s+/g, "").toLowerCase();
      const volMap = new Map(
        volumes.map((v) => [normalize(v.keyword), v]),
      );
      for (const d of discovered) {
        const v = volMap.get(normalize(d.keyword));
        if (v) {
          d.monthlyVolume = v.monthlyTotalVolume;
          d.monthlyPcVolume = v.monthlyPcVolume;
          d.monthlyMobileVolume = v.monthlyMobileVolume;
          d.competition = v.competition;
        } else {
          d.volumeNote = "네이버 광고 API에서 검색량 데이터 없음 (검색량 매우 적거나 신규 키워드)";
        }
      }
    } catch (err) {
      // 네이버 API 실패해도 GSG 결과는 그대로 반환 (graceful degradation)
      const msg = (err as Error).message;
      console.warn(`[discover] 네이버 검색량 머지 실패: ${msg}`);
      for (const d of discovered) {
        d.volumeNote = `네이버 API 호출 실패: ${msg.slice(0, 100)}`;
      }
    }
  }

  return discovered;
}

/**
 * 응답 텍스트에서 JSON 배열을 추출. 마크다운 코드펜스 제거 + 파싱.
 */
function parseKeywordsResponse(
  text: string,
  expectedCount: number,
): DiscoveredKeyword[] {
  // 1) 코드펜스 제거 시도
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");

  // 2) 첫 [ 부터 마지막 ] 까지 추출 (앞뒤 텍스트 무시)
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start >= 0 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `키워드 발굴 응답 JSON 파싱 실패: ${(err as Error).message}\n원본:\n${text.slice(0, 500)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error("응답이 배열 형태가 아닙니다.");
  }

  return parsed
    .filter(
      (it): it is DiscoveredKeyword =>
        !!it &&
        typeof it === "object" &&
        typeof (it as { keyword?: unknown }).keyword === "string" &&
        ((it as { keyword: string }).keyword.trim().length > 0),
    )
    .slice(0, expectedCount)
    .map((it) => ({
      keyword: it.keyword.trim(),
      intent: (it.intent as DiscoveredKeyword["intent"]) || "정보탐색",
      reason: it.reason || "",
      expectedVolume:
        (it.expectedVolume as DiscoveredKeyword["expectedVolume"]) || "medium",
    }));
}
