"""Verify real installer payloads in a disposable Linux build container.
Requires locally built installers and act-dock-build:0.2.0; never publishes.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import struct
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]


def verify_inside():
    results = []
    for name in ["deb", "rpm", "appimage", "windows"]:
        helper_name = "act-dock-helper.exe" if name == "windows" else "act-dock-helper"
        helpers = list((Path("/tmp/verify") / name).rglob(helper_name))
        assert len(helpers) == 1, (name, "helper missing or duplicated")
        helper = helpers[0]
        payload = helper.parent
        suffix = ".exe" if name == "windows" else ""
        for dependency in ["act-dock" + suffix, "act" + suffix, "helper-LICENSES.txt", "helper-dependencies.jsonl", "act-LICENSE.txt"]:
            assert (payload / dependency).stat().st_size > 0, (name, dependency)
        checksum = hashlib.sha256(helper.read_bytes()).hexdigest()
        assert checksum == Path(str(helper) + ".sha256").read_text().split()[0], name
        inventory = [json.loads(line) for line in (payload / "helper-dependencies.jsonl").read_text().splitlines()]
        assert any(m.get("Path") == "github.com/go-git/go-git/v5" and m.get("Version") == "v5.16.5" for m in inventory), name
        if name == "windows":
            for executable in [helper, payload / "act-dock.exe", payload / "act.exe"]:
                assert executable.read_bytes()[:2] == b"MZ", executable.name
        else:
            assert helper.read_bytes()[:4] == b"\x7fELF", name
            assert "0.2.89" in subprocess.check_output([str(payload / "act"), "--version"], text=True)
            result = json.loads(subprocess.check_output([str(helper)], input='{"op":"parse_dotenv","value":"FIXTURE=value"}', text=True))
            assert result.get("ok") and result.get("value", {}).get("FIXTURE") == "value", name
        results.append({"format": name, "helperSha256": checksum, "dependenciesPresent": True, "noticesPresent": True, "helperExecuted": name != "windows", "nativeWindowsVerified": False})
        if name == "deb":
            with open("/proof/packaged-linux-cli.txt", "w") as log:
                subprocess.run([shutil.which("bun"), "test", "/source/apps/desktop/tests/service.test.ts"], cwd="/source", env={**os.environ, "ACT_DOCK_TEST_EXECUTABLE": str(payload / "act-dock")}, stdout=log, stderr=subprocess.STDOUT, check=True)
    Path("/proof/distribution.json").write_text(json.dumps({"time": datetime.now(timezone.utc).isoformat(), "linuxExecution": "AMD64 Docker emulation on macOS ARM64", "results": results, "packagedLinuxCliMcpIntegration": True, "windowsNativeGate": "not run"}, indent=2) + "\n")


if __name__ == "__main__":
    if "--extract-appimage" in sys.argv:
        path=Path("/artifacts/linux-x64-ActDock.AppImage")
        with path.open("rb") as image:
            header=image.read(64)
            assert header[:6] == b"\x7fELF\x02\x01", "Expected little-endian ELF64 AppImage"
            sections=struct.unpack_from("<Q",header,40)[0]
            size,count=struct.unpack_from("<HH",header,58)
            offset=sections+size*count
            image.seek(offset)
            assert image.read(4)==b"hsqs", "AppImage filesystem offset is invalid"
        subprocess.run(["unsquashfs","-o",str(offset),"-d","/tmp/verify/appimage",str(path)],check=True,stdout=subprocess.DEVNULL)
    elif "--inside" in sys.argv:
        verify_inside()
    else:
        image = "act-dock-verification:0.2.0"
        if subprocess.run(["docker","image","inspect",image],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode:
            recipe="FROM act-dock-build:0.2.0\nRUN apt-get -o Acquire::http::Timeout=30 -o Acquire::Retries=2 update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends p7zip-full cpio python3 && rm -rf /var/lib/apt/lists/*\n"
            subprocess.run(["docker","build","--platform","linux/amd64","-t",image,"-"],input=recipe,text=True,check=True)
        script = r'''
set -euo pipefail
mkdir -p /tmp/verify/{deb,rpm,appimage,windows}
dpkg-deb -x /artifacts/linux-x64-ActDock.deb /tmp/verify/deb
(cd /tmp/verify/rpm && rpm2cpio /artifacts/linux-x64-ActDock.rpm | cpio -idm --quiet)
python3 /source/scripts/verify-distribution.py --extract-appimage
7z x -y -o/tmp/verify/windows /artifacts/windows-x64-ActDock-Setup.exe >/dev/null
python3 /source/scripts/verify-distribution.py --inside
'''
        subprocess.run(["docker", "run", "--rm", "--platform", "linux/amd64", "-v", f"{ROOT}:/source:ro", "-v", f"{ROOT / 'artifacts'}:/artifacts:ro", "-v", f"{ROOT / 'docs/research/act-engine/optimization'}:/proof", image, "bash", "-lc", script], check=True)
