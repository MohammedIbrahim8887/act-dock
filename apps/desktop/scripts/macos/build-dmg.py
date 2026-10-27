"""Build a native Finder installer without AppleScript or UI automation.

Run via: uv run --with dmgbuild==1.6.7 python scripts/macos/build-dmg.py ...
The application is the expanded runnable Electrobun payload, not its self-extractor.
"""
import argparse
import json
from pathlib import Path
import plistlib
import stat
import struct
import subprocess
import dmgbuild


def install_alias_icon(alias: Path, icon: Path):
    # Write the resource fork to this regular Finder alias itself. Never follow or
    # set an icon on /Applications, and never change the user's Applications folder.
    if not stat.S_ISREG(alias.lstat().st_mode):
        raise ValueError("Applications destination must be a regular Finder alias")
    data = icon.read_bytes()
    resource_data = struct.pack(">I", len(data)) + data
    data_offset = 256
    map_offset = data_offset + len(resource_data)
    map_length = 50
    header = struct.pack(">IIII", data_offset, map_offset, len(resource_data), map_length)
    resource_map = header + b"\0" * 8 + struct.pack(">HH", 28, 50)
    resource_map += struct.pack(">H4sHHhh", 0, b"icns", 0, 10, -16455, -1) + b"\0" * 8
    assert len(resource_map) == map_length
    with open(str(alias) + "/..namedfork/rsrc", "wb") as stream:
        stream.write(header + b"\0" * (data_offset - len(header)) + resource_data + resource_map)
    attributes = subprocess.run(["/usr/bin/xattr", "-px", "com.apple.FinderInfo", str(alias)], capture_output=True, text=True)
    finder_info = bytearray(bytes.fromhex(attributes.stdout)) if attributes.returncode == 0 else bytearray(b"alisMACS" + b"\0" * 24)
    flags = struct.unpack_from(">H", finder_info, 8)[0] | 0x8400
    struct.pack_into(">H", finder_info, 8, flags)
    subprocess.run(["/usr/bin/xattr", "-wx", "com.apple.FinderInfo", finder_info.hex(), str(alias)], check=True)


def build(args):
    app = Path(args.app).resolve()
    artwork = Path(args.artwork).resolve()
    layout = json.loads(Path(args.layout).read_text())
    with (app / "Contents/Info.plist").open("rb") as stream:
        info = plistlib.load(stream)
    if not info.get("CFBundleIdentifier", "").startswith("sh.actdock.desktop"):
        raise ValueError("Refusing to package an unrelated application")
    if not (app / "Contents/MacOS/bun").is_file():
        raise ValueError("Package the runnable app payload, not the self-extractor")
    alias = artwork / "Applications"
    install_alias_icon(alias, Path(args.folder_icon).resolve())
    app_name = "Act Dock.app" if args.channel == "stable" else "Act Dock Canary.app"
    volume_name = "Install Act Dock" if args.channel == "stable" else "Install Act Dock Canary"
    dmgbuild.build_dmg(args.output, volume_name, settings={
        "format": "UDZO", "filesystem": "HFS+", "compression_level": 9,
        "files": [(str(app), app_name), (str(alias), "Applications")],
        "icon": str(Path(args.icon).resolve()),
        "background": str(artwork / "background.png"),
        "window_rect": ((180, 140), (layout["width"], layout["height"] + layout["titleBarHeight"])),
        "icon_locations": {app_name: tuple(layout["appPosition"]), "Applications": tuple(layout["applicationsPosition"])},
        "icon_size": layout["iconSize"], "text_size": layout["textSize"],
        "label_pos": "bottom", "arrange_by": None,
        # No hide_extensions: it writes Finder info onto the signed bundle, which strict Gatekeeper checks reject.
        "default_view": "icon-view",
        "show_toolbar": False, "show_sidebar": False, "show_status_bar": False,
        "show_tab_view": False, "show_pathbar": False, "show_icon_preview": False,
        "include_icon_view_settings": True, "include_list_view_settings": False,
    })
    subprocess.run(["/usr/bin/hdiutil", "verify", args.output], check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for name in ["app", "artwork", "layout", "icon", "folder-icon", "output"]:
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--channel", choices=["stable", "canary"], required=True)
    build(parser.parse_args())
