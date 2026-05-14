// 임시 더미 데이터. Google Sheets 연동 후 lib/sheets.ts로 교체.

export type PostStatus = "ready" | "published" | "failed";

export type Post = {
  id: string;
  title: string;
  preview: string;
  keyword: string;
  category: "situation" | "comparison" | "info" | "trouble";
  createdAt: string; // ISO
  timeLabel: string;
  dateLabel: string;
  chars: number;
  seo: number;
  status: PostStatus;
  isToday: boolean;
  isTop?: boolean;
  tistoryUrl?: string | null;
};

export const todayPosts: Post[] = [
  {
    id: "p001",
    title:
      "신용불량자도 선불폰 개통 가능한가요? 5분 만에 끝내는 비대면 가이드",
    preview:
      "신용 점수 때문에 휴대폰 개통이 막히신 분들 많으시죠. 선불폰은 신용 조회 없이 신분증 한 장으로…",
    keyword: "신용불량자 선불폰",
    category: "situation",
    createdAt: "2026-05-05T09:14:00+09:00",
    timeLabel: "오늘 09:14",
    dateLabel: "5월 5일 (화)",
    chars: 3724,
    seo: 92,
    status: "published",
    isToday: true,
    tistoryUrl: "https://dajjis.tistory.com/entry/credit-prepaid",
  },
  {
    id: "p002",
    title: "외국인 선불폰 개통, 외국인등록증 하나로 끝내는 법",
    preview:
      "한국에 막 도착한 외국인 분들이 가장 먼저 부딪히는 벽이 바로 통신 개통입니다…",
    keyword: "외국인 개통",
    category: "situation",
    createdAt: "2026-05-05T09:14:00+09:00",
    timeLabel: "오늘 09:14",
    dateLabel: "5월 5일 (화)",
    chars: 3512,
    seo: 88,
    status: "ready",
    isToday: true,
  },
  {
    id: "p003",
    title: "법인 선불폰 vs 개인 선불폰, 차이점 완벽 정리 2026",
    preview:
      "사업자등록증이 있다면 법인 선불폰이 훨씬 유리합니다. 세금 공제부터 다회선 할인…",
    keyword: "법인 vs 개인",
    category: "comparison",
    createdAt: "2026-05-05T09:14:00+09:00",
    timeLabel: "오늘 09:14",
    dateLabel: "5월 5일 (화)",
    chars: 4108,
    seo: 95,
    status: "published",
    isToday: true,
  },
  {
    id: "p004",
    title: "선불유심 호환 가이드: KT와 LG U+ 어디가 더 좋을까",
    preview:
      "같은 선불폰이라도 KT망과 LG U+망의 커버리지와 속도는 다릅니다…",
    keyword: "유심 호환",
    category: "comparison",
    createdAt: "2026-05-05T09:14:00+09:00",
    timeLabel: "오늘 09:14",
    dateLabel: "5월 5일 (화)",
    chars: 3890,
    seo: 91,
    status: "published",
    isToday: true,
  },
  {
    id: "p005",
    title: "선불폰 충전 방법 3가지, 가장 빠르고 저렴한 건?",
    preview:
      "편의점, 모바일 앱, 자동 충전. 세 가지 방식을 비교해 보면 내 사용 습관에 맞는 답이…",
    keyword: "충전 방법",
    category: "info",
    createdAt: "2026-05-05T09:14:00+09:00",
    timeLabel: "오늘 09:14",
    dateLabel: "5월 5일 (화)",
    chars: 2841,
    seo: 95,
    status: "published",
    isToday: true,
    isTop: true,
  },
  {
    id: "p006",
    title: "선불폰 개통 안 될 때 체크리스트 7가지",
    preview:
      "유심 인식이 안 되거나 개통 인증이 실패할 때, 100% 해결되는 순서가 있습니다…",
    keyword: "개통 트러블",
    category: "trouble",
    createdAt: "2026-05-05T09:14:00+09:00",
    timeLabel: "오늘 09:14",
    dateLabel: "5월 5일 (화)",
    chars: 3256,
    seo: 87,
    status: "ready",
    isToday: true,
  },
  {
    id: "p007",
    title: "20대 학생을 위한 가성비 선불요금제 추천 TOP 5",
    preview:
      "데이터를 많이 쓰지만 통신비는 줄이고 싶은 학생들. 월 2만원 대 선에서 가장…",
    keyword: "학생 요금제",
    category: "situation",
    createdAt: "2026-05-05T09:14:00+09:00",
    timeLabel: "오늘 09:14",
    dateLabel: "5월 5일 (화)",
    chars: 3602,
    seo: 89,
    status: "published",
    isToday: true,
  },
  {
    id: "p008",
    title: "데이터 무제한 선불요금제, 진짜 무제한일까?",
    preview:
      "“무제한”이라는 단어 뒤에 숨은 QoS(속도 제한) 정책. 진짜 무제한과 가짜 무제한을 구분하는…",
    keyword: "데이터 무제한",
    category: "info",
    createdAt: "2026-05-05T09:14:00+09:00",
    timeLabel: "오늘 09:14",
    dateLabel: "5월 5일 (화)",
    chars: 3914,
    seo: 90,
    status: "ready",
    isToday: true,
  },
  {
    id: "p009",
    title: "본인인증 안 되는 선불폰, 이렇게 해결하세요",
    preview:
      "은행 앱이나 정부24에서 본인인증이 안 된다면 대부분 선불폰이 원인입니다…",
    keyword: "본인인증",
    category: "trouble",
    createdAt: "2026-05-05T09:14:00+09:00",
    timeLabel: "오늘 09:14",
    dateLabel: "5월 5일 (화)",
    chars: 2940,
    seo: 85,
    status: "ready",
    isToday: true,
  },
  {
    id: "p010",
    title: "선불폰에서 후불폰으로 갈아타는 가장 빠른 방법",
    preview:
      "번호 그대로, 데이터 손실 없이 후불 요금제로 옮기는 절차를 3단계로 정리했습니다…",
    keyword: "후불 전환",
    category: "info",
    createdAt: "2026-05-05T09:14:00+09:00",
    timeLabel: "오늘 09:14",
    dateLabel: "5월 5일 (화)",
    chars: 3376,
    seo: 93,
    status: "published",
    isToday: true,
  },
];

export const olderPosts: Post[] = [
  {
    id: "p011",
    title: "KT 바로유심 편의점 구매 방법 총정리",
    preview: "GS25, CU, 세븐일레븐 어디가 가장 빠른지…",
    keyword: "KT 바로유심",
    category: "info",
    createdAt: "2026-05-04T09:00:00+09:00",
    timeLabel: "어제 09:00",
    dateLabel: "5월 4일 (월)",
    chars: 3241,
    seo: 90,
    status: "published",
    isToday: false,
  },
  {
    id: "p012",
    title: "LG U+ 선불요금제 TOP 7, 데이터 많이 쓰는 분 필수",
    preview: "LG U+망 선불요금제 중 가장 가성비가 좋은…",
    keyword: "LG U+ 선불",
    category: "info",
    createdAt: "2026-05-04T09:00:00+09:00",
    timeLabel: "어제 09:00",
    dateLabel: "5월 4일 (월)",
    chars: 3876,
    seo: 88,
    status: "published",
    isToday: false,
  },
  {
    id: "p013",
    title: "두번째폰 추천 선불요금제 TOP 5",
    preview: "업무용·세컨폰으로 사용하기 좋은 저렴한…",
    keyword: "두번째폰",
    category: "situation",
    createdAt: "2026-05-04T09:00:00+09:00",
    timeLabel: "어제 09:00",
    dateLabel: "5월 4일 (월)",
    chars: 2994,
    seo: 87,
    status: "published",
    isToday: false,
  },
  {
    id: "p014",
    title: "선불폰 약정 없이 사용하는 방법 완벽 정리",
    preview: "약정 없이 개통하면 위약금 걱정도 없습니다…",
    keyword: "약정 없는 폰",
    category: "info",
    createdAt: "2026-05-03T09:00:00+09:00",
    timeLabel: "5월 3일 09:00",
    dateLabel: "5월 3일 (일)",
    chars: 3420,
    seo: 86,
    status: "ready",
    isToday: false,
  },
  {
    id: "p015",
    title: "미성년자 선불폰 개통, 보호자 동의 필요할까?",
    preview: "만 14세 이상이면 본인 명의로 개통이 가능…",
    keyword: "미성년자 선불폰",
    category: "situation",
    createdAt: "2026-05-03T09:00:00+09:00",
    timeLabel: "5월 3일 09:00",
    dateLabel: "5월 3일 (일)",
    chars: 3158,
    seo: 89,
    status: "published",
    isToday: false,
  },
];

export const allPosts = [...todayPosts, ...olderPosts];

export function getPostById(id: string): Post | undefined {
  return allPosts.find((p) => p.id === id);
}

export const dashboardStats = {
  todayGenerated: 10,
  todayLimit: 10,
  todayPublished: 6,
  weekPublished: 42,
  weekLimit: 70,
  conversionClicks: 127,
  conversionGrowth: 24,
};

export const keywordStats = {
  total: 42,
  used: 128,
  pending: 42,
  avgSearchVolume: 2840,
};

type KeywordItem = { name: string; starred?: boolean };
type KeywordGroup = {
  id: string;
  name: string;
  count: number;
  description: string;
  accent: "brand" | "violet" | "mint" | "amber";
  items: KeywordItem[];
};

export const keywordGroups: KeywordGroup[] = [
  {
    id: "situation",
    name: "상황형",
    count: 12,
    description: "12개 키워드 · 우선순위 높음",
    accent: "brand",
    items: [
      { name: "신용불량자 선불폰", starred: true },
      { name: "외국인 선불폰" },
      { name: "미성년자 선불폰" },
      { name: "법인 선불폰" },
      { name: "신분증 분실" },
      { name: "통신요금 미납" },
      { name: "두번째폰" },
      { name: "중장년층 선불폰" },
      { name: "유학생 선불폰" },
    ],
  },
  {
    id: "comparison",
    name: "비교형",
    count: 8,
    description: "8개 키워드 · 검색량 ↑",
    accent: "violet",
    items: [
      { name: "알뜰폰 vs 선불폰", starred: true },
      { name: "법인 vs 개인" },
      { name: "KT vs LG U+" },
      { name: "선불 vs 후불" },
      { name: "바로유심 vs 일반유심" },
      { name: "eSIM vs 유심칩" },
      { name: "자급제 vs 약정" },
      { name: "월별 vs 연간" },
    ],
  },
  {
    id: "info",
    name: "정보형",
    count: 14,
    description: "14개 키워드 · 안정적 트래픽",
    accent: "mint",
    items: [
      { name: "선불폰 충전 방법" },
      { name: "선불유심 호환" },
      { name: "선불폰 본인인증" },
      { name: "개통 절차" },
      { name: "요금제 종류" },
      { name: "데이터 무제한" },
      { name: "번호이동" },
      { name: "바로유심 사용법" },
      { name: "eSIM 발급" },
    ],
  },
  {
    id: "trouble",
    name: "문제해결형",
    count: 8,
    description: "8개 키워드 · 전환율 ↑",
    accent: "amber",
    items: [
      { name: "개통 안 될 때", starred: true },
      { name: "유심 인식 안됨" },
      { name: "본인인증 실패" },
      { name: "충전 안됨" },
      { name: "데이터 안 터짐" },
      { name: "분실 신고" },
      { name: "개통 환불" },
      { name: "통화 끊김" },
    ],
  },
];
