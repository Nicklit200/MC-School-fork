"""One-time, offline migration helper. Existing source data is always read-only."""
import argparse
import contextlib
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
import uuid
import zipfile

module_path = Path(__file__).with_name('data-package.py')
if not module_path.exists():
    module_path = Path(__file__).parent.parent / 'data-package.py'
spec = importlib.util.spec_from_file_location('tsubera_data_package', module_path)
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)

def atomic_json(path, value):
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(temporary, path)

def archive_info(archive):
    with zipfile.ZipFile(archive) as zipped:
        entries = zipped.infolist()
        if len(entries) > 20000 or sum(entry.file_size for entry in entries) > 512 * 1024 * 1024 or any(entry.file_size > 160 * 1024 * 1024 for entry in entries):
            raise RuntimeError('Archive expanded size exceeds the migration safety limit')
    with package.open_package(archive) as root:
        verification = package.verify_directory(root)
        manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    return {'archiveSha256': package.sha_file(archive), 'archiveBytes': archive.stat().st_size, 'verification': verification, 'manifest': manifest}

def backup(source, state):
    source, state = source.resolve(), state.resolve()
    state.mkdir(parents=True, exist_ok=True)
    marker = state / 'baseline.json'
    if marker.exists():
        saved = json.loads(marker.read_text(encoding='utf-8'))
        directory = state / saved['backupDirectory']
        if directory.parent != state or not directory.name.startswith('before-'):
            raise RuntimeError('Invalid baseline directory')
        info = archive_info(directory / 'Tsubera-data.zip')
        if info != {key: saved[key] for key in info}:
            raise RuntimeError('Existing baseline no longer matches its verified manifest')
        return saved
    if not (source / 'tsubera.sqlite').is_file():
        raise RuntimeError('Original database is missing; an empty replacement was not created')
    # The SQLite backup and ZIP are first created outside the existing volume.
    with tempfile.TemporaryDirectory(prefix='tsubera-baseline-') as temporary:
        export = Path(temporary) / 'export'
        package.export(source, export)
        info = archive_info(export / 'Tsubera-data.zip')
        name = 'before-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
        destination = state / name
        destination.mkdir()
        for filename in ['Tsubera-data.zip', 'Tsubera-data.zip.sha256']:
            shutil.copy2(export / filename, destination / filename)
        shutil.copy2(export / 'snapshot' / 'manifest.json', destination / 'manifest.json')
        if archive_info(destination / 'Tsubera-data.zip') != info:
            raise RuntimeError('Persistent baseline backup failed verification')
    saved = {**info, 'backupDirectory': name}
    atomic_json(marker, saved)
    return saved

def restore(archive, target, state, expected):
    archive, target, state = archive.resolve(), target.resolve(), state.resolve()
    if package.sha_file(archive) != expected:
        raise RuntimeError('Uploaded ZIP SHA256 does not match the expected checksum')
    info = archive_info(archive)
    state.mkdir(parents=True, exist_ok=True)
    if target.exists() and any(target.iterdir()):
        verification = package.verify_directory(target)
        manifest = json.loads((target / 'manifest.json').read_text(encoding='utf-8'))
        if verification != info['verification'] or manifest != info['manifest']:
            raise RuntimeError('Restore target already contains different data; existing files were preserved')
        saved = {**info, 'idempotent': True}
        atomic_json(state / 'imported.json', saved)
        return saved
    staging = target.with_name('.' + target.name + '-staging-' + uuid.uuid4().hex)
    try:
        package.restore(archive, staging)
        if target.exists():
            if not target.is_dir() or any(target.iterdir()):
                raise RuntimeError('Restore target changed during verification')
            target.rmdir()  # Only the explicit, verified-empty new destination.
        os.rename(staging, target)
    finally:
        if staging.exists():
            if staging.resolve().parent != target.parent.resolve() or not staging.name.startswith('.' + target.name + '-staging-'):
                raise RuntimeError('Unsafe staging cleanup target')
            shutil.rmtree(staging)
    saved = {**info, 'idempotent': False}
    atomic_json(state / 'imported.json', saved)
    return saved

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    create = commands.add_parser('backup')
    create.add_argument('--source', type=Path, required=True)
    create.add_argument('--state', type=Path, required=True)
    recover = commands.add_parser('restore')
    recover.add_argument('--archive', type=Path, required=True)
    recover.add_argument('--target', type=Path, required=True)
    recover.add_argument('--state', type=Path, required=True)
    recover.add_argument('--sha256', required=True)
    args = parser.parse_args()
    if args.command == 'backup':
        result = backup(args.source, args.state)
    else:
        result = restore(args.archive, args.target, args.state, args.sha256)
    print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    main()
