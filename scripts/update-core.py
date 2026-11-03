#!/usr/bin/env python3
"""Vendor an unmodified upstream ref. No core patches or reimplementation."""
import argparse
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("ref", nargs="?", default="master")
parser.add_argument("--source", type=Path, help="Use an existing clean upstream checkout")
args = parser.parse_args()


def git(source, *arguments):
    return subprocess.check_output(["git", "-C", str(source), *arguments], text=True).strip()


with tempfile.TemporaryDirectory() as temporary:
    source = args.source
    if source is None:
        source = Path(temporary) / "upstream"
        subprocess.run(["git", "init", "-q", str(source)], check=True)
        git(source, "fetch", "--depth=1", "https://github.com/jingchaoqi/kaipi.git", args.ref)
        git(source, "checkout", "--detach", "FETCH_HEAD")
    if git(source, "status", "--porcelain"):
        raise SystemExit("Refusing a modified upstream checkout")
    revision = git(source, "rev-parse", "HEAD")
    core = source / "kaipi"
    for required in [core / "cli.py", source / "LICENSE", source / "pyproject.toml", source / "uv.lock"]:
        if not required.is_file():
            raise SystemExit(f"Upstream layout changed: missing {required.name}")
    wheels = Path(temporary) / "wheels"
    subprocess.run(["uv", "build", "--wheel", "--out-dir", str(wheels), str(source)], check=True)
    runtime = ROOT / "app/src/main/assets/runtime"
    # This subtree and dist-info are generated exclusively from the upstream wheel.
    for old in [runtime / "kaipi", *runtime.glob("kaipi-*.dist-info")]:
        if old.exists():
            shutil.rmtree(old)
    with zipfile.ZipFile(next(wheels.glob("kaipi-*.whl"))) as wheel:
        wheel.extractall(runtime)
    metadata = ROOT / "vendor/kaipi"
    metadata.mkdir(parents=True, exist_ok=True)
    for name in ["LICENSE", "pyproject.toml", "uv.lock"]:
        shutil.copy2(source / name, metadata / name)
    (metadata / "REVISION").write_text(revision + "\n")
    print(f"kaipi core: {revision}. Review dependency changes and rebuild/test Android before release.")
