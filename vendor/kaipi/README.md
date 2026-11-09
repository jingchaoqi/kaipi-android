# kaipi core

Source: https://github.com/jingchaoqi/kaipi (MIT)
Exact commit: REVISION. Dependency definitions: pyproject.toml and uv.lock.

Release: [v0.2.1](https://github.com/jingchaoqi/kaipi/releases/tag/v0.2.1).
Packaged files match the official `kaipi-0.2.1-py3-none-any.whl` byte for byte.
Release wheel SHA-256: `c7be5e18be05c40db6129b35c343a309cfc0e168b3c4923462032fd226215e97`.

`app/src/main/assets/runtime/kaipi/` is an **unmodified** copy of the upstream
package. Do not edit it. Run `python3 scripts/update-core.py [ref]` to update.
Android adaptation belongs outside this directory. Rebuild the runtime when
upstream dependencies change, then test the packaged application.
