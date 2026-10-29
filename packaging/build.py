#!/usr/bin/env python3
"""Build a private LOOPKIND Linux preview from an exact clean source commit."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

NODE_SHA256 = '94efd062ed066c1a0b332e18249859c905e920eeada5df55d24c99b919629a90'
LICENSE_SHA256 = 'c738ae413cf561f174e34f6961f8ca458aae2369a73640dda6234c629b98bcc4'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def git(source, *args):
    return subprocess.check_output(['git', '-C', str(source), *args])

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--node', type=Path, required=True)
    parser.add_argument('--node-license', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--version', default='0.1.0-integrated-preview.1')
    args = parser.parse_args()
    source = args.source.resolve()
    head = git(source, 'rev-parse', 'HEAD').decode().strip()
    if head != args.commit:
        parser.error('--commit must equal the full source HEAD')
    if git(source, 'status', '--porcelain', '--untracked-files=all'):
        parser.error('source worktree must be clean, including untracked files')
    if not args.version or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_' for c in args.version):
        parser.error('version must contain only letters, digits, dots, hyphens or underscores')
    node = args.node.read_bytes()
    if digest(node) != NODE_SHA256:
        parser.error('Node binary does not match the pinned Node 22.23.4 SHA-256')
    license_data = args.node_license.read_bytes()
    if digest(license_data) != LICENSE_SHA256:
        parser.error('Node LICENSE does not match the pinned runtime distribution')
    entries = {}
    for record in git(source, 'ls-tree', '-rz', '--full-tree', head).split(b'\0'):
        if not record:
            continue
        meta, name_bytes = record.split(b'\t', 1)
        mode, kind, object_id = meta.decode().split()
        name = name_bytes.decode('utf-8')
        if kind != 'blob' or mode not in ('100644', '100755'):
            parser.error('unsupported tracked entry (symlink/submodule): ' + name)
        if name.startswith('/') or '..' in name.split('/'):
            parser.error('unsafe tracked path: ' + name)
        data = git(source, 'cat-file', 'blob', object_id)
        entries['app/' + name] = (data, 0o755 if mode == '100755' else 0o644)
    for required in ['app/server.mjs', 'app/packaging/start.sh', 'app/packaging/README.md']:
        if required not in entries:
            parser.error('source must contain tracked ' + required.removeprefix('app/'))
    entries['runtime/bin/node'] = (node, 0o755)
    entries['runtime/LICENSE'] = (license_data, 0o644)
    entries['start.sh'] = (entries['app/packaging/start.sh'][0], 0o755)
    entries['README.md'] = (entries['app/packaging/README.md'][0], 0o644)
    manifest = {
        'product': 'LOOPKIND', 'version': args.version,
        'distribution': 'private Linux integrated preview',
        'source_commit': head,
        'source_provenance': 'Integrated from captured uncommitted upstream candidate source; this packaging commit does not establish upstream adoption.',
        'contributors': ['hamon-b378a5de (primary owner)', 'hamon-8257-20261027 (inherited autosave and 24:00 fixes)', 'hamon-e5de3c (keyboard editor lifetime)', 'loopkind-provider-status-lifetime-cd4280d1 (provider discovery lifetime)', 'estate-4610aa27 (deadline recovery, omissions, composition)'],
        'runtime': {'version': '22.23.4', 'platform': 'linux-x64', 'sha256': NODE_SHA256, 'license_sha256': LICENSE_SHA256},
        'files': {name: {'sha256': digest(data), 'bytes': len(data), 'mode': oct(mode)} for name, (data, mode) in sorted(entries.items())},
        'manifest_note': 'Hashes cover every payload file; BUILD.json does not hash itself.'
    }
    entries['BUILD.json'] = ((json.dumps(manifest, indent=2) + '\n').encode(), 0o644)
    # Exclusive creation prevents accidental replacement of an existing package.
    with args.output.open('xb') as output:
        try:
            with gzip.GzipFile(fileobj=output, mode='wb', filename='', mtime=0) as compressed, tarfile.open(fileobj=compressed, mode='w') as archive:
                for name, (data, mode) in sorted(entries.items()):
                    info = tarfile.TarInfo('loopkind-' + args.version + '/' + name)
                    info.size = len(data)
                    info.mode = mode
                    info.mtime = 0
                    archive.addfile(info, io.BytesIO(data))
        except BaseException:
            output.close()
            args.output.unlink()
            raise
    print(json.dumps({'output': str(args.output), 'source_commit': head, 'sha256': digest(args.output.read_bytes())}))

if __name__ == '__main__':
    main()
