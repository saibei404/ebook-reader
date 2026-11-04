# 墨鱼阅读器 · 路线图（ROADMAP）

> 基线 **v32 / 0.9.0**（2026-11-04）。阅读内核、位置记忆（含 EPUB 章内）、书签、高亮/笔记、全篇搜索、
> 备份导入、书架分组、DOCX 格式透传均已完成；单测 131 例。
> **当前缺口性质已变化**：不再是"读不了书"，而是"读起来还不够顺"（书签缺失、EPUB 位置恢复不稳、大文件性能）与"产品闭环未成形"（笔记/分组/备份）。
> 时间单位：**有效开发日（d）**，按「1 人 + AI 辅助」估算，含自测与回归，不含等待评审。

---

## 一、当前进展快照

### 已完成（可直接使用）

| 模块 | 状态 | 说明 |
|---|---|---|
| 书架首页 | ✅ | 卡片 3:4 + 3D 悬停 + 进度圆环；5 种入场动效；搜索/筛选/排序；封面尺寸三档 |
| 本地导入 | ✅ | 多选导入、格式识别、判重、坏封面清理 |
| 封面 | ✅ | 程序化生成（可随机）+ 本地图片替换 + 恢复默认 |
| 壁纸 | ✅ | 图片/视频、底纹叠加、深浅亮度适配、全局+细分透明度、显示模式/缩放/取色 |
| 主题与材质 | ✅ | 深/浅色；4 种材质（已去大面积 backdrop-filter） |
| 网盘导入 | ✅ | WebDAV（坚果云/Nextcloud/群晖/Alist）+ 百度网盘 OpenAPI |
| 桌面能力 | ✅ | 托盘常驻、摸鱼热键（双窗口联动）、单实例、关闭到托盘、崩溃日志 |
| **阅读内核** | ✅ | 独立全屏 `reader.html` 窗口；7 格式渲染；排版面板（字号/行距/宽度/字体/主题）；目录；Esc 退出 |
| **位置记忆** | ✅ | `locator` 四类定位（cfi/page/offset/index）；节流写回 + 退出 flush；BroadcastChannel 同步书架圆环 |
| **大文件** | ✅ | PDF 走 `moyu-file://` 协议 Range 流式（实测 267MB / 300 页）；其它格式 buffer（≤300MB） |
| 工程质量 | ✅ | 29 状态截图回归；材质切换 / 阅读渲染 / 位置恢复 / 跨窗口自检；批次归档（26 轮） |
| 排版验证样本 | ✅ | `test-fixtures/` 七格式同规格样本 + 逐格式实测报告 |

### 未完成 / 占位

| 能力 | 现状 | 缺口 |
|---|---|---|
| ~~**书签**~~ | ✅ **已实现（v27）** | 阅读器面板增删/跳转 + 详情页列表；DB v2 表 |
| ~~笔记 / 高亮 / 书摘~~ | ✅ **已实现（v29）** | 文本类 + EPUB 高亮、备注、笔记页聚合、Markdown 导出 |
| ~~书架组织~~ | ✅ **已实现（v30）** | 分组 + 拖拽归组/排序 + 折叠 + 重命名/删除 |
| ~~数据备份~~ | ✅ **已实现（v29）** | 导出 + 导入合并去重 |
| 阅读器内搜索 | 无 | 长文档查找不便 |
| MOBI / AZW3 / CBR | 明确提示转换 | 需外部依赖或 sidecar，评估后决定 |

### 技术债

| # | 债务 | 影响 | 状态 |
|---|---|---|---|
| D1 | ~~无 git 仓库~~ | 改错无法回滚 | ✅ 已还清（`cf3bf81` 起） |
| D2 | ~~无单元测试~~ | 数据层/解析层缺陷靠人工发现 | ✅ 已还清（v29：113 例 / 83%） |
| D3 | 19 个 `release*` 空壳（285MB） | 目录噪声，被文件锁占用 | 待清理（需关监视器） |
| D4 | 包体 86.5MB | Electron 运行时 ~70MB 固定成本 | 已接受（决策点 6） |
| D5 | ~~`Book` 无 locator~~ | 接内核需数据迁移 | ✅ 已还清（v24） |
| D6 | EPUB 作者 CSS 与主题冲突 | 已用灰阶色适配缓解，彩色仍有硬编码风险 | 部分缓解 |
| D7 | ~~DOCX 颜色/字号/对齐不透传~~ | 自研 OOXML 解析直读 `document.xml` | ✅ 已还清（v30） |

### 已知缺陷（来自 READER-FORMATS.md K1–K5）

| # | 缺陷 | 影响面 | 优先级 |
|---|---|---|---|
| K1 | ~~EPUB 跨会话恢复回落到第一章~~ **✅ 已修复（v27：`RESTORE_OK(cfi)`）** | — | 已关闭 |
| K2 | ~~CBZ/PDF 位置恢复精度~~ **✅ 已修复（v28：四格式均 `RESTORE_OK`）** | — | 已关闭 |
| K3 | ~~EPUB 章内像素滚动不进 locator~~ **✅ 已修复（v30）** | — | 已关闭 |
| K4 | ~~大 TXT（>3MB）一次性渲染~~ **✅ 已修复（v29：惰性 HTML + 分批挂载，3MB 首开 290ms）** | — | 已关闭 |
| K5 | ~~无阅读器内搜索~~ **✅ 已实现（v28：文本类全篇搜索）** | EPub/PDF/CBZ 明确提示不支持 | 已关闭 |

---

## 二、里程碑

| 里程碑 | 定义 | 状态 |
|---|---|---|
| **M1 能读** | 七格式打开即读，位置持久化，摸鱼热键不丢进度 | ✅ **已达成（v25/v26）** |
| **M2 读得顺** | 位置恢复零失误（含 EPUB 章内）、书签可用、大文件不卡 | ✅ 已达成（v30） |
| **M3 闭环** | 标注—整理—备份—搜索形成闭环，可日常替代同类工具 | ✅ 已达成（v29：高亮/笔记/书签/搜索/备份四件齐） |
| **M4 可分发** | 单测覆盖核心链路、自动更新、目标平台稳定发布 | 进行中（单测完成；自动更新未做） |

---

## 三、任务清单

### Stage A · 阅读体验加固（M2，约 7–9d）

| # | 任务 | 工作量 | 依赖 | 预期产出（可验证） |
|---|---|---|---|---|
| A1 | ~~修复 EPUB 位置恢复（K1）~~ **✅ 完成 v27**：根因是滚动容器读错（实际是 `.epub-container` 而非 `.epub-host`）+ display 后立即上报覆盖目标；已加 href 二次定位 | ✅ | 无 | `RESTORE_OK(cfi)`，恢复到第 2 章 |
| A2 | ~~书签功能~~ **✅ 完成 v27**：DB v2 + 阅读器面板 + 详情页列表 + `openReader(jump)` 跳转；删书同步清书签 | ✅ | 无 | `BOOKMARK_OK`（重启后仍在）；DB 迁移 `14 本 → 14 本` 不丢 |
| A3 | ~~CBZ/PDF 恢复精度（K2）~~ **✅ 完成 v28**：记录全文 `scrollRatio` 并优先按比例恢复；CBZ 图片加载慢于重试窗口（rAF 0.3s → 定时器 4s + 容器高度门槛） | ✅ | 无 | pdf 2058→2058、cbz 1769→1769 |
| A4 | ~~大文件性能（K4）~~ **✅ 完成 v29**：章节 HTML 惰性生成（首开不再全量转义）+ 分批挂载（估算高度占位、前缀偏移二分算可视窗口）。实测 3MB/508 章：首开 290ms、只挂 21 章、堆 18MB；滚到底正常。EPUB 预加载经评估后不做（epub.js section.load 与渲染器内部缓存冲突，收益不确定） | ✅ | 无 | 首开 <600ms 达成 |
| A5 | ~~阅读器内搜索（K5）~~ **✅ 完成 v28**：文本类全篇搜索（章节索引 + 上下文片段 + 点击跳转）；PDF/EPUB/CBZ 明确提示 | ✅ | A4 | `SEARCH_OK`（命中 5 处，点击精确滚到 188px） |

### Stage B · 产品闭环（M3，约 10–13d）

| # | 任务 | 工作量 | 依赖 | 预期产出 |
|---|---|---|---|---|
| B1 | ~~笔记 / 高亮 / 书摘~~ **✅ 完成 v29**：DB v3 `annotations` 表；文本类用 CSS Custom Highlight API（不改 DOM）+ 字符偏移区间，EPUB 用 CFI Range（自绘 ::highlight，弃用 epub.js annotations——它依赖 sectionIndex 对齐，常「无异常但不出现」）；四色 + 备注；笔记页聚合/筛选/编辑/跳转；导出 Markdown | ✅ | A2 | `ANNOT_OK`（文本 + EPUB 各自通过，含重开后仍在、备注面板可见） |
| B2 | ~~书架分组与拖拽~~ **✅ 完成 v30**：kv `shelves`（数组即顺序）+ `Book.shelfId` 镜像；分区视图 / 分组条 / 拖拽到 chip·区块·卡片左右半边（归组 + 重排）/ 折叠 / 双击重命名 / 删除（书回未分组）；无分组时不分区，保持原整片网格 | ✅ | 无 | `SHELF_OK`（新建/拖入/镜像/重排/折叠持久化/删除） |
| B3 | ~~数据备份导出/导入~~ **✅ 完成 v29**：单个 JSON（书籍/位置/书签/笔记/设置），导入按「id → 书名+大小」合并、书签/笔记按位置去重、进度只增不减、重复导入幂等；`seeded` 标记不被覆盖 | ✅ | B1 | `BACKUP_OK`（14 本合并不重复、+1 书签 +1 笔记、二次导入 0 新增、非法文件被拒） |
| B4 | 格式补齐评估：MOBI/AZW3、CBR | 2–3d | 无 | 明确"支持 / 转 external 工具 / 不支持"的结论与实现或提示 |
| B5 | ~~DOCX 颜色与字号透传（D7）~~ **✅ 完成 v30**：自研 OOXML 解析（fflate + `document.xml`），保留 `w:color`（color-mix 适配主题）/`w:sz`（em 随字号缩放）/`w:jc`（对齐）/`w:ind`/`w:numPr`/表格 `gridSpan`；解析失败回退 mammoth | ✅ | 无 | fixture `样式10/60/5`（颜色/字号/对齐命中数），8/8 通过 |

### Stage C · 工程质量（M4，约 6–8d，可与 A/B 并行）

| # | 任务 | 工作量 | 依赖 | 预期产出 |
|---|---|---|---|---|
| C1 | ~~单元测试（vitest）~~ **✅ 完成 v29/v30**：131 用例 / 6 文件，覆盖分章与惰性 HTML、字符偏移↔DOM、Markdown 渲染、备份解析合并、注解格式化、DB CRUD 与 **v2→v3 迁移不丢数据**；语句覆盖 83.5%（annotations 100%、db 90.9%、text-utils 90.3%、chapter-window 100%） | ✅ | 无 | 已超出 ≥40 用例 / >70% 目标 |
| C2 | 阅读态回归扩展：把 `test-fixtures` 八份样本纳入自动化断言（容器/元素计数/字号/颜色） | 1.5d | 无 | 一条命令输出 8 份通过/失败表 |
| C3 | 启动与包体优化：冷启动 <1.2s；mammoth/epub/pdf 分包复核 | 1d | 无 | 实测冷启动数据；主窗口首屏 JS 不因新格式变大 |
| C4 | 发布链路：自动更新（可选）、目标平台（Windows 稳定后再评估 mac/Linux） | 2d | 无 | 更新可用或明确不做 |
| C5 | 清理 `release*` 残留壳（D3） | 0.2d | 关闭文件监视 | 工程根目录干净 |

---

## 四、依赖关系

```
                    ┌──────────── A1 修复 EPUB 恢复（K1/K3） ────────┐
                    │                                              │
M1(已达成) ─────────┼──────────── A2 书签（DB v2） ──┬──────────── B1 笔记高亮 ── B3 备份导出
                    │                                │                 │
                    ├──────────── A3 CBZ/PDF 恢复 ───┘                 │
                    │                                                  │
                    ├──────────── A4 大文件性能 ── A5 搜索 ────────────┘
                    │
                    ├──────────── B2 书架分组
                    ├──────────── B4 格式评估 ── B5 DOCX 颜色
                    └──────────── C1 单测 / C2 回归 / C3 优化 / C4 发布 / C5 清理
```

**关键路径**：A1 → A2 → B1 → B3（位置可靠 → 可标记 → 可带走）。
**可并行**：C1/C2 与 A 阶段并行（不改产品行为，只加护栏）；B2 与 B1 并行。

---

## 五、排期（有效开发日）

```
W1   A1 EPUB 恢复(2d) → A2 书签(2d)              ← M2 达成（位置零失误 + 书签可用）
W2   A3 恢复精度(1d) → A4 大文件(2d) → A5 搜索(1.5d)
W3   B1 笔记高亮(5d)                              ← 与 C1 单测并行
W4   B3 备份导出(2d) → B2 分组(3d)                ← M3 达成
W5   B4 格式评估(2d) → B5 DOCX 颜色(1d) → C3 优化(1d)
W6   C4 发布(2d) → C5 清理 → 归档                 ← M4 达成
```

---

## 六、风险与应对

| # | 风险 | 等级 | 应对 |
|---|---|---|---|
| R1 | **DB version 升级丢数据** | 🔴 高 | 升级前先做导出（B3 提前到 A2 之前做最小版）或写迁移脚本；升级回调只增表不改旧表；用测试 profile 验证 1→2 |
| R2 | EPUB CFI 恢复依赖 epub.js 内部行为 | 🟠 中 | 先做 href 二次定位兜底，再叠加章内偏移；用固定样本做回归，不靠肉眼 |
| R3 | 笔记高亮的选区跨 iframe（EPUB） | 🟠 中 | 优先做文本类（TXT/MD/DOCX）高亮，EPUB 用 CFI Range 后置 |
| R4 | 大 TXT 虚拟化破坏位置记忆 | 🟠 中 | 虚拟化后 locator 必须仍走字符偏移 + 像素比例双轨；改完立刻跑 `MOYU_TEST_RESTORE` |
| R5 | 包体继续增长（mammoth + 引擎） | 🟡 低 | 引擎分包懒加载已就位；新依赖需报体积影响 |
| R6 | 自检在打包后失效 | 🟠 中 | 已确立约定：asar 只读，写盘一律回退 `userData`；实机路径用 ASCII |
| R7 | 合成器稳定性（历史 blur 崩溃） | 🟡 低 | 常驻大面积元素禁用 backdrop-filter（团队红线） |
| R8 | 网盘 API 变动 | 🟡 低 | 已隔离 `electron/baidu.ts`、`netpan.ts`，失败不影响本地 |

---

## 七、已定的决策（原阻塞项，现全部关闭）

| 决策 | 结论 | 依据 |
|---|---|---|
| 阅读器形态 | **独立全屏窗口** | v24 实现，热键/托盘双窗口联动 |
| EPUB 引擎 | **epub.js** | CFI 定位可用，章内滚动问题用 A1 补 |
| 格式范围 | TXT/MD/EPUB/PDF/FB2/DOCX/CBZ 七种；MOBI/AZW3/CBR 明确不支持 | v26 矩阵 |
| 云同步 | **不做**，仅本地 | 位置与偏好全在 IndexedDB |
| 目标平台 | **Windows 优先** | 打包与验收均以 Win 为准 |
| 包体 | **接受 86.5MB** | Electron 运行时为固定成本 |

---

## 八、下一步计划（本周执行）

### 顺序与产出（✅ 本周已全部完成，v27）

| 序 | 任务 | 结果 |
|---|---|---|
| 1 | DB v2 迁移 + 最小备份导出 | ✅ `MOYU_TEST_DB`：v1→v2 后 14 本书完整；设置页可导出 JSON |
| 2 | A1 EPUB 位置恢复 | ✅ `RESTORE_OK(cfi)` → 恢复到第 2 章 |
| 3 | A2 书签 | ✅ `BOOKMARK_OK`；DB 计数跨重启保持 |
| 4 | C2 样本回归 | ✅ `MOYU_TEST_FIXTURES` 一条命令 8/8 ALL_PASS（dev + 打包版均验） |
| 5 | 打包 v27 + 归档 | ✅ 90.7MB，实机 8/8 通过 |

**下周（按 ROADMAP 原排期）**：A3 CBZ/PDF 恢复精度（K2，本轮仍是 `RESTORE_SKIP`）、A4 大文件性能、A5 搜索。

### 注意事项（按踩过的坑列出）

1. **DB 升级不可逆**：`openDB('moyu-reader', 2, { upgrade })` 里只允许"加表/加索引"，绝不动 `books` 现有字段；升级前务必先导出（第 1 步）。
2. **书签复用 locator**：`{ id, bookId, locator, label, note?, createdAt }`，`label` 存快照（章节名），避免章节变更后显示为空。
3. **位置恢复必须用样本回归**：只改 EPUB 时也要跑 TXT/PDF/CBZ，防止 A1 的"兜底逻辑"影响其它格式（v25 就出现过改一处坏一处的连锁）。
4. **打包后自检**：`app.getAppPath()` 是只读 asar，任何写盘回退 `userData`；`?testpath=` 用 ASCII 路径（中文会破坏 URL 解析）。
5. **每步交付节奏**：`tsc --noEmit` → `electron-vite build` → 29 状态截图 → 格式回归 → 打包 → `_archive/<日期>_v<N>_<主题>/` + MANIFEST。
6. **不要顺手改 EPUB 的 `flow` 模式**：`scrolled` 会让 epub.js 切 div 渲染导致黑屏（v24 踩过），保持 `scrolled-doc`。
7. **单测优先覆盖纯函数**：locator 换算、`splitPlainText`、`markdownToHtml`、`fb2ToChapters`、`docxToChapters` —— 这些是 v26 出问题最集中的地方。

### 本周不做的（明确划出边界）

- 不做笔记/高亮（依赖书签表与选区方案，排到 W3）
- 不做分组拖拽（与核心链路无关）
- 不评估 MOBI/AZW3（需外部依赖，排到 W5）
- 不做云同步（已决策不做）

---

## 九、v29 交付记录（P0–P3 全量）

### 已完成

| 优先级 | 任务 | 关键改动 | 验证 |
|---|---|---|---|
| P0 | 大文件性能（A4/K4） | `text-utils` 章节改 `body/source/heading` 惰性 HTML；`chapter-window` 预算挂载 + 前缀偏移二分；`text-range` 字符偏移↔DOM 换算（段落级 + 段内比例）；`TextReader` 分批挂载 | `PERF_OK(paint=290ms)`、`LAZY_OK(21/508)`、`BOTTOM_OK`；`RESTORE_OK(600→600)` |
| P1 | 笔记 / 高亮（B1） | DB v3 `annotations`；CSS Custom Highlight API（宿主 + iframe 双端）；选区→字符偏移/CFI；备注气泡；笔记页；Markdown 导出 | `ANNOT_OK`（txt + epub）、`DB_CHECK_OK(v3)` |
| P2 | 备份导入（B3） | `mergeBackup` 纯函数（id → 书名+大小合并、位置去重、进度只增不减、`seeded` 保护）；`openTextFile` IPC；设置页导入 | `BACKUP_OK`（幂等 + 拒非法） |
| P3 | 单元测试（C1） | vitest + jsdom + fake-indexeddb；`tests/` 5 文件 113 例 | 113 passed；覆盖率 83.5% |

### 本轮发现并修复的两个真问题

1. **可见窗口下 EPUB 不渲染**（`iframe` 迟迟不出现、无报错）
   根因：阅读窗口常被遮挡（摸鱼场景），Chromium 判定后台后大幅降频计时器/rAF，epub.js 的异步渲染管线卡住。
   修复：阅读窗口 `webPreferences.backgroundThrottling: false`。
   验证方式：同一构建下 `show:false` 正常、`show:true` 必现；加参数后可见窗口 5s 内出首章。
2. **PDF 用相对路径打不开**
   根因：`toBookUrl` 直接把传入路径 base64 化，而协议侧只接受绝对路径，相对路径直接 404。
   修复：`path.resolve` + 自检样本目录改用绝对路径。

### 新增自检钩子

`MOYU_TEST_PERF="<name>|<path>"`（首开耗时/挂载数/滚到底）、`MOYU_TEST_ANNOT=<path>`（高亮/备注/笔记页，文本与 EPUB）、`MOYU_TEST_BACKUP=1`（导入幂等/去重/拒非法）；`MOYU_TEST_DB` 断言升级到 v3。

### 下一步（建议顺序）

| 优先级 | 任务 | 说明 |
|---|---|---|
| P0 | B2 书架分组与拖拽 | `shelfId` 字段已预留，纯前端改造 |
| P1 | K3 EPUB 章内像素级恢复 | `scrolled-doc` 下滚动会被 epub.js 重排重置，现只保证章节级 |
| P2 | B5 DOCX 颜色/字号透传 | mammoth 不解 `w:color`/`w:sz`/`w:jc`，需补丁或换解析器 |
| P3 | C2 阅读态回归扩展 / C3 冷启动优化 / C5 清理 `release*` 空壳 | 工程收尾 |
| P4 | B4 MOBI/AZW3/CBR 评估 | 需外部依赖，成本高于收益时可只保留「提示转换」 |

---

## 十、v30 交付记录（B2 / K3 / B5）

| 优先级 | 任务 | 关键改动 | 验证 |
|---|---|---|---|
| B2 | 书架分组与拖拽 | kv `shelves` 存 `{id,name,bookIds[],collapsed}`（数组即顺序）+ `Book.shelfId` 镜像；分组条 + 分区视图；原生 HTML5 拖拽（拖到 chip / 区块 / 卡片左右半边）；折叠/重命名/删除；拖拽后自动切「自定义顺序」 | `SHELF_OK` |
| K3 | EPUB 章内像素级恢复 | 根因：scroll 监听在 `.epub-host`，而滚动发生在 `.epub-container`（scroll 不冒泡）；改捕获阶段监听 → locator 记录「视口顶部文字 CFI + 章内比例」；恢复期锁上报 + 持续矫正到容器高度稳定 | `EPUB_INNER_OK`（600→600，顶部文字一致）|
| B5 | DOCX 颜色/字号/对齐透传 | 自研 `docx-ooxml.ts`：fflate 解 zip 读 `document.xml`，`w:color`→color-mix、`w:sz`→em、`w:jc`→text-align、`w:ind`/`w:numPr`/`gridSpan`；Title/Subtitle 不参与切章；失败回退 mammoth | fixture `样式10/60/5`，8/8 |

### 踩坑与决策

1. **拖拽必须始终 `draggable`**：若只在「正在拖拽」时才设 draggable，第一本书永远发不起 dragstart（状态只能由拖动本身产生）。
2. **motion.div 的 `onDragStart` 是 pan 手势**（`(event, info: PanInfo)`），与 HTML5 drag 签名冲突 → 拖拽一律走原生 `addEventListener`。
3. **新建分组后不要自动切到该组**：空组页会让用户看不到书、也没法继续拖。
4. **单组视图也必须按 `bookIds` 排**，否则拖拽重排只改了数据不改界面。
5. **DOCX 的 Title/Subtitle 不能当标题**：切章按 h1 做，会把书名变成一章（mammoth 时代用 styleMap 规避，自研解析同样要避开）。
6. **自检的容器判断要覆盖 `.epub-host`**：CROSSWIN 之前只认 text/pdf，EPUB 永远 FAIL（假失败）。

### 单测

`tests/docx.test.ts` 新增 18 例（标题识别/Title 不切章/颜色-字号-对齐/非法颜色丢弃/转义/表格 colspan/列表/端到端章节切分），总计 **131 例**。

---

## 十一、v31 交付记录（可交付性补强）

### v31-1 错误兜底与日志（已完成）

| 项 | 内容 | 验证 |
|---|---|---|
| 主进程日志 | `electron/logger.ts`：单文件 2MB × 5 份滚动；**同步写**（崩溃前最后一条不丢）；写失败静默（日志不能把应用带崩） | 自检写入 >2MB → 出现 `app.1.log`，当前文件回落 227KB |
| 全局兜底 | `uncaughtException` / `unhandledRejection` 记录后**不退出**（桌面应用最差体验是窗口一闪就没） | 自检覆盖 |
| 渲染端采集 | `src/lib/error-log.ts`：`error`（区分资源加载失败）+ `unhandledrejection`；指纹去重 + 会话上限 40 条 | 日志出现 `[ui:main]` / `[ui:reader]` 且保留堆栈帧 |
| 兜底页 | `ErrorBoundary`：内联样式（**不依赖 CSS/主题变量**，崩溃时样式可能已坏）+ 重载 / 导出诊断 / 关闭；连续重载 ≥3 次提示改走诊断 | 浅色 17.01:1 / 深色 15.95:1 对比度；主窗「隐藏到托盘」、阅读窗「关闭阅读窗口」 |
| 诊断导出 | IPC `moyu:diagnostics`：环境快照（版本/Electron/Chrome/内存/路径）+ 最近 240 行日志 | 报告 3061 字节，含版本与堆栈 |
| **静默失败守卫** | EPUB 坏 zip 不 reject 只挂起 → 6s 容器未建 / 16s 正文为空即判失败并提示 | 截断到 40% 的 EPUB：提示「文件可能损坏、下载不完整，或受 DRM 保护」并落日志 |

**本轮踩坑**

1. **兜底页浅色模式白底黑卡、深字黑底**：`@media (prefers-color-scheme: light)` 写在卡片基础规则**之前**，同特异性被后面的深色规则覆盖。DOM 断言全绿，只有截图能发现 → 自检已改为「双主题 + WCAG 对比度断言」。
2. **守卫写在 `.then` 里等于没有**：损坏的 zip 让 `display()` 永不 resolve，`.then` 不执行；必须**在 display 之前**武装。
3. **截图时机**：切回 `themeSource='system'` 后窗口会重新渲染，截图必须重新确认主题再截。
4. **日志重复**：`message` 与 `stack` 首行同源（都是 `Error: xxx`），主进程落盘前需去重首行。

### 下一步（v31 剩余）

| 步骤 | 内容 | 状态 |
|---|---|---|
| 3 | 渲染进程 CSP（`default-src 'self'`，EPUB iframe 单独放宽） | 待做 |
| 4 | 主入口 chunk 拆分（当前 572KB 含 mammoth 回退，目标 <200KB） | 待做 |
| 5 | Electron 33 → 受支持版本 | 待做 |
| 6 | 代码签名 + `signAndEditExecutable: true` | 待做 |

### v31-3 安全策略（已完成）

两个入口（`index.html` / `reader.html`）加 CSP meta：

| 指令 | 值 | 理由 |
|---|---|---|
| `script-src` | `'self'` | 无内联脚本；收紧后即使书里塞脚本也执行不了 |
| `style-src` | `'self' 'unsafe-inline' blob:` | React 内联 style、兜底页 `<style>`、**EPUB 章节样式（blob）** |
| `img/media/connect-src` | 含 `blob: data: moyu-file:` | 封面、EPUB 内图片、本地书籍协议 |
| `frame-src` | `'self' blob: data:` | epub.js 把章节装进 blob: iframe |
| `worker-src` | `'self' blob:` | pdf.js worker |
| `object-src` / `base-uri` / `form-action` | `'none'` | 本应用完全用不到 |

**误伤与修复**：首版漏了 `style-src blob:`，EPUB 的文字还在但样式全丢（颜色从多色退化成 1 色），
fixtures 立刻报 `epub FAIL 颜色 1 色`。CSP 生效性用 `securitypolicyviolation` 事件断言
（不能看 fetch 的报错文本——DNS 失败也是 `Failed to fetch`），实测拿到 `script-src|eval` 与
`connect-src|https://…` 两条违规记录。

### v31-4 首屏包体（已完成）

| 项 | 前 | 后 |
|---|---|---|
| 主入口 chunk | 440KB | **388KB** |
| 首屏合计（含 React 共享 chunk） | 683KB | **627KB** |
| 设置页 / 笔记页 / 书籍详情 | 打在主包 | 39KB / 8.7KB / 10.3KB 独立 chunk |
| 首屏引擎 | — | 无（pdf 635KB、EPUB 795KB、reader 依赖 563KB 全部独立） |

**修正一个早期误判**：此前以为「主入口 563KB 含 mammoth」需要压到 200KB。实际那个 563KB chunk
属于**阅读入口**的依赖，从未进过首屏；首屏是 440KB + 240KB（React 共享 chunk）。
`<200KB` 对一个 React 应用不现实（React 18 生产版本身 130KB+），阈值改为 680KB，
守的是「不因新功能悄悄膨胀」+「引擎不得进首屏」。

### 拖拽批量导入 + 自动封面

| 项 | 内容 |
|---|---|
| 拖拽 | window 级监听；**必须 preventDefault**（不拦会让窗口导航到文件本身）；dragleave 计数防闪（且不能依赖 `dataTransfer.types`，部分环境为空会让遮罩卡死） |
| 批量 | 逐个 `await`，遮罩显示 `正在导入 2/5 · 文件名` + 进度条；不支持的文件单独计数提示 |
| 封面 | EPUB 按 OPF 规范（`properties="cover-image"` → `<meta name="cover">` → 文件名含 cover）；CBZ 取首图；PDF 渲染第 1 页（>60MB 放弃）；失败/null 一律回退书名封面 |
| 兼容 | 三条导入路径（拖拽 / 对话框 / 网盘）统一到 `addBooksFromEntries`，行为一致 |
| 顺带修复 | `hydrate` 原来恒为 `covers: {}` 且 `getCover` 无人调用 → 真实封面**重启后消失**，退回书名封面 |

自检 `MOYU_TEST_DROP`：5 个样本（带封面 epub / 无封面 epub / pdf / cbz / txt）
→ `added=5, covers=3`，无封面的两本有书名封面，二次导入 `dup=5`，遮罩出现/消失正确 → `DROP_OK`。

### v31-5 运行时升级（Electron 33 → 45）

| 项 | 前 | 后 |
|---|---|---|
| Electron | 33.4.11（已 EOL，不再收安全补丁） | **45.2.2**（当前受支持版本） |
| electron-builder | 25.1.8 | **26.18.0** |
| `win.signAndEditExecutable` | `false`（exe 无版本资源） | **`true`** |
| 产物名 | 硬编码 `0.1.0` | `${productName}-${version}` |

**升级中踩的坑（都可复现）**

1. **`npm i electron@45` 不会下载二进制**：只更新了包元数据，`node_modules/electron/dist/` 与 `path.txt` 都不存在，
   表现为 `npx electron -v` 挂死无输出。需要手动 `node node_modules/electron/install.js`（带 `ELECTRON_MIRROR`）。
2. **builder 26 移除了 `win.fileDescription`**：配置校验直接失败，报 `configuration.win should be one of these: null`
   （schema 报错不点名具体字段，只能查 `app-builder-lib/scheme.json` 的 `WindowsConfiguration.properties` 比对）。
3. **打包中断会留下 `win-unpacked.tmp`**：builder 用「改名 → 解压到新目录」的原子策略，
   被超时杀掉后残留目录会让下次 rename 失败，后续所有构建都报错。必须手动清 `win-unpacked*`。
4. **portable 打包耗时集中在 7z 压缩**：126MB 体积单线程压缩，首次还要下载 7zip / nsis 工具，
   5 分钟内跑不完，需要放到后台执行。
5. **无证书时 builder 明确跳过**：日志输出 `no code signing certificate configured, signing is skipped`
   —— 说明 `signAndEditExecutable` 与「代码签名」是两件事：前者写 exe 资源（图标/版本/版权），后者是证书签名。

**升级兼容性**：项目无原生模块（epubjs / pdfjs / mammoth / fflate / idb 全是纯 JS），
无 ABI 重编译风险；Electron 32 起移除的 `File.path` 早前已改用 `webUtils.getPathForFile`，本次无新增适配。


---

## 十二、v32 交付记录（0.9.0 · 排版与交互重做）

用户反馈九项，逐条落地：

| 反馈 | 处理 |
|---|---|
| 窗口最上方多出一条矩形 | 逐层排查：DOM 顶栏 `top=0`、桌面级截屏与内容截屏逐像素一致，判定不是渲染/窗口层偏移（高度疑似截图裁到了窗口外的桌面）。仍做加固：窗口改用 `useContentSize`；`MOYU_TEST_STYLE` 增加「外壳贴边」断言（shell.top/left=0、高度等于视口、topbar.top=0） |
| 增加两张系统默认壁纸 | `src/lib/builtin-wallpapers.ts`：内联 SVG 渐变网格，浅/深各一张，< 3KB、任意分辨率不糊；不落库、不可删除、清空数据后仍在 |
| 透明度框改滑块式 + 数字可输入 | 新增 `src/components/NumberFields.tsx`（`SliderField` / `NumberField`）：滑块 + 数字框 + 步进按钮，编辑时保留草稿、失焦/回车提交；设置页 4 处滑杆与壁纸弹层全部换用 |
| 文字大小格式与风格统一 | 弹层小标题 12.5px/600/text-2、说明 11.5px、条目 12.5px + `tabular-nums`；数值列右对齐等宽，多个控件叠放不跳字 |
| 设置栏大量文字黑底 | 新增 `--surface-card` / `--surface-inset` 令牌（与 Dock 同一族半透明度），区块卡不再直接用 `acrylic-card`；表单输入框从「灰底叠灰底」改为内嵌凹槽 |
| 版本号与说明 | `package.json` → 0.9.0，构建期 `define __APP_VERSION__` 注入，关于页重写（格式/能力/数据位置/隐私/备份/技术栈），并加「导出诊断报告」入口 |
| TXT 排版过于密集 | 根因：旧 `textToHtml` 只按空行切段，无空行 TXT 会压成一个巨型 `<p>`。新增 `plainParagraphs()` 支持三种约定（空行 / 全角缩进 / 每行一段），并区分「硬折行」与「新段」；CSS 补 2em 首行缩进、0.85em 段距、两端对齐、字距 0.01em |
| 换颜色只改阅读器 | 新增 `broadcastTheme` / `subscribeTheme` / `applyAppTheme`：阅读器显式选主题 → 写库 + 广播 → 主界面跟随；主界面切换 → 阅读器仅在「跟随」下同频（不抢用户显式选择）。顺带修掉「纸白主题下弹出深夜面板」——面板配色原来只看 `systemDark`，改为看有效主题 |
| 选择区域 UI 与整体不一致 | 阅读器排版面板重做：字号/行距/宽度改为「− 值 +」步进器（也可直接输入），字体/主题改成分段控件（凹槽 + 高亮块），与主界面 `.seg` 同一套语言；分段控件与数值控件样式抽出为组件级 CSS，两个入口共享 |

### 自检

- 新增 `MOYU_TEST_THEME`：阅读器→主界面、主界面→阅读器、「显式主题不被抢」三条链路 → `THEME_OK`
- `MOYU_TEST_STYLE` 扩展：外壳贴边、数值行（滑块+步进齐备）、数字框输入/步进真实生效、内置壁纸可渲染、弹层不溢出 → `STYLE_OK`
- 单测新增 `plainParagraphs` 7 例（三种排版约定、折行拼接、西文补空格），共 **138 例**
- 回归：fixtures 8/8、DROP/ANNOT(txt+epub)/BACKUP/SHELF/CRASH/BUNDLE 全绿，位置恢复 txt 600→600、pdf 2062→2062、cbz 1769→1769、EPUB 章内 OK，28 状态截图 `NO_RENDER_ERRORS`
