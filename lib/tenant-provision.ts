import { google } from "googleapis";
import { mainSheetId, keywordsSheetId, readRange } from "./sheets";
import { getGaAccessTokenForCron } from "./ga-token";
import type { TenantRow } from "./tenants";

/**
 * 테넌트 전용 스프레드시트 프로비저닝.
 *
 * ⚠️ 왜 서비스 계정이 아니라 "오너 OAuth"로 생성하는가:
 *    서비스 계정은 Drive 저장 용량이 0이라 파일을 소유할 수 없다
 *    (2026-07-25 실측: spreadsheets.create → "storage quota has been exceeded").
 *    그래서 로그인 시 저장되는 오너 refresh token(drive.file 스코프 포함)으로
 *    오너 소유 시트를 만들고, ① 테넌트 이메일 ② 서비스 계정(크론용)에 공유한다.
 *    오너가 drive.file 동의 이전에 로그인했던 토큰이면 스코프가 없어 실패
 *    → "로그아웃 후 재로그인" 안내 에러를 돌려준다.
 *
 * 생성 내용: posts / keywords / settings / guide 탭.
 * posts·keywords 헤더는 메인 시트에서 라이브 복사 (스키마 드리프트 방지).
 */

// settings 탭 — 메인 시트 settings와 동일 스키마 (sheets.ts SETTINGS_HEADERS)
const SETTINGS_HEADERS = [
  "id",
  "type",
  "value",
  "label",
  "enabled",
  "created_at",
  "last_used",
  "usage_count",
];

const GUIDE_HEADERS = ["section", "설명", "content", "updated_at"];

/**
 * 세부 가이드 섹션 스캐폴드.
 * company·plans는 "필수" — 비어 있으면 그 테넌트 글 생성을 건너뛴다
 * (공통 가이드의 회사·요금 정보는 오너 것이라 폴백하면 남의 정보가 글에 들어감).
 * 나머지는 비워두면 공통 가이드를 따른다.
 */
const GUIDE_SCAFFOLD: Array<[section: string, desc: string]> = [
  [
    "company",
    "(필수) 상호명, 연락 채널(카톡·전화), 홈페이지, 영업시간 등 본인 회사 정보. 비어 있으면 글이 생성되지 않습니다.",
  ],
  [
    "plans",
    "(필수) 단정해서 표기할 수 있는 확정 요금·상품만 적어주세요. 비어 있으면 글이 생성되지 않습니다.",
  ],
  [
    "personas",
    "글을 읽을 타깃 독자 유형. 한 줄에 하나씩. 비워두면 공통 기본 페르소나를 사용합니다.",
  ],
  [
    "banned_words",
    "글에 쓰면 안 되는 단어·표현 (콤마로 구분). 공통 품질 금지어에 추가로 적용됩니다.",
  ],
  [
    "extra_rules",
    "그 밖의 글 작성 규칙 (톤, 강조할 메시지, 피할 주제 등). 공통 가이드와 충돌하면 이 내용이 우선합니다.",
  ],
  [
    "faq",
    "자주 받는 질문과 답 (Q/A 형식 자유). 글의 사실 근거로 사용됩니다.",
  ],
];

/** 원본 시트의 헤더 행을 읽는다 (1행이 💡 코멘트면 2행). 실패 시 null. */
async function readHeaderRow(
  spreadsheetId: string,
  tab: string,
): Promise<string[] | null> {
  try {
    const rows = await readRange(spreadsheetId, `${tab}!A1:Z2`);
    if (!rows.length) return null;
    const header = rows[0]?.[0]?.startsWith("💡") ? rows[1] : rows[0];
    return header && header.length ? header : null;
  } catch {
    return null;
  }
}

// 메인 시트 posts 헤더를 못 읽을 때의 최후 폴백 (updatePostStatus 열 순서와 동일)
const POSTS_HEADERS_FALLBACK = [
  "id",
  "title",
  "keyword",
  "category",
  "persona",
  "content_md",
  "content_html",
  "char_count",
  "seo_score",
  "status",
  "scheduled_at",
  "published_at",
  "tistory_url",
  "image_urls",
  "ga_pageviews",
  "ga_clicks",
  "ga_conversions",
  "utm_campaign",
  "created_at",
  "updated_at",
];

const KEYWORDS_HEADERS_FALLBACK = [
  "keyword",
  "status",
  "category",
  "priority",
  "used_count",
  "last_used",
  "note",
];

export type ProvisionResult =
  | { ok: true; spreadsheetId: string; url: string }
  | { ok: false; error: string };

function isScopeError(e: unknown): boolean {
  const status =
    (e as { response?: { status?: number } })?.response?.status ??
    (e as { code?: number })?.code;
  const msg = String((e as Error)?.message ?? "").toLowerCase();
  return (
    status === 403 ||
    msg.includes("insufficient") ||
    msg.includes("scope") ||
    msg.includes("permission")
  );
}

/**
 * 테넌트 전용 시트 생성(오너 소유) + 테넌트·서비스 계정 공유.
 * tenants 행 업데이트(F열)는 호출부 책임.
 */
export async function provisionTenantSheet(
  tenant: Pick<TenantRow, "email" | "name">,
): Promise<ProvisionResult> {
  // 0) 오너 OAuth access token (settings의 refresh token 사용)
  let accessToken: string;
  try {
    accessToken = await getGaAccessTokenForCron();
  } catch (e) {
    return {
      ok: false,
      error: `오너 구글 토큰 없음 — ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const oauth = new google.auth.OAuth2();
  oauth.setCredentials({ access_token: accessToken });
  const drive = google.drive({ version: "v3", auth: oauth });
  const sheets = google.sheets({ version: "v4", auth: oauth });

  try {
    // 1) 스프레드시트 생성 (오너 소유, drive.file 스코프)
    const title = `블로그 자동화 — ${tenant.name || tenant.email}`;
    const created = await drive.files.create({
      requestBody: {
        name: title,
        mimeType: "application/vnd.google-apps.spreadsheet",
      },
      fields: "id",
    });
    const newId = created.data.id;
    if (!newId) return { ok: false, error: "스프레드시트 생성 실패 (ID 없음)" };
    const url = `https://docs.google.com/spreadsheets/d/${newId}`;

    // 2) 탭 구성 — 기본 탭 조회 후 4개 탭 추가 + 기본 탭 삭제
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: newId,
      fields: "sheets.properties(sheetId,title)",
    });
    const defaultSheetId = meta.data.sheets?.[0]?.properties?.sheetId ?? 0;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: newId,
      requestBody: {
        requests: [
          { addSheet: { properties: { title: "posts" } } },
          { addSheet: { properties: { title: "keywords" } } },
          { addSheet: { properties: { title: "settings" } } },
          { addSheet: { properties: { title: "guide" } } },
          { deleteSheet: { sheetId: defaultSheetId } },
        ],
      },
    });

    // 3) 헤더 — posts·keywords는 메인 시트에서 라이브 복사 (서비스 계정으로 읽음)
    const postsHeaders =
      (await readHeaderRow(mainSheetId(), "posts")) ?? POSTS_HEADERS_FALLBACK;
    const keywordsHeaders =
      (await readHeaderRow(keywordsSheetId(), "keywords")) ??
      KEYWORDS_HEADERS_FALLBACK;

    const now = new Date().toISOString();
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: newId,
      requestBody: {
        valueInputOption: "RAW",
        data: [
          { range: "posts!A1", values: [postsHeaders] },
          { range: "keywords!A1", values: [keywordsHeaders] },
          { range: "settings!A1", values: [SETTINGS_HEADERS] },
          {
            range: "guide!A1",
            values: [
              GUIDE_HEADERS,
              ...GUIDE_SCAFFOLD.map(([section, desc]) => [
                section,
                desc,
                "",
                now,
              ]),
            ],
          },
        ],
      },
    });

    // 4) 공유 — ① 테넌트(메일 알림 O) ② 서비스 계정(크론 접근용, 알림 X)
    await drive.permissions.create({
      fileId: newId,
      sendNotificationEmail: true,
      emailMessage:
        "블로그 자동화 백오피스의 전용 데이터 시트입니다. guide 탭에서 세부 가이드를 작성해 주세요.",
      requestBody: {
        type: "user",
        role: "writer",
        emailAddress: tenant.email,
      },
    });
    const saEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
    if (saEmail) {
      await drive.permissions.create({
        fileId: newId,
        sendNotificationEmail: false,
        requestBody: {
          type: "user",
          role: "writer",
          emailAddress: saEmail,
        },
      });
    }

    return { ok: true, spreadsheetId: newId, url };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isScopeError(e)) {
      return {
        ok: false,
        error:
          "Drive 권한 부족 — 백오피스에서 로그아웃 후 다시 로그인(구글 권한 동의)하면 해결됩니다.",
      };
    }
    return { ok: false, error: `시트 프로비저닝 실패: ${msg}` };
  }
}
