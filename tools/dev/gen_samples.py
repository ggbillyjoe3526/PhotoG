"""Usage: python3 tools/dev/gen_samples.py photos   (needs Pillow + numpy)

Generate procedural, photograph-like sample images with realistic EXIF/XMP.

These are placeholders for the portfolio demo; the owner replaces them with
real photographs. Output: JPEGs in <repo>/photos/.
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else "photos"
LONG = 2400
rng = np.random.default_rng(7)


def hexrgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def size_for(ratio):
    """ratio = w/h"""
    if ratio >= 1:
        return LONG, int(round(LONG / ratio))
    return int(round(LONG * ratio)), LONG


def vgrad(h, w, stops):
    """stops: list of (pos 0..1, hex)."""
    ys = np.linspace(0, 1, h, dtype=np.float32)
    pos = [s[0] for s in stops]
    cols = np.stack([hexrgb(s[1]) for s in stops])
    ch = [np.interp(ys, pos, cols[:, c]) for c in range(3)]
    col = np.stack(ch, axis=1)  # h x 3
    return np.repeat(col[:, None, :], w, axis=1)


def fbm1d(n, octaves=6, base=4, persistence=0.5, seed=None):
    r = np.random.default_rng(seed) if seed is not None else rng
    x = np.linspace(0, 1, n)
    out = np.zeros(n)
    amp, freq, total = 1.0, base, 0.0
    for _ in range(octaves):
        pts = r.uniform(-1, 1, freq + 2)
        xp = np.linspace(0, 1, freq + 2)
        out += amp * np.interp(x, xp, pts)
        total += amp
        amp *= persistence
        freq *= 2
    return out / total


def noise2d(h, w, scale=8, octaves=4, persistence=0.5):
    out = np.zeros((h, w), dtype=np.float32)
    amp, total = 1.0, 0.0
    for o in range(octaves):
        gh, gw = max(2, int(scale * (2 ** o) * h / max(h, w))), max(2, int(scale * (2 ** o) * w / max(h, w)))
        small = (rng.uniform(0, 255, (gh, gw))).astype(np.uint8)
        big = np.asarray(Image.fromarray(small).resize((w, h), Image.BICUBIC), dtype=np.float32) / 255.0
        out += amp * big
        total += amp
        amp *= persistence
    return out / total


def blend(a, b, t):
    t = np.asarray(t, dtype=np.float32)
    if t.ndim == 2:
        t = t[..., None]
    return a * (1 - t) + b * t


def finish(img, grain=4.0, vignette=0.25, blur=0.0):
    h, w, _ = img.shape
    if vignette:
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        r = ((xx / w - 0.5) ** 2 + (yy / h - 0.5) ** 2) * 2
        img = img * (1 - vignette * r)[..., None]
    if grain:
        img = img + rng.normal(0, grain, (h, w, 1)).astype(np.float32)
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    if blur:
        im = im.filter(ImageFilter.GaussianBlur(blur))
    return im


def ridges(h, w, sky, layers, haze, seed=1, valley_fog=0.35):
    img = sky.copy()
    yy = np.arange(h, dtype=np.float32)[:, None]
    for i, (base, amp, col, rough) in enumerate(layers):
        line = (base + amp * fbm1d(w, octaves=7, base=rough, seed=seed + i)) * h
        mask = (yy >= line[None, :]).astype(np.float32)
        # soften the edge a touch
        depth = np.clip((yy - line[None, :]) / (h * 0.25), 0, 1)
        layer_col = np.broadcast_to(hexrgb(col), (h, w, 3))
        fogged = blend(layer_col, np.broadcast_to(hexrgb(haze), (h, w, 3)), (1 - depth) * 0 + depth * valley_fog)
        img = blend(img, fogged, mask)
    return img


def save(im, name, exif, xmp_title, city, country, desc):
    os.makedirs(OUT, exist_ok=True)
    ex = Image.Exif()
    ex[0x010F] = exif["make"]
    ex[0x0110] = exif["model"]
    ex[0x0131] = "Sample generator"
    ex[0x8298] = "Sample image - replace with your own work"
    ifd = ex.get_ifd(0x8769)
    ifd[0x829A] = exif["exposure"]           # ExposureTime
    ifd[0x829D] = exif["fnumber"]            # FNumber
    ifd[0x8827] = exif["iso"]                # ISO
    ifd[0x9003] = exif["date"]               # DateTimeOriginal
    ifd[0x920A] = exif["focal"]              # FocalLength
    ifd[0xA434] = exif["lens"]               # LensModel
    if exif.get("focal35"):
        ifd[0xA405] = exif["focal35"]
    xmp = f"""<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    photoshop:City="{city}" photoshop:Country="{country}">
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">{xmp_title}</rdf:li></rdf:Alt></dc:title>
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">{desc}</rdf:li></rdf:Alt></dc:description>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>"""
    path = os.path.join(OUT, name)
    im.save(path, "JPEG", quality=88, subsampling=0, exif=ex.tobytes(), xmp=xmp.encode("utf-8"))
    print(path, im.size, os.path.getsize(path) // 1024, "KB")


CAMS = {
    "fuji": ("FUJIFILM", "X-T5"),
    "sony": ("SONY", "ILCE-7RM5"),
    "canon": ("Canon", "Canon EOS R5"),
    "nikon": ("NIKON CORPORATION", "NIKON Z 8"),
    "leica": ("LEICA CAMERA AG", "LEICA Q3"),
}


def E(cam, lens, focal, f, t, iso, date, focal35=None):
    mk, md = CAMS[cam]
    return dict(make=mk, model=md, lens=lens, focal=focal, fnumber=f, exposure=t, iso=iso, date=date, focal35=focal35)


# ---------------------------------------------------------------- scenes

def s_ridgelines():
    w, h = size_for(3 / 2)
    sky = vgrad(h, w, [(0, "#2b2f4a"), (0.35, "#7a6a8a"), (0.55, "#e2a48a"), (0.62, "#f3c9a0")])
    layers = [
        (0.44, 0.08, "#b58e93", 5),
        (0.52, 0.09, "#86677a", 6),
        (0.61, 0.08, "#5a4862", 5),
        (0.72, 0.07, "#352c42", 7),
        (0.84, 0.06, "#1b1726", 6),
    ]
    img = ridges(h, w, sky, layers, "#e7b49a", seed=11, valley_fog=0.25)
    return finish(img, grain=3.5, vignette=0.18)


def s_fog_ridge():
    w, h = size_for(2 / 3)
    sky = vgrad(h, w, [(0, "#d9d9d6"), (0.5, "#bfbfbc"), (1, "#a9a9a6")])
    layers = [
        (0.30, 0.10, "#9c9c99", 4),
        (0.42, 0.09, "#7d7d7a", 5),
        (0.55, 0.10, "#5c5c5a", 5),
        (0.70, 0.08, "#3a3a39", 6),
        (0.86, 0.06, "#1d1d1d", 7),
    ]
    img = ridges(h, w, sky, layers, "#d0d0cd", seed=23, valley_fog=0.55)
    fog = noise2d(h, w, scale=3, octaves=4)
    img = blend(img, np.broadcast_to(hexrgb("#e6e6e3"), img.shape), np.clip((fog - 0.45) * 1.4, 0, 0.55))
    return finish(img, grain=5, vignette=0.12)


def s_horizon():
    w, h = size_for(16 / 9)
    hz = 0.58
    sky = vgrad(h, w, [(0, "#5f7fa3"), (hz - 0.02, "#c8d4dc"), (hz, "#dfe5e6")])
    sea = vgrad(h, w, [(0, "#2a4560"), (hz, "#8fa6b6"), (1, "#1c2f43")])
    yy = np.arange(h)[:, None] / h
    img = np.where((yy < hz)[..., None], sky, sea)
    # soft glow near horizon
    xx = np.arange(w)[None, :] / w
    glow = np.exp(-(((xx - 0.68) / 0.18) ** 2 + ((yy - hz) / 0.08) ** 2))
    img = blend(img, np.broadcast_to(hexrgb("#f6efe2"), img.shape), glow * 0.55)
    # gentle wave texture below horizon
    waves = noise2d(h, w, scale=40, octaves=2)
    img = img + ((yy > hz) * (waves - 0.5) * 18)[..., None]
    return finish(img, grain=3, vignette=0.2)


def s_dunes():
    w, h = size_for(3 / 2)
    sky = vgrad(h, w, [(0, "#8fb3cf"), (0.3, "#d8dfdc")])
    img = sky.copy()
    yy = np.arange(h, dtype=np.float32)[:, None]
    xx = np.linspace(0, 1, w)[None, :]
    bands = [(0.30, "#d9a46d", "#8a5434", 0.0), (0.45, "#cf9058", "#6d3f26", 1.3), (0.62, "#c47d47", "#5a311d", 2.1), (0.80, "#b86d3b", "#4b2817", 0.7)]
    for i, (base, lit, shade, ph) in enumerate(bands):
        crest = (base + 0.06 * np.sin(xx * 6.0 + ph) + 0.03 * fbm1d(w, 5, 3, seed=40 + i)[None, :]) * h
        mask = (yy >= crest).astype(np.float32)
        # lit/shadow split along a diagonal ridge
        ridge_x = 0.5 + 0.35 * np.sin(ph + yy / h * 3)
        side = 1 / (1 + np.exp(-(xx - ridge_x) * 40))
        col = blend(np.broadcast_to(hexrgb(lit), (h, w, 3)), np.broadcast_to(hexrgb(shade), (h, w, 3)), side * 0.8)
        img = blend(img, col, mask)
    ripples = np.sin((yy / h * 220) + noise2d(h, w, scale=6, octaves=2) * 12)
    img = img + (ripples * 4)[..., None] * (yy / h > 0.3)[..., None]
    return finish(img, grain=4, vignette=0.22)


def s_shadow_study():
    w, h = size_for(4 / 5)
    base = noise2d(h, w, scale=60, octaves=3)
    wall = 185 + (base - 0.5) * 30
    img = np.repeat(wall[..., None], 3, axis=2)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    u = (xx / w) * 0.8 + (yy / h) * 0.6
    stripes = (np.mod(u * 7, 1.0) > 0.58).astype(np.float32)
    stripes = np.asarray(Image.fromarray((stripes * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4)), dtype=np.float32) / 255
    img = img * (1 - 0.62 * stripes)[..., None]
    floor = (yy / h > 0.82).astype(np.float32)
    img = blend(img, img * 0.55, floor)
    return finish(img, grain=6, vignette=0.3)


def s_night_lights():
    w, h = size_for(3 / 2)
    img = vgrad(h, w, [(0, "#05060c"), (0.6, "#111426"), (1, "#1b1a24")])
    layer = Image.new("RGB", (w, h))
    arr = np.zeros((h, w, 3), dtype=np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    palette = ["#ff9f45", "#ffcf7a", "#ff5a5f", "#6fb7ff", "#ffe9b0", "#c38bff"]
    for _ in range(70):
        cx, cy = rng.uniform(0, w), rng.uniform(h * 0.25, h * 0.95)
        r = rng.uniform(30, 120)
        col = hexrgb(palette[rng.integers(len(palette))])
        d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
        disc = np.clip((r - d) / 3, 0, 1) * rng.uniform(0.15, 0.55)
        ring = np.exp(-((d - r * 0.95) / 4) ** 2) * 0.12
        arr += (disc + ring)[..., None] * col
    img = img + arr
    return finish(img, grain=5, vignette=0.35, blur=1.2)


def s_pines():
    w, h = size_for(2 / 3)
    img = vgrad(h, w, [(0, "#c9d2cf"), (0.6, "#a8b5b2"), (1, "#7f8f8c")])
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    for layer, (gy, col, n, sc) in enumerate([(0.55, "#8e9e9b", 26, 0.6), (0.68, "#5f716e", 18, 0.85), (0.82, "#334441", 12, 1.15), (0.98, "#131d1c", 7, 1.6)]):
        mask = np.zeros((h, w), dtype=np.float32)
        for _ in range(n):
            cx = rng.uniform(-0.05, 1.05) * w
            th = rng.uniform(0.28, 0.42) * h * sc
            tw = th * 0.22
            top = gy * h - th
            inside = (yy > top) & (yy < gy * h + h) & (np.abs(xx - cx) < (yy - top) / th * tw)
            mask = np.maximum(mask, inside.astype(np.float32))
        mask = np.maximum(mask, (yy > gy * h).astype(np.float32))
        img = blend(img, np.broadcast_to(hexrgb(col), img.shape), mask)
        fog = np.clip(1 - (gy * h - yy) / (h * 0.25), 0, 1) * 0.0
        mist = np.exp(-((yy - gy * h) / (h * 0.05)) ** 2) * 0.35
        img = blend(img, np.broadcast_to(hexrgb("#d6dedb"), img.shape), mist)
    return finish(img, grain=5, vignette=0.15)


def s_sun_disc():
    w, h = size_for(1)
    hz = 0.66
    sky = vgrad(h, w, [(0, "#3b1426"), (0.4, "#a8352c"), (hz, "#f08a3c")])
    sea = vgrad(h, w, [(0, "#000000"), (hz, "#5c1f1c"), (1, "#14070a")])
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    img = np.where((yy < hz * h)[..., None], sky, sea)
    cx, cy, r = w * 0.5, h * 0.52, w * 0.13
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    sun = np.clip((r - d) / 2, 0, 1) * (yy < hz * h)
    img = blend(img, np.broadcast_to(hexrgb("#ffd59a"), img.shape), sun)
    glow = np.exp(-(d / (r * 2.8)) ** 2) * 0.35
    img = blend(img, np.broadcast_to(hexrgb("#ffb067"), img.shape), glow)
    # reflection column
    refl = (yy > hz * h) * np.exp(-((xx - cx) / (r * 0.7)) ** 2) * (np.sin(yy * 0.9) > 0.1) * 0.5 * np.exp(-(yy - hz * h) / (h * 0.25))
    img = blend(img, np.broadcast_to(hexrgb("#ffbb73"), img.shape), refl)
    return finish(img, grain=4, vignette=0.25)


def s_panorama():
    w, h = LONG, LONG // 3
    sky = vgrad(h, w, [(0, "#0f1a33"), (0.5, "#2b4170"), (0.75, "#6f7fa8"), (0.85, "#b9a8b9")])
    layers = [
        (0.52, 0.16, "#4f5f86", 9),
        (0.64, 0.14, "#34436a", 10),
        (0.78, 0.10, "#1d2744", 12),
        (0.90, 0.05, "#0b1022", 10),
    ]
    img = ridges(h, w, sky, layers, "#7d86a8", seed=61, valley_fog=0.3)
    return finish(img, grain=3.5, vignette=0.15)


def s_window_light():
    w, h = size_for(4 / 5)
    wall = vgrad(h, w, [(0, "#3a3029"), (1, "#26201c")])
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    # skewed rectangle of light
    u = (xx - w * 0.22 - (yy - h * 0.2) * 0.35) / (w * 0.42)
    v = (yy - h * 0.18) / (h * 0.5)
    rect = ((u > 0) & (u < 1) & (v > 0) & (v < 1)).astype(np.float32)
    mullion = ((np.abs(u - 0.5) < 0.025) | (np.abs(v - 0.5) < 0.02)).astype(np.float32)
    rect = rect * (1 - mullion)
    rect = np.asarray(Image.fromarray((rect * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(10)), dtype=np.float32) / 255
    img = blend(wall, np.broadcast_to(hexrgb("#f2c98f"), wall.shape), rect * 0.85)
    tex = noise2d(h, w, scale=80, octaves=2)
    img = img * (0.94 + 0.12 * tex)[..., None]
    return finish(img, grain=6, vignette=0.35)


def s_snowfield():
    w, h = size_for(3 / 2)
    img = vgrad(h, w, [(0, "#dfe5ea"), (0.45, "#eef1f3"), (0.46, "#f4f6f7"), (1, "#d3dce5")])
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    drift = noise2d(h, w, scale=4, octaves=3)
    img = img - ((yy / h > 0.46) * (drift - 0.5) * 28)[..., None] * np.array([1.0, 0.8, 0.5])
    for i in range(9):
        cx = w * (0.3 + 0.045 * i + rng.uniform(-0.01, 0.01))
        top = h * (0.43 - rng.uniform(0, 0.03))
        tree = (np.abs(xx - cx) < (yy - top) * 0.18) & (yy > top) & (yy < h * 0.462)
        img = blend(img, np.broadcast_to(hexrgb("#3d4752"), img.shape), tree.astype(np.float32) * 0.9)
    return finish(img, grain=3, vignette=0.1)


def s_tide():
    w, h = size_for(2 / 3)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    sand = vgrad(h, w, [(0, "#bfae97"), (1, "#9b8a74")])
    water = vgrad(h, w, [(0, "#1f3f4a"), (1, "#3d6a72")])
    edge = (0.45 + 0.12 * np.sin(yy / h * 5 + 0.5) + 0.05 * noise2d(h, w, 3, 3) - 0.025) * w
    m = 1 / (1 + np.exp(-(edge - xx) / 6))
    img = blend(sand, water, m)
    foam = np.exp(-((xx - edge) / 14) ** 2) * (0.6 + 0.4 * noise2d(h, w, 30, 2))
    img = blend(img, np.broadcast_to(hexrgb("#f1efe9"), img.shape), np.clip(foam, 0, 1))
    wet = np.exp(-np.clip(xx - edge, 0, None) / (w * 0.08)) * (xx > edge) * 0.35
    img = blend(img, img * 0.7, wet)
    return finish(img, grain=5, vignette=0.2)


def s_concrete():
    w, h = size_for(1)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    tex = noise2d(h, w, 90, 3)
    img = np.repeat((150 + (tex - 0.5) * 40)[..., None], 3, axis=2)
    planes = [((xx > w * 0.18) & (xx < w * 0.52) & (yy > h * 0.12), 1.25), ((xx >= w * 0.52) & (xx < w * 0.86) & (yy > h * 0.3), 0.62), ((yy > h * 0.84), 0.45)]
    for m, k in planes:
        img = img * np.where(m, k, 1.0)[..., None]
    diag = (yy - h * 0.3 > (xx - w * 0.52) * 0.9) & (xx >= w * 0.52) & (xx < w * 0.86)
    img = img * np.where(diag, 0.7, 1.0)[..., None]
    sky = np.repeat(np.full((h, w), 228.0)[..., None], 3, axis=2)
    img = np.where(((yy < h * 0.12) | ((yy < h * 0.3) & (xx >= w * 0.52)) | (xx < w * 0.18) & (yy < h * 0.84) | (xx >= w * 0.86) & (yy < h * 0.84))[..., None], sky - 10 * (yy / h)[..., None], img)
    return finish(img, grain=6, vignette=0.22)


def s_aurora():
    w, h = size_for(16 / 9)
    img = vgrad(h, w, [(0, "#020611"), (0.7, "#0a1a24"), (1, "#081015")])
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    curve = (0.38 + 0.12 * np.sin(xx / w * 4 + 1) + 0.04 * fbm1d(w, 5, 4, seed=91)[None, :]) * h
    curtain = np.exp(-np.clip(yy - curve, 0, None) / (h * 0.03)) * (yy > curve - h * 0.35) * np.exp(-np.clip(curve - yy, 0, None) / (h * 0.16))
    rays = 0.55 + 0.45 * noise2d(h, w, 4, 2) * (0.5 + 0.5 * np.sin(xx / w * 90))
    a = np.clip(curtain * rays, 0, 1)
    img = blend(img, np.broadcast_to(hexrgb("#4dffb0"), img.shape), a * 0.75)
    img = blend(img, np.broadcast_to(hexrgb("#b56bff"), img.shape), np.clip(np.exp(-np.clip(curve - yy, 0, None) / (h * 0.05)) * (yy < curve) * 0.25 * rays, 0, 1))
    stars = (rng.random((h, w)) > 0.9993).astype(np.float32) * (1 - a)
    img = img + (stars * 200)[..., None]
    sky = img
    img = ridges(h, w, sky, [(0.82, 0.05, "#03070a", 8)], "#03070a", seed=5, valley_fog=0)
    return finish(img, grain=5, vignette=0.3)


def s_canyon():
    w, h = size_for(2 / 3)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    img = vgrad(h, w, [(0, "#f6c58c"), (0.5, "#c0582c"), (1, "#3a140c")])
    left = (0.38 + 0.08 * fbm1d(h, 6, 5, seed=101)[:, None] + 0.1 * np.sin(yy / h * 6)) * w
    right = (0.62 + 0.08 * fbm1d(h, 6, 5, seed=102)[:, None] + 0.1 * np.sin(yy / h * 6 + 0.6)) * w
    wall = ((xx < left) | (xx > right)).astype(np.float32)
    strata = np.sin(yy / h * 140 + noise2d(h, w, 5, 2) * 8) * 0.5 + 0.5
    rock = vgrad(h, w, [(0, "#d9733b"), (0.6, "#8a3519"), (1, "#2a0d07")]) * (0.85 + 0.2 * strata)[..., None]
    shade = np.clip(np.minimum(np.abs(xx - left), np.abs(xx - right)) / (w * 0.25), 0, 1)
    rock = rock * (1 - 0.55 * shade)[..., None]
    img = blend(img, rock, wall)
    beam = np.exp(-((xx - w * 0.5 - (yy - h * 0.5) * 0.25) / (w * 0.05)) ** 2) * (1 - wall) * 0.4
    img = blend(img, np.broadcast_to(hexrgb("#fff1d6"), img.shape), beam)
    return finish(img, grain=5, vignette=0.3)


def s_lake():
    w, h = size_for(3 / 2)
    hz = 0.52
    sky = vgrad(h, w, [(0, "#a9b8d6"), (0.45, "#e8d2d5"), (0.52, "#f2e1d8")])
    top = ridges(h, w, sky, [(0.36, 0.08, "#8f8fae", 5), (0.43, 0.06, "#6d6a8c", 7), (0.49, 0.03, "#433f5e", 9)], "#e2cfd6", seed=121, valley_fog=0.2)
    hh = int(h * hz)
    upper = top[:hh]
    lower = upper[::-1][: h - hh]
    lower = blend(lower, np.broadcast_to(hexrgb("#9aa6c2"), lower.shape), 0.22)
    img = np.concatenate([upper, lower], axis=0)
    yy = np.arange(h)[:, None]
    ripple = (yy > hh) * np.sin(yy * 0.6) * 3
    img = img + ripple[..., None]
    return finish(img, grain=3, vignette=0.18)


def s_salt_flat():
    w, h = LONG, int(LONG / (21 / 9))
    hz = 0.56
    img = vgrad(h, w, [(0, "#9fb4c8"), (hz, "#e9ecee"), (hz + 0.001, "#f3f2ef"), (1, "#d9d4ca")])
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cracks = noise2d(h, w, 50, 2)
    img = img - ((yy > hz * h) * (np.abs(cracks - 0.5) < 0.012) * 25)[..., None]
    cx = w * 0.63
    fig = (np.abs(xx - cx) < 4) & (yy > hz * h - 34) & (yy < hz * h + 4)
    head = (xx - cx) ** 2 + (yy - (hz * h - 40)) ** 2 < 25
    img = blend(img, np.broadcast_to(hexrgb("#202124"), img.shape), (fig | head).astype(np.float32))
    return finish(img, grain=3, vignette=0.12)


SCENES = [
    ("01-ridgelines.jpg", s_ridgelines, E("fuji", "XF70-300mmF4-5.6 R LM OIS WR", 210, 8.0, 1 / 320, 160, "2024:10:12 18:41:07", 315), "Ridgelines", "Dolomites", "Italy", "Five ridges stacked into the last light."),
    ("02-fog-ridge.jpg", s_fog_ridge, E("leica", "SUMMILUX 1:1.7/28 ASPH.", 28, 5.6, 1 / 250, 100, "2023:11:03 08:12:44"), "Fog Line", "Black Forest", "Germany", "Morning fog settling between ridges."),
    ("03-horizon.jpg", s_horizon, E("sony", "FE 24-70mm F2.8 GM II", 52, 11.0, 1 / 125, 100, "2024:06:21 05:58:31"), "Horizon, 05:58", "Lofoten", "Norway", "Flat sea at first light."),
    ("04-dunes.jpg", s_dunes, E("canon", "RF100-500mm F4.5-7.1 L IS USM", 340, 9.0, 1 / 500, 200, "2024:03:02 17:22:10"), "Erg", "Merzouga", "Morocco", "Dunes in low raking light."),
    ("05-shadow-study.jpg", s_shadow_study, E("leica", "SUMMILUX 1:1.7/28 ASPH.", 28, 8.0, 1 / 1000, 200, "2023:08:15 13:05:58"), "Shadow Study No. 3", "Lisbon", "Portugal", "Hard midday light through a louvred facade."),
    ("06-night-lights.jpg", s_night_lights, E("fuji", "XF56mmF1.2 R WR", 56, 1.2, 1 / 60, 3200, "2024:12:19 21:47:02", 84), "After Hours", "Tokyo", "Japan", "City lights rendered out of focus."),
    ("07-pines.jpg", s_pines, E("nikon", "NIKKOR Z 70-200mm f/2.8 VR S", 135, 5.6, 1 / 200, 400, "2023:10:28 07:31:19"), "Pines in Cloud", "Hokkaido", "Japan", "Layers of conifers dissolving into cloud."),
    ("08-sun-disc.jpg", s_sun_disc, E("canon", "RF800mm F11 IS STM", 800, 11.0, 1 / 2000, 100, "2024:08:09 20:51:36"), "Sun Disc", "Algarve", "Portugal", "The sun touching the Atlantic."),
    ("09-panorama.jpg", s_panorama, E("sony", "FE 70-200mm F2.8 GM OSS II", 105, 8.0, 2.0, 100, "2024:01:17 17:36:50"), "Blue Hour Range", "Patagonia", "Chile", "Stitched panorama, five frames."),
    ("10-window-light.jpg", s_window_light, E("fuji", "XF23mmF1.4 R LM WR", 23, 2.8, 1 / 60, 800, "2023:12:02 15:14:27", 35), "Window, 15:14", "Copenhagen", "Denmark", "Winter afternoon light on a plaster wall."),
    ("11-snowfield.jpg", s_snowfield, E("nikon", "NIKKOR Z 24-120mm f/4 S", 120, 8.0, 1 / 800, 64, "2024:02:11 11:02:15"), "Treeline", "Lapland", "Finland", "A row of spruce on an open snowfield."),
    ("12-tide.jpg", s_tide, E("canon", "RF24-105mm F4 L IS USM", 24, 11.0, 0.5, 50, "2023:09:22 19:03:41"), "Tide Edge", "Isle of Harris", "Scotland", "Shot from a headland, looking straight down."),
    ("13-concrete.jpg", s_concrete, E("leica", "SUMMILUX 1:1.7/28 ASPH.", 28, 4.0, 1 / 500, 100, "2024:04:06 10:47:33"), "Planes", "Chandigarh", "India", "Brutalist geometry under an overcast sky."),
    ("14-aurora.jpg", s_aurora, E("sony", "FE 14mm F1.8 GM", 14, 1.8, 8.0, 1600, "2024:03:24 23:18:09"), "Corona", "Tromsø", "Norway", "Aurora over the fjord ridge."),
    ("15-canyon.jpg", s_canyon, E("fuji", "XF16mmF1.4 R WR", 16, 8.0, 1 / 30, 400, "2023:05:30 11:55:02", 24), "Slot", "Page, Arizona", "USA", "Reflected light inside a slot canyon."),
    ("16-lake.jpg", s_lake, E("nikon", "NIKKOR Z 24-120mm f/4 S", 58, 9.0, 1 / 60, 100, "2024:09:14 06:22:48"), "Still Water", "Lake Bled", "Slovenia", "A windless dawn doubles the range."),
    ("17-salt-flat.jpg", s_salt_flat, E("sony", "FE 24-70mm F2.8 GM II", 70, 8.0, 1 / 1600, 100, "2024:07:04 12:31:20"), "Figure, Salt Flat", "Salar de Uyuni", "Bolivia", "A single figure on the salt crust."),
]

if __name__ == "__main__":
    only = set(sys.argv[2:])
    for name, fn, exif, title, city, country, desc in SCENES:
        if only and name not in only:
            continue
        save(fn(), name, exif, title, city, country, desc)
