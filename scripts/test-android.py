#!/usr/bin/env python3
"""Run the native smoke test in an already-started debug APK (adb must be connected)."""
import argparse
from pathlib import Path
import shlex
import subprocess

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--adb", default="adb")
args = parser.parse_args()


def adb(*command, **kwargs):
    return subprocess.check_output([args.adb, *command], **kwargs)


app = "dev.kaipi.android"
base = next(line.removeprefix("package:") for line in adb("shell", "pm", "path", app, text=True).splitlines() if line.endswith("/base.apk"))
abi = adb("shell", "getprop", "ro.product.cpu.abi", text=True).strip()
libraries = str(Path(base).parent / "lib" / {"arm64-v8a": "arm64", "x86_64": "x86_64"}[abi])
data = adb("shell", "run-as", app, "pwd", text=True).strip()
runtime = data + "/files/runtime"
if subprocess.run([args.adb, "shell", "run-as", app, "test", "-f", "files/runtime/.installed"]).returncode:
    raise SystemExit("Open the app and wait for runtime initialization before running this test.")
command = shlex.join(["run-as", app, "sh", "-c", "cat > files/android_smoke.py"])
adb("shell", command, input=(ROOT / "tests/android_smoke.py").read_bytes())
environment = ["HOME=" + data + "/files/home", "TMPDIR=" + data + "/files/home/tmp",
               "PYTHONHOME=" + runtime + "/python", "PYTHONPATH=" + runtime, "LD_LIBRARY_PATH=" + libraries,
               "PATH=" + data + "/files/home/bin:/system/bin"]
# Android's env treats APK paths containing '=' as assignments; use the shell's export/exec.
script = shlex.join(["export", *environment]) + "\n" + shlex.join(["exec", libraries + "/libkaipi_python.so", data + "/files/android_smoke.py"])
subprocess.run([args.adb, "shell", shlex.join(["run-as", app, "sh", "-c", script])], check=True)
