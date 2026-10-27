"""Package only distributable extension files; no credentials, tests, or tools."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo
import hashlib
import json

root = Path(__file__).resolve().parents[2]
extension = root / 'extension'
out = root / 'frontend' / 'public' / 'downloads'
out.mkdir(parents=True, exist_ok=True)
manifest = json.loads((extension / 'manifest.json').read_text())
allowed_roots = {'popup', 'dashboard', 'shared', 'icons'}
allowed_top = {'manifest.json', 'background.js', 'content.js'}
allowed_suffixes = {'.json', '.js', '.css', '.html', '.svg', '.png'}
target = out / 'unoword-extension.zip'
with ZipFile(target, 'w', ZIP_DEFLATED, compresslevel=9) as archive:
    for file in sorted(extension.rglob('*')):
        relative = file.relative_to(extension)
        if not file.is_file() or file.suffix not in allowed_suffixes:
            continue
        if relative.parts[0] not in allowed_roots and str(relative) not in allowed_top:
            continue
        item = ZipInfo('unoword/' + relative.as_posix(), date_time=(2026, 1, 1, 0, 0, 0))
        item.compress_type = ZIP_DEFLATED
        item.external_attr = 0o644 << 16
        archive.writestr(item, file.read_bytes())
metadata = {'version': manifest['version'], 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'file': target.name}
(out / 'release.json').write_text(json.dumps(metadata, indent=2) + '\n')
print(f"Packaged UnoWord {metadata['version']}: {target.stat().st_size} bytes")
