/* Translate UI literals only. Template substitutions (messages, code and names) stay intact. */
(() => {
  const messages = {
    '删除文件':'Delete file', '删除这个文件？':'Delete this file?', '删除后无法恢复。':'Deletion cannot be undone.',
    '文件将从当前工作区中永久删除。':'The file will be permanently removed from this workspace.',
    '永久删除':'Delete permanently', '正在删除…':'Deleting…', '已删除。':'Deleted.', '返回列表':'Back to files',
    '文件已变化，请刷新列表后重新确认。':'The file has changed. Refresh the list and confirm again.',
    '无法删除文件，请刷新列表后重试。':'The file could not be deleted. Refresh the list and try again.',
    '工作区已切换，请重新选择文件。':'The workspace changed. Select the file again.',
    '删除结果尚未确认，请返回列表检查。':'The deletion result is not confirmed. Return to the list to check.',
    '工作区文件':'Workspace files', '工作区':'Workspace', '文件路径':'File path', '刷新文件':'Refresh files',
    '文件夹':'Folder', '分享文件':'Share file', '保存到 Downloads':'Save to Downloads',
    '保存文件夹为 ZIP':'Save folder as ZIP', '正在读取文件…':'Reading files…',
    '这里保存着当前工作区的文件。打开预览，或保存一份到 Downloads。':'Files in the current workspace. Open a preview or save a copy to Downloads.',
    '这里还没有文件':'No files here yet', '让 kaipi 创建的文件，会出现在这里。':'Files created by kaipi will appear here.',
    '文件保留在本机，保存与分享会创建副本。':'Files stay on this device. Saving and sharing create copies.',
    '请在 Android 应用中打开工作区文件。':'Open workspace files in the Android app.',
    '无法识别这个文件路径。':'This file path could not be read.', '无法读取这个目录。':'This folder could not be read.',
    '正在保存文件…':'Saving the file…', '已保存到 Downloads。':'Saved to Downloads/kaipi.',
    '无法打开文件。它可能已被移动，或不在当前工作区中。':'The file could not be opened. It may have moved or be outside this workspace.',
    '无法分享这个文件。':'This file could not be shared.',
    '没有可打开此文件的应用，请保存到 Downloads 后使用其他应用打开。':'No app is available to open this file. Save it to Downloads to use another app.',
    '保存失败，请检查可用空间和文件是否存在。':'Saving failed. Check the free space and whether the file still exists.',
    '请允许将文件保存到 Downloads，然后重试。':'Allow saving files to Downloads, then retry.',
    '检查更新':'Check for updates', '正在检查更新':'Checking for updates', '新版本，已就绪':'A new version is ready',
    '已是最新版本':'You are up to date', '正在下载更新':'Downloading the update', '正在校验安装包':'Verifying the APK',
    '安装包已下载':'Ready to install', '还需要一步授权':'One permission to continue', '继续完成安装':'Finish installing',
    '暂时无法完成更新':'The update could not finish', '下载进度':'Download progress', '正在连接…':'Connecting…',
    '当前版本':'Installed version', '重新检查':'Check again', '安装已下载的 APK':'Install downloaded APK', '下载并安装':'Download & install',
    '更新已下载，可在检查更新中继续安装。':'Update downloaded. Open Check for updates to install it.',
    '无法连接更新服务，请稍后重试。':'The update service could not be reached. Try again later.',
    '检查过于频繁，请稍后重试。':'Too many update checks. Try again later.',
    '这个 release 的信息不完整，请稍后重试。':'The release information is incomplete. Try again later.',
    '无法识别 release 版本，请稍后重试。':'The release version could not be read. Try again later.',
    '最新 release 还没有 APK，请稍后再来。':'The latest release does not have an APK yet. Check again later.',
    '最新 release 有多个 APK，暂时无法自动选择。':'This release has multiple APKs. An automatic selection is unavailable.',
    '下载未完成，请检查网络后重试。':'The download did not finish. Check your connection and retry.',
    '正在等待网络恢复，下载会自动继续。':'Waiting for a connection. The download will resume automatically.',
    '请允许将安装包保存到 Downloads，然后继续。':'Allow saving the APK to Downloads to continue.',
    '请在系统设置中允许 kaipi 安装应用。返回后可继续使用已下载的安装包。':'Allow kaipi to install apps in system settings. The downloaded APK will be reused when you return.',
    '安装包校验未通过，请重新下载。':'APK verification failed. Download it again.',
    '下载文件已被移除，请重新下载。':'The downloaded file was removed. Download it again.',
    '无法打开系统安装器，请稍后重试。':'The system installer could not be opened. Try again later.',
    '版本信息已变化，请重新检查更新。':'The release changed. Check for updates again.',
    '请在 Android 应用中检查更新。':'Check for updates in the Android app.',
    '从 kaipi Android 的最新 release 获取版本。':'Checking the latest kaipi Android release.',
    '安装包将保存到 Downloads，已有对话与配置会保留。':'The APK will be saved to Downloads. Your conversations and settings will be kept.',
    '你正在使用最新发布的版本。':'You are using the latest published version.',
    '安装包正在保存到 Downloads，关闭此窗口也会继续下载。':'Saving the APK to Downloads. The download continues if you close this dialog.',
    '正在确认安装包完整性与签名。':'Checking the APK integrity and signing certificate.',
    '文件保存在 Downloads。再次安装会复用这份文件。':'The file is in Downloads. Installing again reuses this download.',
    '系统授权完成后，即可继续安装。':'Allow the system permission to continue installing.',
    '请在系统安装界面确认。取消后也可以回来继续安装。':'Confirm in the system installer. If you cancel, you can return and install again.',
    '你可以稍后再试，对话与配置不受影响。':'Try again later. Your conversations and settings are safe.',

    '重新运行上一轮':'Run the last turn again', '使用当前模型重新运行上一轮':'Run the last turn again with the current model',
    '重试上一轮不接受参数':'Retrying the last turn takes no arguments', '重试':'Retry',
    '这轮未完成':'This turn did not finish', '未完成的请求':'Unfinished request',
    '可以从原始问题重新运行，旧尝试保留在树中。':'Start again from the original question. The previous attempt stays in the tree.',
    '当前状态无法重试，可在树中查看此轮。':'This turn cannot be retried in the current state. You can view it in the tree.',
    '原附件会一并恢复。':'The original attachments will be included.', '查看原因':'View reason', '查看本次输出':'View this attempt’s output',
    '当前模型':'Current model', '任务仍在运行…':'The task is still running…',
    '正在重新准备上下文':'Preparing the original context', '会话状态已变化，请重新确认。':'The conversation changed. Check its state before retrying.',
    '正在确认运行状态…':'Checking the task status…', '无法确认运行状态，请重新连接。':'The task status is unknown. Please reconnect.',
    '连接已中断，请重新连接检查结果。':'Disconnected. Reconnect to check the result.',
    '重新运行上一轮？':'Run the last turn again?', '重新运行':'Run again',
    '本轮可能已执行工具操作。重试会使用当前模型重新开始，已有文件改动不会自动撤销。':'This turn may have run tools. Retrying starts again with the current model; existing file changes will remain.',
    '此轮未完成，不进入后续上下文。':'This turn did not finish and is excluded from future context.', '未完成':'Unfinished',
    '没有可重试的原始请求':'No original request is available to retry',
    '会话位置或待嫁接内容已变化，无法重试上一轮':'The conversation position or pending grafts changed. The last turn cannot be retried.',
    'a turn is running':'A turn is already running',
    '正在加载kaipi引擎':'Loading kaipi engine',
    '默认工作区':'Default workspace',
    '本地引擎启动失败，请重试。':'The kaipi engine could not start. Please retry. ',
    '与本地引擎的连接已断开，请重新连接。':'The engine disconnected. Please reconnect.',
    '消息未能送达，请重新连接。':'The message could not be delivered. Please reconnect.',
    '本地引擎已结束（':'The engine stopped (', '），请重新连接。':'). Please reconnect.',
    '无法读取附件，或文件超过大小限制。':'The attachment could not be read, or it exceeds the size limit.',
    '本地引擎尚未连接，请稍候或重新连接。':'The kaipi engine is not connected yet. Please wait or reconnect.',
    '操作等待超时，请重新连接后检查状态。':'This is taking longer than expected. Reconnect to check the result.',
    '请在 Android 应用中打开，或启动开发预览。':'Open the Android app or start the development preview.',
    '运行时版本不兼容，请更新应用。':'This engine version is incompatible. Please update the app.',
    '对话已切换，请重新添加附件。':'The conversation changed. Please attach the files again.',
    '引擎连接中断':'Engine disconnected', '重新连接':'Reconnect', '正在切换工作区':'Switching workspace', '正在打开工作区…':'Opening workspace…',
    '选择模型':'Choose a model', '新的对话':'New conversation',
    ' 个节点在当前上下文中 · ':' nodes in this context · ', ' 个节点留在分支上':' nodes on other branches',
    '为思路留出更多空间':'Room for more possibilities', '探索分支':'Exploration', '新的起点':'A fresh start',
    '主干上下文 ':'Trunk context ', '累计 $':'Total $', 'kaipi · 本地运行':'kaipi · On device',
    '没有找到这个对话':'No conversations found', '新的思路，会留在这里。':'Your ideas will find a home here.',
    '执行中…':'Running…', '正在思考…':'Thinking…', '正在思考':'Thinking',
    '已停止，此节点不进入后续上下文。':'Stopped. This node is excluded from future context.',
    '复制回答':'Copy answer', '从这里探索':'Explore from here', '在上下文树中查看':'Show in context tree', '复制代码':'Copy code',
    '正在执行命令':'Running a command', '正在保存会话':'Saving conversation', '已停止，正在保存':'Stopped. Saving…',
    '正在整理上下文':'Updating context', '探索分支修改了工作区文件。请检查变更后再继续。':'This exploration changed workspace files. Review the changes before continuing.',
    '摘要暂不可用，本次将使用节点问答。':'A summary is unavailable. This turn will use the question and answer.',
    '这个模型尚无价格记录，费用显示为估算。':'Pricing is unavailable for this model. Costs are estimates.',
    '问答与摘要':'Q&A + summary', '问答与路径摘要':'Q&A + path summary', '整条分支':'Entire branch', '问答':'Q&A',
    '移除嫁接':'Remove graft', '移除 ':'Remove ', '停止生成':'Stop generation', '发送消息':'Send message',
    '正在生成，你也可以先写下一个想法…':'Generating. You can draft your next idea…', '写下你的想法…':'What would you like to explore?',
    '先连接一个模型，让对话开始。':'Connect a model before your first conversation.', '正在准备上下文':'Preparing context',
    '主干路径':'Trunk path', '已归档':'Archived', '已停止':'Stopped', '未完成的回合':'Unfinished turn', '你在这里':'You are here',
    '折叠':'Collapse', '展开':'Expand', ' 的子节点':' children', '，当前位置':', current position',
    '嫁接到当前上下文':'Graft into current context', '嫁接到当前思路':'Graft into this context',
    '探索节点':'Exploration node', '不进入上下文':'Excluded from context', '这个回合没有保存最终回答。':'No final answer was saved for this turn.',
    ' 上下文 tokens':' context tokens', '从这里继续':'Continue from here', '设为主干':'Set as trunk',
    '完整内容':'Full content', '恢复分支':'Restore branch', '归档分支':'Archive branch',
    '在这里开启探索，主干保持原位。':'Explore from here. The trunk stays in place.', '已切换上下文，工作区文件保持原样。':'Context changed. Workspace files are unchanged.',
    '把这条思路设为主干？':'Make this the trunk?',
    '下一次输入将从这个节点继续，主干可以修改工作区文件。已有的对话和其他分支会保留。':'Your next turn continues from this node and may change workspace files. History and other branches are preserved.',
    '已设为主干。':'Trunk updated.', '归档这条分支？':'Archive this branch?',
    '该节点及其子节点将移出上下文。历史和费用记录保留，随时可以恢复。':'This node and its descendants leave the context. History and costs are preserved. You can restore the branch later.',
    '分支已归档，可开启「显示归档」找回。':'Branch archived. Turn on Show archived to find it.', '分支已恢复。':'Branch restored.', '节点内容':'Node content',
    '把发现带回当前思路':'Bring a discovery back', '将 ':'Bring ', ' 的内容带入下一回合。原分支会保留，历史内容不会改写。':' into the next turn. The original branch and history are preserved.',
    '只带入这个节点的问题与最终回答。':'Include this node’s question and final answer.', '保留发现，以及通往发现的必要背景。':'Include the discovery and the background that led to it.',
    '带入公共祖先之后的全部问答，省略工具输出。':'Include all Q&A after the shared ancestor, without tool output.', '添加嫁接':'Add graft', '发现已加入下一回合的上下文。':'Discovery added to your next turn.',
    '回到这个节点':'Return to this node', '选择要回退的部分。代码回退只影响后续回合修改过的文件，同一文件中的手工修改也会被覆盖。':'Choose what to rewind. Code rewind affects files changed by later turns, including manual edits in those files.',
    '只回退对话':'Conversation only', '切换上下文，不修改文件。':'Change context without modifying files.', '只回退代码':'Code only', '恢复文件，对话位置不变。':'Restore files without moving the conversation.',
    '对话与代码':'Conversation and code', '从这个节点的对话和文件状态继续。':'Continue from this node’s conversation and file state.', ' 当前节点不可用。':' Unavailable for this node.',
    '没有需要恢复的文件。':'No files need restoring.', '确认回退':'Rewind', '已回到选定状态。':'Returned to the selected state.',
    '为下一回合选择模型，历史记录保持原样。':'Choose a model for your next turn. History is preserved.', '管理模型与服务商':'Manage models and providers',
    '先停止或等待当前回合结束，再修改模型设置。':'Stop or finish the current turn before changing model settings.', '模型与设置':'Models & settings',
    '连接你选择的模型。配置保存在本机，只有模型请求会发送到你配置的服务商。':'Bring your own model. Settings stay on this device; model requests go to your chosen provider.',
    '服务地址':'Endpoint', '已保存 · 留空保留现有 key':'Saved · Leave blank to keep your key', '填写服务商提供的 API key':'Enter your provider’s API key', '此服务无需 key':'No API key required',
    '保存在应用私有目录，不进入对话或工作区。':'Stored privately on this device, outside conversations and workspaces.', '模型 ID':'Model IDs',
    '使用英文逗号分隔。可填写服务商支持的自定义模型 ID。':'Separate with commas. Custom model IDs are welcome.', '保存连接':'Save connection', '连接已保存。可以开始对话了。':'Connection saved. You are ready to chat.',
    '移除服务商连接？':'Remove this provider?', '删除本机保存的地址、key 和模型列表。历史对话仍然保留。':'Remove the saved endpoint, key and model list. Conversation history is preserved.',
    '移除连接':'Remove connection', '刷新模型与价格':'Refresh models & pricing', '正在获取模型目录…':'Fetching model catalog…', '更新模型目录':'Update model catalog',
    '将保留现有与自定义模型，更新后的列表包含 ':'Existing and custom models are preserved. The updated list contains ', ' 个模型。确认后保存模型与价格。':' models. Confirm to save models and pricing.',
    '保存更新':'Save update', '模型与价格已更新。':'Models and pricing updated.',
    '外观与色彩':'Appearance', '选择一种舒服的阅读氛围。更改即时生效，也会保存下来。':'Choose a comfortable space to read. Changes apply immediately and are saved.',
    '明暗模式':'Appearance mode', '强调色':'Accent color', '为思路留出空间':'Room for your ideas', '让一个想法，自由生长。':'Give an idea room to grow.',
    '在分支中探索，在主干上创造。':'Explore on branches. Create on the trunk.', '让界面退后，让内容走到前面。':'Less interface. More room for what matters.',
    '跟随系统':'System', '浅色':'Light', '深色':'Dark', '松绿':'Forest', '靛蓝':'Indigo', '陶土':'Clay',
    '将随系统自动切换浅色与深色。':'Light and dark appearance will follow your system.', '主题已应用，关闭后仍会保留。':'Appearance saved. Your choice stays with you.',
    '给这段思路起个名字':'Name this conversation', '对话名称':'Conversation name', '保存名称':'Save name',
    '当前只有一个本地工作区。':'You have one local workspace.', '本地工作区':'Local workspace', '请先结束当前回合再切换工作区。':'Finish the current turn before switching workspace.',
    '每条消息最多添加 8 个附件。':'Add up to 8 attachments per message.', '附件过大：单个最多 20 MiB，合计最多 40 MiB。':'Files may be up to 20 MiB each and 40 MiB in total.',
    '已复制。':'Copied.', '复制暂不可用。':'Copy is unavailable right now.', '当前回合结束后可以发送，草稿会保留。':'Send after this turn finishes. Your draft is saved.',
    '取消':'Cancel', '关闭对话框':'Close dialog', '服务商':'Provider', '提供商':'Provider', '已连接':'Connected', '等待模型':'Waiting for model', '生成标题':'Naming conversation',
    '主干':'Trunk', '嫁接':'Graft', '归档':'Archive', '恢复':'Restore', '回退':'Rewind', '探索':'Explore', '附件':'Attachment',
    '切换会话侧栏':'Toggle conversations', '关闭会话侧栏':'Close conversations', '开启新对话':'New conversation', '你的思路，逐渐成形':'Watch your ideas take shape',
    '查找对话':'Search conversations', '会话':'Conversations', '对话列表':'Conversations', '对话内容':'Conversation', '对话':'Conversations',
    '想法与文件，留在这里':'Your ideas and files, on device', '上下文树':'Context tree', '上下文用量':'Context usage', '上下文':'Context',
    '从一个问题开始，让思路自由生长。':'Start with a question. See where it leads.', '留出空间，探索更多可能':'A LITTLE ROOM FOR POSSIBILITY',
    '一个想法，':'One idea,', '可以有很多种':'so many ', '可能。':'possibilities.',
    '和 kaipi 一起思考、编写与创造。':'Think, code and create with kaipi.', '让探索长成分支，把有价值的发现带回主干。':'Let explorations branch out. Bring discoveries back.',
    '读懂一个项目':'Understand a project', '从结构到细节，建立全貌':'See the structure. Find the details.', '把想法变成现实':'Make an idea real', '一起找到值得实现的方向':'Find a direction worth building.',
    '思路不必是一条直线':'Ideas do not have to follow a line', '认识树形上下文':'Meet the context tree', '回到最新消息':'Jump to latest message',
    '添加附件':'Attach a file', '消息':'Message', '分支中探索 · 主干上创造':'Explore on branches · Create on the trunk',
    '让思路可见':'SEE YOUR IDEAS', '关闭上下文树':'Close context tree', '显示归档':'Show archived', '每个问题，都是一个节点':'Every question becomes a node',
    '从任意节点开启探索，把发现嫁接回主干。':'Explore from any node. Graft discoveries back.', '对话开始后，你的思路会在这里生长。':'As you chat, your ideas take shape here.',
    '缩小树':'Zoom out', '放大树':'Zoom in', '适应视图':'Fit to view', '当前位置':'You are here', '点选节点，查看内容或调整上下文':'Select a node to view it or shape your context',
    '关闭侧栏':'Close sidebar', '重命名对话':'Rename conversation', '关闭节点详情':'Close node details',
    '帮我了解这个项目的结构，梳理主要模块和它们之间的关系。':'Help me understand this project’s structure, its main modules and how they fit together.',
    '我有一个新想法。先帮我梳理需求，再一起探索几种实现方案。':'I have a new idea. Help me clarify the requirements, then explore a few ways to build it.',
    '无效的主题设置':'Invalid appearance setting', '写下问题，再发送。':'Write a message before sending.', '请填写 API key':'Enter an API key',
    '至少填写一个模型 ID':'Enter at least one model ID', '服务地址需要以 https:// 或 http:// 开头':'The endpoint must start with https:// or http://', '请先配置这个模型':'Configure this model first',
    '连接你的模型':'Bring your own model', '选择你的服务商':'Choose your provider', '搜索服务商':'Search providers', '没有找到服务商':'No providers found',
    '保存并开始':'Save & start', '稍后配置':'Set up later', '返回':'Back', '继续使用当前连接':'Use existing connection',
    '使用你自己的 API key，连接你信任的服务商。':'Use your own API key with a provider you trust.',
    '也可以稍后设置，但首次对话前仍需配置供应商。':'You can set this up later. A provider is required before your first conversation.',
    '已跳过。首次对话前仍需配置供应商。':'Setup skipped. Connect a provider before your first conversation.',
    '首次对话前连接模型':'Connect a model before chatting', '正在读取服务商配置…':'Getting your provider settings…',
    '连接准备好后即可保存。也可以稍后配置。':'Save when the engine is ready, or set this up later.',
    '界面语言':'Interface language', '选择你习惯的语言，内容和代码保持原样。':'Choose your interface language. Messages and code stay unchanged.',
    '简体中文':'简体中文', 'English':'English', '语言已保存。':'Language saved.',
  };
  let preferences = {language:null, android_language_confirmed:false, android_onboarding_complete:false};
  try { preferences = {...preferences,...JSON.parse(localStorage.getItem('kaipi.preferences') || '{}')}; } catch { }
  if (!['zh','en'].includes(preferences.language)) preferences.language = null;
  const keys = Object.keys(messages).sort((a,b)=>b.length-a.length);
  const statics = [];
  const translated = new Map();
  function text(source) {
    if (preferences.language !== 'en') return source;
    if (translated.has(source)) return translated.get(source);
    let result = String(source);
    for (const key of keys) if (result.includes(key)) result = result.split(key).join(messages[key]);
    translated.set(source,result);
    return result;
  }
  function html(strings,...values) { return strings.map((part,index)=>text(part)+(index<values.length?values[index]:'')).join(''); }
  function apply(value) {
    preferences = {...preferences,...value};
    if (!['zh','en'].includes(preferences.language)) preferences.language = null;
    preferences.android_language_confirmed = preferences.android_language_confirmed === true;
    preferences.android_onboarding_complete = preferences.android_onboarding_complete === true;
    document.documentElement.lang = preferences.language === 'en' ? 'en' : 'zh-CN';
    try { localStorage.setItem('kaipi.preferences',JSON.stringify(preferences)); } catch { }
    for (const item of statics) if (item.node.isConnected) {
      if (item.attribute) item.node.setAttribute(item.attribute,text(item.source));
      else item.node.nodeValue = text(item.source);
    }
    return {...preferences};
  }
  function initStatic(root) {
    const walker = document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) { const node = walker.currentNode; if (/[\u3400-\u9fff]/.test(node.nodeValue)) statics.push({node,source:node.nodeValue}); }
    for (const node of root.querySelectorAll('[aria-label],[title],[placeholder],[data-prompt]')) {
      for (const attribute of ['aria-label','title','placeholder','data-prompt']) {
        const source = node.getAttribute(attribute); if (source && /[\u3400-\u9fff]/.test(source)) statics.push({node,attribute,source});
      }
    }
    apply({});
  }
  window.KaipiLocale = {text,html,apply,initStatic,current:()=>({...preferences})};
  apply({});
})();
