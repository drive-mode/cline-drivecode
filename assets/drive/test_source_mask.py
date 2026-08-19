#!/usr/bin/env python3
"""Regression tests for Drive source and inverse-pair extraction."""

import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageOps

from source_mask import foreground_mask


class SourceMaskTests(unittest.TestCase):
    @staticmethod
    def light_mark() -> Image.Image:
        image = Image.new("L", (64, 64), 255)
        ImageDraw.Draw(image).polygon(((12, 52), (32, 8), (52, 52)), fill=0)
        return image

    def mask_for(self, image: Image.Image) -> np.ndarray:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source.png"
            image.save(path)
            return foreground_mask(path)

    def test_single_light_and_dark_sources_match(self) -> None:
        light = self.light_mark()

        self.assertTrue(
            np.array_equal(self.mask_for(light), self.mask_for(ImageOps.invert(light)))
        )

    def test_square_inverse_pair_uses_light_left_panel(self) -> None:
        light = self.light_mark()
        light_panel = Image.new("L", (64, 128), 255)
        dark_panel = Image.new("L", (64, 128), 0)
        light_panel.paste(light, (0, 32))
        dark_panel.paste(ImageOps.invert(light), (0, 32))
        sheet = Image.new("L", (128, 128), 0)
        sheet.paste(light_panel, (0, 0))
        sheet.paste(dark_panel, (64, 0))

        self.assertTrue(
            np.array_equal(self.mask_for(sheet), self.mask_for(light_panel))
        )


if __name__ == "__main__":
    unittest.main()
