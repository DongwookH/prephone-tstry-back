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
import json, os, sys, hashlib, colorsys
from PIL import Image, ImageDraw, ImageFont

ASSET_DIR = os.environ.get("ASSET_DIR", "scripts/assets")
OUT_DIR = os.environ.get("OUT_DIR", "public/thumbnails")
FONT_PATH = os.environ.get("NOTO_FONT", os.path.join(ASSET_DIR, "NotoSansKR.ttf"))
CHAR_DIR = os.path.join(ASSET_DIR, "characters")
LOGO_PATH = os.path.join(ASSET_DIR, "logo.png")

DEFAULT_CHARACTER = "thumbsup"


def char_path(emotion):
    """감정 키 → 캐릭터 PNG 경로. 없으면 기본 캐릭터로 fallback."""
    p = os.path.join(CHAR_DIR, f"{emotion}.png")
    if os.path.exists(p):
        return p
    return os.path.join(CHAR_DIR, f"{DEFAULT_CHARACTER}.png")

# 테마 키 → 원색 RGB. 배경·태그·강조가 전부 이 색의 농도로 파생된다.
THEME_MAP = {
    "green": (15, 110, 86),
    "blue": (37, 99, 175),
    "orange": (217, 119, 6),
    "purple": (124, 58, 183),
}


def tint(rgb, ratio):
    return tuple(int(255 - (255 - c) * ratio) for c in rgb) + (255,)


def seed_int(s):
    """문자열 → 안정적인 정수 시드 (같은 글 id면 항상 같은 값)."""
    return int(hashlib.md5(str(s).encode("utf-8")).hexdigest(), 16)


def theme_rgb_for(pid, fallback=(15, 110, 86)):
    """글 id 해시 → 매번 다른 테마 원색.

    채도(S)·명도(V)를 고정해 어떤 색조(hue)가 나와도
    흰 글씨 대비·연한 배경 가독성이 일정하게 유지된다.
    """
    if not pid:
        return fallback
    hue = (seed_int(pid) % 360) / 360.0
    r, g, b = colorsys.hsv_to_rgb(hue, 0.68, 0.58)
    return (int(r * 255), int(g * 255), int(b * 255))


# 사용 가능한 감정 캐릭터 (char_path가 없으면 thumbsup로 fallback)
EMOTIONS = [
    "thumbsup", "surprised", "wink", "thinking", "pointing", "cheer",
    "heart", "worried", "ok", "callcenter", "checklist", "celebrate",
    "relieved", "coin", "stop",
]

# 캐릭터 배치 슬롯 (제목 중앙·태그·로고를 피한 안전 구역).
#   (너비, 가로기준, ax, ay)  ay = 'tr'이면 위쪽 가장자리, 그 외는 아래쪽 가장자리
SLOTS = [
    (196, "right", 672, 678),   # 큰 캐릭터 — 우하단
    (138, "left", 6, 678),      # 중간 — 좌하단
    (104, "center", 340, 678),  # 작은 — 하단 가운데
    (94, "tr", 674, 12),        # 작은 — 우상단(로고 반대편, 태그 위)
]


def pick_emotions(primary, seed, n):
    """primary를 첫 캐릭터로 두고, 나머지를 시드 기준 결정적으로 뽑는다."""
    primary = primary if primary in EMOTIONS else EMOTIONS[0]
    pool = [e for e in EMOTIONS if e != primary]
    pool.sort(key=lambda e: seed_int(f"{seed}:{e}"))
    return [primary] + pool[: max(0, n - 1)]


def char_count_for(seed):
    """글마다 1~4개 — 2~3개에 가중."""
    return [1, 2, 2, 3, 3, 4][seed_int(f"{seed}:n") % 6]


def rotation_for(seed, emotion):
    """보조 캐릭터 기울기 — 10~60도, 방향(좌/우)도 결정적으로 다르게."""
    mag = 10 + seed_int(f"{seed}:{emotion}:rot") % 26   # 10..35
    sign = 1 if seed_int(f"{seed}:{emotion}:sgn") % 2 else -1
    return sign * mag


def paste_char(canvas, emotion, width, anchor, ax, ay, angle=0):
    im = Image.open(char_path(emotion)).convert("RGBA")
    w = width
    h = int(im.height * w / im.width)
    im = im.resize((w, h), Image.LANCZOS)
    if angle:
        # 투명 배경 유지하며 회전, 박스가 커지므로 크기 재계산
        im = im.rotate(angle, expand=True, resample=Image.BICUBIC,
                       fillcolor=(0, 0, 0, 0))
        w, h = im.size
    if anchor == "right":
        x, y = ax - w, ay - h
    elif anchor == "left":
        x, y = ax, ay - h
    elif anchor == "center":
        x, y = ax - w // 2, ay - h
    else:  # 'tr' = 우상단, 위쪽 가장자리 기준
        x, y = ax - w, ay
    canvas.alpha_composite(im, (x, y))


def font(size, wght=900):
    f = ImageFont.truetype(FONT_PATH, size)
    try:
        f.set_variation_by_axes([wght])
    except Exception:
        pass
    return f


def fit_title_size(d, lines, max_width, base=60, min_size=42):
    """제목을 최대한 크게 — 가장 긴 줄이 max_width에 들어갈 때까지만 축소."""
    size = base
    while size > min_size:
        f = font(size, 900)
        if all(d.textlength(ln, font=f) <= max_width for ln in lines):
            break
        size -= 2
    return size


def make_thumbnail(lines, highlight, tags, theme_rgb, out, character="thumbsup", seed=""):
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
    ty, th = 178, 42
    for i, (text, w) in enumerate(zip(show_tags, widths)):
        fill = tag_fills[min(i, 2)]
        fg = tag_fgs[min(i, 2)]
        d.rounded_rectangle([x, ty, x + w, ty + th], radius=21, fill=fill)
        d.text((x + w / 2, ty + th / 2), text, font=tf, fill=fg, anchor="mm")
        x += w + gap

    # 제목 — 폭에 맞춰 최대한 크게(기본 60px), 줄 수만큼 세로 중앙 정렬
    title_lines = [l for l in (lines or [])[:3] if l]
    ts = fit_title_size(d, title_lines, max_width=W - 72, base=60, min_size=42)
    ttf = font(ts, 900)
    line_gap = int(ts * 1.14)
    cy = 344  # 제목 블록 세로 중심 (태그 아래로 충분히 내림)
    y0 = cy - line_gap * (len(title_lines) - 1) / 2
    hl = set(highlight or [])
    for i, line in enumerate(title_lines):
        col = ACCENT if i in hl else DARK
        d.text((W / 2, y0 + i * line_gap), line, font=ttf, fill=col, anchor="mm")

    # 캐릭터 1~4개 — 크기·위치 다르게 (제목/태그/로고 안전 구역에만)
    # 메인(첫 번째)은 똑바로, 나머지는 10~60도 회전으로 자연스럽게 흩뿌림.
    n = char_count_for(seed)
    emotions = pick_emotions(character, seed, n)
    for i, (emotion, (cw, anchor, ax, ay)) in enumerate(zip(emotions, SLOTS)):
        angle = 0 if i == 0 else rotation_for(seed, emotion)
        paste_char(canvas, emotion, cw, anchor, ax, ay, angle)

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
        # 색상은 글 id 해시로 매번 다르게 (theme 필드는 무시 — 무한 색상 회전)
        theme_rgb = theme_rgb_for(pid)
        out = os.path.join(OUT_DIR, f"{pid}.png")
        try:
            make_thumbnail(
                meta.get("lines", []),
                meta.get("highlight", [0, 2]),
                meta.get("tags", []),
                theme_rgb,
                out,
                meta.get("character", DEFAULT_CHARACTER),
                seed=pid,
            )
            generated.append(pid)
        except Exception as e:
            print(f"[thumbnail] {pid} 실패: {e}", file=sys.stderr)
    print(json.dumps({"generated": generated}, ensure_ascii=False))


if __name__ == "__main__":
    main()
