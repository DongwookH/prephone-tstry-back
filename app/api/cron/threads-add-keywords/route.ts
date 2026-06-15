import { NextResponse } from "next/server";
import {
  appendThreadsKeyword,
  getActiveThreadsKeywords,
} from "@/lib/sheets";

export const maxDuration = 60;

/**
 * POST /api/cron/threads-add-keywords
 *
 * threads_keywords 시트에 키워드를 일괄 추가.
 * 이미 있는 키워드는 건너뜀.
 *
 * body: {
 *   keywords: Array<{ keyword: string; category: string; priority?: "high"|"normal"|"low" }>
 * }
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    keywords?: {
      keyword: string;
      category: string;
      priority?: "high" | "normal" | "low";
    }[];
  };

  if (!Array.isArray(body.keywords) || body.keywords.length === 0) {
    return NextResponse.json(
      { ok: false, error: "keywords 배열이 비어 있습니다." },
      { status: 400 },
    );
  }

  const existing = await getActiveThreadsKeywords();
  const existingSet = new Set(existing.map((k) => k.keyword.trim()));

  const added: { keyword: string; id: string }[] = [];
  const skipped: string[] = [];

  for (const item of body.keywords) {
    const kw = item.keyword?.trim();
    if (!kw) {
      skipped.push("(빈 키워드)");
      continue;
    }
    if (existingSet.has(kw)) {
      skipped.push(`${kw} (이미 존재)`);
      continue;
    }
    const { id } = await appendThreadsKeyword({
      keyword: kw,
      category: item.category || "핵심",
      priority: item.priority || "normal",
    });
    added.push({ keyword: kw, id });
    existingSet.add(kw);
  }

  return NextResponse.json({
    ok: true,
    added,
    skipped,
  });
}
