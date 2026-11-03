"""APK entry point. CPython must be built for Android, with all pinned dependencies."""
import os
import sys
import subprocess
from pathlib import Path
import certifi

os.environ.setdefault("XDG_CONFIG_HOME", str(Path.home() / ".config"))
# Standalone Android Python has no OpenSSL system CA path; httpx2 needs one explicitly.
os.environ.setdefault("SSL_CERT_FILE", certifi.where())
# Keep private provider configuration private, including files created by upstream.
os.umask(0o077)
sys.path.insert(0, str(Path(__file__).resolve().parent))
from kaipi.cli import app

if __name__ == "__main__":
    if not any(Path.cwd().iterdir()):
        subprocess.run(["git", "init", "--template=", "-q"], check=True)
    app(args=["-c"], prog_name="kaipi")
