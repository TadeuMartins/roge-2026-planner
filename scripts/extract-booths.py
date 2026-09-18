"""Offline extraction of label centers, not booth polygons (PyMuPDF 1.26.4).

Run: python scripts/extract-booths.py
Inspect source labels: python scripts/extract-booths.py --inspect
The WebP must remain the full, rotated PDF page, without cropping.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[1]
PDF = ROOT / "assets/maps/planta-geral-riocentro.pdf"
# Full-page percentage bounds checked against the supplied artwork's building
# outlines and pavilion labels, not guessed from stand letters or the directory.
PAVILIONS = {"2": [50, 70, 76, 86], "3": [47, 44, 87, 64],
             "4": [38, 12, 68, 41], "6": [5, 23, 26, 38]}
PREFIX = r"(?:[A-Z]|Z[A-D]|IU|ATV)"
CODE = re.compile(r"^(" + PREFIX + r"\d{2}[a-z]?)\s*\d+(?:[.,]\d+)?M\u00b2$")


def normalize_code(text):
    match = re.fullmatch("(" + PREFIX + r")(\d{1,2})([A-Z]?)", text.strip().upper())
    return match[1] + match[2].zfill(2) + match[3] if match else None


def extract():
    document = pymupdf.open(PDF)
    page = document[0]
    labels = []
    for block in page.get_text("rawdict")["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                chars = span["chars"]
                text = "".join(char["c"] for char in chars)
                if not text:
                    continue
                rect = pymupdf.Rect(span["bbox"]) * page.rotation_matrix
                match = CODE.fullmatch(text.strip())
                code = normalize_code(match[1]) if match else normalize_code(text)
                if code:
                    # Area text can touch the code (ZB0420M2); use only code glyphs.
                    start = len(text) - len(text.lstrip())
                    length = len(match[1]) if match else len(text.strip())
                    code_rect = pymupdf.Rect(chars[start]["bbox"])
                    for char in chars[start + 1:start + length]:
                        code_rect |= pymupdf.Rect(char["bbox"])
                    rect = code_rect * page.rotation_matrix
                label = {"text": text.strip(), "x": round((rect.x0 + rect.x1) / 2 / page.rect.width * 100, 5),
                         "y": round((rect.y0 + rect.y1) / 2 / page.rect.height * 100, 5)}
                if code:
                    label["code"] = code
                labels.append(label)
    return page, labels


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inspect", nargs="?", const=".*", help="Print labels matching a regex")
    args = parser.parse_args()
    page, labels = extract()
    if args.inspect is not None:
        print(json.dumps({"rotation": page.rotation, "page": list(page.rect)}))
        for label in labels:
            if re.search(args.inspect, label["text"], re.IGNORECASE):
                print(json.dumps(label, ensure_ascii=True))
        return
    booths = {}
    for label in labels:
        if "code" not in label:
            continue
        pavilion = next((key for key, (x0, y0, x1, y1) in PAVILIONS.items()
                         if x0 <= label["x"] <= x1 and y0 <= label["y"] <= y1), None)
        if not pavilion:
            continue
        code = label["code"]
        position = {"x": label["x"], "y": label["y"], "pavilion": pavilion,
                    "source_text": label["text"]}
        positions = booths.setdefault(code, [])
        # Only identical overprinted glyphs are deduplicated. Distinct positions
        # of the same code remain ambiguous, even inside the same pavilion.
        if not any(abs(p["x"] - position["x"]) < 0.001 and abs(p["y"] - position["y"]) < 0.001 for p in positions):
            positions.append(position)
    landmarks = [label for label in labels if re.fullmatch(
        r"COWORKING|AUDIT\. PAV\. 4|Plenaria [AB]|ROGe|Fest", label["text"], re.IGNORECASE)]
    data = {"version": 1, "source": {"document": str(PDF.relative_to(ROOT)).replace("\\", "/"),
            "sha256": hashlib.sha256(PDF.read_bytes()).hexdigest(), "revision": "2026-05-18",
            "extractor": "PyMuPDF " + pymupdf.VersionBind, "page": 1,
            "unrotated_size": [page.cropbox.width, page.cropbox.height], "rotation": page.rotation,
            "displayed_size": [page.rect.width, page.rect.height], "image_size": [3600, 5093],
            "coordinate_method": "code glyph bounding rectangle * page.rotation_matrix; center / displayed page size * 100",
            "precision": "label centers, not booth polygons; company allocation is not verified",
            "pavilion_method": "geographic full-page bounds visually verified against pavilion building outlines"},
            "pavilion_bounds": PAVILIONS, "landmarks": landmarks, "booths": dict(sorted(booths.items()))}
    output = ROOT / "data/booth-locations.json"
    output.write_text(json.dumps(data, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    print(f"{len(booths)} codes; {sum(map(len, booths.values()))} positions; "
          f"{sum(len(p) > 1 for p in booths.values())} ambiguous codes -> {output}")


if __name__ == "__main__":
    main()
