"""Offline Tsubera snapshot/verification/restore. Never uploads data or reads credentials."""
import argparse
import base64
import contextlib
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
import zipfile

FORMAT = 'tsubera-data-v1'

def sha_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()

def ro(path):
    return sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)

def q(identifier):
    return '"' + identifier.replace('"', '""') + '"'

def canonical(value):
    def encode(item):
        if isinstance(item, bytes):
            return {'$sqlite_blob_base64': base64.b64encode(item).decode('ascii')}
        raise TypeError(type(item).__name__)
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), default=encode, allow_nan=False)

def database_state(path):
    with contextlib.closing(ro(path)) as db:
        integrity = [row[0] for row in db.execute('PRAGMA integrity_check')]
        foreign = db.execute('PRAGMA foreign_key_check').fetchall()
        if integrity != ['ok'] or foreign:
            raise RuntimeError('SQLite integrity/foreign key verification failed')
        schema = sorted(db.execute('SELECT type,name,tbl_name,sql FROM sqlite_master').fetchall(), key=canonical)
        tables = {}
        for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
            cursor = db.execute('SELECT * FROM ' + q(name))
            columns = [column[0] for column in cursor.description]
            records = sorted(canonical(list(row)) for row in cursor.fetchall())
            digest = hashlib.sha256(canonical({'columns': columns, 'records': records}).encode('utf-8')).hexdigest()
            tables[name] = {'rows': len(records), 'columns': columns, 'recordsSha256': digest}
        documents = [{'id': row[0], 'storedName': row[1], 'size': row[2]} for row in db.execute('SELECT id,stored_name,size FROM documents ORDER BY id')]
        return {'schemaSha256': hashlib.sha256(canonical(schema).encode('utf-8')).hexdigest(), 'tables': tables, 'integrity': 'ok', 'foreignKeyErrors': 0}, documents

def valid_name(name):
    if not isinstance(name, str) or not name or '/' in name or '\\' in name or Path(name).name != name or name in {'.', '..'} or ':' in name:
        raise RuntimeError('Unsafe document filename')
    return name

def package_files(root):
    return sorted(path.relative_to(root).as_posix() for path in root.rglob('*') if path.is_file())

def verify_directory(root):
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('format') != FORMAT:
        raise RuntimeError('Unsupported package format')
    expected = {'manifest.json', 'tsubera.sqlite'}
    for item in manifest['documents']:
        name = valid_name(item['storedName'])
        relative = 'documents/' + name
        if relative in expected:
            raise RuntimeError('Duplicate document filename')
        expected.add(relative)
        file = root / relative
        if file.stat().st_size != item['size'] or sha_file(file) != item['sha256']:
            raise RuntimeError('Document size/hash mismatch: ' + name)
    if set(package_files(root)) != expected:
        raise RuntimeError('Unexpected or missing files in data package')
    database = root / 'tsubera.sqlite'
    if database.stat().st_size != manifest['database']['bytes'] or sha_file(database) != manifest['database']['sha256']:
        raise RuntimeError('Database byte/hash mismatch')
    state, docs = database_state(database)
    if state != manifest['database']['state']:
        raise RuntimeError('Database records/schema differ from manifest')
    references = [{key: doc[key] for key in ('id', 'storedName', 'size')} for doc in manifest['documents']]
    if docs != references:
        raise RuntimeError('Document links differ from database')
    return {'ok': True, 'tables': len(state['tables']), 'rows': {name: value['rows'] for name, value in state['tables'].items()}, 'documents': len(docs), 'documentBytes': sum(doc['size'] for doc in docs), 'databaseBytes': database.stat().st_size, 'integrity': 'ok', 'foreignKeyErrors': 0, 'allFileHashesVerified': True, 'allTableRecordsVerified': True}

@contextlib.contextmanager
def open_package(package):
    package = package.resolve()
    if package.is_dir():
        yield package
        return
    with tempfile.TemporaryDirectory(prefix='tsubera-verify-') as temporary:
        root = Path(temporary)
        with zipfile.ZipFile(package) as archive:
            names = archive.namelist()
            if len(names) != len(set(names)):
                raise RuntimeError('Duplicate ZIP entry')
            for item in archive.infolist():
                name = item.filename
                parts = name.split('/')
                if item.is_dir() or any(part in {'', '.', '..'} for part in parts) or '\\' in name or ':' in name or name.startswith('/'):
                    raise RuntimeError('Unsafe ZIP entry')
                if name not in {'manifest.json', 'tsubera.sqlite'} and not (len(parts) == 2 and parts[0] == 'documents' and valid_name(parts[1])):
                    raise RuntimeError('Unexpected ZIP entry')
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(item) as src, target.open('xb') as dst:
                    shutil.copyfileobj(src, dst)
        yield root

def export(source, output):
    source, output = source.resolve(), output.resolve()
    if source == output or source in output.parents or output.exists():
        raise RuntimeError('Output must be a new directory outside the source data directory')
    if not (source / 'tsubera.sqlite').is_file() or not (source / 'documents').is_dir():
        raise RuntimeError('Source database/documents missing')
    output.mkdir(parents=True)
    snapshot = output / 'snapshot'
    (snapshot / 'documents').mkdir(parents=True)
    database = snapshot / 'tsubera.sqlite'
    with contextlib.closing(ro(source / 'tsubera.sqlite')) as src, contextlib.closing(sqlite3.connect(database)) as dst:
        src.backup(dst)
    state, docs = database_state(database)
    for doc in docs:
        name = valid_name(doc['storedName'])
        src, dst = source / 'documents' / name, snapshot / 'documents' / name
        shutil.copy2(src, dst)
        if dst.stat().st_size != doc['size']:
            raise RuntimeError('Source file size differs from DB: ' + name)
        doc['sha256'] = sha_file(dst)
        if sha_file(src) != doc['sha256']:
            raise RuntimeError('Source file changed during snapshot: ' + name)
    manifest = {'format': FORMAT, 'createdAtUtc': dt.datetime.now(dt.timezone.utc).isoformat(), 'database': {'bytes': database.stat().st_size, 'sha256': sha_file(database), 'state': state}, 'documents': docs}
    (snapshot / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    result = verify_directory(snapshot)
    archive_path = output / 'Tsubera-data.zip'
    with zipfile.ZipFile(archive_path, mode='x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for relative in package_files(snapshot):
            archive.write(snapshot / relative, relative)
    with open_package(archive_path) as extracted:
        if verify_directory(extracted) != result:
            raise RuntimeError('Archive verification differs from snapshot')
    archive_hash = sha_file(archive_path)
    (output / 'Tsubera-data.zip.sha256').write_text(archive_hash + '  Tsubera-data.zip\n', encoding='ascii')
    # Only this separate local provenance record contains the Windows source path.
    (output / 'local-provenance.json').write_text(json.dumps({'sourceDataDirectory': str(source), 'createdAtUtc': manifest['createdAtUtc'], 'sourceOpenedReadOnly': True, 'activeDataModified': False}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    result.update({'archiveBytes': archive_path.stat().st_size, 'archiveSha256': archive_hash, 'archive': str(archive_path)})
    (output / 'verification.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    return result

def restore(package, target):
    target = target.resolve()
    if target.exists() and (not target.is_dir() or any(target.iterdir())):
        raise RuntimeError('Restore target must be absent or completely empty. Existing data is never overwritten.')
    with open_package(package) as root:
        result = verify_directory(root)
        if not target.exists():
            target.mkdir(parents=True)
        for relative in package_files(root):
            dst = target / relative
            dst.parent.mkdir(parents=True, exist_ok=True)
            with (root / relative).open('rb') as src, dst.open('xb') as stream:
                shutil.copyfileobj(src, stream)
        if verify_directory(target) != result:
            raise RuntimeError('Restored data verification failed')
        return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    create = commands.add_parser('export')
    create.add_argument('--source', type=Path, required=True)
    create.add_argument('--output', type=Path, required=True)
    verify = commands.add_parser('verify')
    verify.add_argument('--package', type=Path, required=True)
    recover = commands.add_parser('restore')
    recover.add_argument('--package', type=Path, required=True)
    recover.add_argument('--target', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'export':
        result = export(args.source, args.output)
    elif args.command == 'verify':
        with open_package(args.package) as root:
            result = verify_directory(root)
    else:
        result = restore(args.package, args.target)
    print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    main()
