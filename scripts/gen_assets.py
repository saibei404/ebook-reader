# -*- coding: utf-8 -*-
"""程序化生成应用图标与默认壁纸（纯标准库，无第三方依赖）"""
import zlib, struct, math, os, sys

OUT = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(OUT)
RES = os.path.join(ROOT, "resources")
PUB = os.path.join(ROOT, "public", "assets")

def write_png(path, w, h, px):
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)
        raw.extend(px[y * stride:(y + 1) * stride])
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 6))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)

def downscale(px, w, h, factor):
    nw, nh = w // factor, h // factor
    out = bytearray(nw * nh * 4)
    for y in range(nh):
        for x in range(nw):
            r = g = b = a = 0
            for dy in range(factor):
                base = ((y * factor + dy) * w + x * factor) * 4
                for dx in range(factor):
                    i = base + dx * 4
                    r += px[i]; g += px[i + 1]; b += px[i + 2]; a += px[i + 3]
            n = factor * factor
            j = (y * nw + x) * 4
            out[j] = r // n; out[j + 1] = g // n; out[j + 2] = b // n; out[j + 3] = a // n
    return out, nw, nh

def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)

def lerp(a, b, t):
    return a + (b - a) * t

def lerp3(c1, c2, t):
    return (lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t))

# ---------------- 图标 ----------------
def draw_icon(S):
    px = bytearray(S * S * 4)
    cx, cy = S * 0.5, S * 0.5
    rad = S * 0.225
    # 调色板：深海墨鱼主题
    top = (28, 34, 64)      # 深藏青
    bottom = (52, 44, 96)   # 深紫
    glow1 = (45, 212, 191)  # 青绿
    glow2 = (129, 140, 248) # 紫蓝
    cream = (247, 243, 232)
    cream2 = (226, 218, 198)
    ink = (39, 42, 74)
    gold = (212, 175, 55)

    for y in range(S):
        fy = y / S
        for x in range(S):
            i = (y * S + x) * 4
            # 圆角方形底板
            qx = min(x, S - 1 - x); qy = min(y, S - 1 - y)
            if qx < rad and qy < rad:
                d = math.hypot(qx - rad, qy - rad)
                a = smoothstep(rad, rad - S * 0.012, d)
            else:
                a = 1.0
            if a <= 0.003:
                continue
            # 垂直渐变 + 对角偏移
            t = fy * 0.85 + (x / S) * 0.15
            base = lerp3(top, bottom, t)
            # 左上青色光晕 / 右下紫色光晕
            d1 = math.hypot(x - S * 0.28, y - S * 0.22) / (S * 0.75)
            g1 = max(0.0, 1.0 - d1) ** 2 * 0.5
            d2 = math.hypot(x - S * 0.82, y - S * 0.85) / (S * 0.7)
            g2 = max(0.0, 1.0 - d2) ** 2 * 0.45
            r = base[0] + (glow1[0] - base[0]) * g1 + (glow2[0] - base[0]) * g2
            g = base[1] + (glow1[1] - base[1]) * g1 + (glow2[1] - base[1]) * g2
            b = base[2] + (glow1[2] - base[2]) * g1 + (glow2[2] - base[2]) * g2

            # ---- 打开的书 ----
            bx = (x - cx) / S
            by = (y - cy) / S
            # 书本局部坐标（左右页分别反向旋转）
            ang = math.radians(-11) if bx < 0 else math.radians(11)
            ca, sa = math.cos(-ang), math.sin(-ang)
            lx = bx * ca - by * sa
            ly = bx * sa + by * ca
            # 书页范围
            pw, ph = 0.155, 0.20
            pyoff = 0.055  # 书心略低
            ly2 = ly - pyoff
            if abs(lx) < pw and abs(ly2) < ph:
                # 圆角
                ex = abs(lx) - (pw - 0.028)
                ey = abs(ly2) - (ph - 0.028)
                if ex > 0 and ey > 0:
                    inside = math.hypot(ex, ey) < 0.028
                else:
                    inside = True
                if inside:
                    # 页面：靠书脊略暗，外缘亮
                    sh = smoothstep(0.0, 0.05, abs(lx))
                    page = lerp3(cream2, cream, sh)
                    # 顶部高光
                    hl = smoothstep(0.16, 0.02, abs(ly2 + ph - 0.03))
                    page = lerp3(page, (255, 255, 250), hl * 0.35)
                    # 文字行（每页 4 行）
                    line = 0
                    if abs(lx) > 0.022:
                        for k in range(4):
                            yy = -0.10 + k * 0.055
                            if abs(ly2 - yy) < 0.009:
                                w_line = pw - 0.035 - (k % 2) * 0.02
                                if abs(lx) < w_line:
                                    line = 1
                    if line:
                        page = lerp3(page, ink, 0.55)
                    # 书脊
                    if abs(lx) < 0.012:
                        page = lerp3(page, gold, 0.85)
                    r, g, b = page
            # 书下阴影
            ds = math.hypot(bx / 0.30, (by - 0.24) / 0.055)
            sh_a = max(0.0, 1.0 - ds) ** 2 * 0.35
            r = lerp(r, 10, sh_a); g = lerp(g, 12, sh_a); b = lerp(b, 26, sh_a)
            # 气泡
            for (bx0, by0, br) in [(0.30, -0.28, 0.020), (0.37, -0.20, 0.013), (0.26, -0.16, 0.009),
                                    (-0.33, -0.22, 0.016), (-0.27, -0.32, 0.010), (0.42, -0.30, 0.008)]:
                d = math.hypot(bx - bx0, by - by0)
                if d < br:
                    edge = smoothstep(br, br * 0.55, d)
                    core = smoothstep(br * 0.5, 0, d) * 0.5
                    r = lerp(r, 190, edge * 0.5 + core * 0.3)
                    g = lerp(g, 240, edge * 0.5 + core * 0.3)
                    b = lerp(b, 235, edge * 0.5 + core * 0.3)

            px[i] = max(0, min(255, int(r)))
            px[i + 1] = max(0, min(255, int(g)))
            px[i + 2] = max(0, min(255, int(b)))
            px[i + 3] = max(0, min(255, int(a * 255)))
    return px

# ---------------- 壁纸 ----------------
def draw_wallpaper(w, h, palette):
    px = bytearray(w * h * 4)
    stops = palette["stops"]
    blobs = palette["blobs"]  # (x01, y01, r01, color, strength)
    for y in range(h):
        fy = y / h
        # 竖直渐变
        seg = fy * (len(stops) - 1)
        i0 = min(int(seg), len(stops) - 2)
        base = lerp3(stops[i0], stops[i0 + 1], seg - i0)
        for x in range(w):
            i = (y * w + x) * 4
            r, g, b = base
            for (bx, by, br, col, st) in blobs:
                d = math.hypot(x / w - bx, y / h - by) / br
                k = max(0.0, 1.0 - d) ** 2 * st
                r += (col[0] - r) * k
                g += (col[1] - g) * k
                b += (col[2] - b) * k
            # 暗角
            vx, vy = x / w - 0.5, y / h - 0.5
            v = 1.0 - smoothstep(0.32, 0.78, math.hypot(vx, vy)) * 0.55
            r *= v; g *= v; b *= v
            # 细噪声
            n = ((x * 7 + y * 13) % 5 - 2) * 1.2
            px[i] = max(0, min(255, int(r + n)))
            px[i + 1] = max(0, min(255, int(g + n)))
            px[i + 2] = max(0, min(255, int(b + n)))
            px[i + 3] = 255
    return px

def write_ico(path, png256):
    data = open(png256, "rb").read()
    header = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack("<BBBBHHII", 0, 0, 0, 0, 1, 32, len(data), 22)
    with open(path, "wb") as f:
        f.write(header + entry + data)

os.makedirs(RES, exist_ok=True)
os.makedirs(PUB, exist_ok=True)

# 图标 1024 + 缩略 256/64
icon = draw_icon(1024)
write_png(os.path.join(RES, "icon.png"), 1024, 1024, icon)
small, sw, sh = downscale(icon, 1024, 1024, 4)
write_png(os.path.join(RES, "icon-256.png"), sw, sh, small)
write_ico(os.path.join(RES, "icon.ico"), os.path.join(RES, "icon-256.png"))
tiny, tw, th = downscale(icon, 1024, 1024, 16)
write_png(os.path.join(PUB, "tray-icon.png"), tw, th, tiny)
print("icon ok", sw, sh)

# 壁纸三套
deep = {
    "stops": [(10, 16, 38), (16, 28, 56), (24, 40, 74)],
    "blobs": [(0.22, 0.24, 0.42, (45, 212, 191), 0.30), (0.80, 0.78, 0.45, (129, 140, 248), 0.30),
              (0.62, 0.18, 0.30, (56, 189, 248), 0.22)],
}
dusk = {
    "stops": [(38, 20, 44), (58, 28, 60), (24, 18, 40)],
    "blobs": [(0.75, 0.30, 0.40, (244, 114, 182), 0.32), (0.25, 0.75, 0.42, (251, 146, 60), 0.26),
              (0.50, 0.50, 0.35, (167, 139, 250), 0.22)],
}
mist = {
    "stops": [(226, 232, 240), (205, 216, 228), (240, 244, 248)],
    "blobs": [(0.30, 0.30, 0.45, (255, 255, 255), 0.5), (0.78, 0.72, 0.40, (186, 230, 253), 0.35),
              (0.55, 0.20, 0.30, (221, 214, 254), 0.25)],
}
# 系统预设壁纸已于 v16 移除（仅保留用户导入壁纸），此处不再生成；
# 历史产物归档于 _archive/_misc_build-temp-configs/dead-assets-2026-10-29/
print("ALL ASSETS DONE (icon/tray only)")
