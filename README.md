# 墨鱼阅读器 · Moyu Reader

本地优先的跨平台电子阅读器——七种格式可读（TXT/MD/EPUB/PDF/FB2/DOCX/CBZ），带位置记忆、书签、高亮与笔记、全篇搜索、备份导入导出，以及「摸鱼」场景必备的老板键与托盘常驻。

> 当前基线 **v30**：v29 完成大文件性能、高亮/笔记闭环与备份导入；v30 补齐书架分组拖拽、EPUB 章内位置恢复（K3）与 DOCX 颜色/字号/对齐透传（D7），单测 131 例。

## 快速开始

```bash
npm install          # 安装依赖（Electron 二进制会自动下载）
npm run dev          # 开发模式（热更新）
npm run build        # 构建 main / preload / renderer
npm run shot         # 自动化视觉测试：28 个界面状态截图到 screenshots/
npm test             # 单元测试（vitest，131 用例）
npm run test:cov     # 单测 + 覆盖率（核心纯函数 > 80%）
npm run dist:portable# 打包免安装 exe 到 release/
npm run dev:web      # 仅以前端方式预览（无原生能力）
```

> 国内网络打包时建议设置镜像：
> `ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/`、
> `ELECTRON_BUILDER_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/electron-builder-binaries/`。
> 若 electron-builder 解压 winCodeSign 报 "Cannot create symbolic link"（非管理员权限），先用
> `7za x -snl-` 手动解压 `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\<hash>.7z` 到同名目录即可复用。
> 若报 `app.asar ... being used by another process`（文件监视器/索引器占用旧产物），更换输出目录即可：
> `electron-builder --win portable -c.directories.output=release-vN`。
> `npm run shot` 使用独立 profile（`%TEMP%\moyu-shot-profile`），避免与运行中的客户端争用 IndexedDB。

## 功能清单

| 模块 | 能力 |
|---|---|
| 首页书架 | 网格布局、全局搜索（导航栏）、筛选（全部/在读/未读/读完）、排序（最近/书名/作者/进度） |
| 展示动效 | 翻页（3D rotateY 弹簧）、淡入、缩放、滑入、堆叠，切换即重播；卡片 hover 浮起 + 指针跟随 3D 倾斜 + 高光 |
| 封面 | 14 本种子书程序化生成封面（canvas 渐变 + 书名 + 格式徽标，3:4）；支持本地图片更换、随机生成、恢复默认 |
| 壁纸 | 三套预设（深海/暮色/晨雾）+ 本地导入（JPEG/PNG/WebP/GIF/BMP/AVIF/HEIC/TIFF + MP4/WebM/MOV，导入时解码探测）；五种显示模式（覆盖/填充/居中/适应/拉伸）+ 缩放，实时预览自动保存；遮罩浓度可调 |
| 阅读内核 | 独立全屏 `reader.html` 窗口；TXT/MD/EPUB/PDF/FB2/DOCX/CBZ 七格式；DOCX 保留 Word 的颜色/字号/对齐；排版面板（字号/行距/宽度/字体/主题）；目录；Esc 退出 |
| 位置记忆 | `locator` 四类定位（CFI/页码/字符偏移/图片序号）+ 退出前 flush；EPUB 精确到章内文字（视口顶部 CFI）；跨窗口 BroadcastChannel 同步书架圆环 |
| 书架分组 | 自定义分组、拖拽归组与组内排序、折叠、重命名、删除；分组随备份 JSON 一起走 |
| 大文件 | 章节 HTML 惰性生成 + 分批挂载（3MB TXT 首开 ≈290ms，只挂 21/508 章）；PDF 走 `moyu-file://` 协议 Range 流式 |
| 书签 / 高亮 / 笔记 | 书签面板与详情页列表；选中正文四色高亮（CSS Custom Highlight API，不改 DOM）；EPUB 用 CFI Range；备注可在阅读器或「笔记」页编辑；导出 Markdown |
| 全篇搜索 | 文本类全篇搜索（章节索引 + 片段 + 点击精确跳转）；PDF/EPUB/CBZ 明确提示 |
| 备份 | 单个 JSON 导出（书籍/位置/书签/笔记/设置）+ 导入合并去重（不倒退进度、重复导入幂等） |
| 稳定性 | 全局错误兜底页（重载 / 导出诊断 / 关闭）；异常与静默失败落 `%APPDATA%/moyu-reader/logs/app.log`（2MB×5 滚动）；坏文件给明确提示而非空白页 |
| 标签栏 | 书架 / 笔记 / 我的 三入口；磨砂玻璃 / 亚克力 / 云母 / 纯色四材质即时切换 |
| 导航栏 | 透明默认，滚动 >24px 切换液态玻璃；品牌返回、页面标题、中央搜索、书签/导入/壁纸/主题快捷操作；支持性能降级与减少动态效果 |
| 摸鱼键 | 默认 `Alt+X` 全局隐藏/恢复（可录制更改；录制时忽略单独修饰键，注册失败自动提示不写入）；关闭窗口 = 隐藏到托盘；托盘单击 toggle、右键菜单；阅读位置本地持久化，恢复后保持 |
| 主题 | 深色 / 浅色，全部表面同步切换 |
| 数据 | IndexedDB v3 本地存储（书籍/封面/壁纸/设置/书签/笔记），完全离线；支持备份、导入、清空重建 |
| 网盘导入 | WebDAV 协议导入（坚果云/Nextcloud/群晖 DSM 等）：连接→目录浏览→勾选书籍→下载入架；凭据仅存本机 IndexedDB；失败逐本提示 |

## 技术栈与选型说明

- **Electron 33 + React 18 + TypeScript + Vite**：原技术选型为 Tauri 2 + React，因交付本机缺少 Rust / MSVC 工具链无法编译 Tauri 的 Rust 核心，故以 Electron 交付可运行 exe。**前端为 shell 无关的纯 Web 实现**（原生能力经 `src/lib/native.ts` 桥接层隔离，Web 模式自动降级），后续可平移回 Tauri。
- **Motion（motion/react）**：全部弹簧动效、layout FLIP（书架重排/详情页封面共享位移动画）、AnimatePresence 进出场。
- **Zustand**：四类状态（books / settings / covers / wallpapers）+ UI 状态单 store。
- **idb**：IndexedDB 封装。
- 主进程职责：窗口（无边框 + 自定义标题栏）、托盘、全局快捷键、原生文件对话框。
- **设计规范**：见 [DESIGN.md](./DESIGN.md)（组件参数分固定要求 / 可配置 / 建议默认三级）与 [DESIGN-GUIDE.md](./DESIGN-GUIDE.md)（设计取向与取舍）。
- **阅读内核 / 格式矩阵**：见 [READER-FORMATS.md](./READER-FORMATS.md)；排期与已知缺陷见 [ROADMAP.md](./ROADMAP.md)。
- **单元测试**：vitest + jsdom + fake-indexeddb，覆盖分章、字符偏移换算、Markdown 渲染、DOCX OOXML 转换、备份合并、DB 迁移（v2→v3）。

## 目录结构

```
ebook-reader/
├── electron/
│   ├── main.ts            # 主进程：窗口/托盘/老板键/IPC/协议/自检钩子
│   ├── preload.ts         # contextBridge 安全桥
│   ├── netpan.ts          # WebDAV
│   └── baidu.ts           # 百度网盘 OpenAPI
├── src/
│   ├── components/        # TabBar/TopBar/BookCard/BookGrid/BookDetail/WallpaperLayer/Toast/Icons
│   ├── pages/             # LibraryPage / NotesPage / SettingsPage
│   ├── reader/            # 阅读窗口：ReaderApp / locator / text-utils / text-range / chapter-window / formats/*
│   ├── store/useStore.ts  # Zustand 状态机
│   ├── lib/               # db(IDB) / backup / annotations / cover / seed / anim / native / perf
│   ├── styles/global.css  # 主题变量 + 四套材质系统
│   └── types/book.ts      # 契约层
├── tests/                 # vitest 单测（text-utils / locator / backup / annotations / db）
├── scripts/               # run.cjs / gen_* 样本生成 / probe-reader.cjs 诊断
├── test-fixtures/         # 七格式排版验证样本
├── resources/             # 应用图标（ico/png/tray）
└── screenshots/           # npm run shot 产出的 28 张状态截图
```

## 已知约束

- 阅读内核（EPUB.js / PDF.js）尚未接入，详情页「开始阅读」为占位——属于下一阶段（增强期）范围。
- 窗口级原生亚克力仅 Windows 11 生效；Win10 下 CSS 亚克力（磨砂）效果不受影响。
- Wallpaper Engine 需本机已安装（Steam 版）；未安装时同步功能不可用，界面会明确提示。
- 若在某些终端中 `npm run dev` 打开空白窗口，是环境变量 `ELECTRON_RUN_AS_NODE=1` 导致 Electron 以 Node 模式运行；`npm run dev` 已内置清理，直接手动运行 electron 时需 `unset ELECTRON_RUN_AS_NODE`。

## 后续路线（与整体规划对齐）

- **MVP 收尾**：阅读内核（TXT/EPUB）、书籍分组与拖拽、备份导出。
- **增强**：MOBI/AZW3/FB2/CBZ/CBR 解析、书签/笔记/高亮、FTS5 全文搜索。
- **优化**：虚拟滚动、封面 WebP 缓存、macOS/Linux CI、自动更新。

## 版本管理（git）

- 仓库：`main` 分支，基线提交 `cf3bf81`（v23，2026-10-29）。
- 忽略范围：`node_modules/`、`out/`、`release*/`、`dist-electron/`、`_archive/`、`screenshots/`、`*.exe|7z|blockmap`。
- 提交规范（Conventional Commits）：`feat:` 新功能 / `fix:` 缺陷修复 / `refactor:` 重构 / `perf:` 性能 / `docs:` 文档 / `chore:` 工程杂务。
- 每次交付前：`npm run typecheck` → `npm run build` → `npm run shot`（29 状态零渲染错误）→ 打包 → 归档到 `_archive/<日期>_v<N>_<主题>/`。
- 建议粒度：一个可验证的功能点一个提交；修复类提交在描述里写明「现象 / 根因 / 修复」。

## 历史版本归档（_archive/）

工程根目录的 `_archive/` 为**目录联接（Junction）**，实体在 `D:/moyu-archive`（C 盘空间有限，大产物外置；访问 `_archive/` 与普通目录完全一致）。

- **归档规则**：按改动批次归档，每批一个文件夹，命名 `<日期>_v<版本号>_<批次名>`；只移动/复制、**不删除不覆盖**；目标冲突自动追加 `-N` 后缀。
- **每批内容**：`MANIFEST.md`（memory 日志原始记录 + 文件清单 + sha256）、该版本构建产物（portable exe / win-unpacked / nsis）、验证截图（归入最新批次）。
- **批次识别**：脚本 `scripts/archive-batches.cjs` 解析 `.workbuddy/memory/*.md` 的「第 N 轮」标题、日期与 `新 exe` 路径，对齐文件系统中的 `release-vN` 目录；memory 缺记录时回退为「未登记批次」。
- **重新归档**：`node scripts/archive-batches.cjs`（预演）/ `--apply`（执行）。
- **索引**：`_archive/README.md`（批次总表）、`_archive/archive-report.json`（机器可读报告）。
- **原位产物**：因 `release/win-unpacked` 被工作区监视器锁定（EPERM），首批采用「复制并保留原件」降级，原件已整体迁至 `D:/moyu-oldbuilds/originals-2026-10-25/`。
- **临时缓存**：portable 运行时的解压缓存位于 `%TEMP%\ns*.tmp` 与 `%TEMP%\3L8*`（每个约 284–357MB），异常退出后会残留，定期清理可保 C 盘空间（便携程序闪退的高频根因）。
