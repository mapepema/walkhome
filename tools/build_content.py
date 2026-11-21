#!/usr/bin/env python3
"""Generate the journey content pack.

One source of structure -> one pack. The default journey is the Camino
Francés, the best-known route of the Way of St James: from Saint-Jean-Pied-de-
Port, at the foot of the French Pyrenees, to Santiago de Compostela in Galicia,
about 780 km across northern Spain.

Everything here is real geography. Distances are in kilometres from
Saint-Jean-Pied-de-Port and follow common guidebook figures; they vary by a
few kilometres with the variant you take, so events are placed where a
walker would meet them, not to the metre. The prose is original.

The pack keeps the schema the app expects (``*_mi`` and ``*_m`` fields): the
kilometre values below are converted on build.

    python tools/build_content.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "content"

KM_TO_MI = 1 / 1.609344
TOTAL_KM = 780

PACK = {
    "id": "camino",
    "lang": "en",
    "name": "The Camino Francés",
    "subtitle": "Saint-Jean-Pied-de-Port to Santiago de Compostela, 780 km",
}

# --------------------------------------------------------------------------
# Stages (km)
# --------------------------------------------------------------------------

STAGES = [
    {"id": "stage1", "name": "Saint-Jean-Pied-de-Port to Burgos", "start_km": 0, "end_km": 290},
    {"id": "stage2", "name": "Burgos to León, across the Meseta", "start_km": 290, "end_km": 475},
    {"id": "stage3", "name": "León to Sarria", "start_km": 475, "end_km": 665},
    {"id": "stage4", "name": "Sarria to Santiago de Compostela", "start_km": 665, "end_km": 780},
]

# --------------------------------------------------------------------------
# Biomes: the parallax scenery. `terrain` selects a procedural generator in
# the frontend, `palette` colours it. Ranges are contiguous and cover the
# whole journey.
# --------------------------------------------------------------------------


def palette(sky, sun, far, mid, near, ground, accent, fog):
    return {"sky": sky, "sun": sun, "far": far, "mid": mid, "near": near,
            "ground": ground, "accent": accent, "fog": fog}


GREEN_HILLS = palette(["#86c5e8", "#d6ecf7"], "#fff4c4", "#9cc1a0", "#6ea77a",
                      "#4a8656", "#3c6a44", "#f0e08c", "#e2f0f7")
WHEAT = palette(["#8ccbf0", "#e4f2fb"], "#fff1b0", "#d9c48a", "#c9a95e",
                "#b08a44", "#8c6b34", "#f6d77a", "#f3ecd8")
VINES = palette(["#8fc9ec", "#e1f0f9"], "#ffe9a8", "#b9b38a", "#8f9a5a",
                "#6b7c3c", "#7a4f36", "#b5323f", "#efe8dc")
STONE_TOWN = palette(["#9ccbe6", "#e6f1f8"], "#fff0c0", "#c8bba5", "#b09d82",
                     "#8f7b62", "#6e5d49", "#e9c46a", "#ede6da")
HIGH_MOOR = palette(["#9fb8c8", "#dde6ec"], "#f2efe0", "#9aa39a", "#7e8a7c",
                    "#5f6c5e", "#4a5448", "#c9a6c8", "#d9e0e3")
GALICIA = palette(["#9cb4bf", "#d5e0e4"], "#eef0e6", "#7fa38a", "#5d8a6a",
                  "#3f6e4e", "#33553e", "#e8d27a", "#cfdcd9")

BIOMES = [
    {"id": "pyrenees", "name": "the Pyrenees", "terrain": "upland",
     "start_km": 0, "end_km": 25, "weather": "fog", "palette": HIGH_MOOR},
    {"id": "navarra_woods", "name": "the beech woods of Navarra", "terrain": "forest",
     "start_km": 25, "end_km": 60, "weather": "clear", "palette": GREEN_HILLS},
    {"id": "pamplona", "name": "Pamplona", "terrain": "village",
     "start_km": 60, "end_km": 72, "weather": "clear", "palette": STONE_TOWN},
    {"id": "navarra_fields", "name": "the fields of Navarra", "terrain": "farmland",
     "start_km": 72, "end_km": 135, "weather": "wind", "palette": WHEAT},
    {"id": "rioja", "name": "La Rioja", "terrain": "garden",
     "start_km": 135, "end_km": 205, "weather": "clear", "palette": VINES},
    {"id": "burgos_wheat", "name": "the wheat of Burgos", "terrain": "farmland",
     "start_km": 205, "end_km": 245, "weather": "clear", "palette": WHEAT},
    {"id": "montes_de_oca", "name": "the Montes de Oca", "terrain": "forest",
     "start_km": 245, "end_km": 280, "weather": "fog", "palette": GREEN_HILLS},
    {"id": "burgos", "name": "Burgos", "terrain": "village",
     "start_km": 280, "end_km": 295, "weather": "clear", "palette": STONE_TOWN},
    {"id": "meseta", "name": "the Meseta", "terrain": "plains",
     "start_km": 295, "end_km": 415, "weather": "clear", "palette": WHEAT},
    {"id": "tierra_de_campos", "name": "Tierra de Campos", "terrain": "plains",
     "start_km": 415, "end_km": 470, "weather": "wind", "palette": WHEAT},
    {"id": "leon", "name": "León", "terrain": "village",
     "start_km": 470, "end_km": 480, "weather": "clear", "palette": STONE_TOWN},
    {"id": "paramo", "name": "the Páramo", "terrain": "farmland",
     "start_km": 480, "end_km": 520, "weather": "clear", "palette": WHEAT},
    {"id": "astorga", "name": "Astorga", "terrain": "village",
     "start_km": 520, "end_km": 530, "weather": "clear", "palette": STONE_TOWN},
    {"id": "montes_de_leon", "name": "the Montes de León", "terrain": "moor",
     "start_km": 530, "end_km": 565, "weather": "wind", "palette": HIGH_MOOR},
    {"id": "bierzo", "name": "El Bierzo", "terrain": "valley",
     "start_km": 565, "end_km": 605, "weather": "clear", "palette": VINES},
    {"id": "cebreiro", "name": "the climb to O Cebreiro", "terrain": "upland",
     "start_km": 605, "end_km": 635, "weather": "fog", "palette": HIGH_MOOR},
    {"id": "galicia_hills", "name": "the hills of Galicia", "terrain": "deepforest",
     "start_km": 635, "end_km": 665, "weather": "rain", "palette": GALICIA},
    {"id": "galicia", "name": "Galicia", "terrain": "forest",
     "start_km": 665, "end_km": 770, "weather": "fog", "palette": GALICIA},
    {"id": "santiago", "name": "Santiago de Compostela", "terrain": "village",
     "start_km": 770, "end_km": 780, "weather": "rain", "palette": STONE_TOWN},
]

# --------------------------------------------------------------------------
# Events. Kinds: `milestone` (a place worth stopping for), `beat` (a small
# moment on the road), `challenge` (hold a pace or an incline for a while),
# `choice` (a real variant of the route).
# --------------------------------------------------------------------------

E = []


def ev(at_km, kind, title, body, icon="•", **extra):
    e = {"id": f"e{len(E):04d}", "at_km": at_km, "kind": kind,
         "title": title, "body": body, "icon": icon}
    e.update(extra)
    E.append(e)
    return e


def climb(min_incline_pct, duration_s, success, failure, fallback_kmh=5.0, note=None):
    """An incline challenge, with a speed fallback for flat treadmills."""
    c = {"type": "incline_hold", "min_incline_pct": min_incline_pct,
         "duration_s": duration_s,
         "fallback": {"type": "speed_hold", "min_speed_kmh": fallback_kmh,
                      "duration_s": duration_s},
         "success": success, "failure": failure}
    if note:
        c["note"] = note
    return c


def pace(min_speed_kmh, duration_s, success, failure):
    return {"type": "speed_hold", "min_speed_kmh": min_speed_kmh,
            "duration_s": duration_s, "success": success, "failure": failure}


# --- Stage 1: Saint-Jean-Pied-de-Port -> Burgos ---------------------------
ev(0, "milestone", "Saint-Jean-Pied-de-Port",
   ("A stamp in your pilgrim's credential, a scallop shell on your pack, and a "
    "cobbled street running downhill to the Porte d'Espagne. 780 km to "
    "Santiago. The first day is the hardest: it crosses the Pyrenees."), "🐚")
ev(0.5, "choice", "Over the mountain or through the valley?",
   ("Two ways into Spain. The Route Napoléon goes over the top; the Valcarlos "
    "road follows the valley, and it is the one to take when snow closes the "
    "pass."), "🧭",
   choice={"options": [
       {"id": "napoleon", "label": "Route Napoléon",
        "detail": "Higher, harder, wide open views.",
        "outcome": ("You climb into the clouds with the vultures and the "
                    "sheep. On a clear day you can see all the way back to "
                    "the plains of France.")},
       {"id": "valcarlos", "label": "Valcarlos road",
        "detail": "Lower, sheltered, along the river.",
        "outcome": ("Chestnut woods, a river beside you and a village for "
                    "coffee. The climb waits for you at the end, in smaller "
                    "pieces.")},
   ]})
ev(8, "beat", "Orisson",
   "The last refuge before the pass. Water, a bench, and the valley falling away below.", "⛰️")
ev(14, "challenge", "The climb to the pass",
   ("Well over a thousand metres of climbing in a single morning. Lean into it "
    "and keep a steady rhythm."), "🥾",
   challenge=climb(4.0, 300,
                   "The Col de Lepoeder, at about 1,450 metres. Downhill from here, for today.",
                   "You stop more often than you meant to. The mountain does not mind, and neither should you.",
                   note=("No incline? Push the pace instead: the app checks speed "
                         "if your treadmill does not report incline.")))
ev(16, "beat", "Into Spain",
   "A stone marker and a cattle grid: you have crossed the border without noticing.", "🇪🇸")
ev(25, "milestone", "Roncesvalles",
   ("A great stone collegiate church in a fold of the mountain, a pilgrims' "
    "blessing in the evening, and a dormitory full of people who all started "
    "today."), "⛪")
ev(47, "beat", "Zubiri",
   "A medieval bridge over the Arga, and the first blisters being compared on its parapet.", "🌉")
ev(68, "milestone", "Pamplona",
   ("Over the Magdalena bridge and through the Portal de Francia into the "
    "walled city. In July the bulls run these streets; today it is only "
    "walkers."), "🏰")
ev(78, "challenge", "Alto del Perdón",
   ("A long climb to a ridge lined with wind turbines. The wind up there "
    "pushes back."), "💨",
   challenge=climb(3.0, 240,
                   ("On the ridge stands a line of iron pilgrims. Their "
                    "inscription says this is where the way of the wind "
                    "crosses the way of the stars."),
                   "You reach the top slowly, with the wind in your face. You still reach it."))
ev(92, "milestone", "Puente la Reina",
   ("Its Romanesque bridge has carried pilgrims over the Arga for nine "
    "centuries. The route from Aragón has joined yours: one road from now on."), "🌉")
ev(114, "beat", "Estella",
   "A town that grew up around the pilgrim road, full of Romanesque churches.", "🏛️")
ev(117, "milestone", "The wine fountain at Irache",
   ("The winery beside the monastery of Irache has put a tap in its wall: "
    "one side water, the other red wine, free for walkers. Moderation is "
    "advised."), "🍷")
ev(135, "beat", "Los Arcos",
   "A plain square, a lavish church, and a long afternoon in the shade.", "⛪")
ev(163, "milestone", "Logroño",
   ("The capital of La Rioja. In the evening the narrow streets around Calle "
    "Laurel fill with people going from one tapas bar to the next."), "🍢")
ev(178, "beat", "Vineyards",
   "Rows of vines to the horizon, and red earth that stains your boots.", "🍇")
ev(192, "beat", "Nájera",
   "Red cliffs above the river, with caves dug into them.", "🪨")
ev(213, "milestone", "Santo Domingo de la Calzada",
   ("A live hen and rooster are kept inside the cathedral, in memory of a "
    "medieval miracle about a pilgrim wrongly hanged. They are very calm about "
    "it."), "🐓")
ev(236, "beat", "Belorado",
   "Into the province of Burgos. The fields turn from vines to wheat.", "🌾")
ev(250, "challenge", "The Montes de Oca",
   ("Oak and pine forest that pilgrims once feared for its bandits. Today it "
    "is just long and quiet. Keep moving."), "🌲",
   challenge=pace(5.5, 180,
                  "You come out of the trees with the afternoon still ahead of you.",
                  "The forest stretches on. You arrive late, but you arrive."))
ev(260, "beat", "San Juan de Ortega",
   ("A monastery in a clearing, founded by a saint who spent his life making "
    "this road safer, with bridges and a hospice."), "🕍")
ev(266, "milestone", "Atapuerca",
   ("Just off the path, caves where some of the oldest human remains in "
    "Europe were found. Pilgrims are recent visitors here."), "🦴")
ev(290, "milestone", "Burgos",
   ("A Gothic cathedral of white stone, all spires and lace. Stage one of four "
    "is done: 290 km behind you. Take a rest day if you can."), "⛪")

# --- Stage 2: Burgos -> León, across the Meseta ---------------------------
ev(296, "beat", "Onto the Meseta",
   ("The high plateau of Castile: wheat, sky, and a path running straight to "
    "the horizon. Some love it, some dread it."), "🌾")
ev(310, "beat", "Hornillos del Camino",
   "A single street of stone houses, built along the road because of the road.", "🏘️")
ev(321, "beat", "Hontanas",
   "A village hidden in a fold of the plain. You only see the church tower when you are almost there.", "⛪")
ev(327, "milestone", "The arch of San Antón",
   ("The road passes right under the ruined arch of a medieval monastery. "
    "Its monks cared for pilgrims struck by a fever that made them burn."), "🏚️")
ev(330, "beat", "Castrojeriz",
   "A long village wrapped around the foot of a castle hill.", "🏰")
ev(333, "challenge", "Alto de Mostelares",
   "A short, steep climb out of the valley, then the plateau opens again.", "⬆️",
   challenge=climb(5.0, 180,
                   "From the top, the Meseta in every direction, cut by the path you just walked.",
                   "You stop halfway to catch your breath. The view is just as good from there.",
                   fallback_kmh=5.5))
ev(352, "beat", "The Canal de Castilla",
   "An 18th-century canal, with a towpath that walks you into Frómista.", "🚣")
ev(355, "milestone", "Frómista",
   "San Martín, one of the purest Romanesque churches in Spain, stands alone in its square.", "⛪")
ev(374, "beat", "Carrión de los Condes",
   "Last shop for a while: the next stretch has no village for about 17 km.", "🛒")
ev(380, "challenge", "The Roman road",
   ("Seventeen kilometres of straight gravel on an old Roman road, with "
    "nothing to hide behind. Carry water and keep a steady pace."), "☀️",
   challenge=pace(5.5, 300,
                  "Calzadilla de la Cueza appears in its hollow, and its café is open.",
                  "The heat slows you down. You make it, with an empty bottle."))
ev(414, "milestone", "Sahagún",
   ("Brick churches in the Mudéjar style, and roughly the halfway point of "
    "the Camino. The town gives walkers a certificate to prove it."), "🧱")
ev(450, "beat", "Mansilla de las Mulas",
   "Old town walls, and the last night before the city.", "🧱")
ev(475, "milestone", "León",
   ("A cathedral made mostly of light, with some of the finest medieval "
    "stained glass in Europe. Stage two is done, 475 km behind you. The "
    "Meseta is over."), "🌈")

# --- Stage 3: León -> Sarria ---------------------------------------------
ev(507, "milestone", "Hospital de Órbigo",
   ("A long medieval bridge where, in 1434, a knight is said to have held the "
    "crossing against all comers in a month of jousts, for love."), "🛡️")
ev(522, "milestone", "Astorga",
   ("Roman walls, a fairy-tale bishop's palace by Gaudí, and a long tradition "
    "of chocolate making."), "🍫")
ev(540, "challenge", "Into the Montes de León",
   "The path climbs again, through broom and heather, into the wind.", "🌬️",
   challenge=climb(3.5, 300,
                   "Foncebadón: a village that was almost abandoned, and came back to life thanks to walkers.",
                   "The climb takes everything you have today. Foncebadón waits for you all the same."))
ev(550, "milestone", "Cruz de Ferro",
   ("A small iron cross on a tall wooden pole, standing on a mound of stones. "
    "Pilgrims carry a stone from home all the way here and leave it. At about "
    "1,500 m, this is the highest point of the Camino Francés."), "✝️")
ev(575, "milestone", "Ponferrada",
   "A Templar castle guarding the bridge over the river Sil.", "🏰")
ev(597, "beat", "Villafranca del Bierzo",
   ("Its church has a Door of Forgiveness: in the Middle Ages, pilgrims too "
    "sick to go on could earn their pilgrimage here."), "🚪")
ev(612, "challenge", "The climb to O Cebreiro",
   ("The last big climb, from chestnut groves up to the hills of Galicia. "
    "Often in fog."), "🌫️",
   challenge=climb(5.0, 360,
                   "You come over the top into a stone village in the clouds.",
                   "Slowly, with stops. The fog hides how far you still had to go, which helps."))
ev(616, "beat", "Into Galicia",
   ("A granite marker with a scallop shell. From here, stone markers count "
    "down the distance to Santiago."), "🐚")
ev(625, "milestone", "O Cebreiro",
   ("Round stone houses with thatched roofs, and a pre-Romanesque church. Its "
    "parish priest started painting the yellow arrows that now guide walkers "
    "along the whole Camino."), "🏡")
ev(647, "choice", "Samos or San Xil?",
   "After Triacastela the way splits for a day and joins again in Sarria.", "🧭",
   choice={"options": [
       {"id": "samos", "label": "Via Samos",
        "detail": "Longer, along a river, past a great monastery.",
        "outcome": ("There has been a monastery at Samos for well over a "
                    "thousand years. You walk in under its walls.")},
       {"id": "sanxil", "label": "Via San Xil",
        "detail": "Shorter, over the hills.",
        "outcome": "Small hamlets, chestnut trees and stone walls. You meet more cows than people."},
   ]})
ev(665, "milestone", "Sarria",
   ("Many pilgrims start here: the Compostela is given to those who walk at "
    "least the last 100 km. Stage three is done, and the path gets busy."), "🎒")

# --- Stage 4: Sarria -> Santiago -----------------------------------------
ev(680, "milestone", "100 km to go",
   "The most photographed marker on the Camino: one hundred kilometres to Santiago.", "💯")
ev(687, "milestone", "Portomarín",
   ("When a reservoir flooded the old town in the 1960s, its church was taken "
    "apart and rebuilt, stone by stone, on the hill above."), "⛪")
ev(700, "beat", "Hórreos",
   "Stone granaries on legs, with a cross on the roof, beside every farm.", "🌽")
ev(712, "beat", "Palas de Rei",
   "Rain, then sun, then rain. Galicia does both in the same hour.", "🌦️")
ev(727, "milestone", "Melide",
   ("The town is known for its octopus, boiled and served on wooden plates "
    "with paprika and olive oil."), "🐙")
ev(741, "beat", "Arzúa",
   "Cheese country: a soft, mild cheese with the town's name on it.", "🧀")
ev(752, "beat", "Eucalyptus",
   "Tall eucalyptus woods. The air smells like a cough sweet.", "🌳")
ev(770, "challenge", "The last push",
   "The city is close and your legs know it. One more effort.", "🏃",
   challenge=pace(6.0, 240,
                  "Monte do Gozo, the Mount of Joy: the cathedral's spires on the skyline.",
                  "You go slowly up the last hill. The spires are there anyway."))
ev(775, "milestone", "Monte do Gozo",
   ("The first view of the cathedral. Tradition says medieval pilgrims raced "
    "each other up here to see it first."), "👀")
ev(780, "milestone", "Santiago de Compostela",
   ("A bagpiper under the archway, then the Praza do Obradoiro and the "
    "cathedral's façade. 780 km, every one of them walked. The Pilgrim's "
    "Office has your Compostela."), "🏁")

# --------------------------------------------------------------------------
# The overview map: the route in a 1000x640 viewBox, east (start) to west
# (Santiago). The frontend places every marker with SVG getPointAtLength(),
# so progress -> position is exact without hand-placing anything.
# --------------------------------------------------------------------------

MAP_PATH = (
    "M 910 410 "
    "C 870 430, 840 452, 800 446 "
    "C 760 440, 730 472, 690 472 "
    "C 650 472, 610 440, 560 432 "
    "C 510 424, 450 410, 400 402 "
    "C 350 394, 300 372, 262 360 "
    "C 228 349, 214 330, 196 326 "
    "C 160 318, 130 300, 90 296"
)

MAP_DECOR = [
    {"kind": "label", "x": 880, "y": 380, "text": "the Pyrenees"},
    {"kind": "label", "x": 790, "y": 480, "text": "Pamplona"},
    {"kind": "label", "x": 560, "y": 466, "text": "Burgos"},
    {"kind": "label", "x": 480, "y": 382, "text": "the Meseta"},
    {"kind": "label", "x": 400, "y": 436, "text": "León"},
    {"kind": "label", "x": 196, "y": 300, "text": "O Cebreiro"},
    {"kind": "label", "x": 80, "y": 332, "text": "Santiago"},
]

SOURCE_NOTE = ("About 780 km from Saint-Jean-Pied-de-Port to Santiago de "
               "Compostela, in four stages. Distances follow common guidebook "
               "figures and vary by a few kilometres with the variant taken.")

# One card pack every 2 km of credited distance. The deck drawn from on this
# journey is "Embers & Peaks" (tools/build_cards.mjs), whose catalog is
# published under this journey's id.
REWARDS = {"pack_every_m": 2000}


def to_mi(km: float) -> float:
    return round(km * KM_TO_MI, 3)


def with_distances(item: dict, *keys: str) -> dict:
    """Replace each `<key>_km` by the `<key>_mi` / `<key>_m` pair the app reads."""
    out = {k: v for k, v in item.items() if not k.endswith("_km")}
    for key in keys:
        km = item[f"{key}_km"]
        out[f"{key}_mi"] = to_mi(km)
        out[f"{key}_m"] = round(km * 1000.0, 2)
    return out


def build() -> dict:
    return {
        **PACK,
        "total_mi": to_mi(TOTAL_KM),
        "total_m": TOTAL_KM * 1000.0,
        "source_note": SOURCE_NOTE,
        # Reward tuning lives with the theme (data, not code).
        "rewards": dict(REWARDS),
        "stages": [with_distances(s, "start", "end") for s in STAGES],
        "biomes": [with_distances(b, "start", "end") for b in BIOMES],
        "events": [with_distances(e, "at") for e in sorted(E, key=lambda x: x["at_km"])],
        "map": {"view_box": "0 0 1000 640", "path": MAP_PATH, "decor": MAP_DECOR},
    }


def validate(pack: dict) -> list[str]:
    problems = []
    total = pack["total_m"]

    def contiguous(items, what):
        prev_end = 0.0
        for it in items:
            if abs(it["start_m"] - prev_end) > 1e-6:
                problems.append(f"{what} {it['id']}: starts at {it['start_m']} m, "
                                f"previous ended at {prev_end} m")
            if it["end_m"] <= it["start_m"]:
                problems.append(f"{what} {it['id']}: empty or reversed range")
            prev_end = it["end_m"]
        if abs(prev_end - total) > 1e-6:
            problems.append(f"{what}s end at {prev_end} m, journey total is {total} m")

    contiguous(pack["biomes"], "biome")
    contiguous(pack["stages"], "stage")

    seen, last = set(), -1.0
    for e in pack["events"]:
        if e["id"] in seen:
            problems.append(f"duplicate event id {e['id']}")
        seen.add(e["id"])
        if e["at_m"] < last:
            problems.append(f"event {e['id']} out of order")
        last = e["at_m"]
        if not 0 <= e["at_m"] <= total:
            problems.append(f"event {e['id']} at {e['at_m']} m is off the journey")

    pack_every = pack.get("rewards", {}).get("pack_every_m")
    if not isinstance(pack_every, (int, float)) or pack_every <= 0:
        problems.append("rewards.pack_every_m must be a positive number")
    return problems


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    pack = build()
    problems = validate(pack)
    if problems:
        print(f"[{pack['id']}] FAILED validation:", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1
    path = OUT / f"{pack['id']}.json"
    path.write_text(json.dumps(pack, indent=1, ensure_ascii=False) + "\n")
    print(f"[{pack['id']}] wrote {path.relative_to(ROOT)}: {len(pack['events'])} events, "
          f"{len(pack['biomes'])} biomes, {TOTAL_KM} km")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
