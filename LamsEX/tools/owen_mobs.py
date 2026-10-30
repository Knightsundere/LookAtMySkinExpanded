"""Keeps LamsEX in step with the owen_ mods.

Run update-owen-mobs.bat (next to LamsEX.exe) after the mods change. It:
  1. copies the assets/ folder of every enabled owen_*.jar into owen_assets next to LamsEX.exe
     (and adds that folder to config.txt as a resources folder, once);
  2. works out which existing model each owen_ mob texture is drawn with, by reading the
     mod's compiled classes (the renderer a mob extends, or the vanilla mob it marks);
  3. writes those pairings into lamsex-library.txt in the entity library (the EMF export),
     between "owen mods" marker lines. Lines outside the markers are left alone.

When a guess is wrong or missing, add a line to owen-models.txt (next to LamsEX.exe), or ship
assets/<modid>/lamsex.txt inside the mod. Both use the lamsex-library.txt format:
    aquamirae/optifine/cem/eel.jem = owen_creatures:entity/jarlwurm
Lines there win over the automatic guesses.

Usage: owen_mobs.py <LamsEX folder> [minecraft mods folder]
"""

import json
import re
import shutil
import struct
import sys
import zipfile
from pathlib import Path

BEGIN = "# >>> owen mods: written by update-owen-mobs.bat, edits between these lines are replaced"
END = "# <<< owen mods"


# ---- class files --------------------------------------------------------------------------

def _op_len(code, i):
    op = code[i]
    if op in (0x10, 0x12, 0xA9, 0xBC) or 0x15 <= op <= 0x19 or 0x36 <= op <= 0x3A:
        return 2
    if op in (0x11, 0x13, 0x14, 0x84, 0xBB, 0xBD, 0xC0, 0xC1, 0xC6, 0xC7) or 0x99 <= op <= 0xA8 or 0xB2 <= op <= 0xB8:
        return 3
    if op == 0xC5:
        return 4
    if op in (0xB9, 0xBA, 0xC8, 0xC9):
        return 5
    if op == 0xC4:
        return 6 if code[i + 1] == 0x84 else 4
    if op in (0xAA, 0xAB):
        j = (i + 4) & ~3
        if op == 0xAA:
            lo, hi = struct.unpack_from(">ii", code, j + 4)
            return j + 12 + 4 * (hi - lo + 1) - i
        n = struct.unpack_from(">i", code, j + 4)[0]
        return j + 8 + 8 * n - i
    return 1


class ClassFile:
    """Just enough of a .class: names, superclass, and per method the string constants and
    static fields/methods it touches, in order."""

    def __init__(self, data):
        pos = 8
        n = struct.unpack_from(">H", data, pos)[0]; pos += 2
        cp = [None] * n
        i = 1
        while i < n:
            tag = data[pos]; pos += 1
            if tag == 1:
                ln = struct.unpack_from(">H", data, pos)[0]
                cp[i] = data[pos + 2:pos + 2 + ln].decode("utf-8", "replace"); pos += 2 + ln
            elif tag in (7, 8, 16, 19, 20):
                cp[i] = (tag, struct.unpack_from(">H", data, pos)[0]); pos += 2
            elif tag in (9, 10, 11, 12):
                cp[i] = (tag,) + struct.unpack_from(">HH", data, pos); pos += 4
            elif tag in (3, 4, 17, 18):
                cp[i] = (tag,); pos += 4
            elif tag in (5, 6):
                pos += 8; i += 1
            elif tag == 15:
                pos += 3
            else:
                raise ValueError(f"bad constant tag {tag}")
            i += 1
        self.cp = cp
        _, this, sup = struct.unpack_from(">HHH", data, pos); pos += 6
        self.name = self._cls(this)
        self.super = self._cls(sup) if sup else None
        ni = struct.unpack_from(">H", data, pos)[0]; pos += 2 + 2 * ni
        pos = self._skip_members(data, pos)
        self.methods = []  # (name, descriptor, events)
        nm = struct.unpack_from(">H", data, pos)[0]; pos += 2
        for _ in range(nm):
            _, mn, md, na = struct.unpack_from(">HHHH", data, pos); pos += 8
            events = []
            for _ in range(na):
                an, al = struct.unpack_from(">HI", data, pos); pos += 6
                if cp[an] == "Code":
                    clen = struct.unpack_from(">I", data, pos + 4)[0]
                    events = self._events(data[pos + 8:pos + 8 + clen])
                pos += al
            self.methods.append((cp[mn], cp[md], events))

    def _cls(self, i):
        return self.cp[self.cp[i][1]]

    def _member(self, i):
        _, c, nt = self.cp[i]
        _, n, _d = self.cp[nt]
        return self._cls(c), self.cp[n]

    @staticmethod
    def _skip_members(data, pos):
        n = struct.unpack_from(">H", data, pos)[0]; pos += 2
        for _ in range(n):
            na = struct.unpack_from(">H", data, pos + 6)[0]; pos += 8
            for _ in range(na):
                pos += 6 + struct.unpack_from(">I", data, pos + 2)[0]
        return pos

    def _events(self, code):
        out, i = [], 0
        while i < len(code):
            op = code[i]
            if op in (0x12, 0x13):
                idx = code[i + 1] if op == 0x12 else struct.unpack_from(">H", code, i + 1)[0]
                c = self.cp[idx]
                if isinstance(c, tuple) and c[0] == 8:
                    out.append(("ldc", self.cp[c[1]]))
            elif op in (0xB2, 0xB3, 0xB7, 0xB8):
                owner, name = self._member(struct.unpack_from(">H", code, i + 1)[0])
                kind = {0xB2: "get", 0xB3: "put", 0xB7: "init", 0xB8: "call"}[op]
                out.append((kind, owner, name))
            i += _op_len(code, i)
        return out


# ---- working out models ---------------------------------------------------------------------

IDENT = "net/minecraft/class_2960"           # Identifier
LAYERS = "net/minecraft/class_5602"          # EntityModelLayers
ENTITY_TYPE = "net/minecraft/class_1299"     # EntityType
# A renderer's texture getter: takes one object (the mob) and returns an Identifier. Its name
# differs per renderer (method_3931, method_33431, GeckoLib's getTextureLocation, ...).
GET_TEXTURE = re.compile(rf"\(L[^;]+;\)L{IDENT};")

snake = lambda s: re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", s).lower()


def tex_id(ns, path):
    m = re.fullmatch(r"textures/(.+)\.png", path)
    return f"{ns}:{m.group(1)}" if m else None


def identifiers_before(events, end):
    """(namespace, path) of an Identifier built from two strings just before events[end]."""
    for k in range(end - 1, max(-1, end - 10), -1):
        e = events[k]
        if e[0] == "init" and e[1] == IDENT and k >= 2 and events[k - 1][0] == "ldc" and events[k - 2][0] == "ldc":
            return events[k - 2][1], events[k - 1][1]
    return None


def static_identifiers(classes):
    """Static fields set to an Identifier in a class initialiser: (class, field) -> texture id."""
    out = {}
    for c in classes.values():
        for name, _d, ev in c.methods:
            if name != "<clinit>":
                continue
            for k, e in enumerate(ev):
                if e[0] == "put":
                    ident = identifiers_before(ev, k)
                    if ident and tex_id(*ident):
                        out[(e[1], e[2])] = tex_id(*ident)
    return out


def renderer_guesses(classes, names, statics):
    """texture id -> (candidate model names, how) for each renderer class in the mod."""
    out = {}
    for c in classes.values():
        tex = None
        for name, desc, ev in c.methods:
            if name.startswith("<") or not GET_TEXTURE.fullmatch(desc):
                continue
            for k, e in enumerate(ev):
                if e[0] == "get" and (e[1], e[2]) in statics:
                    tex = statics[(e[1], e[2])]
                elif e[0] == "init" and e[1] == IDENT and identifiers_before(ev, k + 1):
                    tex = tex_id(*identifiers_before(ev, k + 1))
                if tex:
                    break
            if tex:
                break
        if not tex:
            continue
        cands, how = [], ""
        for name, _d, ev in c.methods:
            if name == "<init>":
                layer = next((names["layers"].get(e[2]) for e in ev if e[0] == "get" and e[1] == LAYERS), None)
                if layer:
                    cands, how = [("minecraft", layer)], f"model layer {layer.upper()}"
                    break
        if not cands:
            sup = c.super
            while sup in classes:
                sup = classes[sup].super
            simple = sup.split("/")[-1]
            if sup.startswith("net/minecraft/"):
                simple = names["renderers"].get(simple, simple)
                ns = "minecraft"
            else:
                parts = sup.split("/")
                ns = parts[2] if len(parts) > 3 else ""
            base = re.sub(r"(Entity)?Renderer$", "", simple)
            cands, how = [(ns, snake(base))], f"renderer {simple}"
        out[tex] = (cands, f"{c.name.split('/')[-1]} uses {how}")
    return out


def variant_guesses(classes, names, textures):
    """Textures named in code next to the mob they dress (e.g. owen_worms' marked mobs):
    a string matching a texture's file name, followed by an EntityType or preceded by an
    Identifier for a modded mob."""
    by_stem = {}
    for t in textures:
        by_stem.setdefault(t.split("/")[-1], []).append(t)
    out = {}
    for c in classes.values():
        for _n, _d, ev in c.methods:
            for k, e in enumerate(ev):
                if e[0] != "ldc" or len(by_stem.get(e[1], [])) != 1:
                    continue
                tex = by_stem[e[1]][0]
                if tex in out:
                    continue
                typ = next((names["entity_types"].get(x[2]) for x in ev[k + 1:k + 4] if x[0] == "get" and x[1] == ENTITY_TYPE), None)
                if typ:
                    out[tex] = ([("minecraft", typ)], f"spawned as EntityType.{typ.upper()}")
                    continue
                ident = identifiers_before(ev, k)
                if ident and ident[0] not in ("minecraft",) and "/" not in ident[1]:
                    ns, path = ident
                    out[tex] = ([(ns, path), ("minecraft", ns + path), ("minecraft", f"{ns}_{path}")], f"spawned as {ns}:{path}")
    return out


def find_jem(jems, cands):
    for ns, name in cands:
        hit = [j for j in jems if j.rsplit("/", 1)[-1] == name + ".jem"]
        if hit:
            return next((j for j in hit if j.startswith(ns + "/")), hit[0])
    return None


# ---- the run --------------------------------------------------------------------------------

def read_config(lamsex):
    cfg = lamsex / "config.txt"
    lines = cfg.read_text(encoding="utf-8-sig").splitlines() if cfg.exists() else []
    lib = None
    for line in lines:
        m = re.match(r"\s*entity_library\s*=\s*(.+)", line, re.I)
        if m:
            lib = Path(m.group(1).strip().strip('"'))
    return cfg, lines, lib


def mapping_lines(text):
    return [l.strip() for l in text.splitlines() if "=" in l and not l.strip().startswith("#")]


def main():
    lamsex = Path(sys.argv[1]).resolve()
    names = json.loads((Path(__file__).with_name("vanilla-names.json")).read_text())
    cfg, cfg_lines, library = read_config(lamsex)
    if not library or not library.is_dir():
        hint = " It's there but commented out: remove the # in front of it." if any(re.match(r"\s*#\s*entity_library\s*=\s*\S", l) for l in cfg_lines) else ""
        sys.exit(f"config.txt has no entity_library folder (the EMF export) set.{hint}")
    mods = Path(sys.argv[2]) if len(sys.argv) > 2 else next((p / "mods" for p in library.parents if (p / "mods").is_dir()), None)
    if not mods or not mods.is_dir():
        sys.exit("Couldn't find the mods folder; pass it as the second argument.")
    jars = sorted(mods.glob("owen_*.jar"))
    print(f"Mods folder: {mods}\nEntity library: {library}\n")

    out_assets = lamsex / "owen_assets"
    if out_assets.exists():
        shutil.rmtree(out_assets)
    jems = sorted(str(p.relative_to(library)).replace("\\", "/") for p in library.rglob("*.jem"))
    jems = [j[len("assets/"):] if j.startswith("assets/") else j for j in jems]

    manual, auto, report = [], [], []
    overrides = lamsex / "owen-models.txt"
    if overrides.exists():
        manual += mapping_lines(overrides.read_text(encoding="utf-8-sig"))
    for jar in jars:
        with zipfile.ZipFile(jar) as z:
            members = [n for n in z.namelist() if n.startswith("assets/") and not n.endswith("/")]
            for n in members:
                dest = out_assets / n
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(z.read(n))
            textures = sorted(t for n in members if (m := re.fullmatch(r"assets/([^/]+)/(textures/entity/.+\.png)", n)) and (t := tex_id(m.group(1), m.group(2))))
            for n in members:
                if re.fullmatch(r"assets/[^/]+/lamsex\.txt", n):
                    manual += mapping_lines(z.read(n).decode("utf-8-sig"))
            classes = {}
            for n in z.namelist():
                if n.endswith(".class"):
                    try:
                        c = ClassFile(z.read(n))
                        classes[c.name] = c
                    except Exception as e:  # noqa: BLE001 - odd class, skip it
                        report.append(f"  (couldn't read {n}: {e})")
        guesses = variant_guesses(classes, names, textures)
        guesses.update(renderer_guesses(classes, names, static_identifiers(classes)))
        covered = {i.strip() for l in manual for i in l.split("=", 1)[1].split(",")}
        report.append(f"{jar.name}: {len(textures)} mob textures")
        for t in textures:
            if t in covered:
                report.append(f"  {t}: set by hand")
                continue
            cands, how = guesses.get(t, ([], ""))
            jem = find_jem(jems, cands)
            if jem:
                auto.append(f"{jem} = {t}")
                report.append(f"  {t} -> {jem}   ({how})")
            elif cands:
                report.append(f"  {t}: NOT FOUND, {how} but no {cands[0][1]}.jem in the export")
            else:
                report.append(f"  {t}: NOT FOUND, no renderer found for it (add a line to owen-models.txt)")

    block = [BEGIN, *manual, *auto, END]
    lib_map = library / "lamsex-library.txt"
    old = lib_map.read_text(encoding="utf-8-sig").splitlines() if lib_map.exists() else []
    if BEGIN in old and END in old:
        old = old[:old.index(BEGIN)] + old[old.index(END) + 1:]
    lib_map.write_text("\n".join([*old, *block]) + "\n", encoding="utf-8")

    res_line = f"resources = {out_assets}"
    if not any(l.strip().lower() == res_line.lower() for l in cfg_lines):
        cfg.write_text("\n".join([*cfg_lines, "", "# owen_ mod assets, kept up to date by update-owen-mobs.bat", res_line]) + "\n", encoding="utf-8")
        report.append(f"\nAdded to config.txt: {res_line}")

    text = "\n".join(report) + f"\n\nWrote {len(manual) + len(auto)} pairings to {lib_map}\n"
    (lamsex / "owen-mobs-report.txt").write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
