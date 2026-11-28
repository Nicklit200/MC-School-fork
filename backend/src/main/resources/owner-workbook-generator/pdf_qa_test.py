"""Regression tests for unsafe or broken exports, including rejected PDF bytes."""
import hashlib
import json
import tempfile
import subprocess
import sys
import unittest
from unittest.mock import patch
from pathlib import Path

import fitz
from weasyprint import HTML

from render_pdf import inspect_layout, require_supported_engine
from verify_pdf import verify_file


ROOT = Path(__file__).resolve().parent
STYLE = '''
@page {size:A4;margin:0}
body {margin:0;font:12px Arial}
.sheet {box-sizing:border-box;width:210mm;height:297mm;padding:15mm;position:relative}
.paper-content {margin-top:35mm}
.footer {position:absolute;bottom:12mm;left:15mm;right:15mm}
'''


def document(content):
    return HTML(string=f'<style>{STYLE}</style><article class="sheet">'
                       f'<h1>MINDCRAFTI SCHOOL</h1><main class="paper-content">{content}</main>'
                       '<footer class="footer">Mindcrafti School / 1</footer></article>').render()


class LayoutRejectionTests(unittest.TestCase):
    def test_aufgabe_label_stays_separate_from_formula_in_normal_and_nested_rows(self):
        """Long ChatGPT-authored task labels must never cover formula glyphs."""
        css = (ROOT / 'styles.css').read_text(encoding='utf-8')
        for nested in (False, True):
            with self.subTest(nested_grid=nested):
                task = ('<div class="task-row">'
                        '<span class="item-label">Aufgabe</span>'
                        '<div class="expression-wrap"><span class="formula">'
                        '3(2x - 4) - 2(x + 5) + 7'
                        '</span></div></div>')
                if nested:
                    task = '<div class="layout-grid" style="grid-template-columns:1fr">' + task + '</div>'
                html = ('<meta charset="utf-8"><style>' + css + '</style>'
                        '<article class="sheet student"><main class="paper-content">'
                        + task + '</main></article>')
                pdf_bytes = HTML(string=html).write_pdf()
                with fitz.open(stream=pdf_bytes, filetype='pdf') as pdf:
                    spans = [span for block in pdf[0].get_text('dict')['blocks']
                             for line in block.get('lines', []) for span in line.get('spans', [])]
                label = next(span['bbox'] for span in spans if span['text'].strip() == 'Aufgabe')
                expression = next(span['bbox'] for span in spans if span['text'].strip().startswith('3(2x'))
                self.assertGreaterEqual(expression[0], label[2] - 0.5,
                                        'Task label overlaps the mathematical expression')

    def test_batch_render_checks_the_second_document_and_fails_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = []
            for name, height in [('valid', 100), ('overflow', 1100)]:
                html, pdf = root / f'{name}.html', root / f'{name}.pdf'
                html.write_text(f'<style>{STYLE}</style><article class="sheet"><h1>MINDCRAFTI SCHOOL</h1>'
                                f'<main class="paper-content"><div class="block" data-qa="task" style="height:{height}px">Task</div></main>'
                                '<footer class="footer">Mindcrafti School / 1</footer></article>', encoding='utf-8')
                paths.extend([str(html), str(pdf)])
            result = subprocess.run([sys.executable, str(ROOT / 'render_pdf.py'), *paths],
                                    capture_output=True, text=True, timeout=30)
            self.assertNotEqual(result.returncode, 0)
            report = json.loads((root / 'overflow.pdf.layout.json').read_text(encoding='utf-8'))
            self.assertFalse(report['passed'])
            self.assertFalse((root / 'overflow.pdf').exists())

    def test_unverified_weasyprint_version_is_rejected(self):
        with patch('render_pdf.weasyprint.__version__', '71.0'):
            with self.assertRaisesRegex(RuntimeError, 'requires WeasyPrint 70.0'):
                require_supported_engine()

    def test_well_formed_page_is_accepted(self):
        self.assertTrue(inspect_layout(document('<div class="block" data-qa="task">Solve the task.</div>'))['passed'])

    def test_overflowing_svg_is_rejected(self):
        report = inspect_layout(document('<div class="block" style="width:100px">'
                                         '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="80">'
                                         '<rect width="1000" height="80"/></svg></div>'))
        self.assertFalse(report['passed'])
        self.assertTrue(any('exceeds its block' in issue or 'outside A4' in issue for issue in report['issues']))

    def test_footer_overlap_is_rejected(self):
        report = inspect_layout(document('<div class="block" data-qa="task" style="height:1000px">Task</div>'))
        self.assertFalse(report['passed'])
        self.assertTrue(any('footer' in issue or 'fragmented' in issue for issue in report['issues']))

    def test_tiny_answer_area_is_rejected(self):
        report = inspect_layout(document('<div class="block" data-qa="answer" style="width:10px;height:5px"></div>'))
        self.assertFalse(report['passed'])
        self.assertTrue(any('answer area too small' in issue for issue in report['issues']))


class PdfRejectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'test.pdf'

    def fixture(self, body='Solve this mathematical task.', html='<p>Solve this mathematical task.</p>'):
        with fitz.open() as pdf:
            page = pdf.new_page(width=595.28, height=841.89)
            page.insert_text((50, 60), 'MINDCRAFTI SCHOOL')
            page.insert_image(fitz.Rect(520, 40, 560, 80), filename=str(ROOT / 'assets' / 'logo-m.png'))
            if body:
                page.insert_text((50, 220), body)
            pdf.save(self.path)
        self.path.with_suffix('.html').write_text(html, encoding='utf-8')
        self.report = {'passed': True, 'pageCount': 1, 'engine': 'weasyprint-70.0', 'pages': [{'footerTop': 1040}],
                       'pdfSha256': hashlib.sha256(self.path.read_bytes()).hexdigest()}
        self.write_report()

    def write_report(self):
        Path(str(self.path) + '.layout.json').write_text(json.dumps(self.report), encoding='utf-8')

    def test_complete_export_is_accepted(self):
        self.fixture()
        self.assertTrue(verify_file(self.path, 1)['layoutPassed'])

    def test_footer_detection_does_not_depend_on_font_whitespace(self):
        self.fixture()
        with fitz.open(self.path) as pdf:
            pdf[0].insert_text((50, 804), 'MINDCRAFTI SCHOOL / Name', fontname='cour', fontsize=9)
            pdf.save(self.path, incremental=True, encryption=fitz.PDF_ENCRYPT_KEEP)
        self.report['pdfSha256'] = hashlib.sha256(self.path.read_bytes()).hexdigest()
        self.write_report()
        self.assertTrue(verify_file(self.path, 1)['layoutPassed'])

    def test_raw_tex_visible_in_html_is_rejected(self):
        self.fixture(html=r'<p>Compute \frac{x+1}{2}.</p>')
        with self.assertRaisesRegex(AssertionError, 'Raw LaTeX in visible HTML'):
            verify_file(self.path, 1)

    def test_raw_tex_visible_in_pdf_is_rejected(self):
        self.fixture(body=r'Compute \sqrt{x+4}.')
        with self.assertRaisesRegex(AssertionError, 'Raw LaTeX in PDF'):
            verify_file(self.path, 1)

    def test_mathjax_error_is_rejected(self):
        self.fixture(html='<svg data-mml-node="merror"></svg>')
        with self.assertRaisesRegex(AssertionError, 'MathJax error'):
            verify_file(self.path, 1)

    def test_accidental_blank_page_is_rejected(self):
        self.fixture(body='', html='<h1>MINDCRAFTI SCHOOL</h1>')
        with self.assertRaisesRegex(AssertionError, 'Accidental empty page'):
            verify_file(self.path, 1)

    def test_layout_report_cannot_be_reused_for_different_pdf_bytes(self):
        self.fixture()
        with self.path.open('ab') as file:
            file.write(b'\n% modified after geometry QA\n')
        with self.assertRaisesRegex(AssertionError, 'different PDF'):
            verify_file(self.path, 1)

    def test_missing_layout_report_is_rejected(self):
        self.fixture()
        Path(str(self.path) + '.layout.json').unlink()
        with self.assertRaisesRegex(AssertionError, 'Missing renderer geometry QA'):
            verify_file(self.path, 1)

    def test_failed_geometry_report_is_rejected(self):
        self.fixture()
        self.report['passed'] = False
        self.write_report()
        with self.assertRaisesRegex(AssertionError, 'Layout QA failed'):
            verify_file(self.path, 1)

    def test_wrong_geometry_engine_is_rejected(self):
        self.fixture()
        self.report['engine'] = 'weasyprint-69.0'
        self.write_report()
        with self.assertRaisesRegex(AssertionError, 'Unsupported renderer geometry QA engine'):
            verify_file(self.path, 1)


if __name__ == '__main__':
    unittest.main()
