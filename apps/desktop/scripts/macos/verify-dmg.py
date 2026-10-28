"""Verify the actual read-only Finder image, including native layout and payload."""
import json
import hashlib
from pathlib import Path
import plistlib
import struct
import subprocess
import sys
import tempfile
from ds_store import DSStore


def verify(image):
    with tempfile.TemporaryDirectory(prefix="act-dock-dmg-check-") as temporary:
        mount = Path(temporary) / "volume"
        mount.mkdir()
        subprocess.run(["/usr/bin/hdiutil", "attach", "-readonly", "-nobrowse", "-mountpoint", str(mount), image], check=True, capture_output=True)
        try:
            visible = sorted(p.name for p in mount.iterdir() if not p.name.startswith("."))
            apps = list(mount.glob("*.app"))
            assert len(apps) == 1 and "Applications" in visible, visible
            app = apps[0]
            info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
            assert info["CFBundleIdentifier"].startswith("sh.actdock.desktop")
            assert (app / "Contents/MacOS/bun").is_file(), "Not the expanded runnable app"
            # An unsealed bundle is reported as "damaged" once a browser quarantines the download.
            signed = subprocess.run(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(app)], capture_output=True, text=True)
            assert signed.returncode == 0, "App bundle signature is not valid: " + signed.stderr.strip()
            details = subprocess.run(["/usr/bin/codesign", "-dv", str(app)], capture_output=True, text=True).stderr
            assert "Sealed Resources version=2" in details, "App bundle resources are not sealed"
            payload = app / "Contents/Resources/app"
            for name in ["act-dock", "act", "act-dock-helper", "act-LICENSE.txt", "helper-LICENSES.txt", "helper-dependencies.jsonl"]:
                assert (payload / name).is_file(), "Bundled dependency missing: " + name
            helper_hash = hashlib.sha256((payload / "act-dock-helper").read_bytes()).hexdigest()
            assert helper_hash == (payload / "act-dock-helper.sha256").read_text().split()[0], "Signed helper checksum differs"
            assert "0.2.89" in subprocess.check_output([str(payload / "act"), "--version"], text=True)
            parsed = json.loads(subprocess.check_output([str(payload / "act-dock-helper")], input='{"op":"parse_dotenv","value":"FIXTURE=value"}', text=True))
            assert parsed.get("ok") and parsed.get("value", {}).get("FIXTURE") == "value", "Packaged helper cannot execute"
            icon = info.get("CFBundleIconFile", "")
            icon_file = app / "Contents/Resources" / (icon if icon.endswith(".icns") else icon + ".icns")
            assert icon_file.stat().st_size > 0, "Application icon missing"
            alias = mount / "Applications"
            assert alias.is_file() and not alias.is_symlink()
            finder_info = bytes.fromhex(subprocess.check_output(["/usr/bin/xattr", "-px", "com.apple.FinderInfo", str(alias)], text=True))
            flags = struct.unpack_from(">H", finder_info, 8)[0]
            assert flags & 0x8400 == 0x8400, "Finder alias/custom-icon flags missing"
            assert Path(str(alias) + "/..namedfork/rsrc").stat().st_size > 0
            script = 'import Foundation; let url = try URL(resolvingAliasFileAt:URL(fileURLWithPath:CommandLine.arguments[1]),options:.withoutUI); print(url.path)'
            resolved = subprocess.check_output(["/usr/bin/swift", "-e", script, str(alias)], text=True).strip()
            assert resolved == "/Applications", resolved
            with DSStore.open(str(mount / ".DS_Store"), "r") as store:
                layout = json.loads(Path("assets/macos/installer-layout.json").read_text())
                positions = {app.name: store[app.name][b"Iloc"], "Applications": store["Applications"][b"Iloc"]}
                assert tuple(positions[app.name]) == tuple(layout["appPosition"]), positions
                assert tuple(positions["Applications"]) == tuple(layout["applicationsPosition"]), positions
                window = store["."][b"bwsp"]
                assert not window["ShowSidebar"] and not window["ShowToolbar"]
                view = store["."][b"icvp"]
                assert view["iconSize"] == layout["iconSize"]
                assert view["backgroundType"] == 2, "Custom background not applied"
            assert list(mount.glob(".background*")), "Retina background missing"
            report = {"installer": str(Path(image).resolve()), "visibleItems": visible, "version": info.get("CFBundleShortVersionString", info.get("CFBundleVersion")), "positions":positions, "applicationsAlias":resolved, "customIcons":True,"customBackground":True,"runnablePayload":True}
            report.update({"helperChecksum":helper_hash,"helperExecutable":True,"engineVersion":"0.2.89","bundleSignature":True,"dependencyNotices":True})
            print(json.dumps(report, indent=2))
        finally:
            subprocess.run(["/usr/bin/hdiutil", "detach", str(mount)], check=True, capture_output=True)


if __name__ == "__main__":
    verify(str(Path(sys.argv[1]).resolve()))
