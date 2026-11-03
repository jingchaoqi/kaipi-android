# kaipi Android

一个 APK，打开就是原版 kaipi TUI。Android 层只提供 Python 运行时、终端和输入法上方的快捷键，不依赖 Termux 或远程主机，暂不适配 canvas。

**开发预览版，尚未完成正常首启和界面验收。** 已原样引入 kaipi 0.1.3（提交见 `vendor/kaipi/REVISION`），内置 Android CPython 3.13、TUI 依赖及本地 Git。构建目标为 Android 8.0+，arm64-v8a / x86_64，需要较新的系统 WebView。当前只提供调试构建；缺少的图片、Office 原生依赖会阻止完整 release 构建。

## 使用与会话

首次启动安装 APK 内置运行时，然后进入 kaipi 自己的模型配置流程。模型服务和 API key 仍由用户配置；API key 不包含在 APK 中。

顶部名称打开会话列表，`+` 新建，`⋮` 重命名、重启或关闭。切换保留进程和终端内容，各会话的 Ctrl 状态独立。键盘上方一排可横向滚动的按钮提供方向键、`/`、Tab、Esc、Ctrl、Ctrl-C、Enter。

每个终端使用独立私有工作目录，共享 HOME 中的模型配置。空工作目录自动初始化 Git，供 kaipi 快照/回退使用。会话列表和选中项会保存；重新启动通过原版 `-c` 继续该目录最近的会话。关闭终端保留磁盘文件，终端滚屏不持久化。没有后台保活服务，Android 结束 App 后需要重启进程。

## 更新核心

```sh
python3 scripts/update-core.py           # 最新 master
python3 scripts/update-core.py v0.1.3    # 指定上游 ref
```

脚本使用 uv 构建上游 wheel，原样引入 `kaipi/` 和版本元数据，记录提交、许可证、依赖声明及锁文件。不要直接改 `app/src/main/assets/runtime/kaipi/`；Android 入口 `main.py` 在其外部。

更新后重新运行 runtime 构建和验证，再生成 APK。安装新版 APK 时，根据内置运行时内容摘要刷新代码和依赖，保留 HOME 与工作目录。依赖引入新的原生库时，需要继续适配 Android。

**原生 `/update` 尚未支持。** 上游要求 `uv tool` 安装收据和可执行入口；当前 APK 不具备这一安装布局。目标是让纯 Python 核心独立更新，仍需完成 uv/入口/依赖兼容方案。Python ABI、原生库或 Android 权限发生变化时，仍可能需要新版 APK。

## 构建

Linux 构建机需要 Python 3.11+、uv、Rust 1.90（rustup）、Node.js、JDK 17+；Android SDK 35 / Build Tools 35.0.0、NDK 27.0.12077973 和 CMake 3.22.1。设置 `ANDROID_HOME`、`JAVA_HOME`。

```sh
npm ci --ignore-scripts
npm run assets
rustup toolchain install 1.90.0 --profile minimal
python3 scripts/build-runtime.py --sdk "$ANDROID_HOME"
./gradlew :app:assembleDebug
```

运行时构建自动下载并校验 CPython Android 包、上游锁定依赖和 Git 源码；用 NDK 编译 Python 入口、本地 Git、pydantic-core、jiter。默认缓存 `.tools/runtime`，可用 `--cache` 指定位置。首次构建需要联网，耗时明显长于 APK 编译。生成的库和依赖不提交到仓库。

APK：`app/build/outputs/apk/debug/app-debug.apk`。

## GitHub Actions 自动编译

[Build APK](.github/workflows/build-apk.yml) 在推送到 `master`、提交 PR 时自动执行，也可在 GitHub 的 **Actions → Build APK → Run workflow** 手动触发。

工作流安装固定版本的构建工具，编译仓库中已锁定的 kaipi 核心及 Android 原生依赖，运行快捷键、主机 PTY、APK 完整性测试和 Android lint。原生构建与 Gradle/npm 依赖使用缓存；首次运行需要完整编译。CI 不运行 Android 交互验收。

成功后，在该次运行的 **Artifacts** 中下载 `kaipi-android-debug-<运行编号>`，解压得到 `kaipi-android-debug.apk` 和 `SHA256SUMS`。一个 APK 同时包含 arm64-v8a 和 x86_64，使用默认调试签名。构建报告另存为 `build-reports-<运行编号>`，产物保留 14 天。此流程只上传 Actions 构建产物，不创建 GitHub Release。

## 验证

```sh
node tests/keys.test.mjs
sh scripts/test-native.sh
python3 tests/test_runtime_package.py
# 安装并打开调试 APK，等待运行时初始化；连接 adb 后：
python3 scripts/test-android.py
```

快捷键测试覆盖 ANSI/application cursor、Ctrl、Unicode。Linux JNI 测试使用真实 PTY，验证输入输出、尺寸、退出码、终止和并发会话。APK 检查验证 Python 资源是否完整、原生模块 ABI 是否匹配。Android 测试在 App UID 下运行打包的 Python，验证原生导入、shell、Git 快照/回退、会话保存及实际 HTTP 请求；模型端点是本地 mock，不能代替真实 API 与交互测试。

2026-11-03 验证结果：

- 双架构 debug APK 构建成功，约 40 MB；25 个上游核心文件逐文件校验一致。
- 3 项快捷键测试、主机 PTY 集成测试、3 项 APK 完整性/ABI/版本摘要测试通过。
- Android lint：0 errors、4 warnings（JavaScript、备份规则、图标和国际化提示）。
- Android 11 x86_64 模拟器中，CPython/原生模块/kaipi 导入、本地 shell、Git 快照/回退、会话保存、mock 模型 HTTP 请求全部通过；旧运行时成功替换为新 APK 的内容。
- **界面验证受阻**：当前云环境无 KVM，软件模拟器 35.2.10 与 37.3.6 的 WebView 83 均将 `NaN | 0` 错算为 `2147483647`，导致终端初始化异常。上述 Android 原生测试通过调试入口启动运行时，不能据此宣称正常首启已通过。尚无 arm64 真机、中文输入法、多会话界面或真实模型 API 的验收结果。

## 当前边界

- 不改写上游核心、TUI、模型配置或 `.kaipi` 格式。
- 本地 Git 支持快照/回退；暂不包含 HTTP/SSH clone/fetch 的运行依赖。
- 图片/Office 处理的 lxml、numpy、onnxruntime、pandas、pillow、pillow-heif 尚未移植；相关功能不可用。
- 尚未接入 Android 文件选择、剪贴板附件、后台服务或 APK 内在线升级。
- 原生库从 APK 的 `nativeLibraryDir` 执行；HOME、TMPDIR、Python 包和工作目录位于 App 私有目录。
- 中文输入法、旋转、多会话切换以及真实模型调用仍需 Android 交互验收。

许可证位于 `vendor/kaipi/LICENSE` 和 `app/src/main/assets/licenses/`。CPython Android 二进制来自 Chaquopy Maven 包；Git 使用 GPLv2，精确源码版本、下载地址与构建选项见 `scripts/runtime.lock.json` 和 `scripts/build-runtime.py`。发布 APK 时需同时履行所含依赖的许可证及对应源码提供义务。
