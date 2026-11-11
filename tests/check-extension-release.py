"""Validate the actual distributable without extracting it or using credentials."""
import hashlib
import json
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

root = Path(__file__).resolve().parents[1]
extension = root / "extension"
downloads = root / "frontend/public/downloads"
metadata = json.loads((downloads / "release.json").read_text())
archive = downloads / "unoword-extension.zip"
manifest = json.loads((extension / "manifest.json").read_text())
assert metadata["version"] == manifest["version"]
assert metadata["file"] == archive.name
assert metadata["sha256"] == hashlib.sha256(archive.read_bytes()).hexdigest()
assert set(manifest["permissions"]) == {"storage", "activeTab", "alarms"}
assert set(manifest["host_permissions"]) == {"https://unoword.app/*", "https://unoword.vercel.app/*"}
with ZipFile(archive) as package:
    assert package.testzip() is None
    assert len(package.namelist()) == len(set(package.namelist()))
    for name in package.namelist():
        path = PurePosixPath(name)
        assert not path.is_absolute() and ".." not in path.parts
        assert path.parts[0] == "unoword"
        relative = PurePosixPath(*path.parts[1:])
        assert relative.parts[0] in {"manifest.json", "background.js", "content.js", "popup", "dashboard", "shared", "icons"}
        assert relative.suffix in {".json", ".js", ".css", ".html", ".svg", ".png", ".webp"}
        assert package.read(name) == (extension / relative).read_bytes(), f"Stale runtime file: {name}"
    assert json.loads(package.read("unoword/manifest.json")) == manifest
    assert package.read("unoword/icons/studio-header.webp") == (root / "frontend/src/assets/studio/landscape-mobile.webp").read_bytes()
    for script in manifest["content_scripts"][0]["js"] + [manifest["background"]["service_worker"], manifest["action"]["default_popup"]]:
        assert "unoword/" + script in package.namelist()
print(f"PASS distributable {manifest['version']}: runtime/source parity, archive integrity, approved permissions, metadata/checksum and supplied artwork.")
