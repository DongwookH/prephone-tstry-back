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
// ⚠️ 04-faq(259문항·64KB)는 여기서 통째로 넣지 않는다. 글마다 관련 섹션만
//    getFaqExcerpt()로 발췌 주입 → 프롬프트 토큰 ↓ → 생성 속도 ↑ (60초 벽 회피).
const CATEGORY_KB_MAP: Record<string, string[]> = {
  개통핵심: ["03-process"],
  페인포인트: ["03-process", "06-cases"],
  타겟: ["06-cases"],
  eSIM: ["05-usim"],
  채널: ["05-usim"],
  광역시: ["03-process"],
  지역: ["03-process"],
  auto: ["03-process", "06-cases", "05-usim"],
  일반: ["03-process"],
};

export function getCategoryContext(category: string): string {
  const ids = CATEGORY_KB_MAP[category] ?? CATEGORY_KB_MAP["일반"];
  return compile(`cat:${category}`, ids);
}

// ─── FAQ 발췌 (글 주제 관련 섹션만 골라 주입) ──────────
// 04-faq.md = "## 섹션" 20개 + 각 "### Q." 항목. 전체(64KB)를 매번 넣으면
// 생성이 60초를 넘겨 504가 난다. 그래서 카테고리/키워드로 관련 섹션만 발췌.
type FaqSection = { name: string; text: string };

const faqParsed: { header: string; sections: FaqSection[] } = (() => {
  const raw = fsCache.get("04-faq") ?? "";
  if (!raw) return { header: "", sections: [] };
  const sections: FaqSection[] = [];
  const headerBuf: string[] = [];
  let cur: FaqSection | null = null;
  let buf: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("## ")) {
      if (cur) {
        cur.text = buf.join("\n").trim();
        sections.push(cur);
      }
      cur = { name: line.slice(3).trim(), text: "" };
      buf = [line];
    } else if (cur) {
      buf.push(line);
    } else {
      headerBuf.push(line);
    }
  }
  if (cur) {
    cur.text = buf.join("\n").trim();
    sections.push(cur);
  }
  return { header: headerBuf.join("\n").trim(), sections };
})();

// 카테고리 → 우선 섹션 (앞쪽 = 더 중요. 큰 핵심 섹션을 먼저 둬서 예산에 항상 포함).
const FAQ_SECTION_MAP: Record<string, string[]> = {
  개통핵심: ["신규개통", "개통방법", "특수개통", "유심정보입력"],
  페인포인트: ["신규개통", "정지, 해지, 환불", "특수개통", "서류업무"],
  타겟: ["신규개통", "개통방법", "특수개통"],
  eSIM: ["ESIM", "유심인식", "단말기 관련", "신규개통"],
  채널: ["유심구매", "개통방법", "충전방법", "신규개통"],
  광역시: ["신규개통", "개통방법", "번호이동"],
  지역: ["신규개통", "개통방법", "번호이동"],
  auto: ["신규개통", "개통방법", "특수개통", "요금제선택"],
  일반: ["신규개통", "개통방법", "특수개통", "요금제선택"],
};
const FAQ_DEFAULT_SECTIONS = ["신규개통", "개통방법", "특수개통", "요금제선택"];

// 키워드에 특정 주제어가 있으면 그 섹션을 (카테고리보다) 먼저 끌어온다.
const FAQ_KEYWORD_HINTS: Array<[RegExp, string[]]> = [
  [/충전/, ["충전방법"]],
  [/번호이동|번이/, ["번호이동"]],
  [/요금제|가격|비교|요금/, ["요금제선택", "요금제관련"]],
  [/신불|신용불량|회생|개인회생|미납|연체|파산/, ["특수개통", "신규개통"]],
  [/정지|해지|환불|위약금/, ["정지, 해지, 환불"]],
  [/esim|이심/i, ["ESIM"]],
  [/공기계|자급제|단말|기기|인식/, ["단말기 관련", "유심인식"]],
  [/유심|usim/i, ["유심구매", "유심인식"]],
  [/명의|서류|신분증|개명|미성년/, ["서류업무"]],
  [/부가|로밍|데이터|소액결제|보험/, ["부가서비스"]],
  [/해피콜/, ["해피콜"]],
  [/인증|공동인증|간편인증/, ["인증서 관련"]],
];

/**
 * 글 주제에 맞는 FAQ 섹션만 발췌. (카테고리 없는 쓰레드는 키워드만으로 동작)
 * @param maxChars 발췌 총 길이 상한(기본 20000자 ≈ 전체 64KB의 ~30%).
 *   첫 섹션은 상한을 넘어도 무조건 포함, 이후 섹션은 들어갈 때만 추가.
 */
export function getFaqExcerpt(opts: {
  category?: string;
  keyword?: string;
  subKeywords?: string[];
  maxChars?: number;
}): string {
  const { sections, header } = faqParsed;
  if (sections.length === 0) return "";
  const maxChars = opts.maxChars ?? 20000;
  const hay = [opts.keyword ?? "", ...(opts.subKeywords ?? [])]
    .join(" ")
    .toLowerCase();

  // 우선순위대로 섹션 이름 모으기: 키워드 힌트 → 카테고리 → (없으면) 기본
  const wanted: string[] = [];
  const add = (names: string[]) => {
    for (const n of names) if (!wanted.includes(n)) wanted.push(n);
  };
  for (const [re, names] of FAQ_KEYWORD_HINTS) if (re.test(hay)) add(names);
  add(
    (opts.category && FAQ_SECTION_MAP[opts.category]) || FAQ_DEFAULT_SECTIONS,
  );

  const cacheKey = `faqx:${wanted.join(",")}:${maxChars}`;
  const cached = compiledCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const byName = new Map(sections.map((s) => [s.name, s]));
  const picked: string[] = [];
  let total = header.length;
  for (const name of wanted) {
    const s = byName.get(name);
    if (!s) continue;
    if (picked.length > 0 && total + s.text.length > maxChars) continue;
    picked.push(s.text);
    total += s.text.length;
  }
  const result = (header ? header + "\n\n" : "") + picked.join("\n\n");
  compiledCache.set(cacheKey, result);
  return result;
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
