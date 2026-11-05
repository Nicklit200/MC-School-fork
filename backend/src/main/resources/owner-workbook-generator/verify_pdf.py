#!/usr/bin/env python3
"""QA for generated PDFs: page count, A4, branding and content bounds."""
import json
import re
import sys
from pathlib import Path
import fitz

def verify_math_spacing(page):
    """Fail closed if a percent sign touches the next math operand.

    WeasyPrint can ignore flex gap in nested inline-flex formulas, making
    a comparison placeholder or the word "von" overlap the percentage.
    Inspect character coordinates, not PDF-extracted whitespace.
    """
    chars = []
    for block in page.get_text('rawdict')['blocks']:
        for line in block.get('lines', []):
            for span in line.get('spans', []):
                for char in span.get('chars', []):
                    chars.append((char, span['size']))
    for percent, font_size in chars:
        if percent['c'] != '%' or font_size < 14:
            continue
        px0, py0, px1, py1 = percent['bbox']
        p_mid = (py0 + py1) / 2
        next_chars = [(char, size) for char, size in chars
                      if not char['c'].isspace()
                      and char['bbox'][0] > px0 + 2
                      and abs((char['bbox'][1] + char['bbox'][3]) / 2 - p_mid) < 4
                      and char['bbox'][0] - px1 < 55]
        if not next_chars:
            continue
        following, _ = min(next_chars, key=lambda pair: pair[0]['bbox'][0])
        if following['c'] in ('□', 'v'):
            gap = following['bbox'][0] - px1
            assert gap >= 5.0, (
                f'Math collision on page {page.number + 1}: gap after % is {gap:.1f} pt '
                f'before {following["c"]!r}; require at least 5 pt')

root = Path(__file__).resolve().parent
lesson_path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root / 'lesson.sample.json'
out = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else root / 'out'
requested_basename = next((a.split('=', 1)[1] for a in sys.argv[3:] if a.startswith('--basename=')), '')
data = json.loads(lesson_path.read_text(encoding='utf-8'))
duration = int(data['meta']['durationMinutes'])
found = sorted(out.glob(f'{requested_basename}*_Arbeitsheft_{duration}min.pdf')) + sorted(out.glob(f'{requested_basename}*_Lehrerloesungen_{duration}min.pdf'))
if len(found) != 2:
    raise SystemExit(f'Expected exactly two PDF files in {out}, found {len(found)}')
for path in found:
    workbook = '_Arbeitsheft_' in path.name
    expected_count = len(data['workbookPages'] if workbook else data['teacherPages'])
    with fitz.open(path) as pdf:
        assert len(pdf) == expected_count, f'{path.name}: expected {expected_count}, got {len(pdf)}'
        for page in pdf:
            verify_math_spacing(page)
            rect = page.rect
            assert abs(rect.width - 595.28) < 0.6 and abs(rect.height - 841.89) < 0.6, 'not A4'
            text = page.get_text()
            assert 'MINDCRAFTI SCHOOL' in text, 'Brand text missing'
            assert len(page.get_images()) >= 1, 'Official logo missing'
            blocks = []
            for b in page.get_text('blocks'):
                block_text = b[4].strip()
                if not block_text or b[1] <= 160:
                    continue
                # The absolute-positioned footer legitimately sits below the
                # content boundary. Exclude only blocks that match the footer
                # identity, never arbitrary low-position content.
                footer_block = b[1] > 760 and (
                    'MINDCRAFTI SCHOOL' in block_text
                    or re.search(r'\\b\\d{2}\\s*/\\s*\\d{2}\\b', block_text)
                )
                if footer_block:
                    continue
                blocks.append(b)
            for b in blocks:
                assert b[0] >= -1 and b[2] <= rect.width + 1, f'Horizontal overflow on page {page.number+1}'
                assert b[3] < 789, f'Content touches footer on page {page.number+1}: {b[3]}'
        print(f'PASS: {path.name}, {len(pdf)} A4 pages, original logo on every page')
