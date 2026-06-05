# Threads 경쟁 리서치 → 초안 → 승인 발행

**작성일:** 2026-06-05
**상태:** Approved (사용자 "진행"), 구현 진행

## 배경

Threads Keyword Search API는 남의 공개글 검색에 App Review(Advanced Access) +
비즈니스 인증이 필요해 즉시 사용 불가. 검증 완료
(standard access는 본인 글만 검색 → 우리 계정 0글 → 빈 결과).

대안: **브라우저 자동화(Playwright)로 Threads 검색 결과를 직접 수집**.

## 목표

매일 자동으로:
1. 전날 선불폰 니치에서 잘 터진 남의 Threads 글 수집 (조회/댓글/공감 높은)
2. 그 글들을 바탕으로 우리 브랜드용 오리지널 Threads 초안 생성
3. 백오피스에서 초안 검토/수정
4. **승인 버튼을 눌러야만** 우리 Threads(@safe_ntel)에 발행

## Non-Goals

- 블로그 글 초안 (이번엔 Threads 게시글만)
- 완전 자동 발행 (반드시 사람 승인 게이트)
- Threads API 키워드 검색 (App Review 회피 — 브라우저로 대체)

## 아키텍처

```
GitHub Action (매일 KST 06:00)
  └ scripts/threads-research.mjs  (Playwright + 저장된 세션 쿠키)
      - 키워드별 Threads 검색 "인기" 결과 수집
      - 네트워크 JSON 응답 캡처 (DOM 셀렉터보다 견고)
      - 필터: 24~48h 이내 + 작성자≠우리 + 댓글≥N + 좋아요≥M
      - 참여도 점수 랭킹 → 상위 N개
  └ POST /api/threads/research/ingest  (CRON_SECRET 인증)
      - Gemini가 인기글 분석 → 오리지널 초안 생성
      - threads_drafts 시트 저장 (status=pending)

백오피스 /threads
  - pending 초안 목록 + 근거 인기글(지표·링크)
  - 인라인 편집 / 승인&발행 / 반려
  - 승인 → server action → postToThreads → status=published
```

## 데이터 모델

### 새 시트 `threads_drafts`
| 컬럼 | 설명 |
|---|---|
| id | `td-{timestamp}` |
| created_at | ISO (KST 표기는 UI에서) |
| keyword | 근거가 된 검색 키워드 |
| draft_text | 생성된 Threads 초안 (≤500자) |
| source_posts | JSON — 근거 인기글 배열 (author/text/likes/replies/permalink) |
| insight | 한 줄 — 왜 이 각도인지 (Gemini 요약) |
| status | pending / published / rejected |
| published_id | 발행 후 Threads 글 id |
| published_at | 발행 ISO |

## 컴포넌트

### 1) lib/sheets.ts
- `ensureThreadsDraftsSheet()`
- `appendThreadsDraft(row)`
- `getThreadsDrafts(status?)`
- `updateThreadsDraft(id, patch)` — text/status/published 갱신
- `ThreadsDraftRow` 타입

### 2) lib/threads-research.ts
- `ScrapedPost` 타입 (author, text, likes, replies, reposts, permalink, timestamp)
- `generateThreadsDraftsFromPosts(keyword, posts[])` — Gemini로 초안 N개 생성
  - 베끼기 금지, 후킹 각도만 차용, 우리 KB 정보 기반
  - 출력: { draft_text, insight }[]

### 3) app/api/threads/research/ingest/route.ts
- POST, CRON_SECRET Bearer 인증
- body: { items: { keyword, posts: ScrapedPost[] }[] }
- 각 keyword묶음 → generateThreadsDraftsFromPosts → appendThreadsDraft
- 반환: { created: n }

### 4) app/(dashboard)/threads/page.tsx + actions.ts + 클라이언트 컴포넌트
- pending 초안 카드 목록
- 각 카드: 초안 textarea(편집) + 근거 인기글 리스트(링크/지표) + insight
- 버튼: 승인&발행 / 수정저장 / 반려
- published/rejected 히스토리 섹션 (접기)
- server actions: approveAndPublish, saveDraftText, rejectDraft

### 5) scripts/threads-research.mjs (Playwright)
- env: THREADS_SESSION_COOKIES (storageState JSON), INGEST_URL, CRON_SECRET, RESEARCH_KEYWORDS
- chromium + storageState 주입 + 현실적 UA/viewport
- 키워드별: search 페이지 goto → 스크롤 → response JSON 캡처
- 후보 글 deep-extract (text + like_count + reply count + timestamp + user + code)
- 필터·랭킹 → items 구성 → ingest POST
- 실패 시 로그 + 해당 키워드 skip (전체 중단 X)

### 6) scripts/threads-login.mjs (1회용 로컬)
- headed chromium 열어 사용자 로그인 → storageState를 stdout/파일로 출력
- 그 JSON을 GitHub Secret THREADS_SESSION_COOKIES에 등록

### 7) .github/workflows/threads-research.yml
- cron 매일 KST 06:00 (UTC 21:00)
- node + playwright install chromium
- run scripts/threads-research.mjs
- secrets: THREADS_SESSION_COOKIES, CRON_SECRET, INGEST_URL(또는 NEXTAUTH_URL)

### 8) 사이드바 네비
- components/sidebar(또는 해당 파일)에 "Threads" 링크 추가

## 리스크 & 완화
- **봇 차단**: storageState 쿠키 + 현실적 UA + 적당한 딜레이. 실패 시 그날 skip + 로그.
- **쿠키 만료**: 만료 시 ingest 0건 → 백오피스에 "최근 수집 없음" 표시. 사용자가 재로그인 후 secret 갱신.
- **DOM/JSON 구조 변경**: 네트워크 JSON deep-extract(방어적) 사용. 키 이름 여러 후보 탐색.
- **Vercel 60s 타임아웃**: ingest에서 keyword당 초안 1~2개만, 묶음 순차. 필요시 keyword별 분할 호출.

## 검증
- scripts/threads-research.mjs 로컬 dry-run (쿠키 있으면 실제 수집, 없으면 mock)
- ingest 엔드포인트 mock POST → 시트 저장 확인
- 백오피스 /threads 렌더 + 버튼 동작 (mock 초안)
- 승인 → postToThreads (실제 발행은 사용자 확인 후)
