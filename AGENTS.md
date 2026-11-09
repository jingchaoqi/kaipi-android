# kaipi Android 项目约定

## kaipi core 的边界

- 本项目只开发 Android 应用层：GUI、平台能力、进程生命周期、打包，以及调用 core 现有接口的数据桥接。
- **不得修改任何 kaipi 层的代码。** 这里的 kaipi 包括整个上游包，而不只是 `core.py`；`app/src/main/assets/runtime/kaipi/` 和对应的 `kaipi-*.dist-info/` 必须原样来自上游 wheel。
- 不得通过本地补丁、构建时改写、运行时 monkey patch，或在 Android 桥接层复制、替换 core 逻辑来绕过这个边界。
- 遇到 kaipi 的缺陷、功能局限或缺少必要接口时，先定位和复现，再向用户反馈原因、证据与所需修改，由用户在 kaipi 的迭代 session 中处理。**不得从 kaipi Android 的任务中直接修改上游 kaipi 仓库、提交修复或创建修复 PR。**
- 用户完成上游修改并要求更新后，使用 `scripts/update-core.py` 原样引入指定的上游版本或提交，保留精确 `REVISION`、许可证、依赖锁和发行元数据，再验证 Android 集成。

构建、验证、版本与固定签名约定见 [开发文档](docs/DEVELOPMENT.md)。
