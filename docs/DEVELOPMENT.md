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

## core 边界约定

kaipi Android 不得修改任何 kaipi 层的代码，只能原样引入上游版本。
禁止直接补丁、构建时改写、运行时 monkey patch，以及在桥接层复制或替换 core 逻辑。
发现 core 的问题、局限或接口需求时，应先定位、复现并向用户反馈，由用户在 kaipi 的迭代 session 中修复；不得从 Android 项目的任务中直接修改上游仓库或创建 core 修复 PR。
用户完成上游修改并要求更新后，Android 侧再原样引入并验证集成。具体工作约定见 [AGENTS.md](../AGENTS.md)。

## 语言与首次引导

`ui/locale.js` 只翻译静态界面文案和模板的字面片段，模板插值中的用户消息、代码、名称与工具输出保持原样。
首次语言选择必须明确确认；供应商引导可稍后完成。`preferences` 操作验证语言与完成标记，写入共享 settings，
不改写会话日志。WebView 缓存让界面先显示已选语言，核心设置用于恢复与跨重启一致性。

供应商、模型、语言、主题、工作区与确认界面都由 GUI 绘制，表单使用行内错误提示。
引擎状态和游标状态共用输入框上方固定高度的一行，加载结束不改变页面几何位置。
官方 kaipi SVG 原样打包；Android launcher 的 VectorDrawable 使用同一组路径与圆形几何。

## 应用层指令

core 0.2.3 的 `app_instructions` 是可选的创建会话参数。Android 通过此公开接口为首次工作区会话与显式新建的对话注入运行环境说明：Android/API/架构、本地执行、`/system/bin/sh`、Python/Git、工作区与 HOME，以及按实际工具结果判断可用能力。主机预览不注入 Android 说明。

恢复已有会话时不传该参数，沿用 core 保存的完整指令快照，旧日志缺少该字段时按上游默认值读取，不迁移或重写原始日志。Android 的「开启新对话」使用公开的 `Session(cwd, new=True, app_instructions=...)` 创建当前 Android 环境的新快照；重试与切回旧会话继续使用各自冻结的指令。会话创建、空会话清理和保存仍由 core 执行。此次不新增指令配置界面。

## 重试

普通发送和重试分别调用 core 的公开 `Session.start()`、`Session.start_retry()`，共享停止与事件生命周期。
桥接仅接收无参数的 `retry` 请求；可用性来自 core 状态中的 `retryable`，不接受任意节点 ID。
core 负责恢复原输入、附件及嫁接快照、保留主干或探索身份、验证会话位置并创建新的尝试。
桥接不改游标、不拼接重试上下文、不重新解析附件，也不执行 CLI 命令。

`latest_attempt` 只是最新尝试的展示数据；进程中断而只留下请求快照时，仍使用 core 的文本过滤函数展示原问题。
失败或停止后保留恢复卡片；成功回答旁提供重跑操作，其他历史节点没有重试入口。
重试使用当前模型，保留新草稿；可能执行过工具时先用应用内确认界面提示已有改动会保留。
请求确认超时只同步执行状态，不自动重新发送；界面重连后依据 core 状态恢复。

## 构建

需要 Linux、Python 3.11+、uv、Node.js、JDK 17+、Rust 1.90、Android SDK 35 / Build Tools 35.0.0、NDK 27.0.12077973。构建目标 Android 8.0+，包含 arm64-v8a / x86_64。建议使用最新 Android System WebView。

```sh
npm ci --ignore-scripts
npm run assets
rustup toolchain install 1.90.0 --profile minimal
python3 scripts/build-runtime.py --sdk "$ANDROID_HOME"
./gradlew :app:assembleDebug :app:lintDebug
```

APK：`app/build/outputs/apk/debug/app-debug.apk`。版本为 0.2.1，包名与开发签名保持兼容，可覆盖旧预览版安装。

版本策略：仅在用户明确指定时修改 `versionName` 和 `versionCode`。日常修改、提交与 Actions 构建均保持当前版本；Actions 的运行编号仅用于区分下载产物，不作为应用版本号。

签名策略：沿用仓库中的固定开发密钥，不在 Actions 或发布时生成、替换密钥，也不对产物重新签名。
证书 SHA-256 为 `1cfa8d84d9e502f1c7dc9db65c8bf080d350362510a8af5e16af6d9747b36283`，与第 4 次 Actions 起的构建保持一致。
CI 的 APK 检查会验证签名并比对该指纹，发现变化即失败；GitHub Release 使用通过检查的 Actions 原始 APK。

更新 core：

```sh
python3 scripts/update-core.py v0.2.3
```

当前引入 kaipi core **0.2.3**，固定上游 `753f2df33330b7e339cab2d631580a15287b8523`。打包文件已与官方 release wheel 逐字节核对一致。脚本原样引入 wheel 和发行元数据，记录精确提交、许可证与依赖锁文件。更新后需重新构建运行时并验证桥接、Android 原生依赖和 APK。不要直接修改 `runtime/kaipi/`。

安装新 APK 时，运行时代码根据内容摘要更新，HOME、工作区和 GUI 文本草稿保留。应用内「检查更新」更新的是整个 Android release APK，core 随 APK 原样更新，不独立在线替换。

## 平台体验

- 窄屏可从左侧 24 CSS px、视口上方三分之一区域向右拉出菜单，跟手拖动并按距离/速度决定展开或回弹；纵向滑动、控件、长按和双指不会触发。弹窗、首次引导与上下文树打开时停用，取消/窗口尺寸变化/切后台时清理。Android 10+ 只在启用时为左上边缘设置系统手势排除区，遵守每侧最多 200 dp 的系统限制，其余边缘继续保留返回手势。

- 官方图标来自 kaipi `c710df6ece355390e6debdc0cf54949ebef256e1` 的 `docs/assets/kaipi-logo*.svg`，UI 与 README 原样复制；桌面 vector 保留同一几何和探索分支渐变，仅增加底色与留白。
- 前台窗口在任一工作区仍有对话运行时设置 `FLAG_KEEP_SCREEN_ON`；发送等待确认也计入。完成、失败、取消确认、引擎断开/关闭后解除。点击停止本身不视为已终止；退到后台立即清除窗口标志，返回时按真实状态恢复。不申请 CPU wake lock，也不主动唤醒已被用户关闭的屏幕。
- 更新独立于 core，读取 GitHub `releases/latest`，只选择稳定 release 的唯一 APK。按数字版本比较；Downloads 下载由系统 DownloadManager 管理，记录 APK asset ID、大小和摘要对应的下载 ID。重复点击、Activity 重建、安装授权被拒绝或取消安装均复用这条记录；失败/丢失/损坏文件才重新下载。
- 安装前复制到私有临时缓存，验证 release 摘要（如有）、大小、包名、版本和当前应用的签名，并通过只读 FileProvider URI 交给系统安装器。Downloads 原文件保留。Android 8/9 需要公开 Downloads 写入权限；安装未知来源应用的授权由系统完成，授权后返回继续安装。
- 更新界面、进度与错误使用应用内对话框并支持中英/主题；下载由系统继续，不在后台主动弹出安装器。

## 验证与预览

```sh
npm test
sh scripts/test-host.sh
python3 tests/test_runtime_package.py
./gradlew :app:testDebugUnitTest
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
KAIPI_TEST_PYTHON=.tools/host-tests/bin/python node tests/retry.mjs
KAIPI_TEST_PYTHON=.tools/host-tests/bin/python node tests/platform-ui.mjs
KAIPI_TEST_PYTHON=.tools/host-tests/bin/python node tests/menu-gesture.mjs
```

可用 `CHROMIUM_BIN` 指定已有 Chromium。测试覆盖真实 adapter/core 调用、手机布局、树操作、停止、草稿、模型界面、主题持久化、系统主题跟随和减少动态效果。

开发预览使用隔离的临时工作区与固定测试模型，**只用于开发，不连接真实服务商，不包含在 APK 中**：

```sh
.tools/host-tests/bin/python scripts/preview.py --seed
```

## 本次验证

- 平台新增：22 项 JVM/Robolectric 测试通过，覆盖 Android 9/13 的亮屏窗口生命周期、完成/失败/取消、迟到确认、公开 Downloads、下载复用、安装授权/取消、文件丢失、APK 替换和摘要拒绝。更新菜单的中英/主题/窄屏及语言图标对齐、键盘展开标题位置回归通过。Robolectric 结果不等同于真机安装器验收。

- 主机：17 项桥接集成测试、3 项树布局测试通过；桥接回归覆盖非 UTF-8 stdout/stderr、正常中文、对话完成、历史重载及继续下一轮，以及重试的快照恢复、身份保持、并发占用和上下文拒绝。浏览器端到端验证了会话、树操作、停止、草稿、HTML 安全渲染、主题保存与系统跟随、窄屏键盘和减少动态效果；重试浏览器测试还覆盖失败卡片、附件、刷新恢复、草稿、双击防重、确认超时、工具确认和中英主题切换。
- 双架构 debug APK 构建、7 项 APK 完整性/ABI/上游 wheel 一致性及固定签名检查通过；Android lint 为 0 errors、2 warnings。
- 此前版本的 Android 11 x86_64 软件模拟器验收：GUI 与真实 core 连接成功，旧工作区恢复；独立 CPython、原生模块、shell、Git 快照/回退、会话保存、可信 HTTPS 与拒绝不可信证书、Anthropic/OpenAI 兼容模型请求、桥接执行与主题持久化均通过。模型是本地 mock，没有使用真实服务商 API key。
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

本项目原创代码采用 [MIT 许可证](../LICENSE)，许可证副本随 APK 打包在 `licenses/kaipi-android.txt`。
第三方组件保留各自的版权声明与许可证，不因本项目采用 MIT 而改变。
用于安全共享安装包的 AndroidX FileProvider 及其运行依赖采用 Apache 2.0，许可证和组件说明随 APK 的 `licenses/AndroidX.txt` 打包。
上游 kaipi 许可证见 [vendor/kaipi/LICENSE](../vendor/kaipi/LICENSE)。
CPython、Git 及其他依赖的许可证保存在 APK 的 `licenses/` 与各 Python 发行元数据中。
Git 使用 GPLv2；发布 APK 时需履行对应源码提供义务。
精确下载地址、校验值与构建选项见 `scripts/runtime.lock.json` 和 `scripts/build-runtime.py`。
