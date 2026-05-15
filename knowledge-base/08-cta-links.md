# 08. CTA 링크 + UTM (Links)

## 정확한 URL 매핑

| 용도 | URL |
|------|-----|
| **개통 신청** | https://ntelecomsafe.com/step2 |
| **카톡 문의** | https://pf.kakao.com/_Sxmxixon/chat |
| **요금제 안내** | https://ntelecomsafe.com/plans |
| **유심 가이드** | https://ntelecomsafe.com/usim-choice |
| **안심개통 소개** | https://ntelecomsafe.com/about-anntel |
| **1:1 문의** | https://pf.kakao.com/_Sxmxixon/chat |
| **FAQ** | https://ntelecomsafe.com/faq |
| **전화 (모바일)** | tel:01023116543 |

## UTM 규칙 (모든 내부 링크에 부착)
- `utm_source=tistory`
- `utm_medium=blog`
- `utm_campaign={키워드-슬러그}`

### 예시
```
https://ntelecomsafe.com/step2?utm_source=tistory&utm_medium=blog&utm_campaign=korean-prepaid-5min
```

## 외부 링크 정책
- **외부 사이트 인용은 자제** (KAIT, 방통위 등도 신중하게)
- 외부 링크가 필요하다면 `rel="noopener"` + `target="_blank"` 필수
- 경쟁사 사이트 직접 링크 절대 X

## CTA 문구 권장

| 위치 | 문구 |
|------|------|
| 히어로 박스 (개통 신청) | 📱 개통 신청하기 |
| 히어로 박스 (카톡) | 💬 카카오톡 문의 |
| 히어로 박스 (요금제) | 🔍 요금제 보기 |
| 히어로 박스 (유심) | 📦 유심 가이드 |
| 본문 중간 CTA | 5분 비대면 개통하러 가기 → |
| 마무리 CTA | ✅ 개통 신청 페이지 접속 |
| 마무리 카톡 | ✅ 카톡으로 바로 문의 → 앤텔레콤 안심개통 |
