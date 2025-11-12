from PIL import Image
import os

# Paths
src_path = r"H:\Assets\Deadlands HTML\Extension\cardassets\balatro\source.png"
base_path = r"H:\Assets\Deadlands HTML\Extension\cardassets\balatro\base.png"
out_dir = r"H:\Assets\Deadlands HTML\Extension\cardassets\balatro"

# Make sure output directory exists
os.makedirs(out_dir, exist_ok=True)

# Load images
src = Image.open(src_path).convert("RGBA")
base = Image.open(base_path).convert("RGBA")

# Grid setup
cols, rows = 13, 4
section_w = src.width // cols
section_h = src.height // rows

# Card naming
ranks = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"]
suits = ["H", "C", "D", "S"]

# Resize base down to match one card size
base_resized = base.resize((section_w, section_h), Image.LANCZOS)

# Loop through rows & cols
for row in range(rows):
    for col in range(cols):
        # Crop one card from source
        left = col * section_w
        top = row * section_h
        right = left + section_w
        bottom = top + section_h
        card_img = src.crop((left, top, right, bottom))

        # Overlay card on top of resized base
        composite = base_resized.copy()
        composite.paste(card_img, (0, 0), card_img)

        # Card name
        card_name = f"{suits[row]}{ranks[col]}"

        # Save
        out_path = os.path.join(out_dir, f"{card_name}.png")
        composite.save(out_path, "PNG")

        print(f"Saved {out_path}")
