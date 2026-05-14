# Tistory Auto · 티스토리 자동화 백오피스

> ntelecomsafe.com (앤텔레콤 안심개통) 운영을 위한 티스토리 블로그 자동화 백오피스.
> 매일 KST 09:00에 Gemini API로 SEO 최적화된 한국어 블로그 글 10편을 자동 생성하고,
> 운영자가 백오피스에서 확인 → 본문/이미지 복사 → 티스토리에 수동 발행하는 구조.

## ✨ 주요 기능

- **🤖 매일 글 10편 자동 생성**
  - Track 1 (5편): 사용자 키워드 시트에서 priority·used_count 기준 자동 픽
  - Track 2 (5편): Gemini Search Grounding으로 실시간 트렌드 키워드 자동 발굴
- **🎨 ntelecomsafe.com 브랜드 컬러 통일** (라임 그린)
  - 그라데이션 히어로 카드 + 토글 details 블록 + 라임 액센트
- **🔢 정확한 검색량 데이터**
  - 네이버 검색광고 API 연동, PC/모바일 월 검색량 + 경쟁도 자동 조회
- **📋 클립보드 복사 + 미리보기**
  - HTML / 미리보기 탭 전환 (iframe 격리로 실제 티스토리 렌더링 재현)
  - HTML + plain text 멀티 클립보드로 어디 붙여넣어도 호환
- **🖼 이미지 자동 생성**
  - 글당 5종 PNG (썸네일/핵심정보/5단계/CTA/Q&A) html2canvas로 즉시 다운로드
- **🔐 Google OAuth + 이메일 화이트리스트** 인증
- **📊 Google Sheets DB**
  - posts / users / keywords / publish_logs / daily_quota 5개 탭
- **✏️ 키워드 모달 입력**
  - 백오피스에서 키워드 입력 → 검색량 자동 조회 + 카테고리 자동 분류 + 시트 저장
- **✓ 발행 체크 토글** — 클릭 시 시트 status 즉시 갱신

## 🧰 기술 스택

| 영역 | 기술 |
|------|------|
| 프레임워크 | Next.js 16 (App Router) + React 19 |
| 언어 | TypeScript 5 |
| 스타일 | Tailwind CSS v4 (`@theme` 토큰 방식) |
| 한국어 폰트 | Pretendard Variable |
| 인증 | NextAuth v5 (Auth.js) + Google OAuth |
| DB | Google Sheets API (서비스 계정) |
| AI 글 생성 | Google Gemini API (`gemini-2.5-flash-lite`) + 다중 키 fallback |
| AI 키워드 발굴 | Gemini Search Grounding (실시간 Google 검색) |
| 검색량 데이터 | 네이버 검색광고 API (HMAC-SHA256 서명) |
| 이미지 생성 | html2canvas (클라이언트 HTML → PNG) |
| 자동화 | GitHub Actions cron (KST 09:00 = UTC 00:00) |
| 배포 | Vercel |

## 🏗 아키텍처 흐름

```
[매일 KST 09:00]
       ↓
GitHub Actions cron 발사
       ↓
POST /api/cron/generate  (Authorization: Bearer CRON_SECRET)
       ↓
┌──────────────────────────────────────────────────────┐
│ Track 1: 사용자 키워드 5편                            │
│  - keywords 시트에서 source=manual + priority 우선   │
│  - last_used != 오늘 (안전망)                        │
│  - used_count 낮은 순                               │
│                                                      │
│ Track 2: AI 발굴 5편                                │
│  - Gemini Search Grounding 호출                     │
│  - 한국 검색 트렌드 + 도메인 컨텍스트 반영           │
│  - 네이버 광고 API로 검색량 자동 머지                │
│  - keywords 시트에 source=auto로 자동 추가          │
└──────────────────────────────────────────────────────┘
       ↓
Gemini로 글 10편 직렬 생성
  - 라임 컬러 인라인 스타일
  - 그라데이션 히어로 + 토글 details 블록
  - 키워드 밀도 0.7~1.4%
  - CTA 8개 (히어로 4 + 본문 1 + 마무리 2 + 단계 1)
  - 메타 디스크립션 + SEO 점수 자가 평가
       ↓
posts 시트 INSERT + keywords used_count +1
       ↓
운영자 백오피스 접속 → 글 확인 → 복사 → 티스토리 HTML 모드 발행
```

## 📁 폴더 구조

```
web/
├── app/
│   ├── (dashboard)/                # 보호 영역 (사이드바 레이아웃)
│   │   ├── layout.tsx              # 사이드바 카운트 fetch
│   │   ├── page.tsx                # 대시보드 (오늘 글 + 통계)
│   │   ├── posts/
│   │   │   ├── page.tsx            # 전체 글 목록
│   │   │   ├── [id]/page.tsx       # 글 상세 (HTML / 미리보기 / 이미지 5종)
│   │   │   └── actions.ts          # 발행 토글 server action
│   │   ├── keywords/
│   │   │   ├── page.tsx            # 키워드 백로그 (카테고리별)
│   │   │   └── actions.ts          # 키워드 추가 server action
│   │   ├── analytics/page.tsx      # 성과 분석 (posts 기반 + GA4 자리)
│   │   ├── settings/page.tsx       # 설정 (UI만)
│   │   └── actions.ts              # 수동 생성 server action
│   ├── api/
│   │   ├── auth/[...nextauth]/     # NextAuth 핸들러
│   │   ├── cron/generate/          # ⭐ 매일 cron (Track1+Track2 글 10편)
│   │   ├── gemini/status/          # Gemini 키 헬스체크
│   │   ├── keywords/discover/      # GSG 단독 발굴 테스트
│   │   ├── naver/keyword/          # 네이버 광고 단독 호출
│   │   ├── posts/test/             # 단일 글 생성 테스트
│   │   ├── posts/preview/          # HTML 미리보기 직접 렌더
│   │   └── sheets/health/          # 시트 연결 헬스체크
│   ├── login/page.tsx              # Google OAuth 로그인
│   ├── globals.css                 # Tailwind v4 @theme (라임 토큰)
│   └── layout.tsx                  # 루트 (Pretendard)
├── components/
│   ├── sidebar.tsx                 # 좌측 네비 (시트 카운트 props)
│   ├── topbar.tsx                  # 상단 브레드크럼
│   ├── post-row.tsx                # 글 목록 행 + 발행 토글 client
│   ├── post-content-viewer.tsx     # HTML/미리보기 탭 + 클립보드 복사
│   ├── image-download-cards.tsx    # 5종 이미지 html2canvas 다운로드
│   ├── manual-generate-button.tsx  # 수동 생성 트리거
│   └── add-keyword-form.tsx        # 키워드 추가 모달
├── lib/
│   ├── sheets.ts                   # Google Sheets 클라이언트 + 도메인 모델
│   ├── gemini.ts                   # Gemini 다중 키 fallback + tools 지원
│   ├── post-generator.ts           # SEO 글 생성 프롬프트 + JSON 파싱
│   ├── keyword-discovery.ts        # GSG 키워드 발굴 + 네이버 검색량 머지
│   ├── naver-keyword.ts            # 네이버 광고 API (HMAC-SHA256)
│   ├── categorize.ts               # 키워드 카테고리 자동 분류
│   └── utils.ts                    # cn() 등
├── auth.ts                         # NextAuth 설정 (이메일 화이트리스트)
├── middleware.ts                   # 라우트 보호 + dev 헬스체크 우회
├── .env.example                    # 환경변수 템플릿
└── README.md
```

## 🔧 환경변수

### 인증
- `AUTH_SECRET` — `openssl rand -base64 32`로 생성
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` — Google Cloud Console OAuth
- `ALLOWED_EMAILS` — 콤마 구분 이메일 화이트리스트 (비우면 모든 Google 계정 허용 — dev only)
- `NEXTAUTH_URL` — 배포 도메인 (로컬은 `http://localhost:3000`)

### Google Sheets (DB)
- `GOOGLE_SHEETS_CLIENT_EMAIL` — 서비스 계정 client_email
- `GOOGLE_SHEETS_PRIVATE_KEY` — 서비스 계정 private_key (`\n` 그대로, 따옴표로 감싸기)
- `GOOGLE_SHEETS_ID` — 스프레드시트 ID (URL 중간 긴 문자열)
- `KEYWORDS_SHEET_ID` — (선택) 키워드 전용 시트 ID, 비우면 위 ID 사용

### Gemini API
- `GEMINI_API_KEYS` — 콤마 구분 키 N개 (rate limit fallback)
- `GEMINI_MODEL` — 기본 `gemini-2.5-flash-lite`

### 네이버 검색광고 (검색량)
- `NAVER_AD_CUSTOMER_ID` — API용 customer ID (광고주 ID와 다름)
- `NAVER_AD_API_KEY` — Access License
- `NAVER_AD_SECRET_KEY` — Secret Key

### 자동화
- `CRON_SECRET` — `openssl rand -hex 32`로 생성, GitHub Actions secret

### 선택
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob (이미지 저장, 미사용 시 빈 값)
- `NEXT_PUBLIC_GA_MEASUREMENT_ID` — Google Analytics 4

> `.env.example` 파일에 모든 변수 + 가이드 코멘트 있음. 복사해서 `.env.local` 만들면 됨.

## 🚀 셋업

### 사전 준비
1. **Google Cloud Console**
   - 프로젝트 생성
   - OAuth 2.0 클라이언트 ID 발급 (Web app)
     - 승인된 리디렉션 URI: `http://localhost:3000/api/auth/callback/google` (+ 배포 도메인)
   - 서비스 계정 생성 + JSON 키 다운로드
   - Sheets API + Drive API 활성화
2. **Google Sheet**
   - 5개 탭(`keywords`/`posts`/`users`/`publish_logs`/`daily_quota`) 생성
   - 서비스 계정 이메일에 편집자 권한 공유 ⚠️ 필수
3. **Gemini API 키** 발급 — https://aistudio.google.com/apikey (여러 개 권장)
4. **네이버 검색광고** — https://searchad.naver.com → API 라이선스 발급

### 설치
```bash
git clone git@github.com:DongwookH/prephone-tstry-back.git
cd prephone-tstry-back
npm install
cp .env.example .env.local
# .env.local 채우기

npm run dev  # http://localhost:3000
```

## 🧪 헬스체크 라우트 (dev 모드 인증 우회)

```bash
# Gemini 키 등록 + 핑 테스트
curl http://localhost:3000/api/gemini/status?test=1

# Google Sheets 연결 + 5개 탭 인식
curl http://localhost:3000/api/sheets/health

# 네이버 광고 API 단독 호출
curl "http://localhost:3000/api/naver/keyword?q=선불폰,KT바로유심"

# GSG 단독 키워드 발굴 (시트 변경 X)
curl "http://localhost:3000/api/keywords/discover?count=3"

# 단일 글 생성 + HTML 미리보기 직접 렌더
open "http://localhost:3000/api/posts/preview?keyword=선불폰개통방법&category=개통핵심&persona=일반"

# cron dry-run (실제 글 생성 X, 어떤 키워드 픽될지 미리보기)
curl http://localhost:3000/api/cron/generate

# cron 실제 실행 (POST + Authorization)
curl -X POST http://localhost:3000/api/cron/generate \
  -H "Authorization: Bearer $CRON_SECRET"
```

## ⏰ GitHub Actions 자동화 (예정)

`.github/workflows/generate-posts.yml` (별도 추가):
```yaml
name: Generate Daily Posts
on:
  schedule:
    - cron: "0 0 * * *"   # UTC 00:00 = KST 09:00
  workflow_dispatch:      # 수동 실행 가능

jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - name: Call cron endpoint
        run: |
          curl -X POST ${{ secrets.PRODUCTION_URL }}/api/cron/generate \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            --max-time 300
```

## 🎨 디자인 시스템

`globals.css`의 `@theme` 블록에 토큰 정의:

| 토큰 | 값 | 용도 |
|------|-----|------|
| `brand-500` | `#9DC91A` | 메인 라임 (ntelecomsafe 사이트와 통일) |
| `brand-600` | `#7FA512` | 호버, 진한 액센트 |
| `brand-700` | `#5F7C0E` | 링크 텍스트 |
| `brand-50` | `#F4F9E0` | 옅은 배경, 토글 헤더 |
| `brand-100` | `#EAF5BD` | 그라데이션 |
| `ink-50` ~ `ink-900` | 9단계 그레이 | Toss 톤 |
| `mint`, `amber`, `rose`, `violet` | 상태 컬러 | 발행 완료 / 대기 / 실패 / 특별 |

## 📂 외부 빌드 스크립트 (repo 외부)

마스터 키워드 통합, 시트 초기화 등은 `tistory-automation/scripts/`에 별도 보관:
- `build_master_keywords.py` — 라이프 + 지역 xlsx 통합 + 네이버 검색량 자동 채움
- `build_database_template.py` — 5개 탭 통합 xlsx 생성
- `init_google_sheet.py` — 빈 시트에 탭 + 데이터 자동 입력
- `repair_keywords_sheet.py` — 헤더 + used_count 복구

## 🔐 보안 노트

- `.env.local`은 `.gitignore`에 등록되어 커밋 X
- 서비스 계정 JSON은 repo 외부에 별도 보관
- 모든 API 라우트는 production에서 `auth()` 인증 필수 (dev 모드만 일부 우회)
- cron 라우트는 `Bearer CRON_SECRET` 별도 인증
- `dangerouslySetInnerHTML`은 자체 생성 HTML에만 사용 (사용자 입력 X)

## 📜 라이선스

Private — 앤텔레콤 안심개통 운영용 내부 프로젝트.
