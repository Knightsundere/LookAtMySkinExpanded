# Generates matching 16x and 24x fixture packs. Every 16x texture is built from 2x2 blocks,
# so its 24x twin (3x3 blocks) is the exact same picture at 1.5x and renders must match.
import json, random, base64, io, os, sys
from PIL import Image
OUT = sys.argv[1]
rnd = random.Random(7)

def blocks16(w, h, alpha=lambda bx, by: 255):
    cols = {}
    for by in range(h // 2):
        for bx in range(w // 2):
            cols[bx, by] = (rnd.randrange(30, 250), rnd.randrange(30, 250), rnd.randrange(30, 250), alpha(bx, by))
    return w, h, cols

def render(spec, scale):
    w, h, cols = spec
    k = 2 if scale == 2 else 3  # block size in pixels: 2 at 16x, 3 at 24x
    im = Image.new("RGBA", (w // 2 * k, h // 2 * k))
    px = im.load()
    for (bx, by), c in cols.items():
        for y in range(k):
            for x in range(k):
                px[bx * k + x, by * k + y] = c
    return im

def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if isinstance(data, Image.Image): data.save(path)
    elif isinstance(data, str): open(path, "w").write(data)
    else: open(path, "w").write(json.dumps(data, indent=1))

def b64(im):
    b = io.BytesIO(); im.save(b, "PNG"); return "data:image/png;base64," + base64.b64encode(b.getvalue()).decode()

T = {}
T["block"] = blocks16(16, 16)
T["item"] = blocks16(16, 16, lambda bx, by: 255 if (bx - 3.5) ** 2 + (by - 3.5) ** 2 < 10 and (bx, by) != (4, 3) else 0)
T["anim"] = blocks16(16, 64)
T["mob"] = blocks16(64, 64, lambda bx, by: 0 if by >= 16 and rnd.random() < 0.3 else 255)
T["mob32"] = blocks16(64, 32)
T["bb"] = blocks16(64, 64)
def skin_alpha(slim):
    def a(bx, by):
        x, y = bx * 2, by * 2
        if slim and x in (54,) and 20 <= y < 32: return 0  # unused right-arm strip
        if slim and x == 46 and 52 <= y < 64: return 0
        if y < 16 and x >= 32: return 255 if rnd.random() < 0.5 else 0   # hat layer, partial
        if y >= 32 and y < 48: return 255 if rnd.random() < 0.4 else 0   # outer body/arms/legs
        if y >= 48 and (x < 16 or x >= 48): return 255 if rnd.random() < 0.4 else 0
        return 255
    return a
T["skin_wide"] = blocks16(64, 64, skin_alpha(False))
T["skin_slim"] = blocks16(64, 64, skin_alpha(True))
T["skin_legacy"] = blocks16(64, 32, lambda bx, by: 255 if not (bx * 2 >= 32 and by * 2 < 16) or rnd.random() < 0.5 else 0)

block_model = {"textures": {"all": "test:block/fx_cube", "particle": "test:block/fx_cube"}, "elements": [
    {"from": [0, 0, 0], "to": [16, 16, 16], "faces": {d: {"texture": "#all"} for d in ["down", "up", "north", "south", "west", "east"]}},
    {"from": [3, 16, 5], "to": [11, 21, 9], "rotation": {"origin": [8, 8, 8], "axis": "y", "angle": 22.5},
     "faces": {d: {"texture": "#all", "uv": [1, 3, 9, 8], "rotation": 90 if d == "up" else 0} for d in ["down", "up", "north", "south", "west", "east"]}}],
    "display": {"gui": {"rotation": [30, 225, 0]}}}
anim_model = {"textures": {"all": "test:block/fx_anim"}, "elements": [
    {"from": [0, 0, 0], "to": [16, 16, 16], "faces": {d: {"texture": "#all"} for d in ["down", "up", "north", "south", "west", "east"]}}],
    "display": {"gui": {"rotation": [30, 225, 0]}}}
item_model = {"parent": "builtin/generated", "textures": {"layer0": "test:item/fx_item"}}

def geo(tw, th):
    return {"format_version": "1.12.0", "minecraft:geometry": [{"description": {"identifier": "geometry.fx", "texture_width": tw, "texture_height": th},
      "bones": [
        {"name": "body", "pivot": [0, 12, 0], "cubes": [{"origin": [-4, 6, -3], "size": [8, 7, 5], "uv": [0, 0]}]},
        {"name": "head", "parent": "body", "pivot": [0, 13, -3], "cubes": [{"origin": [-3, 12, -8], "size": [6, 5, 5], "uv": [26, 0]},
            {"origin": [-1, 13, -9], "size": [3, 1, 1], "uv": {"north": {"uv": [5, 17], "uv_size": [3, 1]}, "up": {"uv": [9, 19], "uv_size": [3, -1]},
                "east": {"uv": [1, 21], "uv_size": [1, 1]}, "west": {"uv": [3, 21], "uv_size": [1, 1]}, "south": {"uv": [7, 23], "uv_size": [3, 1]}, "down": {"uv": [11, 25], "uv_size": [3, 1]}}}]},
        {"name": "leg0", "parent": "body", "pivot": [-2, 6, 0], "cubes": [{"origin": [-3, 0, -1], "size": [3, 6, 3], "uv": [0, 13] if th == 64 else [44, 0], "inflate": 0.25}]},
        {"name": "leg1", "parent": "body", "pivot": [2, 6, 0], "cubes": [{"origin": [1, 0, -1], "size": [3, 6, 3], "uv": [0, 13] if th == 64 else [44, 0], "mirror": True}]}]}]}

bb_elements = [
    {"uuid": "a", "name": "body", "from": [-4, 0, -2], "to": [4, 9, 3], "origin": [0, 0, 0], "box_uv": True, "uv_offset": [0, 0], "faces": {d: {"texture": 0} for d in ["north", "east", "south", "west", "up", "down"]}},
    {"uuid": "b", "name": "ear", "from": [1, 9, -1], "to": [4, 13, 0], "origin": [2, 9, 0], "rotation": [0, 0, -20], "box_uv": False,
     "faces": {"north": {"uv": [33, 3, 36, 7], "texture": 0}, "south": {"uv": [37, 3, 40, 7], "texture": 0}, "east": {"uv": [41, 3, 42, 7], "texture": 0},
               "west": {"uv": [43, 3, 44, 7], "texture": 0}, "up": {"uv": [45, 3, 48, 4], "texture": 0}, "down": {"uv": [49, 3, 52, 4], "texture": 0}}},
]

for scale, name in ((2, "pack16"), (3, "pack24")):
    R = lambda key: render(T[key], scale)
    root = os.path.join(OUT, name)
    a = os.path.join(root, "assets", "test")
    write(os.path.join(a, "models/block/fx_cube.json"), block_model)
    write(os.path.join(a, "textures/block/fx_cube.png"), R("block"))
    write(os.path.join(a, "models/block/fx_anim.json"), anim_model)
    write(os.path.join(a, "textures/block/fx_anim.png"), R("anim"))
    write(os.path.join(a, "textures/block/fx_anim.png.mcmeta"), {"animation": {"frametime": 60}})
    write(os.path.join(a, "models/item/fx_item.json"), item_model)
    write(os.path.join(a, "textures/item/fx_item.png"), R("item"))
    write(os.path.join(a, "geo/fx_mob.geo.json"), geo(64, 64))
    write(os.path.join(a, "textures/entity/fx_mob.png"), R("mob"))
    write(os.path.join(a, "geo/fx_mob32.geo.json"), geo(64, 32))
    write(os.path.join(a, "textures/entity/fx_mob32.png"), R("mob32"))
    bb = R("bb")
    write(os.path.join(a, "models/entity/fx_bb.bbmodel"), {"meta": {"format_version": "4.10", "model_format": "free", "box_uv": True},
        "resolution": {"width": 64, "height": 64}, "elements": bb_elements, "outliner": [{"name": "root", "origin": [0, 0, 0], "children": ["a", "b"]}],
        "textures": [{"name": "fx_bb.png", "id": "0", "uv_width": 64, "uv_height": 64, "width": bb.width, "height": bb.height, "source": b64(bb)}]})
    for s in ("skin_wide", "skin_slim", "skin_legacy"):
        write(os.path.join(OUT, "skins" + name[4:], s + ".png"), R(s))
print("ok")
