"""APK entry point. CPython must be built for Android, with all pinned dependencies."""
import os
import sys
import subprocess
from pathlib import Path

os.environ.setdefault("XDG_CONFIG_HOME", str(Path.home() / ".config"))
# Keep private provider configuration private, including files created by upstream.
os.umask(0o077)
sys.path.insert(0, str(Path(__file__).resolve().parent))
from kaipi.cli import app

if __name__ == "__main__":
    if not any(Path.cwd().iterdir()):
        subprocess.run(["git", "init", "--template=", "-q"], check=True)
    app(args=["-c"], prog_name="kaipi")
