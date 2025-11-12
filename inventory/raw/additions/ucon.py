import os

# Path to the directory
directory = r"H:\Assets\Deadlands HTML\Extension\inventory\raw\additions"

# Loop through all files in the directory
for filename in os.listdir(directory):
    # Check for .webp files that contain '_icon'
    if filename.endswith(".webp") and "_icon" in filename:
        old_path = os.path.join(directory, filename)
        new_filename = filename.replace("_icon", "")
        new_path = os.path.join(directory, new_filename)
        
        # Rename the file
        os.rename(old_path, new_path)
        print(f"Renamed: {filename} -> {new_filename}")

print("Done!")
