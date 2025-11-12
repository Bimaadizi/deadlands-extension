import os
from PIL import Image

# Path to your image folder
folder = r"H:\Assets\Deadlands HTML\Extension\inventory\raw\256"

# Iterate through all files in the folder (no subfolders)
for filename in os.listdir(folder):
    file_path = os.path.join(folder, filename)

    # Process only image files
    if not os.path.isfile(file_path):
        continue
    if not filename.lower().endswith(('.png', '.webp', '.jpg', '.jpeg', '.tga')):
        continue

    try:
        with Image.open(file_path) as img:
            img = img.convert("RGBA")

            # Get bounding box of non-transparent pixels
            bbox = img.getbbox()
            if bbox:
                cropped = img.crop(bbox)
                cropped.save(file_path)
                print(f"Trimmed: {filename}")
            else:
                print(f"Skipped empty image: {filename}")

    except Exception as e:
        print(f"Error processing {filename}: {e}")

print("Done! All images trimmed.")
