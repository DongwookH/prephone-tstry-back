#!/usr/bin/env python3
"""카드뉴스 인포카드(프로토타입) — AI 사진 헤더 + 자동높이 정보 패널.

카드뉴스의 두 문제(내용 짤림 / 디자인 반복)를 동시에 해결:
  - 상단: 매번 다른 AI 배경 사진(헤더) → 이미지 다양성 확보
  - 하단: 흰 패널에 제목 + 불릿(체크리스트/단계)을 "짤림 없이" 자동 배치
          (불릿을 폭에 맞춰 줄바꿈, 패널 높이는 내용에 맞춰 자동 확장)

stdin JSON:
  {"bg_path","page":"2/4","title","subtitle","bullets":[...],
   "bullet_style":"checklist|steps","handle":"@...","out_path"}

환경변수: NOTO_FONT (한글 폰트 경로, 없으면 macOS 시스템 폰트로 fallback)
"""
import json, os, sys, re
from PIL import Image, ImageDraw, ImageFont

FONT_PATH = os.environ.get("NOTO_FONT", "scripts/assets/NotoSansKR.ttf")
_FALLBACK = [
    "/System/Library/Fonts/AppleSDGothicNeo.ttc",
    "/System/Library/Fonts/Supplemental/AppleGothic.ttf",
]
_RESOLVED = None


def _font_path():
    global _RESOLVED
    if _RESOLVED:
        return _RESOLVED
    if os.path.exists(FONT_PATH):
        _RESOLVED = FONT_PATH
    else:
        _RESOLVED = next((p for p in _FALLBACK if os.path.exists(p)), None)
    if not _RESOLVED:
        raise FileNotFoundError("한글 폰트 없음 (NOTO_FONT 지정 필요)")
    return _RESOLVED


def font(size, wght=700):
    p = _font_path()
    if p.endswith(".ttc") and "AppleSDGothicNeo" in p:
        return ImageFont.truetype(p, size, index=(6 if wght >= 700 else 0))
    f = ImageFont.truetype(p, size)
    try:
        f.set_variation_by_axes([wght])
    except Exception:
        pass
    return f


def wrap(d, text, fnt, max_w):
    """폭에 맞춰 줄바꿈 (공백 우선, 안 되면 글자 단위). 한글/혼합 안전."""
    words, lines, cur = text.split(" "), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if d.textlength(trial, font=fnt) <= max_w:
            cur = trial
            continue
        # 현재 줄 확정하고 w를 새 줄에 — w 자체가 너무 길면 글자 단위로 쪼갬
        if cur:
            lines.append(cur)
            cur = ""
        while d.textlength(w, font=fnt) > max_w:
            i = len(w)
            while i > 1 and d.textlength(w[:i], font=fnt) > max_w:
                i -= 1
            lines.append(w[:i])
            w = w[i:]
        cur = w
    if cur:
        lines.append(cur)
    return lines or [""]


def compose(data):
    W = 1080
    accent = tuple(data.get("accent_rgb", (108, 172, 61)))
    pad = 72
    inner = W - pad * 2

    # ── 헤더 사진 (1080 폭으로 리사이즈 후 중앙 크롭) ──
    H_IMG = 600
    bg = Image.open(data["bg_path"]).convert("RGB")
    r = max(W / bg.width, H_IMG / bg.height)
    bg = bg.resize((int(bg.width * r), int(bg.height * r)), Image.LANCZOS)
    left = (bg.width - W) // 2
    top = (bg.height - H_IMG) // 2
    header = bg.crop((left, top, left + W, top + H_IMG))

    d0 = ImageDraw.Draw(header)

    # ── 텍스트 요소 미리 측정 (패널 높이 자동 계산) ──
    title_raw = re.sub(r"^\s*\d+\)\s*", "", data.get("title", ""))  # "2) " 접두 제거
    # 2026-07-28 가독성 보강 — 1080px 카드가 모바일 피드에서 축소 표시될 때
    # 본문이 뭉개지던 문제. 본문 굵기·크기를 올리고 대비를 높였다.
    title_f = font(58, 800)
    sub_f = font(34, 600)
    bullet_f = font(41, 600)
    num_f = font(32, 800)

    title_lines = wrap(d0, title_raw, title_f, inner)
    sub = data.get("subtitle") or ""
    sub_lines = wrap(d0, sub, sub_f, inner) if sub else []

    bullets = data.get("bullets", []) or []
    style = data.get("bullet_style", "checklist")
    marker_w = 64  # 체크/번호 마커 폭 (본문 커진 만큼 확대)
    bullet_wrapped = [wrap(d0, b, bullet_f, inner - marker_w) for b in bullets]

    line_h_title = 76
    line_h_sub = 50
    # 한글은 라틴 대비 글자 높이가 커서 1.4배 미만이면 줄이 붙어 보인다 → 1.46배
    line_h_bul = 60
    gap_after_title = 16
    gap_after_sub = 34
    # 항목 사이를 벌려 "덩어리"가 구분되게 (이전 22px은 줄간격과 구분이 안 됐다)
    gap_between_bul = 34

    panel_top_pad = 56
    panel_bot_pad = 64
    h = panel_top_pad
    h += len(title_lines) * line_h_title
    if sub_lines:
        h += gap_after_title + len(sub_lines) * line_h_sub
    h += gap_after_sub
    for i, bl in enumerate(bullet_wrapped):
        h += len(bl) * line_h_bul
        if i < len(bullet_wrapped) - 1:
            h += gap_between_bul
    handle = data.get("handle")
    h += 40 + (46 if handle else 0)  # 하단 여백 + 핸들
    panel_h = h

    # ── 캔버스 조립 (헤더 + 흰 패널) ──
    total_h = H_IMG + panel_h
    canvas = Image.new("RGB", (W, total_h), (255, 255, 255))
    canvas.paste(header, (0, 0))
    d = ImageDraw.Draw(canvas)

    y = H_IMG + panel_top_pad
    # 제목 (다크)
    for ln in title_lines:
        d.text((pad, y), ln, font=title_f, fill=(25, 31, 40))
        y += line_h_title
    # 부제 (회색)
    if sub_lines:
        y += gap_after_title
        for ln in sub_lines:
            d.text((pad, y), ln, font=sub_f, fill=(88, 98, 112))
            y += line_h_sub
    y += gap_after_sub
    # 불릿
    for i, bl in enumerate(bullet_wrapped):
        my = y
        if style == "steps":
            # 번호 원
            cr = 20
            cx, cy = pad + cr, my + 22
            d.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], fill=accent)
            d.text((cx, cy), str(i + 1), font=num_f, fill=(255, 255, 255), anchor="mm")
        else:
            # 체크 마커 — 글꼴이 "✓" 글리프에 굵기를 못 먹여 머리카락처럼 얇게
            # 나오던 문제(2026-07-28). 번호 스타일과 동일하게 원형 배지로 그린다.
            cr = 17
            cx, cy = pad + cr, my + 21
            d.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], fill=accent)
            # 흰 체크를 선으로 직접 — 글리프 의존 없이 항상 또렷하다
            d.line(
                [(cx - 8, cy + 1), (cx - 2, cy + 7), (cx + 8, cy - 6)],
                fill=(255, 255, 255), width=4, joint="curve",
            )
        tx = pad + marker_w
        for j, ln in enumerate(bl):
            d.text((tx, my + j * line_h_bul), ln, font=bullet_f, fill=(30, 37, 48))
        y += len(bl) * line_h_bul
        if i < len(bullet_wrapped) - 1:
            y += gap_between_bul

    # 핸들 (하단 좌측)
    if handle:
        hf = font(26, 500)
        d.text((pad, total_h - 40), handle, font=hf, fill=(138, 148, 160), anchor="lb")

    # 페이지 번호 — 카드 우측 하단
    page = data.get("page")
    if page:
        pf = font(28, 800)
        badge_w = d.textlength(page, font=pf) + 40
        badge_h = 48
        bx = W - pad - badge_w
        by = total_h - 34 - badge_h
        d.rounded_rectangle([bx, by, bx + badge_w, by + badge_h], radius=badge_h // 2, fill=accent)
        d.text((bx + badge_w / 2, by + badge_h / 2), page, font=pf, fill=(255, 255, 255), anchor="mm")

    out = data["out_path"]
    os.makedirs(os.path.dirname(os.path.abspath(out)) or ".", exist_ok=True)
    if out.lower().endswith((".jpg", ".jpeg")):
        canvas.save(out, quality=92)
    else:
        canvas.save(out)
    return out, total_h


def main():
    data = json.load(sys.stdin)
    try:
        out, h = compose(data)
        print(json.dumps({"out_path": out, "height": h}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
