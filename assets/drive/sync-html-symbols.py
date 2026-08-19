#!/usr/bin/env python3
"""Sync generated Drive mark layers into self-contained HTML demos."""

import argparse
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TARGETS = (
    ROOT / "docs/drivecode/design/wireframes/mobile-drive-ios.html",
    ROOT / "docs/drivecode/design/wireframes/mobile-drive-ios-demo.html",
    ROOT / "docs/drivecode/design/canvases/drive-product-demo.html",
)
PATTERN = re.compile(r'<symbol id="drive-mark"[^>]*>.*?</symbol>', re.DOTALL)
GROUP_PATTERN = re.compile(r'<g id="(dm-(?:wheel|head))"[^>]*>(.*?)</g>', re.DOTALL)


def generated_symbol() -> str:
    layers_svg = (ROOT / "assets/drive/cline-drive-mark-layers.svg").read_text(
        encoding="utf-8"
    )
    groups = {name: body.strip() for name, body in GROUP_PATTERN.findall(layers_svg)}
    if groups.keys() != {"dm-wheel", "dm-head"}:
        raise RuntimeError("expected wheel and head groups in generated layer asset")
    return f'''<symbol id="drive-mark" viewBox="0 0 1024 1024">
    <!-- Generated from assets/drive/source.png by assets/drive/sync-html-symbols.py. -->
    <g class="dm-wheel" fill="currentColor">
      {groups["dm-wheel"]}
    </g>
    <g class="dm-head" fill="currentColor">
      {groups["dm-head"]}
    </g>
  </symbol>'''


def sync(check: bool = False) -> None:
    symbol = generated_symbol()
    for target in TARGETS:
        original = target.read_text(encoding="utf-8")
        matches = PATTERN.findall(original)
        if len(matches) != 1:
            raise RuntimeError(
                f"expected exactly one Drive symbol in {target.relative_to(ROOT)}, "
                f"found {len(matches)}"
            )
        if check:
            if matches[0] != symbol:
                raise RuntimeError(f"stale Drive symbol in {target.relative_to(ROOT)}")
            print(f"verified {target.relative_to(ROOT)}")
            continue
        target.write_text(PATTERN.sub(symbol, original), encoding="utf-8")
        print(f"synced {target.relative_to(ROOT)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    sync(check=parser.parse_args().check)
