"""Shared extraction for the approved single or inverse-pair Drive source."""

from pathlib import Path

import numpy as np
from PIL import Image


def paired_light_half(image: Image.Image) -> Image.Image | None:
    """Return the light-background panel when the source is an inverse pair."""

    image = image.convert("L")
    if image.width < 2:
        return None

    midpoint = image.width // 2
    left_background = sum(
        image.getpixel((0, y)) for y in (0, image.height - 1)
    ) / 2
    right_background = sum(
        image.getpixel((image.width - 1, y)) for y in (0, image.height - 1)
    ) / 2
    if abs(left_background - right_background) < 128:
        return None

    gutter = 8 if image.width >= image.height * 1.5 else 0
    if left_background > right_background:
        return image.crop((0, 0, midpoint - gutter, image.height))
    return image.crop((midpoint + gutter, 0, image.width, image.height))


def foreground_mask(path: Path) -> np.ndarray:
    """Return the mark as a uint8 0/255 mask, independent of presentation."""

    image = Image.open(path).convert("L")
    image = paired_light_half(image) or image
    array = np.asarray(image)
    corners = (
        array[0, 0],
        array[0, -1],
        array[-1, 0],
        array[-1, -1],
    )
    background_is_light = sum(int(value) for value in corners) / 4 >= 128
    foreground = array < 128 if background_is_light else array >= 128
    return foreground.astype(np.uint8) * 255
