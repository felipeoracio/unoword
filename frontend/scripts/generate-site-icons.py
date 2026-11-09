"""Export the existing UnoWord logo for browsers/Home Screen. Requires cairosvg, Pillow."""
from io import BytesIO
from pathlib import Path
import cairosvg
from PIL import Image

PUBLIC = Path(__file__).resolve().parents[1] / "public"
logo = (PUBLIC / "brand/unoword.svg").read_bytes()
(PUBLIC / "favicon.svg").write_bytes(logo)
for filename, size in [
    ("favicon-16x16.png", 16),
    ("favicon-32x32.png", 32),
    ("apple-touch-icon.png", 180),
    ("app-icon-192.png", 192),
    ("app-icon-512.png", 512),
]:
    # Opaque background supports iOS masking without black transparent corners.
    png = cairosvg.svg2png(bytestring=logo, output_width=size, output_height=size, background_color="#0757ff")
    with Image.open(BytesIO(png)) as icon:
        icon.convert("RGB").save(PUBLIC / filename)
png = cairosvg.svg2png(bytestring=logo, output_width=256, output_height=256, background_color="#0757ff")
with Image.open(BytesIO(png)) as icon:
    icon.save(PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (256, 256)])
