#!/usr/bin/env python3
"""Render one or more self-contained HTML files to vector PDFs in one warm WeasyPrint process."""
import sys
from concurrent.futures import ThreadPoolExecutor
from weasyprint import HTML

def render(pair):
    source, destination = pair
    HTML(filename=source).write_pdf(destination)
    return destination

if __name__ == '__main__':
    args = sys.argv[1:]
    if len(args) < 2 or len(args) % 2 != 0:
        raise SystemExit('Usage: python render_pdf.py input.html output.pdf [input2.html output2.pdf ...]')
    pairs = [(args[i], args[i + 1]) for i in range(0, len(args), 2)]
    # Workbook and teacher answers are independent documents. Keep one imported
    # WeasyPrint/Pango runtime, but render the two documents concurrently.
    with ThreadPoolExecutor(max_workers=min(2, len(pairs))) as pool:
        list(pool.map(render, pairs))
