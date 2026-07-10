# 성과 피드백 루프 + 운영 안정화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 장애는 텔레그램으로 즉시 보고되고, 매일 아침 글·전환·Threads 성과 브리핑이 자동 발송되는 파이프라인.

**Architecture:** Phase 1은 기존 GHA 워크플로·watchdog 크론·로컬 스크래퍼에 텔레그램 알림을 끼워 넣는다(새 인프라 없음). Phase 2는 GA refresh token을 settings 시트에 영속화한 뒤, GHA 러너 스크립트(`collect-metrics.ts`)가 GA4 2개 속성 + Threads insights를 하루 1회 수집해 시트에 쌓고 브리핑을 발송한다. 수집 실패는 소스별로 격리되고 기존 생성·발행 파이프라인에 영향을 주지 않는다.

**Tech Stack:** Next.js(App Router)+TS, Google Sheets API(기존 lib/sheets.ts), GA4 Data API(기존 lib/ga4.ts), Meta Threads Graph API(기존 lib/threads.ts), Telegram Bot API(기존 lib/telegram.ts), GitHub Actions, node:test.

**스코프 노트:** 스펙 2-4(대시보드 표)는 이 계획에서 제외 — metrics 데이터가 며칠 쌓인 뒤 실물 데이터 기준으로 별도 미니 계획. 스펙의 threads_metrics "upsert"는 date 컬럼 포함 append-only로 단순화(일자별 스냅샷이 되어 추세 분석에 오히려 유리).

**확정된 사실 (2026-07-10 코드 확인):**
- GHA secrets에 `TELEGRAM_BOT_TOKEN`·`TELEGRAM_CHAT_ID` **이미 등록됨**.
- `sendTelegram(text, opts?)`(lib/telegram.ts:32)는 HTML 모드, 실패해도 throw 안 함. `getTgState/setTgState`로 중복 알림 방지 가능.
- `getThreadsToken()`(lib/threads.ts:138) → `{access_token, expires_at, ...} | null`.
- settings 시트 upsert 패턴은 `saveThreadsToken`(lib/threads.ts:94~135) 그대로 복사 가능.
- `runReport(accessToken, body, propertyIdOverride?)`(lib/ga4.ts:80, module-private).
- auth.ts jwt 콜백의 `if (account)` 분기는 **로그인 콜백(node 런타임)에서만** account가 존재 — 여기서 dynamic import로 시트 저장해도 edge(middleware)를 오염시키지 않는다.
- posts 시트: `ga_pageviews`=O열, `tistory_url`=M열. 행 찾기 패턴은 `updatePostStatus`(lib/sheets.ts:373~425) 참고.
- `ThreadsDraftRow`: `published_id`, `published_at`, `keyword`, `insight`(카피 스타일이 "스타일명: 설명" 형태로 들어있음).

**⏸ 사용자 액션 게이트 (해당 태스크에서 요청):**
- Task 4 후: 대시보드 **로그아웃 → 재로그인 1회** (refresh token이 시트에 저장되도록).
- Task 6 전: **ntelecomsafe.com GA4 속성 ID** 제공 (`NTELECOM_GA_PROPERTY_ID` secret).

---

### Task 1: 이미지 생성 실패 텔레그램 알림 (GHA)

**Files:**
- Create: `scripts/build-image-alert.mjs`
- Test: `scripts/build-image-alert.test.mjs`
- Modify: `.github/workflows/generate-posts.yml` (thumbnails job 마지막), `.github/workflows/backfill-images.yml` (실행 스텝 뒤)

- [ ] **Step 1: 실패 테스트 작성**

```js
// scripts/build-image-alert.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildImageAlert } from "./build-image-alert.mjs";

test("전부 성공이면 빈 문자열 (알림 없음)", () => {
  assert.equal(
    buildImageAlert("success", '{"total":10,"ok":10,"failed":0}', '{"total":40,"ok":40,"failed":0}', "메인", ""),
    "",
  );
});

test("부분 실패면 실패 수 포함 경고", () => {
  const msg = buildImageAlert("success", '{"total":10,"ok":7,"failed":3}', '{"total":40,"ok":1,"failed":39}', "메인", "백필이 재시도합니다.");
  assert.match(msg, /썸네일: 7\/10/);
  assert.match(msg, /카드뉴스: 1\/40/);
  assert.match(msg, /백필이 재시도/);
});

test("잡 자체가 failure면 요약 JSON 없어도 경고", () => {
  const msg = buildImageAlert("failure", "", "", "백필", "");
  assert.match(msg, /백필/);
  assert.match(msg, /failure/);
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test scripts/build-image-alert.test.mjs` → Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

```js
// scripts/build-image-alert.mjs
// 이미지 생성 요약 JSON(regen 스크립트 마지막 줄) → 텔레그램 경고 메시지.
// 문제 없으면 빈 문자열을 출력해 워크플로가 발송을 건너뛴다.
export function buildImageAlert(jobStatus, thumbsJson, cardsJson, label, tailMsg) {
  const parse = (s) => {
    try { return JSON.parse(s || "{}"); } catch { return {}; }
  };
  const t = parse(thumbsJson);
  const c = parse(cardsJson);
  const tFail = t.failed ?? 0;
  const cFail = c.failed ?? 0;
  const broken = jobStatus === "failure" || jobStatus === "cancelled";
  if (!broken && tFail === 0 && cFail === 0) return "";
  const lines = [`⚠️ ${label} 이미지 생성 문제`];
  if (broken) lines.push(`잡 상태: ${jobStatus}`);
  if (t.total !== undefined) lines.push(`썸네일: ${t.ok ?? "?"}/${t.total} (실패 ${tFail})`);
  if (c.total !== undefined) lines.push(`카드뉴스: ${c.ok ?? "?"}/${c.total} (실패 ${cFail})`);
  if (tailMsg) lines.push(tailMsg);
  return lines.join("\n");
}

const isCli = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  const [, , status = "", thumbs = "", cards = "", label = "이미지", tail = ""] = process.argv;
  process.stdout.write(buildImageAlert(status, thumbs, cards, label, tail));
}
```

- [ ] **Step 4: 통과 확인** — Run: `node --test scripts/build-image-alert.test.mjs` → Expected: `pass 3`

- [ ] **Step 5: generate-posts.yml에 알림 스텝 추가** — thumbnails job의 커밋 스텝 **뒤에**:

```yaml
      - name: 실패 시 텔레그램 알림
        if: always()
        env:
          TG_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TG_CHAT: ${{ secrets.TELEGRAM_CHAT_ID }}
          JOB_STATUS: ${{ job.status }}
        run: |
          thumbs=$(tail -n1 /tmp/thumbs.log 2>/dev/null || echo '{}')
          cards=$(tail -n1 /tmp/cardnews.log 2>/dev/null || echo '{}')
          msg=$(node scripts/build-image-alert.mjs "$JOB_STATUS" "$thumbs" "$cards" "메인(썸네일 잡)" "백필(00:30·04:00 UTC)이 자동 재시도합니다.")
          if [ -n "$msg" ]; then
            curl -s -X POST "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
              -d chat_id="${TG_CHAT}" --data-urlencode "text=${msg}" >/dev/null || true
          fi
```

- [ ] **Step 6: backfill-images.yml에도 동일 스텝** — 실행 스텝 뒤, 라벨·꼬리만 변경:

```yaml
      - name: 실패 시 텔레그램 알림
        if: always()
        env:
          TG_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TG_CHAT: ${{ secrets.TELEGRAM_CHAT_ID }}
          JOB_STATUS: ${{ job.status }}
        run: |
          thumbs=$(tail -n1 /tmp/thumbs.log 2>/dev/null || echo '{}')
          cards=$(tail -n1 /tmp/cardnews.log 2>/dev/null || echo '{}')
          msg=$(node scripts/build-image-alert.mjs "$JOB_STATUS" "$thumbs" "$cards" "백필" "🔴 백필 후에도 구멍 — 수동 확인 필요")
          if [ -n "$msg" ]; then
            curl -s -X POST "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
              -d chat_id="${TG_CHAT}" --data-urlencode "text=${msg}" >/dev/null || true
          fi
```

- [ ] **Step 7: 커밋·푸시 후 실동작 검증** — `git add -A && git commit -m "feat(alerts): 이미지 생성 실패 텔레그램 알림" && git push`
  → `gh workflow run backfill-images.yml` → run 성공 + (전부 skip이므로) **알림이 안 오는 것**이 정답. 로그에서 알림 스텝이 빈 msg로 skip됐는지 확인: `gh run view <id> --log | grep -A2 "텔레그램 알림"`

---

### Task 2: Threads API 토큰 만료 D-7 경고 (watchdog)

**Files:**
- Modify: `app/api/cron/threads-watchdog/route.ts`

- [ ] **Step 1: 만료 검사 블록 추가** — 기존 요약 발송 로직 뒤, 최종 return 전에:

```ts
// ── 3) Threads API 토큰 만료 임박 경고 (D-7부터, 하루 1회) ──
try {
  const { getThreadsToken } = await import("@/lib/threads");
  const token = await getThreadsToken();
  if (token?.expires_at) {
    const daysLeft = Math.floor(
      (new Date(token.expires_at).getTime() - now) / 86_400_000,
    );
    if (daysLeft <= 7) {
      const todayKst = new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);
      const warned = await getTgState("token_expiry_warned");
      if (warned !== todayKst) {
        await sendTelegram(
          `🔑 <b>Threads API 토큰 만료 D-${Math.max(daysLeft, 0)}</b>\n` +
            `만료: ${kstLabel(token.expires_at)}\n` +
            `대시보드 설정 → Threads 재연결로 갱신하세요. (만료되면 자동 발행 중단)`,
        );
        await setTgState("token_expiry_warned", todayKst);
        actions.push(`토큰 만료 D-${daysLeft} 경고 발송`);
      }
    }
  }
} catch (e) {
  console.error("[watchdog] 토큰 만료 검사 실패:", e);
}
```

- [ ] **Step 2: 타입·빌드 확인** — Run: `npx tsc --noEmit -p tsconfig.json` → Expected: 에러 0

- [ ] **Step 3: 커밋·배포·실호출 검증** — commit/push 후 Vercel 배포 대기, `curl -s -X POST https://prephone-tstry-back.vercel.app/api/cron/threads-watchdog -H "Authorization: Bearer $CRON_SECRET"` (CRON_SECRET은 .env.local에서 셸 변수로만, 출력 금지) → Expected: `{"ok":true,...}` + 토큰이 아직 D-8 이상이면 경고 없음(정상)

---

### Task 3: 스크래퍼 로그인벽·저수확 알림 (로컬)

**Files:**
- Modify: `scripts/threads-research.mjs`

- [ ] **Step 1: 알림 헬퍼 + .env.local 폴백 로더 추가** — 파일 상단 상수 영역에:

```js
// .env.local 폴백 (launchd가 TELEGRAM env를 안 넘겨줄 때 대비)
try {
  const { readFileSync: rf, existsSync: ex } = await import("node:fs");
  const envP = new URL("../.env.local", import.meta.url).pathname;
  if (ex(envP)) {
    for (const line of rf(envP, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      if (!k || process.env[k] !== undefined) continue;
      let v = t.slice(eq + 1).trim();
      if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) v = v.slice(1, -1);
      process.env[k] = v;
    }
  }
} catch {}

const MIN_TOTAL_ALERT = parseInt(process.env.MIN_TOTAL_ALERT || "5", 10);

async function notifyTelegram(text) {
  const tk = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!tk || !chat) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${tk}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000) }),
    });
    return res.ok;
  } catch { return false; }
}
```

- [ ] **Step 2: `--notify-test` 플래그** — main() 첫 부분에 (Threads 접속 없이 알림 경로만 검증):

```js
if (process.argv.includes("--notify-test")) {
  const ok = await notifyTelegram("✅ 스크래퍼 텔레그램 알림 테스트");
  log(ok ? "알림 테스트 발송됨" : "알림 실패 (env 확인)");
  process.exit(ok ? 0 : 1);
}
```

- [ ] **Step 3: 트리거 연결** — 키워드 루프에서 `loggedOut` 감지 시 `sawLoginWall = true` 플래그만 세우고(기존 경고 로그 유지), main() 끝 완료 로그 직전에 1회만:

```js
const totalHarvest = /* store 모드면 totalStored, drafts 모드면 totalCreated */;
if (sawLoginWall || totalHarvest < MIN_TOTAL_ALERT) {
  await notifyTelegram(
    `⚠️ Threads 스크래퍼 상태 이상\n` +
      (sawLoginWall ? "· 로그인벽 감지 — 세션 만료 의심\n" : "") +
      `· 오늘 수확 ${totalHarvest}건 (기준 ${MIN_TOTAL_ALERT})\n` +
      `조치: cd web && node scripts/threads-login.mjs 로 세션 갱신`,
  );
}
```

- [ ] **Step 4: 검증 (Threads 무접속)** — Run: `node scripts/threads-research.mjs --notify-test` → Expected: 텔레그램에 테스트 메시지 수신 + exit 0. **주의: 실제 스크랩 실행은 하지 않는다(봇 감지 리스크). 내일 아침 6시 자동 실행이 실전 검증.**

- [ ] **Step 5: 커밋** — `git add scripts/threads-research.mjs && git commit -m "feat(scraper): 로그인벽·저수확 텔레그램 알림 + --notify-test"`

---

### Task 4: GA refresh token 영속화

**Files:**
- Create: `lib/ga-token.ts`
- Modify: `auth.ts` (jwt 콜백 `if (account)` 분기)

- [ ] **Step 1: lib/ga-token.ts 작성**

```ts
/**
 * GA OAuth refresh token 영속화 + 크론용 access token 발급.
 * 저장소: settings 시트 type='ga_refresh_token' (threads_token과 동일 패턴).
 */
import {
  readSettings,
  appendRow,
  updateCell,
  mainSheetId,
  ensureSettingsSheet,
  readRange,
} from "./sheets";

const TYPE = "ga_refresh_token";

export async function saveGaRefreshToken(refreshToken: string): Promise<void> {
  await ensureSettingsSheet();
  const all = await readSettings();
  const now = new Date().toISOString();
  if (all.some((r) => r.type === TYPE)) {
    const raw = await readRange(mainSheetId(), "settings!A:H");
    let headerIdx = 0;
    if (raw[0]?.[0]?.startsWith("💡")) headerIdx = 1;
    for (let i = headerIdx + 1; i < raw.length; i++) {
      if (raw[i]?.[1] === TYPE) {
        const rowNum = i + 1;
        await updateCell(mainSheetId(), `settings!C${rowNum}`, refreshToken);
        await updateCell(mainSheetId(), `settings!E${rowNum}`, "1");
        await updateCell(mainSheetId(), `settings!G${rowNum}`, now);
        return;
      }
    }
  }
  await appendRow(mainSheetId(), "settings", [
    `ga-${Date.now()}`, TYPE, refreshToken, "GA cron refresh token", "1", now, now, "0",
  ]);
}

/** 크론/스크립트용 — settings의 refresh token으로 access token 발급. */
export async function getGaAccessTokenForCron(): Promise<string> {
  const all = await readSettings();
  const row = all.find((r) => r.type === TYPE && r.value && r.enabled !== "0");
  if (!row) {
    throw new Error("ga_refresh_token 없음 — 대시보드에 로그아웃 후 재로그인하면 저장됩니다.");
  }
  const params = new URLSearchParams({
    client_id: process.env.AUTH_GOOGLE_ID!,
    client_secret: process.env.AUTH_GOOGLE_SECRET!,
    grant_type: "refresh_token",
    refresh_token: row.value,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const j = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || !j.access_token) {
    throw new Error(`GA access token 갱신 실패: ${j.error ?? res.status} — 재로그인 필요`);
  }
  return j.access_token;
}
```

주의: `readRange`가 lib/sheets.ts에서 export되는지 확인(threads.ts가 이미 dynamic import로 사용). 아니면 동일하게 `await import("./sheets")`.

- [ ] **Step 2: auth.ts jwt 콜백에서 저장** — `if (account)` 분기 안, return 앞에:

```ts
if (account.refresh_token) {
  // 크론용 영속화. account 분기는 로그인 콜백(node 런타임)에서만 실행되므로
  // dynamic import가 edge(middleware) 번들을 오염시키지 않는다.
  try {
    const { saveGaRefreshToken } = await import("@/lib/ga-token");
    await saveGaRefreshToken(account.refresh_token);
  } catch (e) {
    console.error("[auth] GA refresh token 저장 실패 (로그인은 계속):", e);
  }
}
```

- [ ] **Step 3: 빌드 확인 (edge 오염 여부 포함)** — Run: `npx tsc --noEmit && npm run build 2>&1 | tail -5` → Expected: 빌드 성공 (middleware 에러 없음)

- [ ] **Step 4: 커밋·배포** — `git add lib/ga-token.ts auth.ts && git commit -m "feat(ga): refresh token 영속화 — 크론용 GA 접근" && git push`

- [ ] **Step 5: ⏸ 사용자 액션** — 형님에게 요청: **대시보드 로그아웃 → 재로그인 1회**. 이후 확인: settings 시트에 `ga_refresh_token` row 존재 (스크립트로 readSettings 후 type만 출력 — value 출력 금지).

---

### Task 5: GA4 헬퍼 확장 (utm 퍼널 + 속성 지정 pageviews)

**Files:**
- Modify: `lib/ga4.ts`

- [ ] **Step 1: getPagePathPageviews에 속성 파라미터 추가**

```ts
export async function getPagePathPageviews(
  accessToken: string,
  days = 30,
  limit = 200,
  propertyIdOverride?: string,
): Promise<Record<string, number>> {
  const data = await runReport(accessToken, { /* 기존 body 그대로 */ }, propertyIdOverride);
  /* 기존 매핑 그대로 */
}
```
(기존 호출부는 파라미터 생략이라 무변경.)

- [ ] **Step 2: utm 퍼널 함수 추가** — 파일 하단에:

```ts
export type UtmFunnelRow = { campaign: string; sessions: number; step2Views: number };

/**
 * ntelecomsafe GA4 — 어제 하루 utm_campaign별 세션 + /step2 도달 페이지뷰.
 * campaign은 블로그 글의 utm_campaign={키워드-슬러그} 규칙과 매칭된다.
 */
export async function getUtmCampaignFunnel(
  accessToken: string,
  propertyId: string,
): Promise<UtmFunnelRow[]> {
  const dateRanges = [{ startDate: "yesterday", endDate: "yesterday" }];
  const [sessions, step2] = await Promise.all([
    runReport(accessToken, {
      dateRanges,
      dimensions: [{ name: "sessionCampaignName" }],
      metrics: [{ name: "sessions" }],
      limit: "200",
    }, propertyId),
    runReport(accessToken, {
      dateRanges,
      dimensions: [{ name: "sessionCampaignName" }],
      metrics: [{ name: "screenPageViews" }],
      dimensionFilter: {
        filter: {
          fieldName: "pagePath",
          stringFilter: { matchType: "CONTAINS", value: "/step2" },
        },
      },
      limit: "200",
    }, propertyId),
  ]);
  const out = new Map<string, UtmFunnelRow>();
  for (const r of sessions.rows ?? []) {
    const c = r.dimensionValues?.[0]?.value ?? "";
    if (!c || c === "(not set)") continue;
    out.set(c, { campaign: c, sessions: parseInt(r.metricValues?.[0]?.value ?? "0", 10), step2Views: 0 });
  }
  for (const r of step2.rows ?? []) {
    const c = r.dimensionValues?.[0]?.value ?? "";
    const row = out.get(c);
    if (row) row.step2Views = parseInt(r.metricValues?.[0]?.value ?? "0", 10);
  }
  return [...out.values()].sort((a, b) => b.sessions - a.sessions);
}
```
주의: step2 report의 `dimensionFilter`에 pagePath를 쓰려면 pagePath가 dimensions에 없어도 필터로는 유효(GA4 Data API 허용). 만약 400이 나면 dimensions에 `{name:"pagePath"}` 추가 후 campaign별 합산으로 수정.

- [ ] **Step 3: 타입 확인 + 커밋** — `npx tsc --noEmit` → 에러 0 → `git add lib/ga4.ts && git commit -m "feat(ga4): utm 퍼널 + 속성 지정 pageviews"`

---

### Task 6: metrics 시트 + collect-metrics 수집·브리핑 + GHA 크론

**Files:**
- Create: `lib/metrics-utils.ts`, `scripts/metrics-utils.test.mjs`, `scripts/collect-metrics.ts`, `.github/workflows/collect-metrics.yml`
- Modify: `lib/sheets.ts` (metrics 시트 헬퍼 + updatePostGaPageviews), `lib/threads.ts` (getMediaInsights)

- [ ] **Step 1: 순수 유틸 실패 테스트**

```js
// scripts/metrics-utils.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { styleFromInsight, matchPostByPath } from "../lib/metrics-utils.ts";

test("insight 앞머리에서 스타일명 추출", () => {
  assert.equal(styleFromInsight("반전/오해 정정형: 널리 퍼진 오해를…"), "반전/오해 정정형");
  assert.equal(styleFromInsight(""), "");
  assert.equal(styleFromInsight("스타일 구분자 없음 문장만 잔뜩 있는 경우에는 빈 값이어야 한다 왜냐하면 삼십자를 넘으니까"), "");
});

test("GA pagePath ↔ posts tistory_url 매칭", () => {
  const posts = [
    { id: "p-1", tistory_url: "https://ntel.tistory.com/123" },
    { id: "p-2", tistory_url: "https://ntel.tistory.com/entry/abc-def" },
    { id: "p-3", tistory_url: "" },
  ];
  assert.equal(matchPostByPath("/123", posts), "p-1");
  assert.equal(matchPostByPath("/entry/abc-def?category=1", posts), "p-2");
  assert.equal(matchPostByPath("/999", posts), null);
});
```

- [ ] **Step 2: 실패 확인** — `node --test scripts/metrics-utils.test.mjs` → FAIL

- [ ] **Step 3: lib/metrics-utils.ts 구현**

```ts
/** 성과 수집용 순수 유틸 — I/O 없음 (단독 테스트 가능). */

/** ThreadsDraftRow.insight "스타일명: 설명" → 스타일명. 형식이 아니면 빈 값. */
export function styleFromInsight(insight?: string): string {
  const head = (insight || "").split(/[:：]/)[0].trim();
  return head.length >= 2 && head.length <= 30 ? head : "";
}

/** GA pagePath(쿼리 제거)와 posts.tistory_url의 pathname을 매칭해 post id 반환. */
export function matchPostByPath(
  pagePath: string,
  posts: { id: string; tistory_url?: string }[],
): string | null {
  const clean = pagePath.split("?")[0].replace(/\/$/, "");
  if (!clean) return null;
  for (const p of posts) {
    if (!p.tistory_url) continue;
    try {
      const u = new URL(p.tistory_url);
      if (u.pathname.replace(/\/$/, "") === clean) return p.id;
    } catch { /* 잘못된 URL은 skip */ }
  }
  return null;
}
```

- [ ] **Step 4: 통과 확인 + 커밋** — `node --test scripts/metrics-utils.test.mjs` → pass 2 → commit `feat(metrics): 수집용 순수 유틸`

- [ ] **Step 5: lib/sheets.ts에 metrics 헬퍼 추가** — USAGE_SHEET ensure 패턴(880~900) 복사:

```ts
// ─── 성과 수집 시트 ───────────────────────────
const METRICS_SHEET = "metrics_daily";
const METRICS_HEADERS = ["date", "source", "key", "pageviews", "sessions", "step2", "conversions", "extra"];
const THREADS_METRICS_SHEET = "threads_metrics";
const THREADS_METRICS_HEADERS = ["date", "media_id", "draft_id", "keyword", "style", "published_at", "views", "likes", "replies", "reposts", "quotes"];

async function ensureSheetWithHeaders(title: string, headers: string[]): Promise<void> {
  const sheets = getSheets();
  const id = mainSheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: "sheets.properties.title" });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === title);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `${title}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  }
}

export async function appendMetricsDaily(rows: (string | number)[][]): Promise<void> {
  if (rows.length === 0) return;
  await ensureSheetWithHeaders(METRICS_SHEET, METRICS_HEADERS);
  const sheets = getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: mainSheetId(),
    range: `${METRICS_SHEET}!A:H`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
}

export async function appendThreadsMetrics(rows: (string | number)[][]): Promise<void> {
  if (rows.length === 0) return;
  await ensureSheetWithHeaders(THREADS_METRICS_SHEET, THREADS_METRICS_HEADERS);
  const sheets = getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: mainSheetId(),
    range: `${THREADS_METRICS_SHEET}!A:K`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
}

/** posts 시트 ga_pageviews(O열) 갱신 — updatePostStatus의 행 탐색 패턴 재사용. */
export async function updatePostGaPageviews(postId: string, pageviews: number): Promise<void> {
  const sheets = getSheets();
  const id = mainSheetId();
  const idCol = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: "posts!A:A" });
  const rows = idCol.data.values ?? [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]?.[0] === postId) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: id,
        range: `posts!O${i + 1}`,
        valueInputOption: "RAW",
        requestBody: { values: [[pageviews]] },
      });
      return;
    }
  }
}
```
주의: `getSheets()`가 이 파일의 실제 클라이언트 헬퍼명과 다르면(예: `sheetsClient()`), updatePostStatus 구현(373~425)이 쓰는 것과 동일한 이름을 사용할 것.

- [ ] **Step 6: lib/threads.ts에 insights 조회 추가**

```ts
/** 발행 글 1건의 인사이트 (views·likes·replies·reposts·quotes). 실패 시 throw. */
export async function getMediaInsights(
  mediaId: string,
  accessToken: string,
): Promise<Record<string, number>> {
  const url = `${THREADS_API}/${mediaId}/insights?metric=views,likes,replies,reposts,quotes&access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url);
  const j = (await res.json()) as {
    data?: { name: string; values?: { value: number }[]; total_value?: { value: number } }[];
    error?: { message: string };
  };
  if (!res.ok) throw new Error(`insights 실패(${mediaId}): ${j.error?.message ?? res.status}`);
  const out: Record<string, number> = {};
  for (const m of j.data ?? []) {
    out[m.name] = m.total_value?.value ?? m.values?.[0]?.value ?? 0;
  }
  return out;
}
```

- [ ] **Step 7: scripts/collect-metrics.ts 작성** (generate-daily.ts의 env 로더 복사 후):

```ts
/**
 * scripts/collect-metrics.ts — 하루 1회 성과 수집 + 아침 텔레그램 브리핑.
 * 소스별 try/catch 격리: 하나 실패해도 나머지는 수집·발송.
 * 실행: npx --yes tsx scripts/collect-metrics.ts [--dry-run]
 */
// (env 로더 — scripts/generate-daily.ts 30~56행 복사)

const DRY = process.argv.includes("--dry-run");
const errors: string[] = [];
const kstToday = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

async function main() {
  const { getGaAccessTokenForCron } = await import("../lib/ga-token");
  const { getPagePathPageviews, getUtmCampaignFunnel } = await import("../lib/ga4");
  const { getAllPosts, updatePostGaPageviews, appendMetricsDaily, appendThreadsMetrics, getThreadsDrafts } = await import("../lib/sheets");
  const { getThreadsToken, getMediaInsights } = await import("../lib/threads");
  const { styleFromInsight, matchPostByPath } = await import("../lib/metrics-utils");
  const { sendTelegram } = await import("../lib/telegram");

  let gaToken: string | null = null;
  try { gaToken = await getGaAccessTokenForCron(); }
  catch (e) { errors.push(`GA 토큰: ${(e as Error).message}`); }

  // a) Tistory 글별 조회수 → posts.ga_pageviews (누적 30일)
  const topPosts: { id: string; title: string; pv: number }[] = [];
  if (gaToken) {
    try {
      const pvByPath = await getPagePathPageviews(gaToken, 30, 500);
      const posts = (await getAllPosts()).filter((p) => p.tistory_url);
      const byId = new Map<string, number>();
      for (const [path, pv] of Object.entries(pvByPath)) {
        const id = matchPostByPath(path, posts);
        if (id) byId.set(id, (byId.get(id) ?? 0) + pv);
      }
      for (const [id, pv] of byId) {
        if (!DRY) await updatePostGaPageviews(id, pv);
        const post = posts.find((p) => p.id === id);
        topPosts.push({ id, title: post?.title ?? id, pv });
      }
      topPosts.sort((a, b) => b.pv - a.pv);
      console.log(`[tistory] 매칭 ${byId.size}글 / GA 경로 ${Object.keys(pvByPath).length}개`);
    } catch (e) { errors.push(`Tistory GA: ${(e as Error).message}`); }
  }

  // b) ntelecomsafe utm 퍼널 → metrics_daily
  let funnel: Awaited<ReturnType<typeof getUtmCampaignFunnel>> = [];
  const ntelProp = process.env.NTELECOM_GA_PROPERTY_ID;
  if (gaToken && ntelProp) {
    try {
      funnel = await getUtmCampaignFunnel(gaToken, ntelProp);
      const rows = funnel.map((f) => [kstToday, "ntelecom", f.campaign, 0, f.sessions, f.step2Views, 0, ""]);
      if (!DRY) await appendMetricsDaily(rows);
      console.log(`[ntelecom] 캠페인 ${funnel.length}개`);
    } catch (e) { errors.push(`ntelecom GA: ${(e as Error).message}`); }
  } else if (!ntelProp) errors.push("NTELECOM_GA_PROPERTY_ID 미설정");

  // c) Threads insights (최근 14일 발행분) → threads_metrics
  let bestThread: { text: string; style: string; views: number; replies: number } | null = null;
  try {
    const token = await getThreadsToken();
    if (!token) throw new Error("Threads 토큰 없음");
    const drafts = (await getThreadsDrafts()).filter(
      (d) => d.published_id && d.published_at &&
        Date.now() - new Date(d.published_at).getTime() < 14 * 86_400_000,
    );
    const rows: (string | number)[][] = [];
    for (const d of drafts) {
      try {
        const ins = await getMediaInsights(d.published_id, token.access_token);
        rows.push([
          kstToday, d.published_id, d.id, d.keyword, styleFromInsight(d.insight),
          d.published_at, ins.views ?? 0, ins.likes ?? 0, ins.replies ?? 0, ins.reposts ?? 0, ins.quotes ?? 0,
        ]);
        if (!bestThread || (ins.views ?? 0) > bestThread.views) {
          bestThread = {
            text: d.draft_text.replace(/\n/g, " ").slice(0, 40),
            style: styleFromInsight(d.insight), views: ins.views ?? 0, replies: ins.replies ?? 0,
          };
        }
      } catch (e) { console.warn(`[threads] ${d.id} insights 실패: ${(e as Error).message}`); }
    }
    if (!DRY) await appendThreadsMetrics(rows);
    console.log(`[threads] ${rows.length}/${drafts.length}건 수집`);
  } catch (e) { errors.push(`Threads: ${(e as Error).message}`); }

  // d) 아침 브리핑
  const lines = [`📊 <b>${kstToday} 성과 브리핑</b>`];
  if (topPosts.length) {
    lines.push("유입 TOP3 (30일 누적):");
    topPosts.slice(0, 3).forEach((p, i) => lines.push(`  ${i + 1}. ${p.title.slice(0, 30)} (${p.pv})`));
  }
  const totalStep2 = funnel.reduce((a, f) => a + f.step2Views, 0);
  if (funnel.length) {
    lines.push(`어제 신청 페이지 도달: ${totalStep2}회`);
    funnel.filter((f) => f.step2Views > 0).slice(0, 3)
      .forEach((f) => lines.push(`  · ${f.campaign}: 세션 ${f.sessions} → step2 ${f.step2Views}`));
  }
  if (bestThread) {
    lines.push(`Threads 최고: "${bestThread.text}…" 조회 ${bestThread.views}·댓글 ${bestThread.replies}${bestThread.style ? ` [${bestThread.style}]` : ""}`);
  }
  lines.push(errors.length ? `⚠️ 수집 실패: ${errors.join(" / ")}` : "수집 실패: 없음");
  const report = lines.join("\n");
  console.log("---report---\n" + report);
  if (!DRY) await sendTelegram(report);

  console.log(JSON.stringify({ ok: true, errors: errors.length, dry: DRY }));
  // 전 소스 실패 시에만 실패 처리 (부분 실패는 브리핑에 표기하고 성공)
  if (errors.length >= 3) process.exit(1);
}

main().catch((e) => { console.error("ERR:", e); process.exit(1); });
```

- [ ] **Step 8: dry-run 검증** — Run: `npx --yes tsx scripts/collect-metrics.ts --dry-run`
  Expected: `[tistory]…/[ntelecom]…/[threads]…` 로그 + `---report---` 미리보기 + 시트 무변경·텔레그램 미발송. (Task 4 재로그인 전엔 "GA 토큰" 에러가 errors에 뜨는 게 정상 — Threads 수집은 그래도 동작해야 함.)

- [ ] **Step 9: 실전 1회** — `npx --yes tsx scripts/collect-metrics.ts` → 텔레그램 브리핑 수신 + 시트에 metrics_daily/threads_metrics 탭 생성 확인.

- [ ] **Step 10: GHA 워크플로 작성** — `.github/workflows/collect-metrics.yml`:

```yaml
name: Collect Metrics (성과 수집·아침 브리핑)
on:
  schedule:
    - cron: "30 1 * * *" # KST 10:30 nominal (+GHA 지연 → 실제 ~11-12시)
  workflow_dispatch:
jobs:
  collect:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - name: 수집 + 브리핑
        env:
          GOOGLE_SHEETS_CLIENT_EMAIL: ${{ secrets.GOOGLE_SHEETS_CLIENT_EMAIL }}
          GOOGLE_SHEETS_PRIVATE_KEY: ${{ secrets.GOOGLE_SHEETS_PRIVATE_KEY }}
          GOOGLE_SHEETS_ID: ${{ secrets.GOOGLE_SHEETS_ID }}
          AUTH_GOOGLE_ID: ${{ secrets.AUTH_GOOGLE_ID }}
          AUTH_GOOGLE_SECRET: ${{ secrets.AUTH_GOOGLE_SECRET }}
          GA_PROPERTY_ID: ${{ secrets.GA_PROPERTY_ID }}
          NTELECOM_GA_PROPERTY_ID: ${{ secrets.NTELECOM_GA_PROPERTY_ID }}
          THREADS_APP_ID: ${{ secrets.THREADS_APP_ID }}
          THREADS_APP_SECRET: ${{ secrets.THREADS_APP_SECRET }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
        run: npx --yes tsx scripts/collect-metrics.ts
```

- [ ] **Step 11: 신규 secrets 등록 (값 출력 절대 금지)** —
```bash
for k in AUTH_GOOGLE_ID AUTH_GOOGLE_SECRET GA_PROPERTY_ID THREADS_APP_ID THREADS_APP_SECRET; do
  grep "^${k}=" .env.local | cut -d= -f2- | gh secret set "$k"; done
```
`NTELECOM_GA_PROPERTY_ID`는 ⏸ **사용자에게 값 요청** 후 동일 방식 등록.

- [ ] **Step 12: 커밋·푸시 + dispatch 검증** — commit → `gh workflow run collect-metrics.yml` → run 성공 + 텔레그램 브리핑 수신.

---

## Self-Review 결과
- 스펙 커버리지: 1-1(Task 1)·1-2(Task 2)·1-3(Task 3)·2-1(Task 4)·2-2(Task 5·6)·2-3(Task 6) ✓. 2-4는 명시적 후속 분리(헤더 참조).
- 타입 일관성: `styleFromInsight`/`matchPostByPath`/`getUtmCampaignFunnel`/`getMediaInsights`/`appendMetricsDaily`/`appendThreadsMetrics`/`updatePostGaPageviews`/`getGaAccessTokenForCron` — 정의 태스크와 사용 태스크 시그니처 일치 확인 ✓.
- 알려진 리스크: (a) GA4 step2 필터가 400을 주면 Task 5 Step 2의 대체안 적용, (b) sheets 클라이언트 헬퍼명은 구현 시 updatePostStatus와 동일한 것 사용, (c) NextAuth 콜백의 시트 저장은 로그인 지연 ~1초 추가 — 허용.
