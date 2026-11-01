#!/usr/bin/env python3
"""Converts Oz's Higgsfield trial kit (direction A, Club Lounge) into compressed web assets.

Usage: python3 scripts/art/convert-club.py [--avif] <source dir with room.png table.png cardback.png chips.png coffee.png>
Writes apps/web/public/art/club/*.webp (Pillow 11+). --avif also writes AVIF copies for comparison.
The PNG sources stay outside the repo; crops are fixed numbers measured on trial1 (see docs/ASSETS_CLUB.md).
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = Path([a for a in sys.argv[1:] if not a.startswith('--')][0])
AVIF = '--avif' in sys.argv  # AVIF saved under 15% here, not worth a second copy in the offline cache
OUT = Path(__file__).resolve().parents[2] / 'apps/web/public/art/club'
OUT.mkdir(parents=True, exist_ok=True)
LIMIT = 300 * 1024


def save(img: Image.Image, name: str, webp_q: int, avif_q: int, lossless_alpha: bool = False) -> None:
    w = OUT / f'{name}.webp'
    a = OUT / f'{name}.avif'
    img.save(w, 'WEBP', quality=webp_q, method=6, **({'alpha_quality': 90} if img.mode == 'RGBA' else {}))
    files = [w]
    if AVIF:
        img.save(a, 'AVIF', quality=avif_q, speed=4)
        files.append(a)
    for f in files:
        size = f.stat().st_size
        assert size <= LIMIT, f'{f.name} is {size} bytes, over the 300 KB budget'
        print(f'{f.name:28} {img.width}x{img.height:<5} {size / 1024:7.1f} KB')


def fit(img: Image.Image, width: int) -> Image.Image:
    return img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)


# Room: portrait as delivered, landscape is the middle band (bar, lamps, booths). Dark overlay is added in CSS.
room = Image.open(SRC / 'room.png').convert('RGB')
save(fit(room, 900), 'room-portrait', 62, 50)
save(fit(room.crop((0, 760, 1536, 1624)), 1280), 'room-landscape', 62, 50)

# Table: only the felt inside the wooden rail (the app draws its own brass rail around any table shape).
table = Image.open(SRC / 'table.png').convert('RGB')
felt = table.crop((560, 330, 2190, 1290))  # inside the oval, so no wood shows in the corners
save(fit(felt, 1400), 'felt-landscape', 70, 55)
save(felt.crop((515, 0, 1115, 960)), 'felt-portrait', 70, 55)  # centred on the lamp pool

# Card back: the card only, corners made transparent with the card's own radius.
card = Image.open(SRC / 'cardback.png').convert('RGB').crop((83, 196, 1614, 2345))
card = fit(card, 300).convert('RGBA')
mask = Image.new('L', card.size, 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, card.width - 1, card.height - 1), radius=14, fill=255)
card.putalpha(mask)
save(card, 'cardback', 82, 62)

# Chips: five separate chips cut out with an antialiased circle. Tier order follows the stakes 10/25/50/100/250.
chips = Image.open(SRC / 'chips.png').convert('RGB')
segments = [(64, 444), (448, 829), (835, 1215), (1220, 1601), (1606, 1986)]
names = ['chip-cream', 'chip-red', 'chip-blue', 'chip-green', 'chip-black']
for (x0, x1), name in zip(segments, names):
    cx, cy, r = (x0 + x1) / 2, (833 + 1214) / 2, 192
    chip = chips.crop((round(cx - r), round(cy - r), round(cx + r), round(cy + r))).convert('RGBA')
    big = Image.new('L', (chip.width * 4, chip.height * 4), 0)
    ImageDraw.Draw(big).ellipse((10, 10, big.width - 11, big.height - 11), fill=255)
    chip.putalpha(big.resize(chip.size, Image.LANCZOS))
    save(chip.resize((128, 128), Image.LANCZOS), name, 85, 65)

# Coffee: the background is a flat dark plum; key it out by colour distance, keep the cup, saucer and steam.
coffee = Image.open(SRC / 'coffee.png').convert('RGB')
arr = np.asarray(coffee).astype(np.float32)
bg = arr[:24, :24].reshape(-1, 3).mean(0)
dist = np.sqrt(((arr - bg) ** 2).sum(2))
alpha = np.clip((dist - 10) / 26, 0, 1)
alpha_img = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
coffee = coffee.convert('RGBA')
coffee.putalpha(alpha_img)
box = coffee.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
coffee = coffee.crop(box)
side = max(coffee.size)
square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
square.paste(coffee, ((side - coffee.width) // 2, (side - coffee.height) // 2))
save(square.resize((160, 160), Image.LANCZOS), 'coffee', 85, 65)
