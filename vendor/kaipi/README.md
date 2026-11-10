# kaipi core

Source: https://github.com/jingchaoqi/kaipi (MIT)
Exact commit: REVISION. Dependency definitions: pyproject.toml and uv.lock.

Release: [v0.2.2](https://github.com/jingchaoqi/kaipi/releases/tag/v0.2.2).
Packaged files match the official `kaipi-0.2.2-py3-none-any.whl` byte for byte.
Release wheel SHA-256: `fb500d6247df6022535b1cfbb7caf71318d85937f9febe2ba29111c3fbd3b3e1`.

`app/src/main/assets/runtime/kaipi/` is an **unmodified** copy of the upstream
package. Do not edit it. Run `python3 scripts/update-core.py [ref]` to update.
Android adaptation belongs outside this directory. Rebuild the runtime when
upstream dependencies change, then test the packaged application.
