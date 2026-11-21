#!/usr/bin/env python3
"""Validate content/cards/<theme>.json (contract section 3) + files under frontend/public/cards/<deck>/**.
Usage: python3 -I tools/validate_cards.py [theme ...]   (default: camino). Exit code 1 on error."""
import json, os, re, struct, sys, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RARITIES = ["common", "uncommon", "rare", "holo", "ultra", "secret"]
FOILS = {"none", "linear", "cosmos", "rainbow", "reverse"}
MAX_FULL, MAX_THUMB = 62 * 1024, 19 * 1024
PACK_MB = {"camino": 15}
errors, warns = [], []
err = lambda m: errors.append(m)


def webp_size(path):
    with open(path, "rb") as f:
        h = f.read(40)
    if h[:4] != b"RIFF" or h[8:12] != b"WEBP":
        return None
    t = h[12:16]
    if t == b"VP8 ":
        w, hh = struct.unpack("<HH", h[26:30]); return w & 0x3FFF, hh & 0x3FFF
    if t == b"VP8L":
        b = struct.unpack("<I", h[21:25])[0]; return (b & 0x3FFF) + 1, ((b >> 14) & 0x3FFF) + 1
    if t == b"VP8X":
        return (int.from_bytes(h[24:27], "little") + 1, int.from_bytes(h[27:30], "little") + 1)
    return None


# Asset folder of each theme's deck (a deck can be published under another name).
DECKS = {"camino": "embers-peaks"}


def check(theme):
    deck = DECKS.get(theme, theme)
    cat_path = os.path.join(ROOT, "content", "cards", theme + ".json")
    base = os.path.join(ROOT, "frontend", "public")
    n0 = len(errors)
    if not os.path.exists(cat_path):
        err(f"{theme}: catalog missing"); return
    cat = json.load(open(cat_path, encoding="utf-8"))
    if cat.get("theme") != theme: err(f"{theme}: theme field = {cat.get('theme')!r}")
    pk = cat.get("pack", {})
    if pk.get("cards_per_pack") != 5 or len(pk.get("slots", [])) != 5: err(f"{theme}: pack.cards_per_pack/slots != 5")
    for s in pk.get("slots", []):
        if not s.get("label") or not set(s.get("odds", {})) <= set(RARITIES) or sum(s["odds"].values()) <= 0: err(f"{theme}: invalid slot {s}")
    if pk.get("pity") != {"rare_every": 5, "ultra_every": 25}: err(f"{theme}: pity != 5/25 : {pk.get('pity')}")
    sets = {s["id"]: s for s in cat.get("sets", [])}
    if len(sets) != len(cat.get("sets", [])): err(f"{theme}: duplicate set ids")
    ids, files, per_set = set(), set(), collections.Counter()
    rar = collections.Counter(); size_full = size_thumb = 0; big = []
    for c in cat.get("cards", []):
        cid = c.get("id", "?")
        for k in ("id", "theme", "set", "number", "name", "rarity", "foil", "image", "thumb"):
            if k not in c: err(f"{cid}: missing field {k}")
        if cid in ids: err(f"{cid}: duplicate id")
        ids.add(cid)
        m = re.fullmatch(rf"{theme}:([a-z0-9]+):([a-z0-9]+)", cid)
        if not m: err(f"{cid}: bad id format"); continue
        if m.group(1) != c.get("set") or c.get("theme") != theme: err(f"{cid}: inconsistent set/theme")
        if c.get("set") not in sets: err(f"{cid}: unknown set"); continue
        per_set[c["set"]] += 1
        if c.get("rarity") not in RARITIES: err(f"{cid}: rarity {c.get('rarity')!r}")
        if c.get("foil") not in FOILS: err(f"{cid}: foil {c.get('foil')!r}")
        if c.get("rarity") == "common" and c.get("foil") != "none": err(f"{cid}: common with foil")
        if c.get("rarity") in ("holo", "ultra", "secret") and c.get("foil") == "none": err(f"{cid}: {c['rarity']} without foil")
        rar[c.get("rarity")] += 1
        r = c.get("art_rect")
        if r is not None and not (len(r) == 4 and all(isinstance(v, (int, float)) for v in r) and r[0] >= 0 and r[1] >= 0 and r[2] > 0.2 and r[3] > 0.2 and r[0] + r[2] <= 1 and r[1] + r[3] <= 1):
            err(f"{cid}: invalid art_rect {r}")
        if not c.get("name", "").strip(): err(f"{cid}: empty name")
        for key, mx, dims in (("image", MAX_FULL, (480, 672)), ("thumb", MAX_THUMB, (240, 336))):
            p = c.get(key, "")
            if not p.startswith(f"/cards/{deck}/{c['set']}/") or not p.endswith(".webp"): err(f"{cid}: bad {key} path {p}"); continue
            fp = os.path.join(base, p.lstrip("/")); files.add(os.path.normpath(fp))
            if not os.path.exists(fp): err(f"{cid}: missing file {p}"); continue
            sz = os.path.getsize(fp)
            if key == "image": size_full += sz
            else: size_thumb += sz
            if sz > mx: big.append((p, sz))
            d = webp_size(fp)
            if d is None: err(f"{cid}: {p} is not a readable WebP")
            elif d != dims: err(f"{cid}: {p} dimensions {d} != {dims}")
    for sid, s in sets.items():
        if s.get("card_count") != per_set[sid]: err(f"set {sid}: card_count {s.get('card_count')} != {per_set[sid]}")
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", s.get("accent", "")): err(f"set {sid}: invalid accent")
        if s.get("cover"):
            fp = os.path.join(base, s["cover"].lstrip("/")); files.add(os.path.normpath(fp))
            if not os.path.exists(fp): err(f"set {sid}: missing pack image {s['cover']}")
            elif webp_size(fp) != (360, 640): err(f"set {sid}: pack dimensions {webp_size(fp)}")
        if per_set[sid] == 0: err(f"set {sid}: empty")
    # orphan files on disk
    root = os.path.join(base, "cards", deck); on_disk = set()
    for dp, _, fn in os.walk(root):
        for f in fn:
            if not f.startswith("."): on_disk.add(os.path.normpath(os.path.join(dp, f)))
    for o in sorted(on_disk - files)[:20]: err(f"{theme}: orphan file {os.path.relpath(o, base)}")
    for p, sz in big: err(f"{p}: {sz} bytes (too heavy)")
    # ratios
    n = sum(rar.values()) or 1
    pct = {k: 100 * rar[k] / n for k in RARITIES}
    for k in RARITIES:
        if rar[k] == 0: err(f"{theme}: no {k} card (the draw would fail)")
    if not (pct["common"] >= pct["rare"] and pct["uncommon"] >= pct["holo"]): err(f"{theme}: inconsistent rarity pyramid {pct}")
    if pct["secret"] > 2 or pct["ultra"] > 5 or pct["holo"] > 10: err(f"{theme}: too many rare cards {pct}")
    tot = sum(os.path.getsize(f) for f in on_disk) / 1e6
    if tot > PACK_MB.get(theme, 110): err(f"{theme}: size {tot:.1f} MB > {PACK_MB.get(theme, 110)} MB")
    print(f"[{theme}] {n} cards, {len(sets)} sets, {tot:.1f} MB on disk "
          f"(full {size_full/1e6:.1f} MB, thumbnails {size_thumb/1e6:.1f} MB)")
    print("   rarity:", ", ".join(f"{k} {rar[k]} ({pct[k]:.1f} %)" for k in RARITIES))
    print("   sets:", ", ".join(f"{k}={v}" for k, v in per_set.items()))
    print("   OK" if len(errors) == n0 else f"   {len(errors) - n0} error(s)")


for t in sys.argv[1:] or ["camino"]:
    check(t)
for e in errors[:60]: print("ERROR", e)
print("\nResult:", "FAILED" if errors else "OK")
sys.exit(1 if errors else 0)
