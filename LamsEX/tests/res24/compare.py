# Compares each <name>_16.png render with <name>_24.png; exits 1 if any pair differs.
import sys, glob, os
from PIL import Image, ImageChops
d = sys.argv[1]
bad = 0
for f in sorted(glob.glob(d + "/*_16.png")):
    g = f.replace("_16.png", "_24.png")
    a, b = Image.open(f).convert("RGB"), Image.open(g).convert("RGB")
    diff = ImageChops.difference(a, b).convert("L")
    px = list(diff.get_flattened_data())
    big = sum(1 for p in px if p > 40)
    bg = sum(1 for p in a.convert("L").get_flattened_data() if p < 250)
    print(f"{os.path.basename(f)[:-7]:12s} differing px {big:6d} / non-white px {bg:6d}  ({100*big/max(bg,1):.2f}%)")
    bad += big > 0
sys.exit(1 if bad else 0)
