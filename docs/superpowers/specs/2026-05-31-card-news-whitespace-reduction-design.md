# 카드뉴스 이미지 여백 최소화 (Whitespace Reduction)

**작성일:** 2026-05-31
**상태:** Approved, ready for implementation

## 배경

카드뉴스 자동 생성 이미지(`square 1080×1080`, `portrait 1080×1350`)에서
사용자가 "여백이 너무 많다"고 피드백.

현재 구현(`bd51baf`)은 콘텐츠 점수가 3점 이상일 때만 4:5로 전환하므로
짧은 콘텐츠와 보통 콘텐츠 모두 1:1로 떨어져서 내부에 빈 공간이 큼.
또한 카드 내부 패딩(`p-16`)과 요소 간 gap이 커서 콘텐츠가 들어가 있어도
시각적으로 차지 못함.

## 목표

- 카드뉴스 이미지에서 시각적 여백을 줄여 콘텐츠가 꽉 차 보이게 한다
- 인스타그램 표준 비율(1:1, 4:5)을 유지해 SNS 호환성 보존
- 세로로 너무 긴 비율(2:3, 9:16)은 사용하지 않음 — 가독성 저하 방지

## Non-Goals

- 비율 풀 확장 (2:3, 9:16 추가) — 사용자 명시 거부
- 카드 디자인 전면 개편 — 색상/타이포 그대로 유지
- 가변 높이(pixel-perfect fit) 도입 — SNS 표준 비율 유지가 우선

## 설계

### 변경 1) 비율 결정 로직 개선

**파일:** `lib/extract-card-data.ts`

**현재:**
```ts
const contentScore =
  (bullets.length >= 3 ? 2 : 0) +
  (hook ? 1 : 0) +
  (subtitle ? 1 : 0);
const ratio: CardRatio = contentScore >= 3 ? "portrait" : "square";
```

**변경 후:**
```ts
// 실제 글자 수까지 고려한 다중 조건
const totalChars =
  (heading?.length || 0) +
  bullets.reduce((sum, b) => sum + b.length, 0) +
  (hook?.length || 0) +
  (subtitle?.length || 0);

const ratio: CardRatio =
  bullets.length >= 3 ? "portrait" :            // 항목 3개+ → 무조건 4:5
  bullets.length >= 2 && Boolean(hook) ? "portrait" :  // 2항목+후크 → 4:5
  totalChars > 180 ? "portrait" :                // 총 글자수 길면 → 4:5
  "square";
```

**효과:** 4:5 선택 빈도 증가 → 1:1에서 빈약하게 보이던 카드들이 4:5로 이동.
4:5 카드의 콘텐츠 밀도가 높아져 자연스러움.

### 변경 2) 카드 내부 패딩/간격 축소

**파일:** `components/card-news-cards.tsx`

| 위치 | 현재 | 변경 후 | Tailwind 클래스 |
|---|---|---|---|
| 카드 외곽 padding | 64px | 40px | `p-16` → `p-10` |
| 헤딩 ↔ 본문 첫 요소 간격 | 48px | 24px | `mt-12` → `mt-6` |
| bullet/step 항목 간격 | 24px | 16px | `space-y-6` → `space-y-4` |
| hook 인용 박스 padding | 48px | 32px | `p-12` → `p-8` |
| 표지 카드 헤딩 ↔ 서브 간격 | 32px | 20px | `mt-8` → `mt-5` |

**적용 범위:** Cover, Section(bullets/hook-only/empty), 모든 케이스 동일하게 축소.

**효과:** 콘텐츠 영역이 약 15-20% 넓어짐 → 동일 콘텐츠도 시각적으로 꽉 참.

### 변경 3) 본문 폰트 자동 스케일 (오버플로 방지)

**파일:** `components/card-news-cards.tsx`

bullets가 많거나 텍스트가 길 때 본문 폰트를 한 단계 축소해서
좁아진 패딩 안에서 잘리지 않게 함.

```ts
const isDense = bullets.length >= 5 || totalChars > 240;
const bulletTextSize = isDense ? "text-2xl" : "text-3xl";
const headingTextSize = isDense ? "text-4xl" : "text-5xl";
```

**효과:** 패딩 축소로 인한 오버플로 위험 제거.

## 영향 받는 파일

1. **`lib/extract-card-data.ts`**
   - `extractCardData()` 내 ratio 결정 로직 교체
   - `CardRatio` 타입은 그대로 (`"square" | "portrait"`)
   - SectionCard에 `totalChars`(또는 `isDense`) 필드 추가하여 컴포넌트로 전달

2. **`components/card-news-cards.tsx`**
   - `SectionCardRender` (3개 케이스): padding/gap/font 클래스 조정
   - `CoverCardRender`: padding/gap 조정
   - `sizeFor()`/`SIZE_MAP`은 그대로 유지

## 검증

- 짧은 콘텐츠 (hook만): 1:1 유지, 내부 패딩 축소로 hook 박스가 카드 80% 차지
- 보통 콘텐츠 (bullets 2개 + hook): 이전엔 1:1 → 이제 4:5, 4:5 안에서 자연스러움
- 풍부 콘텐츠 (bullets 4-6개): 4:5 유지, dense 모드 폰트 적용해서 오버플로 X
- 표지: 1:1 유지 (OG 호환)
- 다운로드 PNG도 동일하게 적용 — html2canvas는 DOM 그대로 캡처하므로 자동

## 마이그레이션

- 기존 글의 metadata에 저장된 ratio는 그대로 사용 (하위 호환)
- 신규 글부터 새 로직 적용
- 기존 글도 미리보기/다운로드 시 컴포넌트 단의 패딩 변경은 즉시 반영됨
