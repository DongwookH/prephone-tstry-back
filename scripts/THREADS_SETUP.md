# Threads 리서치 셋업 가이드 (Mac 운영)

매일 새벽 자동으로 Threads 인기글을 수집해 초안을 만들고, 백오피스 `/threads`에서 검토·발행.

## 1. 의존성 설치 (최초 1회)

```bash
cd /Users/mac/Desktop/tistory-automation/web
npm run threads:setup
```

설치되는 것:
- `playwright` (브라우저 자동화)
- `playwright-extra` + `puppeteer-extra-plugin-stealth` (봇 감지 회피)
- Chromium 번들

> ⚠️ 진짜 Chrome도 같이 깔려 있으면 더 안전합니다.
> Chrome 미설치 시 자동으로 번들 Chromium fallback.

## 2. Threads 로그인 세션 추출 (최초 1회 + 만료 시)

```bash
npm run threads:login
```

1. 크롬 창 뜨면 본인 계정으로 로그인
2. Threads 메인까지 진입한 뒤 터미널에서 Enter
3. `scripts/threads-session.json` 생성됨 (gitignore)

세션 만료(보통 수개월) 시 같은 명령 다시 실행.

## 3. 수동 테스트

```bash
# 백그라운드 헤드리스 (운영 모드)
npm run threads:research

# 브라우저 창 보면서 디버그
npm run threads:research:visible
```

성공하면 백오피스 `/threads`에 초안이 쌓입니다.

## 4. 매일 자동 실행 (launchd)

```bash
# 1) plist 복사
cp scripts/com.ntelecom.threads-research.plist ~/Library/LaunchAgents/

# 2) 로드
launchctl load ~/Library/LaunchAgents/com.ntelecom.threads-research.plist

# 3) 확인
launchctl list | grep ntelecom
```

매일 **KST 06:00**에 자동 실행. Mac이 켜져 있거나 절전 모드여야 함.

### 절전 깨우기 (선택)

시스템 설정 → 배터리/에너지 절약 → "예약된 시간에 깨우기"로 06:00 설정.

### 해제

```bash
launchctl unload ~/Library/LaunchAgents/com.ntelecom.threads-research.plist
rm ~/Library/LaunchAgents/com.ntelecom.threads-research.plist
```

## 5. 로그 확인

```bash
tail -f /tmp/threads-research.log   # 표준 출력
tail -f /tmp/threads-research.err   # 에러
```

## 6. 환경변수 (`.env.local`에 자동 로드됨)

| 변수 | 필수 | 기본값 |
|---|---|---|
| `CRON_SECRET` | ✅ | — |
| `THREADS_SESSION_COOKIES` | — | (파일 우선) |
| `THREADS_SESSION_FILE` | — | `scripts/threads-session.json` |
| `INGEST_URL` | — | `https://prephone-tstry-back.vercel.app/api/threads/research/ingest` |
| `RESEARCH_KEYWORDS` | — | `선불폰,알뜰폰,유심,비대면개통,선불유심` |
| `OUR_USERNAME` | — | `safe_ntel` |
| `MIN_LIKES` | — | 10 |
| `MIN_REPLIES` | — | 2 |
| `MAX_AGE_HOURS` | — | 48 |
| `TOP_PER_KEYWORD` | — | 8 |
| `HEADLESS` | — | `true` |

## 7. GitHub Actions 백업 (Mac 꺼진 날)

`.github/workflows/threads-research.yml`을 수동 트리거. Azure 데이터센터 IP라
봇 감지 위험 있어 **자주 쓰지 않을 것**.

## 트러블슈팅

- **0건 수집**: 세션 만료. `npm run threads:login` 다시.
- **봇 감지/redirect**: 며칠 쉬고 재시도. 키워드 수 줄이기.
- **launchd 안 돔**: `launchctl list | grep ntelecom`로 상태 확인,
  최근 종료 코드(Last Exit Code) 보기. 0이 아니면 `/tmp/threads-research.err` 확인.
