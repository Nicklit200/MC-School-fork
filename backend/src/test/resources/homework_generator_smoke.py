"""Use the exact production renderer on fixtures emitted by the Java compiler.
No network, real pupil data, or provider calls are needed."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json
import subprocess
import sys
import time

root, fixtures, output = (Path(x).resolve() for x in sys.argv[1:4])
expected_files = {f'homework-{day}.json' for day in range(1, 8)} | {'lesson.json'}
assert {p.name for p in fixtures.glob('*.json')} == expected_files, 'Missing smoke fixtures'

def render(source):
    start = time.monotonic()
    dest = output / source.stem
    dest.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(['node', str(root / 'generate.mjs'), '--lesson='+str(source),
                             '--out='+str(dest), '--basename=Smoke'],
                             cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             text=True, timeout=115)
    if result.returncode:
        raise AssertionError(source.name + ' render failed:\n' + result.stdout[-16000:])
    math = json.loads((dest / 'Smoke_math-qa.json').read_text())
    layout = json.loads((dest / 'Smoke_layout-qa.json').read_text())
    assert math['passed'] and layout['passed'], source.name
    files = list(dest.glob('*.pdf'))
    is_homework = source.name.startswith('homework-')
    assert len(files) == (1 if is_homework else 2), source.name
    assert (dest / 'Smoke_Arbeitsheft_30min.pdf').is_file()
    assert (dest / 'Smoke_Lehrerloesungen_30min.pdf').is_file() == (not is_homework)
    if is_homework:
        assert len(layout['documents']) == 1 and layout['documents'][0]['pageCount'] == 1
    answers = math['results']
    if source.stem == 'homework-1':
        assert [a['answer'] for a in answers] == ['3/2', '5/8'], answers
    if source.stem == 'homework-2':
        assert answers[0]['answer'] == '17', answers
    if source.stem == 'homework-3':
        assert answers[0]['answer'] == '11', answers
    if source.stem == 'homework-4':
        assert answers[0]['answers'] == ['3'], answers
    if source.stem == 'homework-5':
        assert set(answers[0]['answers']) == {'-3', '3'}, answers
    if source.stem in ('homework-6', 'homework-7'):
        assert math['visualChecked'] == 1, answers
    print(f'PASS {source.name}: {len(files)} PDF, math + A4 QA, {time.monotonic()-start:.2f}s', flush=True)
    return len(files)

started = time.monotonic()
with ThreadPoolExecutor(max_workers=3) as pool:
    counts = list(pool.map(render, sorted(fixtures.glob('*.json'))))
assert sum(counts) == 9
print(f'WORKBOOK_SMOKE_PASSED: seven homework PDFs + two ordinary lesson PDFs; {time.monotonic()-started:.2f}s', flush=True)
