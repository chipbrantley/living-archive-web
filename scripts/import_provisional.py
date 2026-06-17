#!/usr/bin/env python3
"""Import images that have no Herron number, under PP-assigned provisional IDs.

Two sets:
  orphans  — the 5 contact-sheet blow-ups Stanford has no negatives for
             (Hawaii delegation, Green Dragon) -> PP-MHX-#####
  slides   — the 101 box-54 color slides (Series 167 box, mixed events)
             -> PP-MHC-#####

Each record: Image number = provisional ID, Photographer = Matt Herron,
Scan source = Stanford Special Collections, attachment = the display scan
(corrected/adjusted variant), recompressed for Airtable's upload cap and
uploaded under its original Stanford filename (the citable locator rides
along on the attachment). NO event/location — those come from per-page
review, since the box mixes the Selma march with summer Mississippi scenes.

Dry-run by default; --live to write.
"""
import argparse, base64, io, json, os, re, sys, time, urllib.request, urllib.parse

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(PROJECT_DIR, ".env.local")
DRIVE = os.path.expanduser(
    "~/Library/CloudStorage/GoogleDrive-chip.brantley@gmail.com/My Drive/"
    "Proximity Partners/Photographers/Matt Herron/Matt Herron images scanned from Stanford"
)
SLIDES = os.path.join(DRIVE, "SPECPAT-3481 Herron 2 (PP copy)/color slides/jpg")
ORPHANS = os.path.join(DRIVE, "SPECPAT-3595 Herron (PP copy)")

IMAGES = "tbl7AqpQT7Ln5lrlP"
FLD_NUM = "fldqi7UPbICTVALsA"
FLD_PHOTOG = "fldTmIaJeQz1daX4q"
FLD_SCANSRC = "fldbR6uls9BKLchCI"
FLD_FILE = "fldYsTwZssXCYrzPT"
MH = "recHlKugBVroBi3WZ"
MAX_LONG_EDGE = 2400  # display copy; full-res TIFF stays in Drive (the vault)


def load_env():
    env = {}
    for line in open(ENV_PATH):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def api(pat, base, path, payload=None, method="GET"):
    req = urllib.request.Request(
        f"https://api.airtable.com/v0/{base}{path}",
        data=json.dumps(payload).encode() if payload is not None else None,
        method=method,
        headers={"Authorization": f"Bearer {pat}", "Content-Type": "application/json"},
    )
    time.sleep(0.2)
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def existing_numbers(pat, base):
    nums, offset = set(), None
    while True:
        url = f"/{IMAGES}?pageSize=100&fields%5B%5D={FLD_NUM}&returnFieldsByFieldId=true"
        if offset:
            url += "&offset=" + urllib.parse.quote(offset)
        d = api(pat, base, url)
        for r in d["records"]:
            v = r.get("fields", {}).get(FLD_NUM)
            if v:
                nums.add(v)
        offset = d.get("offset")
        if not offset:
            return nums


def display_copy(path):
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    img = Image.open(path)
    img = img.convert("RGB")
    if max(img.size) > MAX_LONG_EDGE:
        img.thumbnail((MAX_LONG_EDGE, MAX_LONG_EDGE))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85, optimize=True)
    return buf.getvalue()


def build_worklist(which):
    items = []  # (pp_id, source_path, upload_filename)
    if which == "orphans":
        # 5 unique frames, display = the *_0001_adjusted variant.
        wanted = [
            "gb523ng2378_0122_35_Green_Dragon-MCHR_0001_adjusted.jpg",
            "gb523ng2378_0122_36_Green_Dragon-MCHR_0001_adjusted.jpg",
            "gb523ng2378_0128_18a_Hawaii_0001_adjusted.jpg",
            "gb523ng2378_0128_19a_Hawaii_0001_adjusted.jpg",
            "gb523ng2378_0128_20a_Hawaii_0001_adjusted.jpg",
        ]
        found = {}
        for root, _, files in os.walk(ORPHANS):
            for f in files:
                if f in wanted:
                    found[f] = os.path.join(root, f)
        for i, fname in enumerate(wanted, 1):
            if fname in found:
                items.append((f"PP-MHX-{i:05d}", found[fname], fname))
    elif which == "slides":
        # 101 corrected slides, ordered by (page, position) for reading-order IDs.
        files = [f for f in os.listdir(SLIDES) if f.endswith("_corrected.jpg")]
        def key(f):
            m = re.match(r"m2866_b54_f11_s(\d+)_(\d+)_corrected\.jpg", f)
            return (int(m.group(1)), int(m.group(2))) if m else (99, 99)
        for i, fname in enumerate(sorted(files, key=key), 1):
            items.append((f"PP-MHC-{i:05d}", os.path.join(SLIDES, fname), fname))
    return items


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("which", choices=["orphans", "slides"])
    ap.add_argument("--live", action="store_true")
    args = ap.parse_args()
    env = load_env()
    pat = env.get("AIRTABLE_PAT_WRITE") or env["AIRTABLE_PAT"]
    base = env["AIRTABLE_BASE_ID"]

    items = build_worklist(args.which)
    print(f"{len(items)} {args.which} to import\n")
    have = existing_numbers(pat, base) if args.live else set()

    created = skipped = errors = 0
    for pp_id, path, fname in items:
        if pp_id in have:
            skipped += 1
            print(f"  SKIP {pp_id} (exists)")
            continue
        print(f"  {pp_id}  <-  {fname}")
        if not args.live:
            continue
        try:
            rec = api(pat, base, f"/{IMAGES}", {
                "fields": {FLD_NUM: pp_id, FLD_PHOTOG: [MH],
                           FLD_SCANSRC: "Stanford Special Collections"}
            }, "POST")
            content = display_copy(path)
            payload = {"contentType": "image/jpeg", "filename": fname,
                       "file": base64.b64encode(content).decode()}
            # The attachment upload endpoint lives on content.airtable.com.
            url = f"https://content.airtable.com/v0/{base}/{rec['id']}/{FLD_FILE}/uploadAttachment"
            req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST",
                headers={"Authorization": f"Bearer {pat}", "Content-Type": "application/json"})
            time.sleep(0.2)
            urllib.request.urlopen(req)
            created += 1
        except Exception as e:
            errors += 1
            print(f"    ERROR: {e}")

    print(f"\n{'LIVE' if args.live else 'DRY RUN'}: created {created}, skipped {skipped}, errors {errors}")


if __name__ == "__main__":
    main()
