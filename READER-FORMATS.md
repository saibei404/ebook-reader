# 阅读内核 · 格式支持与验收说明

> 版本：v24（2026-10-29）｜平台：Windows 10/11 x64（Electron 33 / Chromium 130）

---

## 一、架构总览

```
主窗口（index.html）                    阅读窗口（reader.html，独立 BrowserWindow）
├─ 书架 / 详情 / 设置                   ├─ 工具栏（悬浮）：返回 · 书名 · 进度 · 目录 · 排版
└─ 「继续阅读」── IPC ──▶ 创建/聚焦 ──▶ ├─ 正文区：按格式分发渲染器
                                        ├─ 底部进度条
IndexedDB（books/covers/wallpapers/kv） ◀── 位置节流写回（1.2s）+ BroadcastChannel 通知
```

**关键设计**
- **独立入口**：`reader.html` 与主窗口分离构建，`epub.js`（796KB）/ `pdf.js`（652KB + worker 1.26MB）**只在阅读窗口按需加载**，主窗口包体不受影响（主入口 JS 402KB）。
- **统一位置抽象** `Locator{kind, value, percent, scrollRatio?}`：cfi（EPUB）/ page（PDF）/ offset（TXT·FB2·MD）/ index（CBZ）。
- **无云同步**：位置、排版偏好全部落本机 IndexedDB，无任何网络上报。

---

## 二、格式支持矩阵

| 格式 | 引擎 | 定位方式 | 恢复粒度 | 状态 |
|---|---|---|---|---|
| **TXT** | 自研（分章 + 流式渲染） | 字符偏移 + 像素比例 | **精确（像素级，已实测 600→600）** | ✅ 可用 |
| **EPUB** | epub.js 0.3.93 | CFI | 章节/段落（当前实测回落首章，见已知问题） | ✅ 可读，⚠️ 恢复待完善 |
| **PDF** | pdf.js 4.10（worker 懒渲染） | 页码 1-based | 页码级 | ✅ 可读，✅ 定位可靠 |
| **FB2** | 自研（XML → 结构化章节） | 字符偏移 | 同 TXT | ✅ 可用 |
| **MD** | 自研（轻量 Markdown → HTML，支持 GFM 表格/列表/引用/代码/行内颜色） | 字符偏移 | 同 TXT | ✅ 可用 |
| **DOCX** | mammoth 1.13（Word → 语义 HTML，按 h1 切章） | 字符偏移 | 同 TXT | ✅ 可用（颜色/绝对字号/对齐不透传，见下） |
| **CBZ** | fflate 解包 + 图片序列 | 图片序号 | 页级 | ✅ 可读，⚠️ 恢复时序待调 |
| **CBR** | — | — | — | ❌ 明确提示转 CBZ |
| **MOBI / AZW3** | — | — | — | ❌ 明确提示转 EPUB |

**加载策略**
- 文本类（TXT/MD/FB2）：`read-book` 取 ArrayBuffer → 解码（UTF-8/UTF-16 BOM/GB18030 自动探测）→ 分章 → 一次性渲染（章节级 DOM，无虚拟滚动）。
- EPUB：`ePub(ArrayBuffer)` → `renderTo` iframe（`flow:'scrolled-doc'`）→ `display(CFI)`。
- PDF：**不走 IPC 搬字节**，改用自定义协议 `moyu-file://f/<base64url(绝对路径)>` 交给 pdf.js，
  `getDocument({ url, rangeChunkSize: 512KB, disableAutoFetch: true })` 由引擎按 Range 分块读取
  （主进程用 `protocol.handle` 返回 206 + `fs.createReadStream(start,end)`）；再只渲染视口 ±600px
  内页面（IntersectionObserver），canvas 池上限 12 页，超出释放像素。
- DOCX：`mammoth.convertToHtml`（浏览器版，按需加载）→ 按 `<h1>` 切章 → 与 TXT/MD 共用渲染管线；
  表格首行提升为 `<th>`；Word 的字符颜色、绝对字号与段落对齐不透传（mammoth 不解析 `w:color` / `w:sz` / `w:jc`）。
- CBZ：`unzipSync` → 图片按自然序 → Blob URL（关闭时统一 revoke）。

---

## 三、兼容范围

| 项 | 范围 |
|---|---|
| 操作系统 | Windows 10 1809+ / Windows 11（x64），portable 单文件 |
| 文件大小 · PDF | **无硬上限**（按需 Range 读取，仅受磁盘与可用内存约束；已实测 267MB / 300 页可正常打开） |
| 文件大小 · 其它 | 单本 ≤ **300MB**（TXT/EPUB/FB2/CBZ 必须整份解入内存）；EPUB 含大量图片时建议 ≤ 100MB |
| 文本编码 | UTF-8（含 BOM）、UTF-16 LE/BE、GB18030/GBK |
| 窗口 | 阅读窗口无边框 + 最大化；支持多显示器/DPI 缩放切换（ResizeObserver 同步 iframe 尺寸） |
| 快捷键 | `Esc` 退出阅读（先关面板）；`Ctrl/⌘ + +/-` 调整字号 |
| 摸鱼联动 | 全局热键同时隐藏主窗口与阅读窗口；托盘点击恢复到活跃窗口 |
| 不支持 | 云同步、DRM（Adobe/Kindle）、MOBI/AZW3 原生解析、竖排/注音排版 |

---

## 四、异常处理

| 场景 | 表现 |
|---|---|
| 文件不存在/被移动 | 阅读器显示「无法打开这本书 · 文件不存在或被移动」+ 返回书架 |
| 无读取权限 | 「没有读取权限」 |
| TXT/EPUB/FB2/CBZ > 300MB | 「文件过大（N MB），XXX 当前上限 300MB」，不进入渲染 |
| PDF 文件损坏 / 被占用 | 「PDF 打开失败：…」（pdf.js 原始原因），停留可返回状态 |
| 阅读窗口读不到书架数据 | 若书在书架存在而阅读窗提示「找不到」，检查窗口 `partition` 是否被改回独立分区（必须共用默认 session） |
| 不支持的格式（MOBI/AZW3/CBR） | 明确说明原因与建议转换目标 |
| 书籍无 `sourcePath`（示例书） | 「没有关联的本地文件，请重新导入原始文件」 |
| EPUB 渲染失败 | 「EPUB 渲染失败：…」并停留可返回状态 |
| PDF 单页渲染失败 | 保留占位页码，其余页继续渲染（不整体失败） |
| 漫画包内无图片 | 「压缩包内没有可显示的图片（支持 JPG/PNG/WebP/GIF/AVIF/BMP）」 |
| 阅读窗口进程崩溃 | 主进程记录 `crash.log`，销毁残留窗口、回焦主窗口并发提示「位置已保存，可重新打开」 |
| 位置保存失败 | 静默重试（下次滚动再写），不打断阅读；退出前 `flush()` 保证已读位置落盘 |
| 窗口重建期间（切原生亚克力） | 沿用旧 URL 恢复原页面；`window-all-closed` 已拦截，不会退出进程 |

---

## 四之二、排版验证样本

`test-fixtures/` 下按格式分类存放统一内容的验证样本（txt/md/epub/docx/pdf/fb2/cbz），
生成与验证方法、逐格式实测字号/颜色/结构与已知差异见 `test-fixtures/README.md`。

## 五、验收标准

### 功能
- [x] 详情页「继续阅读」打开独立全屏阅读窗口（无重复建窗，已开则切书聚焦）
- [x] TXT/EPUB/PDF/FB2/CBZ 五格式均可渲染正文（自动化探针 + 截图双验证）
- [x] 悬浮工具栏：返回 / 书名 / 进度 / 目录（EPUB）/ 排版；`Esc` 退出并保存位置
- [x] 排版设置：字号 13–34、行距 1.2–2.4、正文宽度 520–1100、字体（宋/黑/楷）、主题（纸白/米黄/夜间/跟随），全部持久化
- [x] 目录跳转（EPUB）可用
- [x] 阅读进度写回书架：圆环 + 详情页只读进度条经 BroadcastChannel 实时同步
- [x] 位置恢复：TXT 精确（600px → 600px）
- [ ] 位置恢复：PDF/CBZ 页级、EPUB 段落级（实现已就位，自动化测试未通过，见下）

### 性能
- [ ] 冷启动 < 1.2s（未测）
- [x] 阅读窗口不加载 epub/pdf 引擎之外的额外体积（按格式懒加载）
- [x] PDF 大文档：懒渲染 + 页池上限 12 页控制内存

### 稳定性
- [x] 五格式连续打开无崩溃、无 `crash.log` 新增
- [x] 阅读窗口崩溃不影响主窗口（独立进程 + 兜底提示）
- [x] 摸鱼热键/托盘在阅读态下行为正确（同时隐藏/恢复）

---

## 六、已知问题与后续修复

| # | 问题 | 影响 | 修复方向 | 优先级 |
|---|---|---|---|---|
| K1 | ~~EPUB 跨会话恢复回落到第一章~~ | **已修复（v27）**：根因是滚动容器取了 `.epub-host`（overflow:hidden），实际应为 `.epub-container`；同时 display 后立即上报会覆盖目标位置。现改为快照式采集 + href 二次定位，`RESTORE_OK(cfi)` | 已关闭 |
| K2 | ~~CBZ/PDF 自动化恢复用例未取到滚动量~~ | **已修复（v28）**：补 `scrollRatio` 并按比例恢复；CBZ 等图片撑开容器（定时器 4s + 高度门槛）。四格式 `RESTORE_OK` | 已关闭 |
| K3 | EPUB 章内像素级滚动不进 locator | 同章内滚动位置不恢复 | 监听 iframe 内滚动（`hooks.content` 挂 scroll 监听）累计到 CFI | 中 |
| K4 | 大 TXT（>3MB）一次性渲染全部章节 | 首次打开可能 1–2s 卡顿 | 引入章节虚拟化（IntersectionObserver + 占位高度） | 中 |
| K5 | ~~无阅读器内搜索~~ | **已实现（v28）**：TXT/MD/FB2/DOCX 全篇搜索（章节索引 + 片段 + 跳转）；PDF/EPUB/CBZ 提示暂不支持 | 已关闭 |

---

## 七、验证方法（可复现）

```bash
# 1. 构建
npx electron-vite build

# 2. 五格式渲染 + 截图（输出 screenshots/reader-<fmt>.png 与探针 JSON）
MOYU_TEST_READER="txt|?testpath=<绝对路径>/test-novel.txt"  electron .
MOYU_TEST_READER="epub|?testpath=<绝对路径>/test-book.epub"  electron .
MOYU_TEST_READER="pdf|?testpath=<绝对路径>/test-manual.pdf"  electron .
MOYU_TEST_READER="fb2|?testpath=<绝对路径>/test-fb2.fb2"    electron .
MOYU_TEST_READER="cbz|?testpath=<绝对路径>/test-comic.cbz"    electron .

# 3. 位置记忆（两阶段：推进位置 → 关闭 → 重开校验）
MOYU_TEST_RESTORE="txt|<绝对路径>/test-novel.txt" electron .
```

手工验收：书架导入 → 详情「继续阅读」→ 滚动/翻页 → `Esc` 退出 → 再从详情进入，检查是否回到原处、书架圆环是否更新。
