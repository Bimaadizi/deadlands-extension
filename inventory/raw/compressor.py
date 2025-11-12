import os
import io
from typing import Tuple, Optional

import numpy as np
from PIL import Image, ImageOps

# === Paths (edit if needed) ===
INPUT_DIR = r"H:\Assets\Deadlands HTML\Extension\inventory\raw\additions"
OUT_256 = r"H:\Assets\Deadlands HTML\Extension\inventory\raw\256"
OUT_128 = r"H:\Assets\Deadlands HTML\Extension\inventory\raw\128"

# === Settings ===
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
PSNR_TARGET_256 = 38.0
PSNR_TARGET_128 = 37.0
WEBP_METHOD = 6
WEBP_ALPHA_QUALITY = 80
QUALITY_MIN = 30
QUALITY_MAX = 90
try:
    RESAMPLE = Image.Resampling.LANCZOS
except Exception:
    RESAMPLE = Image.LANCZOS


def ensure_dirs():
    os.makedirs(OUT_256, exist_ok=True)
    os.makedirs(OUT_128, exist_ok=True)


def psnr(rgb_a: Image.Image, rgb_b: Image.Image) -> float:
    a = np.asarray(rgb_a, dtype=np.float32)
    b = np.asarray(rgb_b, dtype=np.float32)
    mse = np.mean((a - b) ** 2)
    if mse == 0:
        return float("inf")
    return 20 * np.log10(255.0) - 10 * np.log10(mse)


def crop_transparent(im: Image.Image) -> Image.Image:
    im = ImageOps.exif_transpose(im)
    rgba = im.convert("RGBA")
    alpha = rgba.split()[-1]
    bbox = alpha.getbbox()
    if bbox:
        rgba = rgba.crop(bbox)
    return rgba


def fit_on_square_rgba(im_rgba: Image.Image, size: int) -> Image.Image:
    im = im_rgba.copy()
    im.thumbnail((size, size), RESAMPLE)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    x = (size - im.width) // 2
    y = (size - im.height) // 2
    canvas.paste(im, (x, y))
    return canvas


def encode_webp_smart(
    rgba_image: Image.Image, psnr_target: float
) -> Tuple[bytes, int, Optional[float]]:
    rgb_ref = rgba_image.convert("RGB")

    best_bytes: Optional[bytes] = None
    best_q: Optional[int] = None
    best_psnr: Optional[float] = None

    lo, hi = QUALITY_MIN, QUALITY_MAX
    for _ in range(8):
        if lo > hi:
            break
        q = (lo + hi) // 2
        buf = io.BytesIO()
        rgba_image.save(
            buf,
            format="WEBP",
            quality=q,
            method=WEBP_METHOD,
            lossless=False,
            alpha_quality=WEBP_ALPHA_QUALITY,
        )
        data = buf.getvalue()
        decoded = Image.open(io.BytesIO(data)).convert("RGB")
        p = psnr(rgb_ref, decoded)

        if p >= psnr_target:
            best_bytes, best_q, best_psnr = data, q, p
            hi = q - 1
        else:
            lo = q + 1

    if best_bytes is None:
        q = 80
        buf = io.BytesIO()
        rgba_image.save(
            buf,
            format="WEBP",
            quality=q,
            method=WEBP_METHOD,
            lossless=False,
            alpha_quality=WEBP_ALPHA_QUALITY,
        )
        best_bytes, best_q, best_psnr = buf.getvalue(), q, None

    return best_bytes, int(best_q), best_psnr


def unique_path(base_dir: str, base_name: str) -> str:
    """Generate a unique path like Windows: file.webp, file (2).webp, file (3).webp, ..."""
    name, ext = os.path.splitext(base_name)
    candidate = os.path.join(base_dir, base_name)
    counter = 2
    while os.path.exists(candidate):
        candidate = os.path.join(base_dir, f"{name} ({counter}){ext}")
        counter += 1
    return candidate


def process_one(src_path: str):
    base = os.path.splitext(os.path.basename(src_path))[0]
    out256 = unique_path(OUT_256, base + ".webp")
    out128 = unique_path(OUT_128, base + ".webp")

    try:
        with Image.open(src_path) as im:
            cropped = crop_transparent(im)

            # --- 256x256 ---
            im256 = fit_on_square_rgba(cropped, 256)
            bytes256, q256, p256 = encode_webp_smart(im256, PSNR_TARGET_256)
            with open(out256, "wb") as f:
                f.write(bytes256)

            # --- 128x128 ---
            im128 = fit_on_square_rgba(cropped, 128)
            bytes128, q128, p128 = encode_webp_smart(im128, PSNR_TARGET_128)
            with open(out128, "wb") as f:
                f.write(bytes128)

            print(
                f"[OK] {os.path.basename(src_path)} → "
                f"{os.path.basename(out256)} ({q256}), "
                f"{os.path.basename(out128)} ({q128})"
            )
    except Exception as e:
        print(f"[ERR] {os.path.basename(src_path)}: {e}")


def main():
    ensure_dirs()
    files = [
        f
        for f in os.listdir(INPUT_DIR)
        if os.path.isfile(os.path.join(INPUT_DIR, f))
        and os.path.splitext(f)[1].lower() in IMAGE_EXTS
    ]
    if not files:
        print("No images found.")
        return

    print(f"Found {len(files)} images. Processing...")
    for fname in files:
        process_one(os.path.join(INPUT_DIR, fname))
    print("Done.")


if __name__ == "__main__":
    main()
