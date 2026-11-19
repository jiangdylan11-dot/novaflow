"""Compare a PSD produced by the formal workflow with the accepted test document.

Run on the same source, layer recipe and seed. Read channel data rather than a
flattened preview so a missing shadow or group mask cannot hide in the background.
"""
import argparse
import hashlib
import json
from pathlib import Path
from psd_tools import PSDImage


def pixels(image):
    return hashlib.sha256(image.tobytes()).hexdigest() if image is not None else None


def snapshot(document):
    records = []
    def walk(group, path):
        for layer in group:
            address = (*path, layer.name)
            record = dict(path=address, group=layer.is_group(), box=layer.bbox,
                          visible=layer.visible, opacity=layer.opacity,
                          blend=layer.blend_mode.value.decode("ascii"))
            if layer.has_mask():
                mask = layer.mask
                record["mask"] = (mask.bbox, mask.background_color, mask.disabled, pixels(mask.topil()))
            if layer.is_group():
                records.append(record)
                walk(layer, address)
            else:
                record["rgba"] = pixels(layer.topil().convert("RGBA"))
                records.append(record)
    walk(document, ())
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path)
    parser.add_argument("actual", type=Path)
    args = parser.parse_args()
    reference, actual = (PSDImage.open(str(path)) for path in (args.reference, args.actual))
    expected, observed = snapshot(reference), snapshot(actual)
    differences = abs(len(expected) - len(observed))
    first = None
    for index, (left, right) in enumerate(zip(expected, observed)):
        if left != right:
            differences += 1
            if first is None:
                first = dict(index=index, expected=left["path"], actual=right["path"],
                             fields=sorted(key for key in left.keys() | right.keys() if left.get(key) != right.get(key)))
    equal_canvas = reference.size == actual.size
    same = equal_canvas and differences == 0
    print(json.dumps(dict(equal=same, sameCanvas=equal_canvas, referenceRecords=len(expected),
                          actualRecords=len(observed), differentRecords=differences, firstDifference=first),
                     ensure_ascii=False))
    return 0 if same else 1


if __name__ == "__main__":
    raise SystemExit(main())
