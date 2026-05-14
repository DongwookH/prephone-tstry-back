/**
 * 키워드 카테고리 자동 분류.
 * build_master_keywords.py의 classify 룰과 동일.
 */

export type Category =
  | "페인포인트"
  | "eSIM"
  | "타겟"
  | "광역시"
  | "개통핵심"
  | "채널"
  | "지역"
  | "일반";

export type Role = "main" | "sub";

export function classifyKeyword(rawKeyword: string): {
  category: Category;
  role: Role;
} {
  const k = rawKeyword.replace(/\s+/g, "").toLowerCase();

  // 페인포인트
  if (
    ["수신정지", "발신정지", "통신정지", "정지", "미납", "연체", "직권해지", "직권"].some(
      (t) => k.includes(t),
    )
  ) {
    return { category: "페인포인트", role: "main" };
  }

  // eSIM/이심
  if (k.includes("esim") || k.includes("이심")) {
    return { category: "eSIM", role: "main" };
  }

  // 타겟
  if (
    ["외국인", "미성년자", "법인", "시니어", "배달폰", "투폰", "세컨폰", "두번째폰", "업무폰", "유학생"].some(
      (t) => k.includes(t),
    )
  ) {
    return { category: "타겟", role: "main" };
  }

  // 광역시
  const majors = ["부산", "대구", "대전", "광주", "인천", "울산", "세종", "수원", "성남", "용인", "고양", "청주", "김해", "마포", "강남", "송파"];
  if (majors.some((m) => k.includes(m)) && k.includes("선불폰")) {
    return { category: "광역시", role: "main" };
  }

  // 개통 핵심
  if (
    [
      "개통방법", "셀프개통", "비대면개통", "개통가이드", "개통후기",
      "개통절차", "개통하는", "5분개통", "3분개통", "당일개통", "주말개통",
      "온라인개통", "유심개통",
    ].some((t) => k.includes(t))
  ) {
    return { category: "개통핵심", role: "main" };
  }

  // 채널
  if (
    [
      "편의점", "gs25", "cu", "세븐일레븐", "이마트", "우체국", "올리브영", "다이소", "스카이라이프",
    ].some((t) => k.includes(t))
  ) {
    return { category: "채널", role: "sub" };
  }

  // 일반
  return { category: "일반", role: "sub" };
}
