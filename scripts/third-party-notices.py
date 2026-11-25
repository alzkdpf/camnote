"""Write dependency notices without publishing local Cargo metadata or paths."""
import json
import pathlib
import sys

metadata = json.loads(pathlib.Path(sys.argv[1]).read_text())
output = ["CamNote third-party notices\n\nThe components below retain their own licenses. This file does not license CamNote-specific code. It includes locked dependencies for other platforms and build/test tools for completeness. FFmpeg, Codex CLI and Ollama are external tools and are not bundled.\n"]
for package in sorted(metadata["packages"], key=lambda p: (p["name"], p["version"])):
    if package["name"] == "camnote":
        continue
    output.append(f"\n{'=' * 72}\n{package['name']} {package['version']}\nLicense expression: {package.get('license') or 'See included notices'}\nSource: {package.get('repository') or 'https://crates.io/crates/' + package['name']}\n")
    directory = pathlib.Path(package["manifest_path"]).parent
    files = sorted({p for pattern in ("LICENSE*", "COPYING*", "NOTICE*", "UNLICENSE*") for p in directory.glob(pattern) if p.is_file()})
    for folder in (directory / "licenses", directory / "LICENSES"):
        if folder.is_dir():
            files.extend(p for p in folder.rglob("*") if p.is_file() and p.stat().st_size < 200_000)
    for file in files:
        text = file.read_text(errors="replace")
        output.append(f"\n--- {file.relative_to(directory)} ---\n{text}\n")
pathlib.Path("THIRD_PARTY_LICENSES.txt").write_text("".join(output))
