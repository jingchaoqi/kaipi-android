#!/usr/bin/env python3
"""Build the Android runtime; never change kaipi core. Linux, uv, Rust 1.90 + NDK required."""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tomllib
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
LOCK = json.loads((ROOT / "scripts/runtime.lock.json").read_text())
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--sdk", type=Path, default=os.environ.get("ANDROID_HOME"))
parser.add_argument("--cache", type=Path, default=ROOT / ".tools/runtime")
args = parser.parse_args()
if not args.sdk:
    parser.error("Set ANDROID_HOME or --sdk")
CACHE = args.cache.resolve()
CACHE.mkdir(parents=True, exist_ok=True)
NDK = args.sdk.resolve() / "ndk/27.0.12077973/toolchains/llvm/prebuilt/linux-x86_64/bin"
ABIS = {"x86_64": "x86_64-linux-android", "arm64-v8a": "aarch64-linux-android"}
ASSETS = ROOT / "app/src/main/assets"
NATIVE = ROOT / "app/src/main/jniLibs"
PACKAGES = tomllib.loads((ROOT / "vendor/kaipi/uv.lock").read_text())["package"]


def run(*command, **kwargs):
    subprocess.run([str(x) for x in command], check=True, **kwargs)


def download(url, digest):
    path = CACHE / "downloads" / url.rsplit("/", 1)[1]
    path.parent.mkdir(exist_ok=True)
    if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        data = urllib.request.urlopen(url, timeout=120).read()
        if hashlib.sha256(data).hexdigest() != digest:
            raise RuntimeError(f"Checksum mismatch: {url}")
        path.write_bytes(data)
    return path


def unzip(archive, destination):
    with zipfile.ZipFile(archive) as package:
        package.extractall(destination)


def copy(source, destination):
    shutil.copytree(source, destination, dirs_exist_ok=True, ignore=shutil.ignore_patterns(".archive-sha256", "__pycache__", "*.pyc"))


def write_changed(path, content):
    if not path.exists() or path.read_text() != content:
        path.write_text(content)


# The publisher's CPython binaries include SSL, SQLite and the Android standard library.
for abi, digest in LOCK["python_sha256"].items():
    name = f'target-{LOCK["python"]}-{abi}.zip'
    url = f'https://repo.maven.apache.org/maven2/com/chaquo/python/target/{LOCK["python"]}/{name}'
    archive = download(url, digest)
    marker = CACHE / abi / ".archive-sha256"
    if not marker.exists() or marker.read_text() != digest:
        shutil.rmtree(CACHE / abi, ignore_errors=True)
        unzip(archive, CACHE / abi)
        marker.write_text(digest)

# Follow the upstream runtime dependency graph, including declared extras, excluding dev tools.
by_name = {p["name"]: p for p in PACKAGES}
selected = {}
pending = [{"name": "kaipi"}]
while pending:
    dependency = pending.pop()
    name = dependency["name"]
    package = by_name[name]
    for extra in dependency.get("extra", []):
        pending.extend(package.get("optional-dependencies", {}).get(extra, []))
    if name not in selected:
        selected[name] = package
        pending.extend(package.get("dependencies", []))
pure, native = [], []
for name, package in selected.items():
    if name == "kaipi":
        continue
    wheel = next((w for w in package.get("wheels", []) if w["url"].endswith("none-any.whl")), None)
    if wheel:
        pure.append(wheel)
    else:
        native.append(name)


def install_pure(wheel):
    unzip(download(wheel["url"], wheel["hash"].split(":")[1]), CACHE / "site-packages")


shutil.rmtree(CACHE / "site-packages", ignore_errors=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    list(pool.map(install_pure, pure))
if not (CACHE / "build-env/bin/python").exists():
    run("uv", "venv", "--python", "3.13.16", CACHE / "build-env")
run("uv", "pip", "install", "--python", CACHE / "build-env/bin/python", "maturin==1.16.0")
for target in ABIS.values():
    run("rustup", "target", "add", "--toolchain", "1.90.0", target)

# Only the TUI's native extensions are currently ported. Attachment libraries remain explicit.
for name in ["pydantic-core", "jiter"]:
    package = by_name[name]
    source = package["sdist"]
    archive = download(source["url"], source["hash"].split(":")[1])
    with tarfile.open(archive) as tar:
        directory = CACHE / "sources" / tar.getnames()[0].split("/")[0]
        if not directory.exists():
            tar.extractall(CACHE / "sources", filter="data")
    for abi, target in ABIS.items():
        config = CACHE / f"pyo3-{abi}.txt"
        write_changed(config, f"implementation=CPython\nversion=3.13\nshared=true\nabi3=false\n"
                          f"lib_name=python3.13\nlib_dir={CACHE / abi / 'jniLibs' / abi}\npointer_width=64\next_suffix=.cpython-313-{target}.so\n")
        env = os.environ.copy()
        env.update(PYO3_CONFIG_FILE=str(config), RUSTUP_TOOLCHAIN="1.90.0", CARGO_BUILD_JOBS="3")
        env["PATH"] = str(NDK) + ":" + env["PATH"]
        env["CARGO_TARGET_" + target.upper().replace("-", "_") + "_LINKER"] = str(NDK / (target + "26-clang"))
        env["CC_" + target.replace("-", "_")] = str(NDK / (target + "26-clang"))
        env["AR_" + target.replace("-", "_")] = str(NDK / "llvm-ar")
        run(CACHE / "build-env/bin/maturin", "build", "--release", "--locked", "--target", target,
            "--out", CACHE / "wheels" / abi, cwd=directory, env=env)

archive = download(f'https://www.kernel.org/pub/software/scm/git/git-{LOCK["git"]}.tar.xz', LOCK["git_sha256"])
with tarfile.open(archive) as tar:
    tar.extractall(CACHE / "sources", filter="data")
shutil.rmtree(ASSETS / "runtime/python", ignore_errors=True)
shutil.rmtree(ASSETS / "runtime-abi", ignore_errors=True)
for abi, target in ABIS.items():
    source = CACHE / "sources" / ("git-" + abi)
    if not source.exists():
        copy(CACHE / "sources" / ("git-" + LOCK["git"]), source)
    # Build-time scripts use the host shell; compiled Git uses Android's shell.
    for name in ["Makefile", "shared.mak"]:
        file = source / name
        write_changed(file, file.read_text().replace("$(SHELL_PATH) ", "/bin/sh "))
    flags = ["CSPRNG_METHOD=arc4random", "NO_PTHREADS=YesPlease", "NO_CURL=YesPlease", "NO_OPENSSL=YesPlease",
             "NO_GETTEXT=YesPlease", "NO_ICONV=YesPlease", "NO_PERL=YesPlease", "NO_PYTHON=YesPlease",
             "NO_TCLTK=YesPlease", "NO_REGEX=NeedsStartEnd", "NO_MMAP=YesPlease", "NO_SYS_POLL_H=YesPlease"]
    run("make", "-j2", "git", "SHELL=/bin/sh", "SHELL_PATH=/system/bin/sh", "CFLAGS=-O2 -fPIE", "LDFLAGS=-pie",
        f"CC={NDK / (target + '26-clang')}", f"AR={NDK / 'llvm-ar'}", *flags, cwd=source)
    libraries = NATIVE / abi
    shutil.rmtree(libraries, ignore_errors=True)
    copy(CACHE / abi / "jniLibs" / abi, libraries)
    shutil.copy2(source / "git", libraries / "libkaipi_git.so")
    run(NDK / (target + "26-clang"), "-O2", "-fPIE", "-pie", "-Wl,-z,max-page-size=16384", "-Wl,-rpath,$ORIGIN",
        "-I" + str(CACHE / abi / "include/python3.13"), ROOT / "app/src/main/cpp/python.c",
        "-L" + str(libraries), "-lpython3.13", "-o", libraries / "libkaipi_python.so")
    python = ASSETS / "runtime-abi" / abi / "python/lib/python3.13"
    copy(CACHE / abi / "lib-dynload" / abi, python / "lib-dynload")
    for name in ["pydantic-core", "jiter"]:
        wheels = list((CACHE / "wheels" / abi).glob(f"{name.replace('-', '_')}-{by_name[name]['version']}-*.whl"))
        if len(wheels) != 1:
            raise RuntimeError(f"Expected one {name} wheel for {abi}")
        unzip(wheels[0], python / "site-packages")

python = ASSETS / "runtime/python/lib/python3.13"
copy(CACHE / "stdlib", python)
copy(CACHE / "site-packages", python / "site-packages")
missing = sorted(set(native) - {"pydantic-core", "jiter"})
(ASSETS / "runtime-status.json").write_text(json.dumps({"python": LOCK["python"], "unavailableNative": missing}, indent=2) + "\n")
print("Built TUI runtime. Attachment native dependencies not yet ported:", ", ".join(missing))
