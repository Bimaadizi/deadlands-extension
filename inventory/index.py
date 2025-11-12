import os
import json

# Path to your target directory
directory = r"H:\Assets\Deadlands HTML\Extension\inventory"

# Path to the output JSON file
output_file = os.path.join(directory, "index2.json")

# Collect all filenames in the directory (no subfolders)
filenames = [
    f for f in os.listdir(directory)
    if os.path.isfile(os.path.join(directory, f))
]

# Optional: sort alphabetically for consistency
filenames.sort()

# Write them to index2.json formatted exactly as your sample
with open(output_file, "w", encoding="utf-8") as f:
    json.dump(filenames, f, indent=2, ensure_ascii=False)
    f.write("\n")  # ensure newline at the end like your example

print(f"Saved {len(filenames)} filenames to {output_file}")
