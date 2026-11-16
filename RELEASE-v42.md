# 墨鱼阅读器 · v42（0.11.1）发布说明

> 日期：2026-11-16 ｜ 基线：v41（0.11.0）→ **v42（0.11.1）**
> 主题：处理 v41 交接遗留 —— 超大惰性挂载 TXT 位置恢复精度 + EPUB 作者彩色 CSS 主题适配
> 产物：`墨鱼阅读器-0.11.1-portable.exe` / `墨鱼阅读器-0.11.1-win.zip`

---

## 一、本轮动作总览

| # | 动作 | 类型 | 涉及文件 |
|---|---|---|---|
| 1 | 补交 `RELEASE-v41.md` 并推送本地领先的 v41 提交 | 工程 | `RELEASE-v41.md` |
| 2 | 位置上报改为视口顶部 caret 精确字符偏移 | 缺陷修复 | `src/reader/formats/TextReader.tsx` |
| 3 | 位置恢复改为折叠 Range 取字符所在行 | 缺陷修复 | `src/reader/text-range.ts` |
| 4 | 章节前缀高度变化的滚动锚定补偿 | 缺陷加固 | `src/reader/chapter-window.ts`、`src/reader/formats/TextReader.tsx` |
| 5 | EPUB 作者彩色/灰阶 CSS 主题适配抽成纯函数 | 缺陷修复 | `src/reader/epub-theme.ts`（新增）、`src/reader/formats/EpubReader.tsx` |
| 6 | 单测 +16（共 165） | 测试 | `tests/epub-theme.test.ts`（新增）、`tests/locator.test.ts` |
| 7 | 版本 0.11.0 → 0.11.1；README / ROADMAP / 本文件同步 | 工程 | `package.json`、`README.md`、`ROADMAP.md`、`RELEASE-v42.md` |

---

## 二、超大惰性挂载 TXT 的位置恢复漂移（115px → 16px）

### 复现

v41 记录：6.37MB / 191 章 TXT 恢复 `600→715`（漂移 115px，自检容差 72，判 `RESTORE_FAIL`）。
本轮用**同一本真实书籍**（`D:/迅雷下载/1213.txt`）、同一自检、各自全新 profile 做 A/B，稳定复现。

### 根因修正

v41 把漂移归因于「占位估算高度与实挂高度的差」，实测并非如此。真实根因是**两端各有一层估算**：

1. **保存端**（`TextReader.tsx` 的 `report()`）：用「章高像素比例 × 章字符数」推算字符偏移，
   隐含假设章内字符密度均匀。网文长段落下该假设误差很大。
2. **恢复端**（`text-range.ts` 的 `scrollTopForCharOffset()`）：用「段落顶部 + 段内字符比例 × 段高」
   把偏移映射回像素；段落可达数百像素高，误差可到整段量级（即 115px）。

> 过程中一个反面教训：先按「占位高度变化」做了滚动锚定补偿，但 A/B 显示旧/新代码在
> 只滚到 600px（仍在第一章）时结果完全相同 —— 该场景前缀偏移差恒为 0，补偿根本不触发。
> 于是换成真实书籍复现，才定位到上面的两层估算。**不要用测不到目标行为的自检宣告修复完成。**

### 修复

- 保存端：`caretRangeFromPoint` 取视口顶部命中的文本节点 → `domToCharOffset` 折算精确章内字符偏移；
  拿不到 caret（空白/未布局）才回退原比例估算。
- 恢复端：折叠 `Range` 的 `getClientRects()` 取该字符**所在行**的真实 y，误差压到一行内；
  Range 无有效矩形时回退段落估算。
- 加固：新增 `anchoredScrollTop()`，恢复后章节前缀高度因实挂/每字高度校准而变化时，
  按锚点章节新旧偏移差补偿 `scrollTop`，防止视口在后续校准中被推走（单测 4 例覆盖）。

### A/B 结果

| | 旧代码 | 修复后 |
|---|---|---|
| 6.37MB / 191 章 TXT | `600→715` `RESTORE_FAIL` | `600→616` `RESTORE_OK` |

---

## 三、EPUB 作者彩色 CSS 主题适配

原逻辑只处理 `sat <= 45` 的灰阶色，高饱和硬编码（白底亮黄字、黑底深蓝字、亮色荧光底）整体漏掉。
抽出纯函数模块 `src/reader/epub-theme.ts`，规则：

- 灰阶文字 → `inherit`（跟随主题前景）；灰阶冲突底 → 中性半透明。
- **仅当彩色与主题底色亮度差 < 0.3**（确实看不清）时，保留 HSL 色相/饱和度，
  只把明度推到可读区间；对比充分的高饱和强调色（如暗底亮蓝）一律不干预。
- 与主题冲突的彩色底 → 保留 RGB、降不透明度到 0.16 做柔和 tint，保留「有色块」的层次。
- 透明底 / alpha ≤ 0.2 的文字不干预，避免误伤。

`EpubReader.tsx` 只保留遍历与 `setProperty`，判定逻辑全部进纯函数，便于单测。

---

## 四、v41 交接清单处理结果

| 交接项 | 结论 |
|---|---|
| 超大惰性挂载 TXT ~115px 恢复漂移 | ✅ 已修复（见第二节） |
| EPUB 作者 CSS 彩色硬编码与主题冲突 | ✅ 已最小修复（见第三节，12 例单测） |
| 阅读窗崩溃根因 100% 实证 | ⏸ 无新增崩溃、无新 minidump；保留 v41 缓解（VT 内存守卫 + 崩溃自愈 + Crashpad 落盘），等复现取 `.dmp` 符号化 |
| 大于 60MB 的 PDF 不提取内嵌封面 | ⏸ 有意的性能权衡（首开速度优先，`cover-extract.ts:163` 注释已说明），保持不变 |
| `release*` 空壳目录清理 | ⏸ 21 个目录各残留一份 `win-unpacked/resources/app.asar`，均未被 Git 跟踪；删除需先关文件监视器且属破坏性操作，本轮未动 |
| 无代码签名 / SmartScreen 提示 | ⏸ 需外部证书，明确不做 |
| Wallpaper Engine 需本机 Steam 版 | ⏸ 依赖第三方软件，明确不做 |
| 静默/增量自动更新、云同步 | ⏸ 明确不做 |

---

## 五、验证

- `tsc --noEmit` 干净；**单测 165/165**（原 149 + `epub-theme` 12 + `anchoredScrollTop` 4）。
- 位置恢复六组全绿：小 TXT `600→600`、3MB TXT `600→590`、**6.37MB TXT `600→616`**、
  PDF `2062→2062`、CBZ `1769→1769`、EPUB `RESTORE_OK(cfi)` + `INNER_SCROLL_OK` + `INNER_TEXT OK`。
- 开发版截图自检 **35/35 状态，`desktop=35 fallback=0`，`NO_RENDER_ERRORS`**。
- 打包版另跑一次 `--shot` 冒烟（隔离 profile）。
- GitHub：`be334af` 已推送；本轮提交随后推送。

---

## 六、工程注意

- 版本号必须**先于** `npm run build` 修改，否则 `__APP_VERSION__` 会把旧版本打进包里。
- 打包版冒烟要 `--user-data-dir` 隔离，且必须清掉宿主的 `ELECTRON_RUN_AS_NODE`。
- 与用户正在运行的实例共用默认 profile 会出现 IndexedDB / 缓存锁报错，不是产品回归。
- 保留崩溃自愈与 Crashpad minidump 落盘；下次复现请把 `%APPDATA%\moyu-reader\Crashpad\reports\` 下的 `.dmp` 交回分析。
