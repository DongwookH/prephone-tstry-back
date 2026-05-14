"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { appendRows, keywordsSheetId, getActiveKeywords } from "@/lib/sheets";
import { fetchKeywordVolumes, isNaverAdConfigured } from "@/lib/naver-keyword";
import { classifyKeyword, type Category, type Role } from "@/lib/categorize";

export type AddedKeyword = {
  id: string;
  keyword: string;
  category: string;
  priority: "high" | "normal" | "low";
  role: Role;
  search_volume: number;
  competition: string;
};

/**
 * 키워드 추가:
 *  1) 중복 체크 (시트에 이미 있으면 skip)
 *  2) 카테고리 자동 분류 (없으면)
 *  3) 네이버 광고 API로 검색량 조회 (가능하면)
 *  4) priority 자동 결정 (검색량 기준 또는 사용자 지정)
 *  5) keywords 시트에 append
 */
export async function addKeywordsAction(input: {
  keywords: string[]; // 한 번에 여러 개 추가 가능
  category?: Category;
  priority?: "high" | "normal" | "low";
  role?: Role;
}): Promise<{
  ok: boolean;
  added: AddedKeyword[];
  skipped: { keyword: string; reason: string }[];
  error?: string;
}> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, added: [], skipped: [], error: "로그인이 필요합니다" };
  }

  // 1) 정규화 + 빈값 제거
  const cleaned = Array.from(
    new Set(
      input.keywords
        .map((k) => k.trim())
        .filter(Boolean),
    ),
  );
  if (cleaned.length === 0) {
    return { ok: false, added: [], skipped: [], error: "키워드를 입력하세요" };
  }
  if (cleaned.length > 30) {
    return {
      ok: false,
      added: [],
      skipped: [],
      error: "한 번에 최대 30개까지만 추가 가능합니다",
    };
  }

  // 2) 중복 체크
  const existing = await getActiveKeywords();
  const existingSet = new Set(
    existing.map((k) => k.keyword.replace(/\s+/g, "").toLowerCase()),
  );
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

  const toAdd: string[] = [];
  const skipped: { keyword: string; reason: string }[] = [];
  for (const kw of cleaned) {
    if (existingSet.has(norm(kw))) {
      skipped.push({ keyword: kw, reason: "이미 시트에 존재" });
    } else {
      toAdd.push(kw);
    }
  }

  if (toAdd.length === 0) {
    return { ok: true, added: [], skipped };
  }

  // 3) 네이버 검색량 일괄 조회
  let volumes: Map<string, { total: number; pc: number; mobile: number; competition: string }> =
    new Map();
  if (isNaverAdConfigured()) {
    try {
      const rows = await fetchKeywordVolumes(toAdd);
      for (const r of rows) {
        volumes.set(norm(r.keyword), {
          total: r.monthlyTotalVolume,
          pc: r.monthlyPcVolume,
          mobile: r.monthlyMobileVolume,
          competition: r.competition,
        });
      }
    } catch (err) {
      console.warn("[addKeywords] 네이버 검색량 조회 실패:", (err as Error).message);
      // 검색량 없어도 계속 진행
    }
  }

  // 4) 행 준비
  const now = new Date().toISOString();
  const datePrefix = now.slice(0, 10).replace(/-/g, "");
  const rows: (string | number)[][] = [];
  const added: AddedKeyword[] = [];

  toAdd.forEach((kw, idx) => {
    // 카테고리/role 자동 분류 (사용자가 지정 안 했으면)
    const auto = classifyKeyword(kw);
    const category = input.category || auto.category;
    const role = input.role || auto.role;
    const vol = volumes.get(norm(kw));
    const totalVol = vol?.total ?? 0;
    // priority: 사용자 지정 우선, 없으면 검색량 기준
    const priority =
      input.priority ||
      (totalVol >= 1000 ? "high" : totalVol >= 100 ? "normal" : "low");
    const id = `kw-manual-${datePrefix}-${String(idx + 1).padStart(3, "0")}-${Math.random().toString(36).slice(2, 5)}`;
    const status = totalVol > 0 || !isNaverAdConfigured() ? "active" : "active"; // 사용자 추가는 무조건 active

    rows.push([
      id,
      kw,
      category,
      priority,
      role,
      totalVol,
      vol?.pc ?? 0,
      vol?.mobile ?? 0,
      vol?.competition ?? "-",
      0, // used_count
      "", // last_used
      status,
      "사용자 수동 추가",
      "manual",
      now,
    ]);
    added.push({
      id,
      keyword: kw,
      category,
      priority,
      role,
      search_volume: totalVol,
      competition: vol?.competition ?? "-",
    });
  });

  // 5) 시트에 append
  try {
    await appendRows(keywordsSheetId(), "keywords", rows);
  } catch (err) {
    return {
      ok: false,
      added: [],
      skipped,
      error: `시트 저장 실패: ${(err as Error).message}`,
    };
  }

  revalidatePath("/keywords");
  revalidatePath("/");
  return { ok: true, added, skipped };
}
