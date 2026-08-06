"""Small reproducible check for the generated official Drive mark pack."""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).parent
DOCS = ROOT.parent.parent / "docs/drivecode/assets/logos"
BLACK = np.array([0, 0, 0], dtype=np.uint8)
WHITE = np.array([255, 255, 255], dtype=np.uint8)


def rgb(name: str) -> np.ndarray:
    image = Image.open(ROOT / name).convert("RGB")
    assert image.size == (512, 512), (name, image.size)
    return np.asarray(image)


light = rgb("cline-drive-light-512.png")
dark = rgb("cline-drive-dark-512.png")
inverse_sum = light.astype(np.uint16) + dark.astype(np.uint16)
assert inverse_sum.min() >= 254 and inverse_sum.max() <= 255
assert np.array_equal(np.asarray(Image.open(DOCS / "logo-light.png").convert("RGB")), light)
assert np.array_equal(np.asarray(Image.open(DOCS / "logo-dark.png").convert("RGB")), dark)

for name, color in (
    ("cline-drive-dark-transparent-512.png", BLACK),
    ("cline-drive-light-transparent-512.png", WHITE),
):
    image = np.asarray(Image.open(ROOT / name).convert("RGBA"))
    assert image.shape == (512, 512, 4)
    assert np.all(image[..., :3] == color)
    assert image[..., 3].min() == 0 and image[..., 3].max() == 255

layers = (ROOT / "cline-drive-mark-layers.svg").read_text()
assert layers.count('class="dm-wheel"') == 1
assert layers.count('class="dm-head"') == 1
assert layers.count("<path") == 2

print("Drive mark assets OK: inverse pair, alpha, docs copies, motion layers")
