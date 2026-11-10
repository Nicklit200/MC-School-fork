#!/usr/bin/env python3
"""Render offline HTML and check actual layout before clipped content is lost.

Box inspection uses the private layout tree of pinned WeasyPrint 70.0. A version
change requires the regression fixtures and this adapter to be verified together.
"""
import json
import hashlib
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import weasyprint
from weasyprint import HTML
from weasyprint.urls import URLFetcher

SUPPORTED_VERSION = '70.0'
LAYOUT_ENGINE = f'weasyprint-{SUPPORTED_VERSION}'


def require_supported_engine():
    if weasyprint.__version__ != SUPPORTED_VERSION:
        raise RuntimeError(f'Layout QA requires WeasyPrint {SUPPORTED_VERSION}; installed {weasyprint.__version__}')


def classes(box):
    return set(box.element.get('class', '').split()) if box.element is not None else set()


def bounds(box):
    return (box.border_box_x(), box.border_box_y(),
            box.border_box_x() + box.border_width(), box.border_box_y() + box.border_height())


def inspect_layout(document):
    require_supported_engine()
    issues, task_pages, summaries = [], {}, []
    for index, page in enumerate(document.pages):
        boxes = list(page._page_box.descendants())
        principal = [b for b in boxes if type(b).__name__ not in ('TextBox', 'LineBox', 'InlineBox')]
        sheets = [b for b in principal if 'sheet' in classes(b)]
        main = next((b for b in principal if 'paper-content' in classes(b)), None)
        footer = next((b for b in principal if 'footer' in classes(b)), None)
        plain = len(sheets) == 1 and 'plain' in classes(sheets[0])
        if len(sheets) != 1 or main is None or (footer is None and not plain):
            issues.append(f'Page {index + 1}: missing or fragmented page structure')
            continue
        sheet = sheets[0]
        sx0, sy0, sx1, sy1 = bounds(sheet)
        mx0, my0, mx1, my1 = bounds(main)
        # Plain supplements have no visible footer or metadata. Keep the same
        # measured content boundary, 14 mm from the bottom of their A4 sheet.
        footer_top = sy1 - 14 * 96 / 25.4 if plain else bounds(footer)[1]
        if sx0 < -1 or sy0 < -1 or sx1 > page.width + 1 or sy1 > page.height + 1:
            issues.append(f'Page {index + 1}: sheet outside A4')
        if my1 > footer_top - 3:
            issues.append(f'Page {index + 1}: content overlaps footer')
        for box in boxes:
            if box is page._page_box or box.element is None:
                continue
            x0, y0, x1, y1 = bounds(box)
            if box.element_tag not in ('html', 'body', 'article') and (
                    x0 < -1 or y0 < -1 or x1 > page.width + 1 or y1 > page.height + 1):
                issues.append(f'Page {index + 1}: {box.element_tag} outside A4')
            if box.element.get('data-qa') == 'task' and box in principal:
                key = id(box.element)
                task_pages.setdefault(key, set()).add(index)
                if y1 > footer_top - 3:
                    issues.append(f'Page {index + 1}: task overlaps footer')
            if box.element.get('data-qa') == 'answer' and box in principal:
                if box.width < 37 or box.height < 18:
                    issues.append(f'Page {index + 1}: answer area too small')
        # Every painted descendant must fit its containing block horizontally.
        # This catches an SVG wider than a narrow split column even if the PDF
        # clips it and its path glyphs are absent from extracted text.
        def check_children(box, container=None):
            tags = classes(box)
            if 'block' in tags or 'teacher-block' in tags:
                container = bounds(box)
            if container and (type(box).__name__ in ('TextBox', 'InlineReplacedBox', 'BlockReplacedBox')):
                x0, _, x1, _ = bounds(box)
                if x0 < container[0] - 1.5 or x1 > container[2] + 1.5:
                    issues.append(f'Page {index + 1}: text or SVG exceeds its block')
            for child in getattr(box, 'children', ()):
                check_children(child, container)
        check_children(page._page_box)
        summaries.append({'page': index + 1, 'width': page.width, 'height': page.height,
                          'contentTop': my0, 'contentBottom': my1, 'footerTop': footer_top, 'plain': plain})
    if any(len(pages) != 1 for pages in task_pages.values()):
        issues.append('A task was split between pages')
    return {'passed': not issues, 'pageCount': len(document.pages),
            'taskCount': len(task_pages), 'pages': summaries, 'issues': sorted(set(issues))}


def render(source, destination):
    require_supported_engine()
    # The renderer consumes only code-built HTML, data PNG logo and vector SVG.
    # Forbid network and local-file resource fetches, including SVG subresources.
    fetcher = URLFetcher(allowed_protocols={'data'}, allow_redirects=False, fail_on_errors=True)
    document = HTML(filename=str(source), url_fetcher=fetcher).render()
    report = inspect_layout(document)
    report['engine'] = LAYOUT_ENGINE
    Path(str(destination) + '.layout.json').write_text(json.dumps(report), encoding='utf-8')
    if not report['passed']:
        raise ValueError('Layout QA failed: ' + '; '.join(report['issues'][:12]))
    document.write_pdf(str(destination))
    report['pdfSha256'] = hashlib.sha256(Path(destination).read_bytes()).hexdigest()
    Path(str(destination) + '.layout.json').write_text(json.dumps(report), encoding='utf-8')


if __name__ == '__main__':
    args = sys.argv[1:]
    if len(args) < 2 or len(args) % 2:
        raise SystemExit('Usage: python render_pdf.py input.html output.pdf [input2.html output2.pdf ...]')
    pairs = [(Path(args[i]), Path(args[i + 1])) for i in range(0, len(args), 2)]
    # Reuse one imported runtime for both independent documents. Each render
    # keeps its own fetcher, layout tree and hash-bound QA sidecar.
    with ThreadPoolExecutor(max_workers=min(2, len(pairs))) as pool:
        jobs = [pool.submit(render, source, destination) for source, destination in pairs]
        for job in jobs:
            job.result()
