# Stanford import — deferred files manifest

**Date of first Stanford import:** 2026-06-10
**Imported that night:** SPECPAT-3431 (119 frames, full `s167-{roll}_{frame}` filenames)
and 7 visually-verified SPECPAT-3595 blow-ups from contact sheet `gb523ng2378_0124`
(= job 167 roll 06 → 1670607, 1670612, 1670619, 1670620, 1670621, 1670624, 1670631).

Everything below was **deliberately not imported** and is safe to import later —
the importer never overwrites a record that already has an image file, so a future
"import everything" pass cannot duplicate or clobber anything.

## Waiting on Ben — Q1: contact-sheet roll numbers

Sheets referenced by SPECPAT-3595 blow-ups whose roll is unconfirmed:

| Files | Sheet | Subject | Status |
|---|---|---|---|
| `gb523ng2378_0122_35/36_Green_Dragon-MCHR_*` (2 adjusted + accurate variants) | gb523ng2378_0122 | Jim Letherer / MCHR "Green Dragon" vehicle | Hypothesis: job 167 **roll 30** (Take Stock "Medical Committee" hits 1673024/25/33). Needs confirmation. |
| `gb523ng2378_0128_18a/19a/20a_Hawaii_*` (3 adjusted + accurate variants) | gb523ng2378_0128 | Hawaii delegation | No hypothesis — roll unknown. |

Once confirmed, add the filenames to `VERIFIED_3595` in `import_images.py` and re-run.

## Waiting on Ben — Q2: bare s-number filenames

Assumed but unconfirmed: `s{N}_{F}` = job 167, roll N, frame F (box 6 folder 11 = Selma–Montgomery).

- **SPECPAT-3595:** 320 jpgs in the `m2866_b6_f11_s01_01.jpg` style (including `_small` duplicates).
- **SPECPAT-3481 / negatives / jpg:** 195 files in the `m2866_b6_f11_s2_17_positive.jpg` style.

Once confirmed, add a parser branch for `m2866_b6_f11_s(\d+)_(\d+)` → `167{roll}{frame}`,
skip `_small` variants, and re-run on both folders.

## Waiting on Ben — Q3: box 54 color slides

- **SPECPAT-3481 / color slides / jpg:** 202 files (101 frames × accurate + corrected),
  `m2866_b54_f11_s1_01_*.jpg` style. Box 54 is outside our finding-aid sheet (boxes 66–90);
  job/subject and whether color has Herron numbers at all are unknown.
- Import the **corrected** variant when decoded; accurate stays preservation-only.

## Never importing to Airtable (by design)

- **All TIFFs** (3481: 397 files / 101 GB) — preservation masters; Drive is the vault.
- **`accurate` variants** where a corrected/adjusted twin exists — preservation, not display.
- **Matt Herron Contact Sheets (PP copy)** (359 files) — whole-sheet scans, destined for the
  future Rolls table, not the Images table.
- **PP scans of prints inventory** (14 box PDFs) — inventory documentation; later candidate
  for Print-record front/back attachments.
- `Images for Michael to print.zip` (Woody folder) — packaging, contents duplicated elsewhere.
- 1 exact-duplicate file in 3431 (`...s167-20_0A_positive 1.jpg` / same without " 1").

## Small open flag

- Frame `0A` parses to frame 00 (e.g. 1672000). Plausible (the zeroth frame before frame 1)
  but worth a glance at the roll-20 contact sheet someday to confirm Matt counted it that way.
