# 카드뉴스 이미지 여백 최소화 (Whitespace Reduction)

**작성일:** 2026-05-31
**수정일:** 2026-05-31 (가변 높이 방식으로 전환)
**상태:** Approved, ready for implementation

## 배경

카드뉴스 자동 생성 이미지에서 **하단 여백이 너무 크다**는 피드백.

`bd51baf` 버전(square 1080×1080 / portrait 1080×1350 자동 선택)
실제 결과물 확인 결과:
- 3-4 bullets 짜리 카드가 portrait(1080×1350)로 선택되어도
  상단 30%만 콘텐츠로 채워지고 하단 70%가 빈 공간
- padding 축소(p-16→p-10)와 임계값 완화로는 이 정도 여백을 잡지 못함

## 목표

**카드 이미지에서 하단 여백을 사실상 0으로 만든다.**

수단: 고정 비율 폐기 → **가변 높이(width 1080 고정, height = 콘텐츠에 맞춤)**.

## Non-Goals

- 인스타그램 표준 비율 호환 — 우선순위에서 제외 (티스토리 임베드가 1순위)
- 카드 디자인 색상/타이포 변경 — 그대로 유지

## 설계

### 핵심 변경: 가변 높이

**현재:**
```ts
const SIZE_MAP = {
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
};
// 카드 DOM에 fixed height 부여 → 콘텐츠 부족 시 하단 빈 공간
```

**변경 후:**
```ts
const CARD_WIDTH = 1080;
const CARD_BOTTOM_MARGIN = 80;  // 하단 마진 (footer 영역 포함)
// 카드 DOM은 height: auto — 콘텐츠가 자연스럽게 차지하는 만큼만
// html2canvas가 캡처할 때 실제 DOM 높이 그대로 PNG 생성
```

### 1) 타입 변경 — `lib/extract-card-data.ts`

```ts
// 제거: CardRatio = "square" | "portrait"
// 제거: CoverCard.ratio, SectionCard.ratio 필드
// 제거: contentScore 계산
```

기존 코드의 `ratio` 참조 모두 제거.
함수 시그니처는 그대로 (외부 호출자 영향 없음).

### 2) 카드 렌더링 — `components/card-news-cards.tsx`

**off-screen 캡처 영역:**
```tsx
<div
  ref={captureRef}
  style={{
    width: CARD_WIDTH,
    // height 지정 X — 콘텐츠 길이에 따라 자동 결정
  }}
>
  <CardContent ... />
</div>
```

**html2canvas 호출:**
```ts
const canvas = await html2canvas(captureRef.current, {
  width: CARD_WIDTH,
  // height 지정 X — DOM의 scrollHeight 사용 (기본 동작)
  scale: 2,
  ...
});
```

**미리보기 그리드:**
```tsx
// 기존: aspect-square 또는 aspect-[4/5]
// 변경: aspect 클래스 제거, height: auto
<div className="bg-white rounded overflow-hidden">
  <CardContent ... />
  {/* 미리보기에서도 실제 높이 그대로 표시 */}
</div>
```

→ 미리보기와 다운로드된 PNG가 100% 동일한 비율로 보임.

### 3) 하단 여백 명확히 정의

가변 높이로 가도 콘텐츠 직후가 그대로 끝나면 답답함.
**의도된 최소 하단 여백:**
- 마지막 bullet 아래 → footer 위 간격: `mt-10` (40px)
- footer 자체 padding: `py-6` (24px 위아래)
- 총 하단 여백: 약 80px (의도된 최소 여백)

→ "여백 0"이 아니라 "콘텐츠 직후 깔끔하게 끝남".

### 4) 풋터(브랜드) 표시 위치

기존: 카드 하단에 absolute 고정 → 빈 공간 위에 떠 있음
변경: **콘텐츠 흐름에 포함** (flex column의 마지막 요소)
→ 콘텐츠 직후에 자연스럽게 풋터 → PNG 끝에 위치.

## 영향 받는 파일

1. **`lib/extract-card-data.ts`**
   - `CardRatio` 타입 제거
   - `CoverCard.ratio`, `SectionCard.ratio` 필드 제거
   - `contentScore` 계산 로직 제거

2. **`components/card-news-cards.tsx`**
   - `SIZE_MAP`, `sizeFor()` 제거
   - off-screen 렌더링: `style={{ width: 1080 }}` (height 미지정)
   - html2canvas: width만 지정, height 자동
   - 미리보기 그리드: aspect-* 클래스 제거, height auto
   - "4:5" 배지 제거
   - 풋터: absolute → flow-in

3. **`docs/superpowers/specs/...`** (이 문서)

## 검증

- **짧은 콘텐츠 (hook + 1 bullet)**: 카드 약 1080×800 → 거의 정사각, 빈 공간 X
- **보통 콘텐츠 (3 bullets)**: 카드 약 1080×1100 → 1:1보다 살짝 세로
- **풍부 콘텐츠 (5 bullets + hook)**: 카드 약 1080×1500 → 4:5와 유사하지만 콘텐츠 꽉 참
- **표지**: 콘텐츠에 맞춤 → 보통 1080×900~1100
- **다운로드 PNG**: 미리보기와 동일 (html2canvas DOM 그대로 캡처)
- **티스토리 임베드**: 어떤 높이든 정상 (img max-width:100%)

## 트레이드오프

- ❌ 인스타그램 자동 업로드 시 비표준 비율 → 자동 크롭 발생
  - 인스타 업로드 우선순위 낮음, 필요시 수동 크롭으로 대응
- ✅ 티스토리 본문 임베드 — 자연스러움
- ✅ 여백 0 보장 (의도된 80px 하단 마진 제외)
- ✅ 미리보기/다운로드 100% 일치

## 마이그레이션

- 기존 글 카드 metadata에 `ratio` 필드 있어도 무시 (옵션 필드 처리)
- 신규 글부터 가변 높이 적용
- 기존 글도 다시 다운로드 시 가변 높이로 생성
