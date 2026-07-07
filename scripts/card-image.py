#!/usr/bin/env python3
"""AI 배경사진 위에 텍스트를 얹는 카드 이미지 생성기.

thumbnail.py(단색 배경+캐릭터)와는 별개 용도 — 이건 실사 배경사진 +
하단 그라데이션 + 해시태그 pill + 굵은 제목 오버레이 방식.

stdin으로 JSON 하나를 받는다:
  {"bg_path": "...", "title_lines": ["...", "..."], "hashtags": ["...", ...],
   "highlight_line_index": 1, "handle": "@...", "out_path": "..."}

환경변수:
  NOTO_FONT   본문/제목용 ttf 경로 (기본 scripts/assets/NotoSansKR.ttf,
              없으면 macOS 시스템 폰트로 자동 fallback)
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

ASSET_DIR = os.environ.get("ASSET_DIR", "scripts/assets")
FONT_PATH = os.environ.get("NOTO_FONT", os.path.join(ASSET_DIR, "NotoSansKR.ttf"))

# 프로젝트 폰트가 없는 환경(예: 로컬 macOS 테스트)에서 쓸 대체 후보.
# (경로, 가변폰트 axes 지원 여부, bold 인덱스)
_FALLBACK_FONTS = [
    "/System/Library/Fonts/AppleSDGothicNeo.ttc",
    "/System/Library/Fonts/Supplemental/AppleGothic.ttf",
]


def _resolve_font_path():
    if os.path.exists(FONT_PATH):
        return FONT_PATH
    for p in _FALLBACK_FONTS:
        if os.path.exists(p):
            return p
    raise FileNotFoundError("사용 가능한 한글 폰트를 찾을 수 없습니다 (NOTO_FONT 지정 필요)")


_RESOLVED_FONT = None


def font(size, wght=900):
    """굵은 제목용 / 얇은 본문용 폰트 로더.

    가변폰트(NotoSansKR)면 set_variation_by_axes로 굵기 지정,
    AppleSDGothicNeo.ttc처럼 axes가 없는 콜렉션 폰트면 Bold 인덱스(6)로 대체.
    """
    global _RESOLVED_FONT
    if _RESOLVED_FONT is None:
        _RESOLVED_FONT = _resolve_font_path()
    path = _RESOLVED_FONT
    if path.endswith(".ttc") and "AppleSDGothicNeo" in path:
        index = 6 if wght >= 700 else 0  # 6 = Bold, 0 = Regular
        return ImageFont.truetype(path, size, index=index)
    f = ImageFont.truetype(path, size)
    try:
        f.set_variation_by_axes([wght])
    except Exception:
        pass
    return f


def fit_title_size(d, lines, max_width, base, min_size):
    """제목을 최대한 크게 — 가장 긴 줄이 max_width에 들어갈 때까지만 축소."""
    size = base
    while size > min_size:
        f = font(size, 900)
        if all(d.textlength(ln, font=f) <= max_width for ln in lines):
            break
        size -= 2
    return size


def make_bottom_gradient(w, h, start_ratio=0.40, max_alpha=255):
    """이미지 하단 start_ratio~1.0 구간에 alpha 0→max_alpha 검은 그라데이션.

    numpy 없이: 1px 높이짜리 그라데이션 스트립을 만들어 세로로 resize.
    """
    grad_h = h - int(h * start_ratio)
    if grad_h <= 0:
        return Image.new("RGBA", (w, h), (0, 0, 0, 0))

    strip = Image.new("L", (1, grad_h), 0)
    sd = ImageDraw.Draw(strip)
    for y in range(grad_h):
        # 앞쪽에서 빨리 어두워지도록 — 지수를 1보다 작게(front-loaded 커브)
        t = y / max(1, grad_h - 1)
        alpha = int(max_alpha * (t ** 0.75))
        sd.point((0, y), fill=alpha)
    strip = strip.resize((w, grad_h), Image.BILINEAR)

    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    black = Image.new("RGBA", (w, grad_h), (0, 0, 0, 255))
    black.putalpha(strip)
    layer.alpha_composite(black, (0, h - grad_h))
    return layer


def _tag_metrics(scale):
    return {
        "tf": font(int(21 * scale), 700),
        "pad_x": int(17 * scale),
        "gap": int(12 * scale),
        "pill_h": int(42 * scale),
        "line_gap": int(12 * scale),
        "margin_x": int(24 * scale),
    }


def _wrap_tags(d, hashtags, w, scale):
    """해시태그를 폭에 맞춰 최대 2줄로 감싼 [[(text,width),...], ...] 반환."""
    if not hashtags:
        return []
    tags = [t if t.startswith("#") else f"#{t}" for t in hashtags]
    m = _tag_metrics(scale)
    max_width = w - int(48 * scale)
    lines, cur, cur_w = [], [], 0
    for t in tags:
        tw = d.textlength(t, font=m["tf"]) + m["pad_x"] * 2
        if cur and cur_w + m["gap"] + tw > max_width:
            lines.append(cur)
            cur, cur_w = [], 0
            if len(lines) == 2:
                break
        cur.append((t, tw))
        cur_w += (m["gap"] if cur_w else 0) + tw
    if cur and len(lines) < 2:
        lines.append(cur)
    return lines


def hashtag_block_height(d, hashtags, w, scale):
    """draw 없이 pill 영역이 차지할 높이만 계산 (배치용)."""
    rows = len(_wrap_tags(d, hashtags, w, scale))
    if rows == 0:
        return 0
    m = _tag_metrics(scale)
    return rows * m["pill_h"] + (rows - 1) * m["line_gap"]


def draw_hashtag_pills(canvas, d, hashtags, top_y, w, h, accent_rgb, scale):
    """해시태그 pill들을 좌측 정렬로 가로 나열, 넘치면 최대 2줄까지 감싼다.

    accent_rgb(반투명)와 어두운 반투명을 번갈아 사용.
    반환값: pill 영역이 차지한 총 높이(다음 요소 배치용).
    """
    lines = _wrap_tags(d, hashtags, w, scale)
    if not lines:
        return 0
    m = _tag_metrics(scale)
    accent_fill = accent_rgb + (200,)
    dark_fill = (20, 20, 20, 140)
    fills = [accent_fill, dark_fill]
    fg = (255, 255, 255, 255)

    y = top_y
    for row in lines:
        x = m["margin_x"]
        for i, (text, tw) in enumerate(row):
            fill = fills[i % 2]
            d.rounded_rectangle(
                [x, y, x + tw, y + m["pill_h"]], radius=m["pill_h"] // 2, fill=fill
            )
            d.text((x + tw / 2, y + m["pill_h"] / 2), text, font=m["tf"], fill=fg, anchor="mm")
            x += tw + m["gap"]
        y += m["pill_h"] + m["line_gap"]

    return y - top_y


def compose_card(bg_path, title_lines, hashtags, out_path,
                  highlight_words=None, handle=None, accent_rgb=(108, 172, 61)):
    bg = Image.open(bg_path).convert("RGBA")
    w, h = bg.size
    scale = ((w + h) / 2) / 1024  # 1024 기준 설계, 다른 해상도는 비율 스케일

    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.alpha_composite(bg, (0, 0))

    gradient = make_bottom_gradient(w, h, start_ratio=0.47, max_alpha=235)
    canvas.alpha_composite(gradient, (0, 0))

    d = ImageDraw.Draw(canvas)

    pad_x = int(24 * scale)

    # 제목 크기 계산 — 가로 폭 꽉 채우도록 자동 축소, 좌측 정렬
    title_lines = [ln for ln in (title_lines or []) if ln][:3]
    title_pad_x = int(18 * scale)
    max_title_w = w - title_pad_x * 2
    base_size = int(92 * scale)
    min_size = int(36 * scale)
    ts = fit_title_size(d, title_lines, max_title_w, base=base_size, min_size=min_size)
    ttf = font(ts, 900)
    line_gap = int(ts * 1.18)
    n = max(1, len(title_lines))

    # 하단 기준 배치: (아래→위) 핸들 여백 → 제목 n줄 → 태그. 줄 수가 몇이든 하단에 딱 맞춤.
    handle_h = int(46 * scale) if handle else int(22 * scale)
    last_center = h - handle_h - int(ts * 0.5)   # 마지막 줄 중심
    y0 = last_center - (n - 1) * line_gap         # 첫 줄 중심
    title_first_top = y0 - ts / 2

    # 해시태그 — 제목 블록 바로 위 (블록 높이 미리 계산해 배치)
    tag_block_h = hashtag_block_height(d, hashtags, w, scale)
    tag_gap = int(16 * scale)
    tags_top = int(title_first_top - tag_gap - tag_block_h)
    draw_hashtag_pills(canvas, d, hashtags, tags_top, w, h, accent_rgb, scale)

    # 제목 그리기
    hl = set(highlight_words or [])
    white = (255, 255, 255, 255)
    accent = accent_rgb + (255,)
    for i, line in enumerate(title_lines):
        col = accent if i in hl else white
        d.text((title_pad_x, y0 + i * line_gap), line, font=ttf, fill=col, anchor="lm")

    # 핸들 — 맨 아래 좌측, 작은 회색 텍스트
    if handle:
        hf = font(int(18 * scale), 500)
        d.text((pad_x, h - int(14 * scale)), handle, font=hf,
                fill=(200, 200, 200, 255), anchor="lm")

    os.makedirs(os.path.dirname(os.path.abspath(out_path)) or ".", exist_ok=True)
    rgb = canvas.convert("RGB")
    if out_path.lower().endswith((".jpg", ".jpeg")):
        rgb.save(out_path, quality=92)
    else:
        rgb.save(out_path)
    return out_path


def main():
    data = json.load(sys.stdin)
    bg_path = data["bg_path"]
    title_lines = data.get("title_lines", [])
    hashtags = data.get("hashtags", [])
    out_path = data["out_path"]
    handle = data.get("handle")
    accent_rgb = tuple(data.get("accent_rgb", (108, 172, 61)))

    hl_idx = data.get("highlight_line_index")
    if hl_idx is None:
        highlight_words = set(data.get("highlight_lines", []))
    else:
        highlight_words = {hl_idx} if isinstance(hl_idx, int) else set(hl_idx)

    try:
        compose_card(bg_path, title_lines, hashtags, out_path,
                     highlight_words=highlight_words, handle=handle, accent_rgb=accent_rgb)
        print(json.dumps({"out_path": out_path}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
