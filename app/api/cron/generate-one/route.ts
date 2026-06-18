import { NextResponse } from "next/server";
import {
  appendPosts,
  bumpKeywordsUsage,
  getRecentPostTitles,
  getAllPosts,
} from "@/lib/sheets";
import { generatePost } from "@/lib/post-generator";
import { ACTIVE_PATTERN_IDS, type HookPatternId } from "@/lib/title-diversity";

export const maxDuration = 60;

/**
 * POST /api/cron/generate-one
 *
 * 1편 생성 + posts 시트 저장 + used_count 갱신.
 * Vercel Hobby plan의 60초 한도 안에서 완료.
 *
 * 인증: Authorization: Bearer <CRON_SECRET>
 *
 * body:
 *   {
 *     track: 1 | 2,
 *     keyword: string,
 *     category: string,
 *     subKeywords?: string[],
 *     persona?: string,
 *     slot: number  // 1~10 (id 생성용)
 *   }
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    track?: 1 | 2;
    keyword?: string;
    category?: string;
    subKeywords?: string[];
    persona?: string;
    slot?: number;
    forcedPattern?: number; // plan이 슬롯별로 배정한 후킹 패턴 (1~20)
  };

  if (!body.keyword) {
    return NextResponse.json(
      { error: "keyword가 필요합니다" },
      { status: 400 },
    );
  }

  const t0 = Date.now();
  try {
    // 최근 25개 제목 — Gemini가 클리셰 패턴 회피하도록 프롬프트에 주입
    const recentTitles = await getRecentPostTitles(25).catch(() => []);

    // plan이 배정한 슬롯별 distinct 패턴 사용 (하루 안 패턴 중복 방지).
    // 없으면(수동 호출 등) generatePost가 자동으로 least-used 패턴 선택.
    const fp =
      typeof body.forcedPattern === "number" &&
      ACTIVE_PATTERN_IDS.includes(body.forcedPattern as HookPatternId)
        ? (body.forcedPattern as HookPatternId)
        : undefined;

    const post = await generatePost({
      keyword: body.keyword,
      category: body.category || "일반",
      subKeywords: body.subKeywords || [],
      persona: body.persona || "일반",
      recentTitles,
      forcedPattern: fp,
    });

    const now = new Date().toISOString();
    // KST 날짜로 id 부여 (UTC 23:15~24:00에 cron 돌 때 UTC date면 어제로 찍힘)
    const todayKST = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()).replace(/-/g, "");

    // id 충돌 방지 — 시트에 같은 id가 이미 있으면 다음 빈 슬롯 번호 사용
    // (수동 트리거와 자동 cron이 동시에 돌 때 발생)
    const existingPosts = await getAllPosts().catch(() => []);
    const usedSlots = new Set(
      existingPosts
        .map((p) => p.id || "")
        .filter((id) => id.startsWith(`p-${todayKST}-`))
        .map((id) => parseInt(id.slice(-3), 10))
        .filter((n) => !isNaN(n)),
    );
    let slotNum = body.slot ?? 0;
    // 요청한 슬롯이 비어 있으면 그대로 사용, 충돌하면 다음 빈 번호 (1~999)
    if (usedSlots.has(slotNum)) {
      for (let n = 1; n <= 999; n++) {
        if (!usedSlots.has(n)) {
          slotNum = n;
          break;
        }
      }
    }
    const slot = String(slotNum).padStart(3, "0");
    const id = `p-${todayKST}-${slot}`;

    await appendPosts([
      {
        id,
        title: post.title,
        keyword: body.keyword,
        category: body.category || "일반",
        persona: body.persona || "일반",
        content_md: "",
        content_html: post.content_html,
        char_count: post.char_count,
        seo_score: post.seo_score,
        status: "ready",
        utm_campaign: post.utm_campaign,
        created_at: now,
        updated_at: now,
        tags: post.tags,
      },
    ]);

    // Track 1만 used_count 갱신 (Track 2는 방금 추가된 거라 굳이 X)
    if (body.track === 1) {
      try {
        await bumpKeywordsUsage([body.keyword]);
      } catch (err) {
        console.warn("[generate-one] used_count 갱신 실패:", err);
      }
    }

    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - t0,
      id,
      title: post.title,
      charCount: post.char_count,
      seoScore: post.seo_score,
      keyword: body.keyword,
      track: body.track,
      thumbnail: post.thumbnail,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        durationMs: Date.now() - t0,
        keyword: body.keyword,
        error: (err as Error).message,
      },
      { status: 500 },
    );
  }
}
