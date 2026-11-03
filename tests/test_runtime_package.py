"""Inspect the real APK for packaging regressions that source-only tests cannot catch."""
from pathlib import Path
import hashlib
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
