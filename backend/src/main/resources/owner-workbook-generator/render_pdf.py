#!/usr/bin/env python3
"""Render one or more self-contained HTML files to vector PDFs in one WeasyPrint process."""
import sys
from weasyprint import HTML

if __name__ == '__main__':
    args = sys.argv[1:]
    if len(args) < 2 or len(args) % 2 != 0:
        raise SystemExit('Usage: python render_pdf.py input.html output.pdf [input2.html output2.pdf ...]')
    for i in range(0, len(args), 2):
        HTML(filename=args[i]).write_pdf(args[i + 1])
