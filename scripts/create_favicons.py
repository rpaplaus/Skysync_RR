import os
from pathlib import Path
from PIL import Image

src_path = Path(r"C:\Users\rpapl\.gemini\antigravity-ide\brain\f1822c7c-dcf6-47c0-8f51-4c241661a5d0\.user_uploaded\media_1793137478235.jpg")
frontend_dir = Path(r"c:\Users\rpapl\.gemini\antigravity-ide\scratch\Skysync_RR\frontend")
assets_dir = frontend_dir / "assets"
assets_dir.mkdir(parents=True, exist_ok=True)

print(f"Source exists: {src_path.exists()}")
img = Image.open(src_path)
print(f"Original image: format={img.format}, size={img.size}, mode={img.mode}")

corners = [img.getpixel((0, 0)), img.getpixel((img.width - 1, 0)), img.getpixel((0, img.height - 1)), img.getpixel((img.width - 1, img.height - 1))]
print("Corner pixels:", corners)

# Pad to square using the background color (or transparent if dark theme)
# The image has a dark cyberpunk background around the heart
bg_color = (11, 8, 28, 255) # or sample from corner
if isinstance(corners[0], tuple) and len(corners[0]) >= 3:
    bg_color = (corners[0][0], corners[0][1], corners[0][2], 255)

max_dim = max(img.width, img.height)
square_img = Image.new("RGBA", (max_dim, max_dim), bg_color)
offset = ((max_dim - img.width) // 2, (max_dim - img.height) // 2)
square_img.paste(img.convert("RGBA"), offset)
print(f"Pasted on square canvas: size={square_img.size}, offset={offset}")

img_rgba = square_img

# 1. Save standard high-res PNG in assets
img_rgba.save(assets_dir / "favicon.png", format="PNG", optimize=True)

# 2. Save sizes: 16x16, 32x32, 48x48, 180x180 (apple-touch-icon), 192x192, 512x512
sizes = {
    "favicon-16x16.png": (16, 16),
    "favicon-32x32.png": (32, 32),
    "apple-touch-icon.png": (180, 180),
    "icon-192.png": (192, 192),
    "icon-512.png": (512, 512),
}

for filename, size in sizes.items():
    resized = img_rgba.resize(size, Image.Resampling.LANCZOS)
    resized.save(assets_dir / filename, format="PNG", optimize=True)
    print(f"Saved {filename} with size {size}")

# 3. Save favicon.ico (multi-size: 16, 32, 48)
ico_sizes = [(16, 16), (32, 32), (48, 48)]
img_rgba.save(assets_dir / "favicon.ico", format="ICO", sizes=ico_sizes)
img_rgba.save(frontend_dir / "favicon.ico", format="ICO", sizes=ico_sizes)
print("Saved favicon.ico in assets/ and frontend root")
