"""Inspect the real APK for packaging regressions that source-only tests cannot catch."""
from pathlib import Path
import hashlib
import base64
import csv
import io
import ast
import os
import re
import subprocess
import tomllib
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
APK = ROOT / "app/build/outputs/apk/debug/app-debug.apk"


class RuntimePackageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.apk = zipfile.ZipFile(APK)
        cls.names = set(cls.apk.namelist())

    @classmethod
    def tearDownClass(cls):
        cls.apk.close()

    def test_signing_certificate_matches_previous_actions_builds(self):
        sdk = Path(os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT') or Path.home() / 'Android/Sdk')
        signer = sdk / 'build-tools/35.0.0/apksigner'
        result = subprocess.run([str(signer), 'verify', '--print-certs', str(APK)],
                                check=True, capture_output=True, text=True)
        fingerprints = re.findall(r'^Signer #\d+ certificate SHA-256 digest: ([0-9a-f]+)$', result.stdout, re.MULTILINE)
        self.assertEqual(fingerprints, ['1cfa8d84d9e502f1c7dc9db65c8bf080d350362510a8af5e16af6d9747b36283'],
                         'APK signing certificate changed; existing installs must remain upgradeable.')

    def test_gui_entry_and_assets_replace_the_terminal(self):
        self.assertIn('assets/ui/outbox.js', self.names)
        for name in ['index.html', 'app.js', 'model.js', 'theme.js', 'style.css', 'render.js', 'locale.js', 'kaipi-logo.svg', 'kaipi-logo-dark.svg', 'vendor/marked.js']:
            self.assertIn('assets/ui/' + name, self.names)
        self.assertFalse(any(name.startswith('assets/terminal/') for name in self.names))
        self.assertNotIn('assets/runtime/android_tui.py', self.names)
        for name in ['main.py', 'core_bridge.py']:
            tree = ast.parse(self.apk.read('assets/runtime/' + name).decode())
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom):
                    self.assertNotIn(node.module, ['kaipi.cli', 'kaipi.tui', 'kaipi.server', 'kaipi.views'])
                    self.assertFalse(node.module == 'kaipi' and any(alias.name in ['cli', 'tui', 'server', 'views'] for alias in node.names))

    def test_official_brand_assets_are_packaged_unchanged(self):
        for name in ['kaipi-logo.svg', 'kaipi-logo-dark.svg']:
            self.assertEqual((ROOT / 'docs/assets' / name).read_bytes(), self.apk.read('assets/ui/' + name))

    def test_vendored_core_matches_the_upstream_wheel_record(self):
        version = tomllib.loads((ROOT / 'vendor/kaipi/pyproject.toml').read_text())['project']['version']
        records = sorted(name for name in self.names if re.fullmatch(r'assets/runtime/kaipi-[^/]+\.dist-info/RECORD', name))
        self.assertEqual(records, [f'assets/runtime/kaipi-{version}.dist-info/RECORD'])
        record = self.apk.read(records[0]).decode()
        count = 0
        for path, digest, size in csv.reader(io.StringIO(record)):
            if path.startswith('kaipi/') and digest:
                data = self.apk.read('assets/runtime/' + path)
                actual = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).decode().rstrip('=')
                self.assertEqual('sha256=' + actual, digest, path)
                self.assertEqual(len(data), int(size), path)
                count += 1
        self.assertGreater(count, 30)

    def test_python_assets_are_not_filtered(self):
        assets = ROOT / "app/src/main/assets"
        expected = {"assets/" + str(p.relative_to(assets)) for folder in ["runtime", "runtime-abi"]
                    for p in (assets / folder).rglob("*") if p.is_file() and "__pycache__" not in p.parts}
        self.assertFalse(expected - self.names, f"Missing assets: {sorted(expected - self.names)[:10]}")

    def test_native_modules_match_interpreter_abi(self):
        for abi, arch in [("arm64-v8a", "aarch64"), ("x86_64", "x86_64")]:
            prefix = f"assets/runtime-abi/{abi}/python/lib/python3.13/site-packages/"
            for package in ["pydantic_core", "jiter"]:
                modules = [n for n in self.names if n.startswith(prefix + package + "/") and n.endswith(".so")]
                self.assertEqual(len(modules), 1, modules)
                self.assertTrue(modules[0].endswith(f".cpython-313-{arch}-linux-android.so"), modules)
            for library in ["libkaipi_python.so", "libpython3.13.so", "libkaipi_git.so"]:
                header = self.apk.read(f"lib/{abi}/{library}")[:20]
                self.assertEqual(header[:4], b"\x7fELF")
                self.assertEqual(int.from_bytes(header[18:20], "little"), 183 if abi == "arm64-v8a" else 62)

    def test_runtime_identity_covers_packaged_code(self):
        digest = hashlib.sha256()
        for name in sorted(n for n in self.names if n.startswith(("assets/runtime/", "assets/runtime-abi/")) and not n.endswith("/")):
            digest.update(("src/main/" + name).encode())
            digest.update(b"\0")
            digest.update(self.apk.read(name))
        self.assertEqual(self.apk.read("assets/runtime-id").decode(), digest.hexdigest())


if __name__ == "__main__":
    unittest.main()
