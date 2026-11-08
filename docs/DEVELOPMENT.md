# 开发与验证

[← 回到 kaipi for Android](../README.md)

## 架构

```text
Android Activity / 系统文件选择与剪贴板
    └─ 本地 WebView GUI（ui/）
        └─ Native.request → LocalCore → CPython 子进程 / 私有 stdin、stdout
            └─ core_bridge.Application
                └─ kaipi.core.Session / core.run_input
                   providers / catalog / settings / attachments
```

`core_bridge.py` 只做请求、结果与事件的数据转换。所有游标移动、嫁接验证、日志写入、快照、回退和并发规则都由上游 core 实现。运行时入口 `main.py` 设置证书与配置目录，初始化空工作区的 Git，再运行桥接。

协议为 UTF-8 JSONL，请求含 `id/op/body`，响应含 `id/result` 或 `id/error`。回合事件走同一输出管道。回调只入队，不阻塞 core；工作线程退出后再发送 `settled` 快照，避免 GUI 在 core 尚忙时接受下一次操作。stdout 专用于协议，依赖诊断写 stderr，Java 只排空、不展示诊断流。停止和关闭使用 core 的停止机制，Activity 销毁时回收进程。

每个工作区使用独立 Python 进程与正确的工作目录；HOME 中共享服务商配置。旧版 `tabs` 中的工作区通过侧栏底部的工作区入口继续访问，`.kaipi` 历史不转换、不重写。原有核心包由上游 wheel 原样引入；Android 适配在包外。

## 语言与首次引导

`ui/locale.js` 只翻译静态界面文案和模板的字面片段，模板插值中的用户消息、代码、名称与工具输出保持原样。
首次语言选择必须明确确认；供应商引导可稍后完成。`preferences` 操作验证语言与完成标记，写入共享 settings，
不改写会话日志。WebView 缓存让界面先显示已选语言，核心设置用于恢复与跨重启一致性。

供应商、模型、语言、主题、工作区与确认界面都由 GUI 绘制，表单使用行内错误提示。
引擎状态和游标状态共用输入框上方固定高度的一行，加载结束不改变页面几何位置。
官方 kaipi SVG 原样打包；Android launcher 的 VectorDrawable 使用同一组路径与圆形几何。

## 构建

需要 Linux、Python 3.11+、uv、Node.js、JDK 17+、Rust 1.90、Android SDK 35 / Build Tools 35.0.0、NDK 27.0.12077973。构建目标 Android 8.0+，包含 arm64-v8a / x86_64。建议使用最新 Android System WebView。

```sh
npm ci --ignore-scripts
npm run assets
rustup toolchain install 1.90.0 --profile minimal
python3 scripts/build-runtime.py --sdk "$ANDROID_HOME"
./gradlew :app:assembleDebug :app:lintDebug
```

APK：`app/build/outputs/apk/debug/app-debug.apk`。版本为 0.2.0，包名与开发签名保持兼容，可覆盖旧预览版安装。

版本策略：仅在用户明确指定时修改 `versionName` 和 `versionCode`。日常修改、提交与 Actions 构建均保持当前版本；Actions 的运行编号仅用于区分下载产物，不作为应用版本号。

更新 core：

```sh
python3 scripts/update-core.py v0.2.0
```

当前固定上游 `65f4290a48f8244e9588f0716cbf98c306953f35`。脚本原样引入 wheel 和发行元数据，记录精确提交、许可证与依赖锁文件。更新后需重新构建运行时并验证桥接、Android 原生依赖和 APK。不要直接修改 `runtime/kaipi/`。

安装新 APK 时，运行时代码根据内容摘要更新，HOME、工作区和 GUI 文本草稿保留。应用内暂不提供 core 在线更新。

## 验证与预览

```sh
npm test
sh scripts/test-host.sh
python3 tests/test_runtime_package.py
# 在已启动的 APK 中验证 Android CPython、TLS、本地 shell、Git 与会话：
python3 scripts/test-android.py
# 完整协议 / 拒绝不可信证书测试（包含 Anthropic SDK）：
python3 scripts/test-android.py --suite full
```

桥接测试使用真实 core、JSONL、Git 和独立子进程，覆盖树操作、并发停止、模型错误、回退、配置保密、主题持久化与附件验证。APK 测试验证资源、ABI、版本摘要及 GUI 入口。

浏览器交互测试需要 Playwright 的 Chromium，以及安装了 kaipi 依赖的主机 Python：

```sh
npx playwright install chromium
KAIPI_TEST_PYTHON=.tools/host-tests/bin/python node tests/gui.mjs
KAIPI_TEST_PYTHON=.tools/host-tests/bin/python node tests/onboarding.mjs
```

可用 `CHROMIUM_BIN` 指定已有 Chromium。测试覆盖真实 adapter/core 调用、手机布局、树操作、停止、草稿、模型界面、主题持久化、系统主题跟随和减少动态效果。

开发预览使用隔离的临时工作区与固定测试模型，**只用于开发，不连接真实服务商，不包含在 APK 中**：

```sh
.tools/host-tests/bin/python scripts/preview.py --seed
```

## 本次验证

- 主机：8 项桥接集成测试、3 项树布局测试通过；浏览器端到端验证了会话、树操作、停止、草稿、HTML 安全渲染、主题保存与系统跟随、窄屏键盘和减少动态效果。
- 双架构 debug APK 构建、6 项 APK 完整性/ABI/上游 wheel 一致性检查通过；Android lint 为 0 errors、2 warnings。
- Android 11 x86_64 软件模拟器：GUI 与真实 core 连接成功，旧工作区恢复；独立 CPython、原生模块、shell、Git 快照/回退、会话保存、可信 HTTPS 与拒绝不可信证书、Anthropic/OpenAI 兼容模型请求、桥接执行与主题持久化均通过。模型是本地 mock，没有使用真实服务商 API key。
- 云环境无 KVM，软件模拟器上的初次导入明显慢于正常设备；此结果不代表真机启动性能或中文输入法已验收。

## 当前限制

- 图片、Office 附件的部分原生依赖仍未移植；不支持的文件会在提交前报错，不能视作完整附件支持。
- Git 支持本地快照/回退，暂不提供 HTTP/SSH clone/fetch 的完整运行依赖。
- 没有后台保活服务。Android 结束应用后，已落盘历史可恢复，正在执行的回合不能保证继续。
- 文本草稿可跨重启恢复；附件草稿只在当前应用生命周期内保留。
- 界面按模型回复更新文本，并非逐 token 输出。停止 bash 可快速生效，等待模型网络请求时可能要到请求返回才结束。
- 尚需 arm64 真机、不同中文输入法、文件选择器及无障碍服务的交互验收。浏览器检查不能代替这些验收。
- 预览版使用公开开发签名，不用于正式发行。

CI 在 push/PR 时构建双架构运行时，执行主机测试、浏览器交互测试、Android lint 和 APK 完整性检查，然后提供调试 APK。模拟器/真机验收单独执行。

许可证：上游 kaipi 为 MIT；CPython 来自 Chaquopy Android 构建，Git 使用 GPLv2。精确版本与源码地址在 `scripts/runtime.lock.json`、`scripts/build-runtime.py` 和 `app/src/main/assets/licenses/`。发布时需履行各依赖的许可证和对应源码提供义务。

## 许可证与分发

上游 kaipi 许可证见 [vendor/kaipi/LICENSE](../vendor/kaipi/LICENSE)。
CPython、Git 及其他依赖的许可证保存在 APK 的 `licenses/` 与各 Python 发行元数据中。
Git 使用 GPLv2；发布 APK 时需履行对应源码提供义务。
精确下载地址、校验值与构建选项见 `scripts/runtime.lock.json` 和 `scripts/build-runtime.py`。
