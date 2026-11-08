"""APK entry: initialize the platform, then run the Android core data adapter."""
import os
import subprocess
from pathlib import Path

import certifi

os.environ.setdefault('XDG_CONFIG_HOME', str(Path.home() / '.config'))
os.environ.setdefault('SSL_CERT_FILE', certifi.where())
os.umask(0o077)

if __name__ == '__main__':
    from core_bridge import run

    cwd = Path.cwd()
    if not any(cwd.iterdir()):
        subprocess.run(['git', 'init', '--template=', '-q'], check=True)
    run(cwd)
