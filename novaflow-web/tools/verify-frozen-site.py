"""Read-only comparison of a frozen site ZIP and its complete staged asset tree."""
import hashlib
import os
from pathlib import Path, PurePosixPath
import sys
import zipfile


def digest(stream):
    value = hashlib.sha256()
    while True:
        chunk = stream.read(1024 * 1024)
        if not chunk:
            return value.digest()
        value.update(chunk)


def verify(archive, root):
    root = Path(root)
    members = {}
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.infolist():
            raw = member.filename
            while raw.startswith('./'):
                raw = raw[2:]
            if not raw or member.is_dir():
                continue
            part = PurePosixPath(raw)
            if '\\' in raw or part.is_absolute() or any(x in ('', '.', '..') for x in part.parts):
                raise ValueError('Unsafe archive path')
            if raw in members:
                raise ValueError('Duplicate archive path')
            members[raw] = member
        files = set()
        for parent, dirs, names in os.walk(root, followlinks=False):
            for name in dirs:
                if (Path(parent) / name).is_symlink():
                    raise ValueError('Symbolic link in staged directory')
            for name in names:
                path = Path(parent) / name
                if path.is_symlink() or not path.is_file():
                    raise ValueError('Staged asset is not a regular file')
                files.add(path.relative_to(root).as_posix())
        if files != set(members):
            raise ValueError('Frozen ZIP and staged asset names differ')
        for name, member in members.items():
            with bundle.open(member) as original, open(root.joinpath(*PurePosixPath(name).parts), 'rb') as staged:
                if digest(original) != digest(staged):
                    raise ValueError('Frozen ZIP and staged asset bytes differ')
    return len(files)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Expected ZIP and asset directory')
    print('verified files:', verify(sys.argv[1], sys.argv[2]))
