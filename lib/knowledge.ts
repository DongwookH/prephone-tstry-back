import fs from "node:fs";
import path from "node:path";

/**
 * Knowledge Base 로더 + 캐싱.
 *
 * web/knowledge-base/ 폴더의 .md 파일들을 빌드 시점에 읽어서
 * Gemini 프롬프트에 주입합니다.
 *
 * ▍ 캐싱 전략 (3-layer)
 *
 *   Layer 1: fs 읽기 메모이즈 (process-level)
 *     module top-level에서 1회만 fs.readFileSync.
 *     이후 호출은 모두 메모리에서.
 *
 *   Layer 2: 컴파일된 컨텍스트 메모이즈
 *     globalContext / categoryContext(category)별 결과를
 *     Map에 캐시. 같은 인자 → 같은 string 인스턴스 반환.
 *
 *   Layer 3: Gemini Implicit Prefix Caching (자동)
 *     buildPrompt가 매번 같은 prefix("당신은 한국 SEO… # 📚 KB…")로
 *     시작하면 Gemini 2.5+ 모델이 자동으로 prefix 토큰을 캐시.
 *     → 매 호출 토큰 비용 절감 (input price 50% 할인).
 *     사전 조건: 글로벌 KB가 prompt의 정확히 같은 위치에 매번 등장해야 함.
 */

const KB_DIR = path.join(process.cwd(), "knowledge-base");

// ─── Layer 1: fs 읽기 메모이즈 ───────────────────────
const fsCache: Map<string, string> = (() => {
  const m = new Map<string, string>();
  try {
    if (!fs.existsSync(KB_DIR)) {
      console.warn(`[knowledge] KB 폴더 없음: ${KB_DIR}`);
      return m;
    }
    const files = fs.readdirSync(KB_DIR).filter((f) => f.endsWith(".md"));
    for (const f of files) {
      const id = f.replace(/\.md$/, "");
      const content = fs.readFileSync(path.join(KB_DIR, f), "utf8");
      m.set(id, content);
    }
    console.log(
      `[knowledge] ✓ KB 로드 (${m.size}개 파일, ${[...m.values()].reduce((a, c) => a + c.length, 0).toLocaleString()}자)`,
    );
  } catch (err) {
    console.error("[knowledge] KB 로드 실패:", err);
  }
  return m;
})();

// ─── Layer 2: 컴파일된 컨텍스트 메모이즈 ────────────
const compiledCache = new Map<string, string>();

function compile(key: string, ids: string[]): string {
  const cached = compiledCache.get(key);
  if (cached !== undefined) return cached;
  const parts: string[] = [];
  for (const id of ids) {
    const c = fsCache.get(id);
    if (c) parts.push(c);
  }
  const result = parts.join("\n\n---\n\n");
  compiledCache.set(key, result);
  return result;
}

// ─── 글로벌 컨텍스트 (모든 글 공통) ─────────────────
const GLOBAL_KB_IDS = [
  "00-company",
  "01-services",
  "02-plans",
  "08-cta-links",
  "07-content-rules",
];

export function getGlobalContext(): string {
  return compile("__global__", GLOBAL_KB_IDS);
}

// ─── 카테고리별 컨텍스트 ────────────────────────────
const CATEGORY_KB_MAP: Record<string, string[]> = {
  개통핵심: ["04-faq", "03-process"],
  페인포인트: ["04-faq", "03-process", "06-cases"],
  타겟: ["04-faq", "06-cases"],
  eSIM: ["04-faq", "05-usim"],
  채널: ["04-faq", "05-usim"],
  광역시: ["04-faq", "03-process"],
  지역: ["04-faq", "03-process"],
  auto: ["04-faq", "03-process", "06-cases", "05-usim"],
  일반: ["04-faq", "03-process"],
};

export function getCategoryContext(category: string): string {
  const ids = CATEGORY_KB_MAP[category] ?? CATEGORY_KB_MAP["일반"];
  return compile(`cat:${category}`, ids);
}

// ─── 디버그 / 헬스체크 ───────────────────────────────
export function knowledgeStatus() {
  const globalCtx = getGlobalContext();
  // 모든 카테고리 한 번씩 호출해서 캐시 워밍
  for (const cat of Object.keys(CATEGORY_KB_MAP)) {
    getCategoryContext(cat);
  }
  return {
    dir: KB_DIR,
    fileCount: fsCache.size,
    files: Array.from(fsCache.keys()).sort(),
    cache: {
      compiledEntries: compiledCache.size,
      globalContextChars: globalCtx.length,
      // 대략적인 토큰 추정 (한국어 1.5~2 토큰/자)
      globalContextEstimatedTokens: Math.round(globalCtx.length * 1.7),
    },
    note: "Layer 1 (fs) + Layer 2 (compiled) + Layer 3 (Gemini implicit prefix caching) 작동 중",
  };
}

/** 캐시 강제 무효화 (dev only — KB 파일 수정 후 hot reload 안 될 때) */
export function invalidateKnowledgeCache() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("production에서 캐시 무효화 불가");
  }
  fsCache.clear();
  compiledCache.clear();
}
