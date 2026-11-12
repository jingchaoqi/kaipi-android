<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/kaipi-logo-dark.svg">
    <img src="docs/assets/kaipi-logo.svg" alt="kaipi" width="64" height="64" align="absmiddle">
  </picture>
  &nbsp;kaipi for Android
</h1>

<p align="center"><strong>在手机上，让思路长成一棵树。</strong><br><sub>A thoughtful Android home for kaipi.</sub></p>

<p align="center">
  <a href="https://github.com/jingchaoqi/kaipi-android/releases/latest"><img src="https://img.shields.io/github/v/release/jingchaoqi/kaipi-android?style=flat-square&color=627D6D" alt="Latest release"></a>
  <a href="https://github.com/jingchaoqi/kaipi-android/actions/workflows/build-apk.yml"><img src="https://github.com/jingchaoqi/kaipi-android/actions/workflows/build-apk.yml/badge.svg" alt="Build APK"></a>
  <img src="https://img.shields.io/badge/Android-8.0%2B-627D6D?style=flat-square" alt="Android 8.0+">
  <img src="https://img.shields.io/badge/中文_%2F_English-365D47?style=flat-square" alt="中文 / English">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-627D6D?style=flat-square" alt="MIT License"></a>
</p>

<p align="center"><a href="https://github.com/jingchaoqi/kaipi-android/releases/latest">下载安装</a> · <a href="#让上下文可见">树形上下文</a> · <a href="#为手机而设计">界面与体验</a> · <a href="docs/DEVELOPMENT.md">开发文档</a></p>

[kaipi（开辟）](https://github.com/jingchaoqi/kaipi) 的 Android GUI。
在对话中阅读代码、编写文件、执行命令；在上下文树上整理思路，
从任意节点开启探索，再把有价值的发现带回主干。

一个 APK，内置 Python、Git 和 kaipi core。打开就能使用自己的模型服务，
无需 Termux、电脑或远程主机。

<p align="center">
  <img src="docs/screenshots/conversation.png" alt="手机对话界面" width="245">
  &nbsp;
  <img src="docs/screenshots/context-tree.png" alt="树形上下文与节点操作" width="245">
  &nbsp;
  <img src="docs/screenshots/provider-picker.png" alt="自绘供应商选择器" width="245">
</p>

## 让上下文可见

每轮对话都是一个节点。主干保留当前方向，分支容纳调查、比较和尝试。

- **从这里继续，或换个方向探索。** 点选历史节点即可调整下一轮上下文。
- **把发现带回来。** 按需嫁接单轮问答、问答与路径摘要，或整条分支。
- **为思路减负。** 归档暂时不需要的分支，随时恢复；明确选择哪些内容进入后续对话。
- **回到合适的位置。** 分别回退对话、代码，或两者一起回退，并先查看受影响的文件。

树支持平移、缩放、折叠、定位当前位置；节点详情集中在底部，单手也能完成操作。
主干、探索分支和当前节点各有清楚的标记，用量与费用随对话可见。

## 为手机而设计

**从第一次打开开始。** 双语欢迎页先选择简体中文或 English，再引导连接供应商。
模型配置可以稍后完成，首次对话前会再次提醒。

**界面有统一的节奏。** 对话、代码、工具输出和节点操作各有自己的位置。
供应商、模型、语言、主题与工作区使用统一的应用内选择面板。
引擎状态安静地留在输入框上方，加载完成也不会推移页面。

**按你的习惯阅读。** 跟随系统、浅色、深色，搭配松绿、靛蓝或陶土。
切换即时生效，状态栏同步；动效尊重系统的「减少动态效果」。

**等候时，屏幕为你亮着。** 前台对话运行期间保持亮屏，完成、失败或取消后恢复系统熄屏设置。

**离开后，接着聊。** 会话、工作区和模型配置保存在本机，文本草稿跨重启保留。
手机用侧栏与独立上下文面板，从左上角宽 72 dp、高 200 dp 的区域向内滑动，即可拉出菜单。
平板空间足够时，可以同时展开对话与树。

**给上一轮一次新尝试。** 失败或停止后可重试上一轮，也可重跑刚完成的回答。
使用当前选择的模型，原问题、附件和嫁接快照一并恢复；旧尝试留在树中，新草稿不会被覆盖。

**把成果带走。** 菜单中的「工作区文件」可以找到已有文件，回答中的文件链接也能直接打开。
HTML 支持离线交互预览，图片与文本可在应用内查看，其他格式交给支持的应用打开。
文件可保存到 `Downloads/kaipi` 或分享，整个文件夹可打包为 ZIP，保留项目目录和资源。
不需要的文件可从条目右侧删除，执行前会再次确认并提醒不可恢复。

<details>
<summary>看看首次引导与深色界面</summary>
<p align="center">
  <img src="docs/screenshots/language.png" alt="不可跳过的双语语言选择" width="245">
  &nbsp;
  <img src="docs/screenshots/provider-setup.png" alt="可稍后完成的供应商引导" width="245">
  &nbsp;
  <img src="docs/screenshots/dark.png" alt="深色界面" width="245">
</p>
</details>

## 安装

需要 **Android 8.0 或更高版本**，建议更新 Android System WebView。

也可以在应用菜单中「检查更新」，直接下载最新 release 的 APK 并安装。安装包保存在 Downloads，重复安装会复用已下载的文件。
一个 APK 同时支持 arm64-v8a 与 x86_64。

1. 前往 [最新 Release](https://github.com/jingchaoqi/kaipi-android/releases/latest)，此入口会自动指向最新发布的版本。
2. 在 **Assets** 下载 `.apk` 文件并直接安装；可使用同页的 `SHA256SUMS` 校验文件。
3. 打开应用，选择语言，填写模型服务地址、API key 与模型 ID。也可以先进入界面，再配置模型。

## 模型由你选择

| 供应商 | 支持的协议 |
| --- | --- |
| Anthropic | Anthropic Messages |
| OpenAI | OpenAI Responses |
| Google Gemini | Gemini |
| DeepSeek | OpenAI Chat Completions、Anthropic Messages |
| Kimi（国际） | OpenAI Chat Completions、Anthropic Messages |
| Kimi（国内） | OpenAI Chat Completions、Anthropic Messages |
| GLM / Z.ai（国际） | OpenAI Chat Completions、Anthropic Messages |
| GLM / 智谱（国内） | OpenAI Chat Completions、Anthropic Messages |
| OpenCode Zen | OpenAI Chat Completions、Anthropic Messages |
| OpenCode Go | OpenAI Chat Completions、Anthropic Messages |
| Qwen / 通义千问 | OpenAI Chat Completions |
| OpenRouter | OpenAI Chat Completions |
| Groq | OpenAI Chat Completions |
| Ollama | OpenAI Chat Completions |

也可以修改服务地址，接入使用对应协议的兼容端点。
界面中可以切换模型，预览并更新模型与价格目录。

API key 保存在应用私有目录，不写入对话或工作区。
模型请求发送到你选择的供应商，对话历史和文件保留在设备上。

构建方式、架构、测试与 core 更新说明见 [开发文档](docs/DEVELOPMENT.md)。

---

Android 层直接使用上游 kaipi core，独立实现界面。
本项目原创代码采用 [MIT 许可证](LICENSE)。
[kaipi](https://github.com/jingchaoqi/kaipi) 为 MIT；Git 与其他内置组件按各自许可证分发。
详细版本、许可证和源码要求见 [开发文档](docs/DEVELOPMENT.md#许可证与分发)。
