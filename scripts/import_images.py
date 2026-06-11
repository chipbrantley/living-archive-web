#!/usr/bin/env python3
"""Bulk image import for the Living Archive.

Reads a folder of Matt Herron scans, matches each file to an Airtable Image
record by the leading 7-digit Herron number, fetches Title + Caption verbatim
from Take Stock, and attaches the image file. Creates Image records for
numbers that don't exist yet.

Dry-run by default — pass --live to write to Airtable.

Usage:
  python3 scripts/import_images.py                 # dry run, Woody folder
  python3 scripts/import_images.py --limit 5       # dry run, first 5 files
  python3 scripts/import_images.py --live          # the real thing
  python3 scripts/import_images.py --source /path/to/folder --live
"""

import argparse
import base64
import csv
import io
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error

# ---------------------------------------------------------------- config

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(PROJECT_DIR, ".env.local")

DEFAULT_SOURCE = os.path.expanduser(
    "~/Library/CloudStorage/GoogleDrive-chip.brantley@gmail.com/My Drive/"
    "Proximity Partners/Photographers/Matt Herron/"
    "Matt Herron images from Woody TakeStock"
)

IMAGES_TABLE = "tbl7AqpQT7Ln5lrlP"
FLD_IMAGE_NUMBER = "fldqi7UPbICTVALsA"
FLD_TITLE = "fldGDH35kZgWMUihG"
FLD_CAPTION = "flddyifH9LyqGLvDe"
FLD_IMAGE_FILE = "fldYsTwZssXCYrzPT"
FLD_PHOTOGRAPHER = "fldTmIaJeQz1daX4q"
MATT_HERRON_REC = "recHlKugBVroBi3WZ"

TAKESTOCK_URL = (
    "https://takestockphotos.com/imagepages/imagedisplay.php"
    "?ImageID={n}&id={n}&words=&LO1=AND&place=&year=&credit="
)
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
)
TAKESTOCK_DELAY_S = 1.2          # politeness between Take Stock fetches
AIRTABLE_DELAY_S = 0.25          # stay under Airtable's 5 req/s
MAX_UPLOAD_BYTES = 4_500_000     # Airtable content API caps at 5 MB

CACHE_DIR = os.path.join(PROJECT_DIR, "scripts", ".takestock_cache")
REPORT_PATH = os.path.join(PROJECT_DIR, "scripts", "import_report.csv")

# SPECPAT-3595 blow-ups from contact sheet gb523ng2378_0124, visually verified
# as job 167 roll 06 (frame 21 matches Take Stock 1670621 — see memory file
# herron-contact-sheet-decoding). Adjusted variants only; sheets 0122 and 0128
# stay deferred pending Ben's roll confirmation.
VERIFIED_3595 = {
    "gb523ng2378_0124_07_Ralph_Bunche_0001_adjusted.jpg": "1670607",
    "gb523ng2378_0124_12_Ralph_Bunche_0001_adjusted.jpg": "1670612",
    "gb523ng2378_0124_19_Ralph_Bunche_0001_adjusted.jpg": "1670619",
    "gb523ng2378_0124_20_Ralph_Bunche_0001_adjusted.jpg": "1670620",
    "gb523ng2378_0124_21_Ralph_Bunche_0001_adjusted.jpg": "1670621",
    "gb523ng2378_0124_24_Ralph_Bunche_0001_adjusted.jpg": "1670624",
    "gb523ng2378_0124_31_Coleman_Woodson_0001_adjusted.jpg": "1670631",
}


def parse_filename(fname):
    """Map a filename to a 7-digit Herron number.

    Returns (number, style) or (None, reason-it-was-deferred)."""
    m = re.match(r"^(\d{7})", fname)
    if m:
        return m.group(1), "woody"
    # Stanford full form: M2866_b6_f11_s167-13_5A_positive.jpg
    # A-frame rule (verified on the physical sheets): 5A = frame 05.
    m = re.match(
        r"^M2866_b6_f11_s167-(\d{1,2})_(\d{1,2})A?_positive(?: \d+)?\.jpe?g$",
        fname, re.I,
    )
    if m:
        return f"167{int(m.group(1)):02d}{int(m.group(2)):02d}", "stanford"
    if fname in VERIFIED_3595:
        return VERIFIED_3595[fname], "3595-verified"
    if re.search(r"_accurate\.|_0001b_", fname):
        return None, "deferred: non-display variant (accurate/alt)"
    if re.match(r"^gb523ng2378_(0122|0128)_", fname):
        return None, "deferred: sheet roll unconfirmed (Ben Q1)"
    if re.match(r"^m2866_b6_f11_s\d{1,2}_", fname, re.I):
        return None, "deferred: bare s-number unconfirmed (Ben Q2)"
    if re.match(r"^m2866_b54_", fname, re.I):
        return None, "deferred: box 54 color slides unconfirmed (Ben Q3)"
    return None, "deferred: unrecognized pattern"


def load_env():
    env = {}
    with open(ENV_PATH) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


# ---------------------------------------------------------------- airtable

class Airtable:
    def __init__(self, pat, base_id):
        self.pat = pat
        self.base_id = base_id

    def _request(self, url, payload=None, method="GET"):
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(
            url,
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {self.pat}",
                "Content-Type": "application/json",
            },
        )
        time.sleep(AIRTABLE_DELAY_S)
        with urllib.request.urlopen(req) as resp:
            return json.load(resp)

    def all_images(self):
        records, offset = [], None
        fields = "&".join(
            f"fields%5B%5D={f}"
            for f in (FLD_IMAGE_NUMBER, FLD_TITLE, FLD_CAPTION, FLD_IMAGE_FILE)
        )
        while True:
            url = (
                f"https://api.airtable.com/v0/{self.base_id}/{IMAGES_TABLE}"
                f"?returnFieldsByFieldId=true&pageSize=100&{fields}"
            )
            if offset:
                url += f"&offset={urllib.parse.quote(offset)}"
            data = self._request(url)
            records.extend(data["records"])
            offset = data.get("offset")
            if not offset:
                return records

    def update_fields(self, record_id, fields):
        url = f"https://api.airtable.com/v0/{self.base_id}/{IMAGES_TABLE}/{record_id}"
        return self._request(url, {"fields": fields, "typecast": False}, "PATCH")

    def create_record(self, fields):
        url = f"https://api.airtable.com/v0/{self.base_id}/{IMAGES_TABLE}"
        return self._request(url, {"fields": fields}, "POST")

    def upload_attachment(self, record_id, field_id, filename, content, content_type="image/jpeg"):
        url = (
            f"https://content.airtable.com/v0/{self.base_id}/{record_id}"
            f"/{field_id}/uploadAttachment"
        )
        payload = {
            "contentType": content_type,
            "filename": filename,
            "file": base64.b64encode(content).decode(),
        }
        return self._request(url, payload, "POST")


# ---------------------------------------------------------------- take stock

def fetch_takestock(number):
    """Return dict of formlabel->formdata from Take Stock, or None if no real data.
    Pages are cached on disk so re-runs don't refetch."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    cache = os.path.join(CACHE_DIR, f"{number}.html")
    if os.path.exists(cache):
        html = open(cache, encoding="utf-8", errors="replace").read()
    else:
        req = urllib.request.Request(
            TAKESTOCK_URL.format(n=number), headers={"User-Agent": USER_AGENT}
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                html = resp.read().decode("utf-8", errors="replace")
        except (urllib.error.URLError, urllib.error.HTTPError) as e:
            print(f"    takestock fetch failed for {number}: {e}")
            return None
        with open(cache, "w", encoding="utf-8") as f:
            f.write(html)
        time.sleep(TAKESTOCK_DELAY_S)

    pairs = re.findall(
        r'<div class="formlabel">\s*(.*?)\s*</div>\s*'
        r'<div class="formdata">\s*(.*?)\s*</div>',
        html,
        re.S,
    )
    data = {k.strip(): re.sub(r"\s+", " ", v).strip() for k, v in pairs}
    # A page whose Image# doesn't echo our number back is a miss, not a hit.
    if data.get("Image#") != number:
        return None
    return data


# ---------------------------------------------------------------- images

def prepare_upload(path):
    """Return (bytes, note). Recompress only if the original exceeds the
    Airtable content-API cap; the Drive original is never modified."""
    raw = open(path, "rb").read()
    if len(raw) <= MAX_UPLOAD_BYTES:
        return raw, "original"
    from PIL import Image

    img = Image.open(io.BytesIO(raw))
    img = img.convert("RGB") if img.mode not in ("RGB", "L") else img
    for quality in (88, 82, 76):
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=quality, optimize=True)
        if buf.tell() <= MAX_UPLOAD_BYTES:
            return buf.getvalue(), f"recompressed q{quality}"
    # Last resort: bound the long edge and try again.
    img.thumbnail((3600, 3600))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85, optimize=True)
    return buf.getvalue(), "resized 3600px q85"


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default=DEFAULT_SOURCE)
    ap.add_argument("--live", action="store_true", help="actually write to Airtable")
    ap.add_argument("--limit", type=int, default=0, help="only process first N files")
    args = ap.parse_args()

    env = load_env()
    pat = env.get("AIRTABLE_PAT_WRITE") or env.get("AIRTABLE_PAT")
    base_id = env["AIRTABLE_BASE_ID"]
    at = Airtable(pat, base_id)
    if args.live and not env.get("AIRTABLE_PAT_WRITE"):
        print("NOTE: no AIRTABLE_PAT_WRITE in .env.local — using AIRTABLE_PAT.")
        print("      If that token is read-only, writes will fail with 403.\n")

    # 1. Scan source folder (recursive) and parse each filename.
    all_jpgs = []
    for root, dirs, fnames in os.walk(args.source):
        for f in sorted(fnames):
            if f.lower().endswith((".jpg", ".jpeg")):
                all_jpgs.append((f, os.path.join(root, f)))
    parsed, deferred, seen_nums = [], [], {}
    for fname, path in all_jpgs:
        num, style = parse_filename(fname)
        if num is None:
            deferred.append((fname, style))
        elif num in seen_nums:
            deferred.append((fname, f"deferred: duplicate of {seen_nums[num]} (same number {num})"))
        else:
            seen_nums[num] = fname
            parsed.append((fname, path, num, style))
    files = parsed[: args.limit] if args.limit else parsed
    print(f"{len(all_jpgs)} jpgs in {args.source}")
    print(f"{len(parsed)} parseable, {len(deferred)} deferred/skipped\n")

    # 2. Pull existing records and build the number -> record map.
    print("Fetching existing Image records…")
    records = at.all_images()
    by_number, messy = {}, []
    for r in records:
        v = (r.get("fields", {}).get(FLD_IMAGE_NUMBER) or "").strip()
        if re.fullmatch(r"\d{7}", v):
            by_number[v] = r
        elif v:
            messy.append((v, r))
    print(f"{len(records)} records ({len(by_number)} clean numbers, {len(messy)} annotated)\n")

    def find_record(num):
        if num in by_number:
            return by_number[num], "exact"
        for v, r in messy:  # e.g. "[no image number] (On TakeStock it's 1263320)"
            if num in v:
                return r, f"annotated: {v!r}"
        return None, None

    # 3. Process.
    rows, n_attach, n_create, n_skip, n_err = [], 0, 0, 0, 0
    for i, (fname, path, num, style) in enumerate(files, 1):
        rec, how = find_record(num)
        has_file = bool(rec and rec["fields"].get(FLD_IMAGE_FILE))

        if has_file:
            n_skip += 1
            rows.append([fname, num, "skip (already has file)", "", "", how])
            print(f"[{i}/{len(files)}] {num}  SKIP — record already has an image file")
            continue

        ts = fetch_takestock(num)
        title = ts.get("Title", "") if ts else ""
        caption = ts.get("Caption", "") if ts else ""
        action = "attach" if rec else "create"
        print(
            f"[{i}/{len(files)}] {num}  {action.upper()}"
            f"{'' if how in (None, 'exact') else f' ({how})'}"
            f"  takestock={'yes' if ts else 'NO'}"
            f"  title={title[:50]!r}"
        )

        if not args.live:
            rows.append([fname, num, f"dry-run {action}", title, caption, how or ""])
            continue

        try:
            if rec is None:
                fields = {FLD_IMAGE_NUMBER: num, FLD_PHOTOGRAPHER: [MATT_HERRON_REC]}
                if title:
                    fields[FLD_TITLE] = title
                if caption:
                    fields[FLD_CAPTION] = caption
                rec = at.create_record(fields)
                n_create += 1
            else:
                fields = {}
                if title and not rec["fields"].get(FLD_TITLE):
                    fields[FLD_TITLE] = title
                if caption and not rec["fields"].get(FLD_CAPTION):
                    fields[FLD_CAPTION] = caption
                if fields:
                    at.update_fields(rec["id"], fields)
                n_attach += 1
            content, note = prepare_upload(path)
            at.upload_attachment(rec["id"], FLD_IMAGE_FILE, fname, content)
            rows.append([fname, num, f"{action} ok ({note})", title, caption, how or ""])
        except urllib.error.HTTPError as e:
            n_err += 1
            body = e.read().decode(errors="replace")[:200]
            rows.append([fname, num, f"ERROR {e.code}: {body}", title, caption, how or ""])
            print(f"    ERROR {e.code}: {body}")

    # 4. Report (processed files + every deferred file with its reason).
    with open(REPORT_PATH, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["filename", "herron_number", "action", "takestock_title",
                    "takestock_caption", "match_note"])
        w.writerows(rows)
        for fname, reason in deferred:
            w.writerow([fname, "", reason, "", "", ""])
    if deferred:
        from collections import Counter
        print("\nDeferred (tracked in report, safe to re-import later):")
        for reason, c in Counter(r for _, r in deferred).most_common():
            print(f"  {c:4d}  {reason}")

    print(f"\n{'DRY RUN — nothing written.' if not args.live else 'LIVE RUN complete.'}")
    if args.live:
        print(f"attached: {n_attach}  created: {n_create}  skipped: {n_skip}  errors: {n_err}")
    print(f"Report: {REPORT_PATH}")
    print("Review takestock_title column for sentence-casing before/after import.")


if __name__ == "__main__":
    import urllib.parse  # used in all_images pagination
    main()
