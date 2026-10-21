"""Rasterize the canonical Uno Word SVG into Chrome's required PNG sizes.

Developer dependency: pip install cairosvg
"""
from pathlib import Path
import cairosvg

root = Path(__file__).parent
for size in (16, 32, 48, 128):
    target = root / f"icon{size}.png"
    cairosvg.svg2png(url=str(root / "unoword.svg"), write_to=str(target),
                    output_width=size, output_height=size)
    print("wrote", target)
