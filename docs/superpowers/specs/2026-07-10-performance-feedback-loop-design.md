# 성과 피드백 루프 + 운영 안정화 설계 (접근 A)

2026-07-10. 대상: ntelecomsafe 블로그·Threads 자동화 (prephone-tstry-back).

## 목표
1. 장애를 운영자가 아니라 **시스템이 먼저** 알게 한다 (텔레그램 알림).
2. 글·키워드·Threads 카피 스타일별 **성과와 전환을 매일 자동 수집**한다.
3. **아침 텔레그램 브리핑**으로 운영자가 1분 안에 "뭘 늘리고 뭘 줄일지" 판단하게 한다.

## 비목표
- 성과 데이터의 **자동 되먹임**(키워드 가중치·스타일 배분 자동 조정)은 이번 스코프가 아니다.
  4~6주 데이터 축적 후 별도 설계(접근 B). 단, 시트 스키마는 그때 재사용 가능하게 설계한다.
- 채널 확장(인스타 등)은 스코프 아님.

## 전제 (2026-07-10 코드 확인 완료)
- Threads 발행 글의 `published_id`·`published_at`이 드래프트 시트에 저장됨 → insights 조회 가능.
- Threads OAuth scope에 `threads_manage_insights` 이미 포함.
- posts 시트에 `tistory_url`(M)·`ga_pageviews`(O) 컬럼이 이미 존재 — `ga_pageviews`는 채우는 코드가 없어 항상 0 (이번에 채운다).
- GA OAuth는 `access_type=offline` → refresh token 발급됨 (현재는 세션 JWT에만 존재).
- ntelecomsafe.com에 GA4 설치 확인(사용자). 블로그 링크에 `utm_campaign={키워드-슬러그}` 이미 부착 중.

---

## Phase 1 — 운영 안정화 (알림 인프라)

### 1-1. GHA 실패·부분실패 텔레그램 알림
- `generate-posts.yml`(thumbnails job)·`backfill-images.yml`: 요약 JSON에서 `failed > 0`이거나 job이 `failure()`면
  curl로 텔레그램 발송 (secrets `TELEGRAM_BOT_TOKEN`·`TELEGRAM_CHAT_ID` — 미등록이면 .env.local에서 파이프로 1회 등록, 값 출력 금지).
- 메시지 예: `⚠️ 이미지 생성 부분실패 — 썸네일 7/10, 카드 1/30. 백필이 00:30 UTC에 재시도.`
- 백필 최종 회차(04:00 UTC) 후에도 구멍이 남으면 `🔴 수동 확인 필요` 레벨로 발송.

### 1-2. Threads API 토큰 만료 D-7 경고
- 기존 `threads-watchdog` 크론에 `expires_at` 검사 추가 → 7일 미만이면 텔레그램 경고(하루 1회만).

### 1-3. 스크래퍼 상태 알림 (로컬 launchd)
- `scripts/threads-research.mjs`: 이미 있는 로그인벽 감지 + "총 수확 N건 < 임계(기본 5)" 조건에서
  텔레그램 직접 발송. `.env.local` 로더 추가(generate-daily 패턴)로 토큰 로드.
- 메시지 예: `⚠️ Threads 스크래퍼 로그인벽 — threads-login.mjs로 세션 갱신 필요 (수확 3건)`

## Phase 2 — 성과 수집 · 전환 추적 · 아침 리포트

### 2-1. GA refresh token 영속화
- `auth.ts` JWT 콜백에서 refresh token을 settings 시트에 `type='ga_refresh_token'`으로 upsert
  (기존 `threads_token` 저장과 동일 패턴·동일 신뢰 수준).
- 크론/스크립트는 이 refresh token으로 access token을 재발급해 GA4 Data API 호출.
- 토큰 철회·만료 시: 텔레그램으로 "대시보드 재로그인 필요" 안내 (1-1 인프라 재사용).

### 2-2. 수집 스크립트 `scripts/collect-metrics.ts` (GHA 러너, cron UTC 01:30)
- generate-daily.ts 패턴 (env 로더 → lib 직접 import, Vercel 60초 제한 회피).
- 소스별 독립 try/catch — 한 소스 실패가 다른 소스 수집을 막지 않는다. 실패는 리포트에 명시.
  - **a. Tistory GA4**: 어제 페이지별 조회수(`getPagePathPageviews`) → `tistory_url` 경로 매칭으로
    posts 시트 `ga_pageviews`(O) 누적 갱신. URL 없는 글은 스킵(리포트에 미매칭 수 표기).
  - **b. ntelecomsafe GA4**: `utm_campaign`별 sessions·`/step2` 도달(가능하면 신청완료 이벤트) →
    `metrics_daily` 시트 append. 신청완료 이벤트가 GA에 없으면 1단계는 step2 도달을 전환 프록시로.
  - **c. Threads insights**: `published_id` 있는 드래프트(최근 14일) → `GET /{id}/insights`
    (views·likes·replies·reposts·quotes) → `threads_metrics` upsert + 드래프트의 카피 스타일 조인.

### 2-3. 아침 텔레그램 리포트 (수집 직후 동일 스크립트에서 발송)
```
📊 7/10 성과 브리핑
유입 TOP3: ①선불폰 미납 (142) ②비대면개통 (98) ③eSIM (77)
전환: step2 도달 12 (utm: 선불폰-미납 5, 비대면 4, …)
Threads 최고: "KT 정지폰…" 조회 1.2k·댓글 9 [반전형]
수집 실패: 없음
```

### 2-4. 대시보드 (읽기 전용, 시트가 소스)
- analytics 페이지: 키워드별 전환 테이블(utm_campaign 기준) 추가.
- threads 페이지: 발행 글별 views·likes·replies 컬럼 추가.

## 데이터 모델 (Google Sheets)
- `metrics_daily`: `date | source(tistory|ntelecom|threads) | key(utm_campaign 등) | pageviews | sessions | step2 | conversions | extra(JSON)`
- `threads_metrics`: `media_id | draft_id | style | published_at | views | likes | replies | reposts | quotes | collected_at`
- `posts.ga_pageviews`: 누적 조회수 (기존 컬럼 활용)

## 에러 처리 원칙
- 수집은 best-effort·소스별 격리. 어떤 실패도 기존 생성·발행 파이프라인에 영향 없음(완전 분리된 크론).
- 시트 쓰기 실패 시 재시도 1회 후 텔레그램 경고.
- API 쿼터: GA4 Data API·Threads Graph API 모두 하루 수십 호출 수준 — 한도 대비 무시 가능.

## 검증 계획
- Phase 1: 워크플로에 임시 강제 실패를 넣어 텔레그램 수신 확인 후 제거. 스크래퍼는 임계값을 일시 상향해 1회 트리거.
- Phase 2: `collect-metrics.ts --dry-run`으로 수집값 stdout 확인 → 실제 시트 기록 1회 → 리포트 수신 확인 →
  대시보드 렌더 확인.

## 구현 순서 (각 단계 독립 배포 가능)
1. 1-1 GHA 알림 → 2. 1-2·1-3 토큰·스크래퍼 알림 → 3. 2-1 GA 토큰 영속화 →
4. 2-2 수집 스크립트+시트 → 5. 2-3 리포트 → 6. 2-4 대시보드

## 확인 필요 (구현 중 해소)
- GHA에 TELEGRAM secrets 등록 여부 (미등록이면 값 노출 없이 등록).
- ntelecomsafe GA4에 신청완료 이벤트 존재 여부 — 없으면 step2 도달로 시작하고,
  2단계로 이벤트 태깅 가이드를 별도 제공.
- posts 시트 `tistory_url` 실제 채움 비율 — 낮으면 글 단위 매핑은 제목 매칭 폴백 검토.
