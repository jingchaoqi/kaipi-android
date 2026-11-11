# kaipi core

Source: https://github.com/jingchaoqi/kaipi (MIT)
Exact commit: REVISION. Dependency definitions: pyproject.toml and uv.lock.

Release: [v0.2.3](https://github.com/jingchaoqi/kaipi/releases/tag/v0.2.3).
Packaged files match the official `kaipi-0.2.3-py3-none-any.whl` byte for byte.
Release wheel SHA-256: `ca40debe3eb78d1c68bd3d6a8adee38307acc7aee2668a80c59506dd29d876e8`.

`app/src/main/assets/runtime/kaipi/` is an **unmodified** copy of the upstream
package. Do not edit it. Run `python3 scripts/update-core.py [ref]` to update.
Android adaptation belongs outside this directory. Rebuild the runtime when
upstream dependencies change, then test the packaged application.
