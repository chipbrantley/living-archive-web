#!/usr/bin/env python3
"""Backfill the Images -> Places links from cached Take Stock Location data.

Reads each cached Take Stock page (scripts/.takestock_cache/), parses its
structured Location field, matches place names against the Places table,
and links the corresponding Image record. Logs every unmatched location
instead of guessing. Idempotent: skips images that already have Places links.

Dry-run by default; --live to write.
"""

import argparse
import json
import os
import re
import time
import urllib.request
import urllib.parse

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(PROJECT_DIR, "scripts", ".takestock_cache")
ENV_PATH = os.path.join(PROJECT_DIR, ".env.local")

IMAGES_TABLE = "tbl7AqpQT7Ln5lrlP"
PLACES_TABLE = "tbl4I0uimeDvxvdrg"
FLD_IMAGE_NUMBER = "fldqi7UPbICTVALsA"
FLD_IMAGE_PLACES = "fldhRPbaUo6hewPlH"

AIRTABLE_DELAY_S = 0.25


def load_env():
    env = {}
    with open(ENV_PATH) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def api(pat, base, path, payload=None, method="GET", params=None):
    url = f"https://api.airtable.com/v0/{base}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params, doseq=True)
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode() if payload is not None else None,
        method=method,
        headers={"Authorization": f"Bearer {pat}", "Content-Type": "application/json"},
    )
    time.sleep(AIRTABLE_DELAY_S)
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)


def all_records(pat, base, table, fields):
    records, offset = [], None
    while True:
        params = [("pageSize", "100")] + [("fields[]", f) for f in fields]
        if offset:
            params.append(("offset", offset))
        data = api(pat, base, f"/{table}", params=params)
        records.extend(data["records"])
        offset = data.get("offset")
        if not offset:
            return records


def parse_location(html):
    m = re.search(
        r'formlabel">\s*Location\s*</div>\s*<div class="formdata">\s*(.*?)\s*</div>',
        html, re.S,
    )
    if not m:
        return None
    return re.sub(r"\s+", " ", m.group(1).replace("<br>", " | ")).strip()


def location_to_places(loc, places_by_name):
    """Map a Take Stock Location string to Places record ids.
    Handles 'City, State', 'A - B, State' (both cities), and '|'-separated
    segments. Returns (record_ids, unmatched_segments)."""
    ids, unmatched = [], []
    for segment in loc.split("|"):
        segment = segment.strip()
        if not segment:
            continue
        # Strip 'On The Highway' style prefixes; keep what follows.
        segment = re.sub(r"^On The Highway\s*", "", segment, flags=re.I).strip()
        if not segment:
            continue
        # 'City, State' -> take the city part; bare 'State' won't match a city.
        city_part = segment.split(",")[0].strip()
        # 'Selma - Montgomery' -> both cities.
        names = [n.strip() for n in city_part.split(" - ")] if " - " in city_part else [city_part]
        hit = False
        for n in names:
            rec = places_by_name.get(n.lower())
            if rec:
                if rec not in ids:
                    ids.append(rec)
                hit = True
        if not hit and segment:
            unmatched.append(segment)
    return ids, unmatched


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true")
    args = ap.parse_args()

    env = load_env()
    pat = env.get("AIRTABLE_PAT_WRITE") or env["AIRTABLE_PAT"]
    base = env["AIRTABLE_BASE_ID"]

    places = all_records(pat, base, PLACES_TABLE, ["Name"])
    places_by_name = {
        r["fields"]["Name"].lower(): r["id"] for r in places if r["fields"].get("Name")
    }
    print(f"{len(places_by_name)} places in vocabulary")

    images = all_records(pat, base, IMAGES_TABLE, ["Image number", "Places"])
    by_number = {}
    for r in images:
        v = (r["fields"].get("Image number") or "").strip()
        if re.fullmatch(r"\d{7}", v):
            by_number[v] = r
    print(f"{len(by_number)} image records with clean numbers\n")

    linked = skipped = no_loc = 0
    unmatched_log = {}
    for fname in sorted(os.listdir(CACHE_DIR)):
        num = fname[:7]
        rec = by_number.get(num)
        if not rec:
            continue
        if rec["fields"].get("Places"):
            skipped += 1
            continue
        html = open(os.path.join(CACHE_DIR, fname), encoding="utf-8", errors="replace").read()
        loc = parse_location(html)
        if not loc:
            no_loc += 1
            continue
        ids, unmatched = location_to_places(loc, places_by_name)
        for u in unmatched:
            unmatched_log.setdefault(u, []).append(num)
        if not ids:
            continue
        names = [p["fields"]["Name"] for p in places if p["id"] in ids]
        print(f"{num}: {loc!r} -> {names}")
        if args.live:
            api(pat, base, f"/{IMAGES_TABLE}/{rec['id']}",
                {"fields": {FLD_IMAGE_PLACES: ids}}, "PATCH")
        linked += 1

    print(f"\n{'LIVE' if args.live else 'DRY RUN'}: {linked} images linked, "
          f"{skipped} already had places, {no_loc} cached pages without location data")
    if unmatched_log:
        print("\nUnmatched location segments (no Places row — review, don't guess):")
        for seg, nums in sorted(unmatched_log.items()):
            print(f"  {seg!r}: {len(nums)} image(s), e.g. {nums[:3]}")


if __name__ == "__main__":
    main()
