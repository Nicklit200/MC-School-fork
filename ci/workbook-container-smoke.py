#!/usr/bin/env python3
"""Offline smoke test of the installed renderer resources in the production image.

Run using the image's existing non-root user and Python executable. No source
checkout, writable application directory, network or content-provider key is used.
"""
import json
import os
import stat
import subprocess
import sys
import tempfile
from pathlib import Path, PurePosixPath
from zipfile import ZipFile


RESOURCE_PREFIX = 'BOOT-INF/classes/owner-workbook-generator/'
RESOURCE_FILES = (
    'generate.mjs', 'pagination.mjs', 'math.mjs', 'schema.mjs', 'diagrams.mjs', 'visual-tasks.mjs', 'styles.css',
    'render_pdf.py', 'verify_pdf.py', 'algebra_qa.py', 'package.json',
    'lesson.sample.json', 'examples/production-layout-demo.json', 'assets/logo-m.png',
)
FIXTURES = ('examples/production-layout-demo.json', 'lesson.sample.json')


def extract_renderer(jar_path, renderer):
    """Copy only known workbook resources; never extract arbitrary ZIP paths."""
    renderer = renderer.resolve()
    total = 0
    with ZipFile(jar_path) as archive:
        names = archive.namelist()
        for filename in RESOURCE_FILES:
            relative = PurePosixPath(filename)
            if relative.is_absolute() or '..' in relative.parts or '\\' in filename:
                raise ValueError('Unsafe workbook resource path')
            member = RESOURCE_PREFIX + filename
            if names.count(member) != 1:
                raise ValueError(f'Packaged renderer resource is missing or duplicated: {filename}')
            info = archive.getinfo(member)
            if info.is_dir() or stat.S_ISLNK(info.external_attr >> 16) or info.file_size > 2 * 1024 * 1024:
                raise ValueError(f'Invalid packaged renderer resource: {filename}')
            total += info.file_size
            if total > 8 * 1024 * 1024:
                raise ValueError('Packaged workbook resources exceed smoke-test limit')
            destination = renderer.joinpath(*relative.parts)
            if not destination.resolve().is_relative_to(renderer):
                raise ValueError('Workbook resource escaped its temporary directory')
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(archive.read(info))


def run_fixture(renderer, workspace, fixture, env):
    output = workspace / ('output-' + Path(fixture).stem)
    basename = 'Mindcrafti_Container'
    command = ['node', str(renderer / 'generate.mjs'),
               '--lesson=' + str(renderer / fixture), '--out=' + str(output),
               '--basename=' + basename, '--logo=' + str(renderer / 'assets' / 'logo-m.png')]
    try:
        result = subprocess.run(command, cwd=renderer, env=env, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True, timeout=100, check=False)
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(f'Packaged renderer exceeded 100 seconds: {fixture}') from error
    if result.returncode:
        raise RuntimeError(f'Packaged renderer failed for {fixture}:\n{result.stdout[-6000:]}')
    print(result.stdout.strip(), flush=True)
    math_qa = json.loads((output / f'{basename}_math-qa.json').read_text(encoding='utf-8'))
    layout_qa = json.loads((output / f'{basename}_layout-qa.json').read_text(encoding='utf-8'))
    if math_qa.get('passed') is not True or layout_qa.get('passed') is not True:
        raise RuntimeError(f'Packaged renderer QA did not pass: {fixture}')
    pdfs = sorted(output.glob('*.pdf'))
    if len(pdfs) != 2 or any(pdf.stat().st_size < 1000 for pdf in pdfs):
        raise RuntimeError(f'Expected two nonempty packaged-renderer PDFs: {fixture}')
    for pdf in pdfs:
        report = json.loads(Path(str(pdf) + '.layout.json').read_text(encoding='utf-8'))
        if report.get('passed') is not True or report.get('engine') != 'weasyprint-70.0':
            raise RuntimeError(f'Packaged PDF lacks pinned layout QA: {pdf.name}')
    print(json.dumps({'fixture': fixture, 'passed': True,
                      'algebraAssertions': math_qa.get('checked'),
                      'pdfs': [{'filename': pdf.name, 'sizeBytes': pdf.stat().st_size} for pdf in pdfs]}), flush=True)


def main():
    if os.geteuid() == 0:
        raise RuntimeError('Container workbook smoke test must run as the existing non-root app user')
    jar = Path('/app/app.jar')
    modules = Path('/opt/mindcrafti-workbook/node_modules')
    if not jar.is_file() or not (modules / 'mathjax').is_dir():
        raise RuntimeError('Production JAR or installed MathJax runtime is missing')
    with tempfile.TemporaryDirectory(prefix='mindcrafti-container-smoke-') as temporary:
        workspace = Path(temporary)
        renderer = workspace / 'renderer'
        extract_renderer(jar, renderer)
        (renderer / 'node_modules').symlink_to(modules, target_is_directory=True)
        cache = workspace / 'cache'
        cache.mkdir()
        env = dict(os.environ, PYTHON_BIN=sys.executable, XDG_CACHE_HOME=str(cache))
        for fixture in FIXTURES:
            run_fixture(renderer, workspace, fixture, env)
    print('PASS packaged production renderer: non-root, offline, two fixtures, four approved PDFs', flush=True)


if __name__ == '__main__':
    main()
