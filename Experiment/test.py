import os
from PIL import Image, ImageDraw, ImageFont

# ---- paths ----
base_dir = r"H:\Assets\Deadlands HTML\Extension\Experiment"
map_path = os.path.join(base_dir, "map.jpeg")
out_path = os.path.join(base_dir, "map_test_overlay.jpeg")

# ---- load map ----
im = Image.open(map_path)
W, H = im.size  # should be 1987 x 1662

# ---- sample points ----
points = {
    "Nephi": (668, 1060),
    "Cairo": (1940, 881),
    "Boise": (564, 1318),
    "El Paso": (992, 487),
    "Chicago": (1946, 1141),
    "Seattle": (305, 1627),
    "San Antonio": (1464, 213),
    "The City of Lost Angels": (358, 711)
}

draw = ImageDraw.Draw(im)
try:
    font = ImageFont.truetype("arial.ttf", 14)
except:
    font = ImageFont.load_default()

for name, (x, y) in points.items():
    # Flip Y coordinate to match WA’s coordinate system
    y = H - y
    r = 5
    draw.ellipse((x - r, y - r, x + r, y + r), fill="red", outline="black")
    draw.text((x + 8, y - 8), name, fill="white", font=font, stroke_width=1, stroke_fill="black")

im.convert("RGB").save(out_path, quality=95)
print(f"Saved corrected overlay to {out_path}")
