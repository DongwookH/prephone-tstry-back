/**
 * scripts/audit-all.ts — 전수 점검.
 *
 *   npx --yes tsx scripts/audit-all.ts              # 전체
 *   npx --yes tsx scripts/audit-all.ts --verbose    # 위반 건별 상세
 *
 * 2026-07-30까지 겪은 사고가 전부 "검사하는 코드가 없어서" 조용히 지나갔다.
 * 콘텐츠·데이터 정합성·설정 세 층을 한 번에 훑어 같은 유형을 미리 잡는다.
 *
 * 점검 항목
 *   [콘텐츠]  가드 6종 / 요금 표기 / 오너 정보 누출 / 테넌트 정보 반영 /
 *             블랙리스트 키워드로 만든 글
 *   [정합성]  ID 중복 / 날짜별 편수 대비 상한 / 이미지 파일 누락 /
 *             썸네일 메타 누락 / 발행 상태 불일치 / 본문 없는 행
 *   [설정]    GEMINI_MODEL 3곳 일치 / TENANT_DAILY_COUNT / 워크플로 제한시간 /
 *             Gemini·NVIDIA 키 동작
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

function loadEnvLocal(): void {
  const p = join(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    if (!k || process.env[k] !== undefined) continue;
    let v = t.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    process.env[k] = v;
  }
}
loadEnvLocal();

const VERBOSE = process.argv.includes("--verbose");

/** 확정 공식가 6종 (CLAUDE.md 2026-07-23). 이외 금액은 단정 금지. */
const OK_PRICES = new Set(["12,100", "33,000", "39,600", "45,900", "46,400", "85,900"]);
/** 남의 글에 절대 없어야 하는 오너 고유 정보. */
const OWNER_LEAKS = ["앤텔레콤", "케어통신", "안심개통", "ntelecomsafe", "ntelsafe"];

type Finding = { where: string; what: string; detail: string; published?: boolean };

function h1(s: string) {
  console.log(`\n${"═".repeat(74)}\n${s}\n${"═".repeat(74)}`);
}
function h2(s: string) {
  console.log(`\n── ${s} ${"─".repeat(Math.max(0, 68 - s.length))}`);
}
/**
 * 발행 여부로 나눠 보고한다.
 *   미발행 = 지금 고칠 수 있는 것 (실질적 조치 대상)
 *   발행됨 = 소급 수정 금지 원칙상 기록용 (사업주 결정 2026-07-30)
 * 이 구분이 없으면 옛 글 수백 건에 묻혀 "오늘 고쳐야 할 것"이 안 보인다.
 */
function report(label: string, findings: Finding[], sample = 5) {
  const open = findings.filter((f) => !f.published);
  const done = findings.filter((f) => f.published);
  const mark = open.length === 0 ? "✅" : "❌";
  const tail = done.length > 0 ? `  (발행분 ${done.length}건은 기록용)` : "";
  console.log(`  ${mark} ${label.padEnd(40)} 미발행 ${String(open.length).padStart(3)}건${tail}`);
  const show = VERBOSE ? open : open.slice(0, sample);
  for (const f of show) console.log(`       · ${f.where} — ${f.detail}`);
  if (!VERBOSE && open.length > sample)
    console.log(`       … 그 외 ${open.length - sample}건 (--verbose)`);
}

// ─── 콘텐츠 점검 ────────────────────────────────────────────────
async function auditContent(label: string, sheetId: string | undefined, isTenant: boolean) {
  const g = await import("../lib/content-guards");
  const { getAllPosts } = await import("../lib/sheets");
  const posts: any[] = await getAllPosts(sheetId);

  let guide: any = null;
  if (isTenant && sheetId) {
    const { loadTenantGuide } = await import("../lib/tenant-config");
    guide = await loadTenantGuide(sheetId).catch(() => null);
  }

  const F = {
    structural: [] as Finding[],
    number: [] as Finding[],
    victim: [] as Finding[],
    banned: [] as Finding[],
    minor: [] as Finding[],
    foreigner: [] as Finding[],
    price: [] as Finding[],
    leak: [] as Finding[],
    tenantInfo: [] as Finding[],
  };

  for (const p of posts) {
    const html: string = p.content_html || "";
    if (!html) continue;
    const both = `${p.title ?? ""}\n${html}`;
    const isPub =
      p.status === "published" ||
      Boolean((p.published_at || "").trim()) ||
      Boolean((p.tistory_url || "").trim());
    const at = (what: string, detail: string) => ({
      where: p.id,
      what,
      detail,
      published: isPub,
    });

    const st = g.findStructuralDefects(html);
    if (st.length) F.structural.push(at("structural", st[0].slice(0, 80)));

    const nk = g.findNumberKeepingClaims(both);
    if (nk.length) F.number.push(at("number", nk[0].slice(0, 80)));

    if (g.hasFirstPersonVictimClaim(both)) F.victim.push(at("victim", "1인칭 피해담"));

    const bw = g.findComplianceBannedWords(both);
    if (bw.length) F.banned.push(at("banned", bw.join(", ")));

    const mn = g.findMinorEligibilityClaims(both);
    if (mn.length) F.minor.push(at("minor", mn[0].slice(0, 80)));

    const fr = g.findForeignerEligibilityClaims(both);
    if (fr.length) F.foreigner.push(at("foreigner", fr[0].slice(0, 80)));

    // 요금 표기 — 확정 6종 외 "…원" 금액
    const plain = html.replace(/<[^>]+>/g, " ");
    const bad = [...new Set(plain.match(/\d{1,3},\d{3}\s*원/g) || [])]
      .map((x) => x.replace(/\s*원/, ""))
      .filter((n) => !OK_PRICES.has(n));
    if (bad.length) F.price.push(at("price", `확정가 아님: ${bad.join(", ")}원`));

    if (isTenant) {
      const leaked = OWNER_LEAKS.filter((w) => both.includes(w));
      if (leaked.length) F.leak.push(at("leak", `오너 정보: ${leaked.join(", ")}`));
      if (guide) {
        const miss: string[] = [];
        if (guide.brand_name && !html.includes(guide.brand_name)) miss.push("브랜드명");
        for (const l of guide.links ?? [])
          if (!html.includes(l.url)) miss.push(`링크(${l.label})`);
        if (miss.length) F.tenantInfo.push(at("tenantInfo", `누락: ${miss.join(", ")}`));
      }
    }
  }

  h2(`${label} — 콘텐츠 (총 ${posts.length}편)`);
  report("구조 결함 (본문 잘림·목차 끊김)", F.structural);
  report("번호 유지 오정보", F.number);
  report("1인칭 피해 경험담", F.victim);
  report("컴플라이언스 금지어", F.banned);
  report("미성년자 셀프개통 가능 주장", F.minor);
  report("외국인 비대면 셀프개통 주장", F.foreigner);
  report("확정가 외 금액 표기", F.price);
  if (isTenant) {
    report("오너 정보 누출", F.leak);
    report("테넌트 브랜드·링크 누락", F.tenantInfo);
  }
  return posts;
}

// ─── 데이터 정합성 점검 ─────────────────────────────────────────
async function auditIntegrity(
  label: string,
  sheetId: string | undefined,
  dailyCap: number,
  idPrefixLen: 8 | 6,
) {
  const { readRange, mainSheetId } = await import("../lib/sheets");
  const rows = (await readRange(sheetId ?? mainSheetId(), "posts!A:U")) as string[][];
  const hIdx = rows.findIndex((r) => (r?.[0] ?? "").trim() === "id");
  if (hIdx < 0) {
    console.log(`  ❌ ${label} — posts 헤더(A열='id')를 못 찾음`);
    return;
  }
  const H = rows[hIdx];
  const col = (n: string) => H.indexOf(n);
  const body = rows.slice(hIdx + 1).filter((r) => (r?.[0] ?? "").trim());

  const dupIds: Finding[] = [];
  const seen = new Map<string, number>();
  for (const r of body) {
    const id = r[0].trim();
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  for (const [id, n] of seen) if (n > 1) dupIds.push({ where: id, what: "dup", detail: `${n}개 행` });
  const pubOf = new Map<string, boolean>();
  for (const r of body) {
    const id = r[0].trim();
    const isPub =
      (r[col("status")] ?? "") === "published" ||
      Boolean((r[col("published_at")] ?? "").trim()) ||
      Boolean((r[col("tistory_url")] ?? "").trim());
    pubOf.set(id, (pubOf.get(id) ?? false) || isPub);
  }

  const emptyBody: Finding[] = [];
  const noThumbMeta: Finding[] = [];
  const statusMismatch: Finding[] = [];
  const perDate = new Map<string, number>();

  for (const r of body) {
    const id = r[0].trim();
    const status = r[col("status")] ?? "";
    const pub = (r[col("published_at")] ?? "").trim();
    const url = (r[col("tistory_url")] ?? "").trim();
    const html = r[col("content_html")] ?? "";
    const imgs = (r[col("image_urls")] ?? "").trim();

    const isPub2 = pubOf.get(id) ?? false;
    if (!html.trim())
      emptyBody.push({ where: id, what: "empty", detail: "content_html 비어 있음", published: isPub2 });
    if (html.trim() && !imgs)
      noThumbMeta.push({
        where: id,
        what: "thumbmeta",
        detail: "image_urls(썸네일 메타) 비어 있음",
        published: isPub2,
      });
    // published_at·URL이 있는데 status가 published가 아니면 상태 불일치
    if ((pub || url) && status !== "published")
      statusMismatch.push({ where: id, what: "status", detail: `status=${status} 인데 발행 흔적 있음` });

    // 날짜별 편수 — p-YYMMDD-NNN 또는 p-YYYYMMDD-NNN
    const m = id.match(/^p-(\d{6,8})-\d+$/);
    if (m) perDate.set(m[1], (perDate.get(m[1]) ?? 0) + 1);
  }

  const overCap: Finding[] = [];
  for (const [d, n] of [...perDate].sort()) {
    if (n > dailyCap)
      overCap.push({ where: d, what: "overcap", detail: `${n}편 (상한 ${dailyCap})` });
  }

  h2(`${label} — 데이터 정합성 (총 ${body.length}행)`);
  report("ID 중복", dupIds);
  report("본문 없는 행", emptyBody);
  report("썸네일 메타 누락", noThumbMeta);
  report("발행 상태 불일치", statusMismatch);
  report(`날짜별 상한 초과 (>${dailyCap}편)`, overCap);
  return { perDate, body, col, H };
}

// ─── 이미지 파일 존재 점검 (오너 시트 = 리포 내 파일) ─────────────
async function auditImageFiles(perDate: Map<string, number>, ids: string[]) {
  const missThumb: Finding[] = [];
  const missCard: Finding[] = [];
  for (const id of ids) {
    if (!existsSync(join(process.cwd(), "public", "thumbnails", `${id}.png`)))
      missThumb.push({ where: id, what: "thumb", detail: "썸네일 파일 없음" });
    if (!existsSync(join(process.cwd(), "public", "card-news", `${id}-1.png`)))
      missCard.push({ where: id, what: "card", detail: "카드뉴스 1장도 없음" });
  }
  h2("이미지 파일 (리포 public/)");
  report("썸네일 파일 누락", missThumb);
  report("카드뉴스 파일 누락", missCard);
}

// ─── 설정 점검 ─────────────────────────────────────────────────
function sh(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

async function auditConfig() {
  h2("설정 (모델·상한·제한시간)");

  const local = (process.env.GEMINI_MODEL ?? "").trim();
  console.log(`  로컬 .env.local GEMINI_MODEL : ${local || "(없음)"}`);

  const vars = sh("gh", ["variable", "list", "--repo", "DongwookH/prephone-tstry-back"]);
  const tdc = vars.split("\n").find((l) => l.startsWith("TENANT_DAILY_COUNT"));
  const tdcVal = tdc ? tdc.split(/\s+/)[1] : "(없음 → 코드 기본 3)";
  console.log(`  GHA TENANT_DAILY_COUNT       : ${tdcVal}`);

  // 워크플로 제한시간 vs 발행량 — 편당 1분 + 이미지 여유 필요
  const wf = readFileSync(".github/workflows/generate-tenant-posts.yml", "utf8");
  const to = wf.match(/timeout-minutes:\s*(\d+)/)?.[1] ?? "?";
  const need = Math.ceil(Number(tdcVal || 3) * 1.9);
  const okTime = Number(to) >= need;
  console.log(
    `  테넌트 워크플로 timeout      : ${to}분 (${tdcVal}편 기준 최소 ${need}분) ${okTime ? "✅" : "❌ 부족"}`,
  );

  // 코드 기본 모델과 로컬 값이 어긋나면 경고 (배포본은 Vercel/GHA 값이 우선)
  const gem = readFileSync("lib/gemini.ts", "utf8");
  const codeDefault = gem.match(/GEMINI_MODEL \?\? "([^"]+)"/)?.[1] ?? "?";
  console.log(`  코드 기본 모델               : ${codeDefault}`);
  if (local && local !== codeDefault)
    console.log(`       ⚠️ 로컬(${local}) ≠ 코드 기본(${codeDefault}) — 의도한 것인지 확인`);
}

// ─── 키 동작 점검 ──────────────────────────────────────────────
async function auditKeys() {
  const { listTenants } = await import("../lib/tenants");
  const { getGeminiKeysFromSheet, getNvidiaKeysFromSheet } = await import("../lib/sheets");
  const CHAIN = ["gemini-2.5-flash", "gemini-3.5-flash-lite"];

  async function usable(key: string) {
    for (const m of CHAIN) {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: "OK" }] }],
            generationConfig: { maxOutputTokens: 200 },
          }),
        },
      ).catch(() => null);
      if (!r) continue;
      const d: any = await r.json().catch(() => ({}));
      if (!d.error && d.candidates?.length) return m;
    }
    return null;
  }

  h2("API 키 동작");
  const ownerKeys = (process.env.GEMINI_API_KEYS || "").split(",").map((s) => s.trim()).filter(Boolean);
  let ownerOk = 0;
  for (const k of ownerKeys) if (await usable(k)) ownerOk++;
  console.log(`  ${ownerOk === ownerKeys.length ? "✅" : "❌"} 오너 Gemini 키 ${ownerOk}/${ownerKeys.length} 사용 가능`);

  for (const t of (await listTenants()).filter(
    (x) => x.role !== "owner" && x.status === "active" && x.spreadsheet_id,
  )) {
    const gk = await getGeminiKeysFromSheet(t.spreadsheet_id!).catch(() => []);
    let ok = 0;
    for (const k of gk) if (await usable(k.value)) ok++;
    const nk = await getNvidiaKeysFromSheet(t.spreadsheet_id!).catch(() => []);
    console.log(
      `  ${ok === gk.length && gk.length > 0 ? "✅" : "❌"} ${t.email} Gemini ${ok}/${gk.length} · NVIDIA ${nk.length}개 등록`,
    );
  }
}

// ─── 블랙리스트 키워드로 만든 글 ────────────────────────────────
async function auditBlacklistedKeywords(label: string, sheetId?: string) {
  const s = await import("../lib/sheets");
  const { getAllPosts } = s;
  const posts: any[] = await getAllPosts(sheetId);
  const hits: Finding[] = [];
  for (const p of posts) {
    const kw = (p.keyword || "").trim();
    if (!kw) continue;
    if (s.isContentBlacklistedKeyword?.(kw))
      hits.push({ where: p.id, what: "blkw", detail: `블랙리스트 키워드: ${kw}` });
  }
  h2(`${label} — 블랙리스트 키워드로 만든 글`);
  report("차단 대상 키워드 사용", hits);
}

/**
 * 최우선 블록 — "발행 예정" 글만 전 가드로 검사한다.
 *
 * 예약시각이 있고 아직 미발행인 글 = 내일이라도 티스토리에 올라갈 글.
 * 옛 미예약 초안 수백 건에 묻히지 않게 따로 뽑는다. 여기가 0이어야 안전하다.
 */
async function auditScheduled(label: string, sheetId?: string) {
  const g = await import("../lib/content-guards");
  const { readRange, mainSheetId } = await import("../lib/sheets");
  const rows = (await readRange(sheetId ?? mainSheetId(), "posts!A:U")) as string[][];
  const hIdx = rows.findIndex((r) => (r?.[0] ?? "").trim() === "id");
  if (hIdx < 0) return;
  const H = rows[hIdx];
  const c = (n: string) => H.indexOf(n);

  const findings: Finding[] = [];
  let n = 0;
  for (const r of rows.slice(hIdx + 1)) {
    const id = (r?.[0] ?? "").trim();
    if (!id) continue;
    const scheduled = (r[c("scheduled_at")] ?? "").trim();
    const pub = (r[c("published_at")] ?? "").trim();
    const url = (r[c("tistory_url")] ?? "").trim();
    if (!scheduled) continue; // 예약 안 된 초안은 발행되지 않는다
    if (r[c("status")] === "published" || pub || url) continue;
    const html = r[c("content_html")] ?? "";
    if (!html) continue;
    n++;
    const both = `${r[c("title")] ?? ""}\n${html}`;
    const push = (d: string) => findings.push({ where: id, what: "sched", detail: d });

    if (g.findStructuralDefects(html).length) push("구조 결함");
    if (g.findNumberKeepingClaims(both).length) push("번호 유지 오정보");
    if (g.hasFirstPersonVictimClaim(both)) push("1인칭 피해담");
    const bw = g.findComplianceBannedWords(both);
    if (bw.length) push(`금지어: ${bw.join(", ")}`);
    if (g.findMinorEligibilityClaims(both).length) push("미성년자 셀프개통 주장");
    if (g.findForeignerEligibilityClaims(both).length) push("외국인 셀프개통 주장");
    const plain = html.replace(/<[^>]+>/g, " ");
    const bad = [...new Set(plain.match(/\d{1,3},\d{3}\s*원/g) || [])]
      .map((x) => x.replace(/\s*원/, ""))
      .filter((x) => !OK_PRICES.has(x));
    if (bad.length) push(`확정가 아님: ${bad.join(", ")}원`);
  }
  h2(`${label} — 발행 예정 ${n}편`);
  report("발행 예정 글의 위반", findings, 20);
}

async function main() {
  const { listTenants } = await import("../lib/tenants");
  const tenants = (await listTenants()).filter(
    (t) => t.role !== "owner" && t.status === "active" && t.spreadsheet_id,
  );

  h1("★ 최우선 — 발행 예정 글 (예약됨 + 미발행)");
  await auditScheduled("오너");
  for (const t of tenants) await auditScheduled(`테넌트 ${t.email}`, t.spreadsheet_id);

  h1("전수 점검 — 콘텐츠");
  const ownerPosts = await auditContent("오너 (앤텔레콤)", undefined, false);
  for (const t of tenants) await auditContent(`테넌트 ${t.email}`, t.spreadsheet_id, true);

  h1("전수 점검 — 데이터 정합성");
  const ownerInt = await auditIntegrity("오너", undefined, 10, 8);
  for (const t of tenants)
    await auditIntegrity(`테넌트 ${t.email}`, t.spreadsheet_id, 20, 6);

  h1("전수 점검 — 이미지 파일");
  // 오너 시트 글만 리포에 파일이 있다 (테넌트도 같은 리포에 저장됨)
  const allIds = [...ownerPosts.map((p: any) => p.id)];
  for (const t of tenants) {
    const { getAllPosts } = await import("../lib/sheets");
    const ps = await getAllPosts(t.spreadsheet_id);
    allIds.push(...ps.map((p: any) => p.id));
  }
  // 최근 30일분만 (옛 글은 이미지 정책이 달랐음)
  const recent = allIds.filter((id) => /^p-2?6?0?7(2[5-9]|30)/.test(id) || /^p-26073|^p-26072[5-9]/.test(id));
  await auditImageFiles(ownerInt?.perDate ?? new Map(), recent);

  h1("전수 점검 — 키워드 정책");
  await auditBlacklistedKeywords("오너");
  for (const t of tenants) await auditBlacklistedKeywords(`테넌트 ${t.email}`, t.spreadsheet_id);

  h1("전수 점검 — 설정·키");
  await auditConfig();
  await auditKeys();

  console.log("\n점검 완료. ❌ 항목은 위 상세를 확인하세요 (--verbose 로 전체 출력).");
}

main().catch((e) => {
  console.error("점검 실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
