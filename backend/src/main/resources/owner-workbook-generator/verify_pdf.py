#!/usr/bin/env python3
"""QA of PDF bytes plus a hash-bound report from the actual layout engine."""
import hashlib
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
import fitz

RAW_TEX = re.compile(r'\\(?:frac|dfrac|tfrac|sqrt|begin|end|left|right|cdot|times|quad|text|overline|mathrm|mathbf)\b|\$\$')


def verify_math_spacing(page):
    chars = []
    for block in page.get_text('rawdict')['blocks']:
        for line in block.get('lines', []):
            for span in line.get('spans', []):
                chars.extend((char, span['size']) for char in span.get('chars', []))
    for percent, font_size in chars:
        if percent['c'] != '%' or font_size < 14:
            continue
        px0, py0, px1, py1 = percent['bbox']
        p_mid = (py0 + py1) / 2
        following = [(char, size) for char, size in chars if not char['c'].isspace()
                     and char['bbox'][0] > px0 + 2
                     and abs((char['bbox'][1] + char['bbox'][3]) / 2 - p_mid) < 4
                     and char['bbox'][0] - px1 < 55]
        if following:
            char, _ = min(following, key=lambda pair: pair[0]['bbox'][0])
            if char['c'] in ('□', 'v'):
                assert char['bbox'][0] - px1 >= 5, f'Math collision after % on page {page.number + 1}'


class VisibleText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hidden = 0
        self.text = []

    def handle_starttag(self, tag, attrs):
        if tag in ('svg', 'style', 'script'):
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in ('svg', 'style', 'script'):
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden:
            self.text.append(data)


def verify_file(path, expected_count, plain=False):
    layout_path = Path(str(path) + '.layout.json')
    assert layout_path.exists(), 'Missing renderer geometry QA; production exports require WeasyPrint'
    layout = json.loads(layout_path.read_text(encoding='utf-8'))
    assert layout.get('engine') == 'weasyprint-70.0', 'Unsupported renderer geometry QA engine'
    assert layout.get('passed') is True and layout.get('pageCount') == expected_count, 'Layout QA failed or page count changed'
    assert layout.get('pdfSha256') == hashlib.sha256(path.read_bytes()).hexdigest(), 'Layout QA belongs to a different PDF'
    html_path = path.with_suffix('.html')
    assert html_path.exists(), 'Missing HTML master for raw LaTeX QA'
    html = html_path.read_text(encoding='utf-8')
    if plain:
        assert '<div class="brandbar">' not in html and '<footer' not in html, 'Unexpected plain worksheet chrome'
    assert not re.search(r'data-mml-node=[\"\x27]merror|data-mjx-error', html), 'MathJax error found'
    visible = VisibleText()
    visible.feed(html)
    assert not RAW_TEX.search(''.join(visible.text)), 'Raw LaTeX in visible HTML'
    with fitz.open(path) as pdf:
        assert not pdf.is_encrypted, 'Encrypted PDF'
        assert len(pdf) == expected_count, f'{path.name}: expected {expected_count}, got {len(pdf)}'
        for page in pdf:
            verify_math_spacing(page)
            rect = page.rect
            assert abs(rect.width - 595.28) < .6 and abs(rect.height - 841.89) < .6, 'Not A4'
            text = page.get_text()
            assert not RAW_TEX.search(text), 'Raw LaTeX in PDF'
            if not plain:
                assert 'MINDCRAFTI SCHOOL' in text, 'Brand text missing'
                assert page.get_images(), 'Official logo missing'
            # PDF whitespace/line grouping depends on the installed font. Use
            # the measured footer boundary rather than a brand-text substring
            # to distinguish footer text from task content. The layout pass
            # already rejects any task or main-content box crossing this line.
            page_layout = layout['pages'][page.number]
            assert page_layout.get('plain', False) == plain, 'Wrong worksheet rendering mode'
            footer_top = page_layout['footerTop'] * .75
            # Derive the true body boundary from WeasyPrint rather than a
            # hard-coded y>185 px. Minimal orange pages may contain only a
            # short prompt at the top followed by intentionally empty writing
            # space: that is a valid task, not an accidental blank page.
            body_top = page_layout['contentTop'] * .75
            blocks = [b for b in page.get_text('blocks') if b[4].strip()
                      and b[1] >= body_top - 2 and b[1] < footer_top - 1]
            for block in blocks:
                assert block[0] >= -1 and block[2] <= rect.width + 1, f'Horizontal overflow on page {page.number + 1}'
                assert block[3] <= footer_top + 1, f'Content touches footer on page {page.number + 1}'
            drawings = page.get_drawings()
            for drawing in drawings:
                painted = drawing['rect']
                assert painted.x0 >= -1 and painted.y0 >= -1 and painted.x1 <= rect.width + 1 and painted.y1 <= rect.height + 1, 'Vector outside A4'
            for item in page.get_image_info():
                image = fitz.Rect(item['bbox'])
                assert image.x0 >= -1 and image.y0 >= -1 and image.x1 <= rect.width + 1 and image.y1 <= rect.height + 1, 'Image outside A4'
            body_text = [b for b in blocks if b[1] < min(745, footer_top - 1)]
            body_vectors = [d for d in drawings if d['rect'].y0 >= body_top - 2
                            and d['rect'].y1 < min(745, footer_top - 1)
                            and d['rect'].get_area() > 25]
            assert body_text or body_vectors, f'Accidental empty page {page.number + 1}'
        print(f'PASS: {path.name}, {len(pdf)} A4 pages, {"plain worksheet" if plain else "original logo on every page"}')
    return {'filename': path.name, 'pageCount': expected_count, 'layoutPassed': True, 'rawLatexFound': False}


def preview_plain(path, destination):
    """A cached preview of the verified first page, cropped after its content.

    The actual PDF remains a complete A4 sheet with blank space for handwriting.
    Both SVG formula paths and ordinary text contribute to the crop boundary.
    """
    with fitz.open(path) as pdf:
        page = pdf[0]
        bottoms = [b[3] for b in page.get_text('blocks') if b[4].strip()]
        bottoms += [item['rect'].y1 for item in page.get_drawings()
                    if item.get('color') is not None or item.get('fill') not in (None, (1.0, 1.0, 1.0))]
        bottoms += [fitz.Rect(item['bbox']).y1 for item in page.get_image_info()]
        bottom = min(page.rect.height, max(100, max(bottoms, default=100) + 20))
        clip = fitz.Rect(0, 0, page.rect.width, bottom)
        scale = 800 / max(clip.width, clip.height)
        page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=clip, alpha=False).save(destination)


def main():
    root = Path(__file__).resolve().parent
    lesson_path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root / 'lesson.sample.json'
    out = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else root / 'out'
    basename = next((a.split('=', 1)[1] for a in sys.argv[3:] if a.startswith('--basename=')), '')
    plain = '--plain' in sys.argv[3:]
    data = json.loads(lesson_path.read_text(encoding='utf-8'))
    duration = int(data['meta']['durationMinutes'])
    if basename:
        found = [out / f'{basename}_Arbeitsheft_{duration}min.pdf', out / f'{basename}_Lehrerloesungen_{duration}min.pdf']
    else:
        found = sorted(out.glob(f'*_Arbeitsheft_{duration}min.pdf')) + sorted(out.glob(f'*_Lehrerloesungen_{duration}min.pdf'))
    if len(found) != 2 or not all(path.is_file() for path in found):
        raise SystemExit(f'Expected exactly two PDF files in {out}')
    results = []
    for path in found:
        count = len(data['workbookPages'] if '_Arbeitsheft_' in path.name else data['teacherPages'])
        results.append(verify_file(path, count, plain))
    if plain:
        preview_plain(found[0], out / f'{basename or "workbook"}_preview.png')
    (out / f'{basename or "workbook"}_layout-qa.json').write_text(json.dumps({'passed': True, 'documents': results}), encoding='utf-8')


if __name__ == '__main__':
    main()
