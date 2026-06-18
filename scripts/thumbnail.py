#!/usr/bin/env python3
"""카드뉴스 썸네일 자동 생성.

stdin으로 글 목록 JSON을 받아 각 글의 썸네일 PNG를 생성한다.
입력 형식:
  [{"id": "p-...", "thumbnail": {"lines": [...], "highlight": [...], "tags": [...], "theme": "green"}}, ...]

환경변수:
  NOTO_FONT   노토산스 KR ttf 경로 (기본 scripts/assets/NotoSansKR.ttf)
  OUT_DIR     출력 디렉토리 (기본 public/thumbnails)
  ASSET_DIR   에셋 디렉토리 (기본 scripts/assets)
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

ASSET_DIR = os.environ.get("ASSET_DIR", "scripts/assets")
OUT_DIR = os.environ.get("OUT_DIR", "public/thumbnails")
FONT_PATH = os.environ.get("NOTO_FONT", os.path.join(ASSET_DIR, "NotoSansKR.ttf"))
CHAR_PATH = os.path.join(ASSET_DIR, "character.png")
LOGO_PATH = os.path.join(ASSET_DIR, "logo.png")

# 테마 키 → 원색 RGB. 배경·태그·강조가 전부 이 색의 농도로 파생된다.
THEME_MAP = {
    "green": (15, 110, 86),
    "blue": (37, 99, 175),
    "orange": (217, 119, 6),
    "purple": (124, 58, 183),
}


def tint(rgb, ratio):
    return tuple(int(255 - (255 - c) * ratio) for c in rgb) + (255,)


def font(size, wght=900):
    f = ImageFont.truetype(FONT_PATH, size)
    try:
        f.set_variation_by_axes([wght])
    except Exception:
        pass
    return f


def make_thumbnail(lines, highlight, tags, theme_rgb, out):
    W = H = 680
    BG = tint(theme_rgb, 0.05)
    DECO = tint(theme_rgb, 0.16)
    ACCENT = theme_rgb + (255,)
    DARK = (26, 26, 26, 255)
    tag_fills = [tint(theme_rgb, r) for r in (1.0, 0.62, 0.30)]
    tag_fgs = [(255, 255, 255, 255), (255, 255, 255, 255), tint(theme_rgb, 1.0)]

    canvas = Image.new("RGBA", (W, H), BG)
    d = ImageDraw.Draw(canvas)
    for (cx, cy, r) in [(632, 170, 28), (58, 540, 24)]:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=DECO)

    logo = Image.open(LOGO_PATH).convert("RGBA")
    lw = 112
    logo = logo.resize((lw, int(logo.height * lw / logo.width)), Image.LANCZOS)
    canvas.alpha_composite(logo, (18, 14))

    # 태그 (제목 위, 가운데, 같은 색 농도 진→연)
    tf = font(21, 700)
    show_tags = (tags or [])[:3]
    gap = 12
    widths = [d.textlength(t, font=tf) + 34 for t in show_tags]
    total = sum(widths) + gap * (len(show_tags) - 1) if show_tags else 0
    x = (W - total) / 2
    ty, th = 198, 42
    for i, (text, w) in enumerate(zip(show_tags, widths)):
        fill = tag_fills[min(i, 2)]
        fg = tag_fgs[min(i, 2)]
        d.rounded_rectangle([x, ty, x + w, ty + th], radius=21, fill=fill)
        d.text((x + w / 2, ty + th / 2), text, font=tf, fill=fg, anchor="mm")
        x += w + gap

    # 제목 3줄 (강조줄은 테마색, 나머지 검정)
    ttf = font(46, 900)
    ys = [280, 334, 388]
    hl = set(highlight or [])
    for i, line in enumerate(lines[:3]):
        col = ACCENT if i in hl else DARK
        d.text((W / 2, ys[i]), line, font=ttf, fill=col, anchor="mm")

    # 캐릭터 우하단
    ch = Image.open(CHAR_PATH).convert("RGBA")
    cw = 180
    ch = ch.resize((cw, int(ch.height * cw / ch.width)), Image.LANCZOS)
    canvas.alpha_composite(ch, (W - cw - 10, H - ch.height - 4))

    os.makedirs(os.path.dirname(out), exist_ok=True)
    canvas.convert("RGB").save(out, quality=95)
    return out


def main():
    items = json.load(sys.stdin)
    generated = []
    for it in items:
        pid = it.get("id")
        meta = it.get("thumbnail")
        if not pid or not meta:
            continue
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except Exception:
                continue
        theme_rgb = THEME_MAP.get(meta.get("theme", "green"), THEME_MAP["green"])
        out = os.path.join(OUT_DIR, f"{pid}.png")
        try:
            make_thumbnail(
                meta.get("lines", []),
                meta.get("highlight", [0, 2]),
                meta.get("tags", []),
                theme_rgb,
                out,
            )
            generated.append(pid)
        except Exception as e:
            print(f"[thumbnail] {pid} 실패: {e}", file=sys.stderr)
    print(json.dumps({"generated": generated}, ensure_ascii=False))


if __name__ == "__main__":
    main()
