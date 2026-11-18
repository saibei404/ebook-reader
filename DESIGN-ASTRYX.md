# 墨鱼阅读器 · Astryx 设计语言规范

> 参考 [`meta/astryx`](https://github.com/meta/astryx) 的 Design Conventions 重构，v43 / 0.12.0 起生效。
> 单一真源：`src/styles/tokens.css`（主窗口与阅读窗口共用）。**新代码只引用 token，不写裸值。**

## 一、定位与边界

Astryx 是 Meta 开源的 React 19 + StyleX 设计系统，核心是「主题 = 一组 CSS 自定义属性覆盖」+ 一套可验证的设计约定。
本项目是原生 CSS + 自定义组件的 Electron 阅读器，**不引入 `@astryxdesign/core`**（那等于重写 UI），只借鉴其约定与 token 架构。

| 借鉴 | 不借鉴 |
|---|---|
| role 语义颜色分层、`light-dark` 双模、AA 对比 | 150+ 组件、StyleX 构建链、CLI |
| 同心圆角、4px 栅格、字号几何阶梯 | 模板 / AppShell 结构（本项目是桌面应用外壳） |
| 状态表现、阴影层级、动效规范 | agent-ready 元数据与 vibe tests |

参考来源：[Astryx Wiki · Design Conventions](https://github.com/meta/astryx/wiki/Design-Conventions)、[Theming Infrastructure](https://github.com/meta/astryx/wiki/Theming-Infrastructure)、[README](https://github.com/meta/astryx)。

## 二、Token 表

### Color · 按 role 选，不按色值选

| Token | 用途 |
|---|---|
| `--color-background-body` | 页面级底色，仅此一处 |
| `--color-background-muted` | 带内容的容器 |
| `--color-background-surface` | 抬升表面（卡片、弹层、Dock） |
| `--color-background-inverted` | 临时覆盖层（toast / tooltip） |
| `--color-neutral` | 自包含元素（chip、按钮 resting fill） |
| `--color-track` | 轨道、滑轨、滚动条 |
| `--color-overlay-hover` / `-pressed` | 交互状态叠层，**必须是 alpha tint** |
| `--color-border` / `-emphasized` | 常规描边 / 字段 hover·focus 描边 |
| `--color-text` / `-muted` / `-subtle` / `-disabled` | 文字四级 |
| `--color-accent` / `-muted` / `--color-on-accent` | 主操作、选中、focus outline |
| `--color-{success,error,warning}` / `-muted` | 状态语义色，**必须配图标或文字** |

规则：所有 fg/bg 组合明暗双模过 WCAG AA（正文 4.5:1、大字/UI 3:1）；禁用纯黑纯白；一个界面只有一个 primary action。

### Radius · role 尺度 + 同心

```
--radius-inner 4 · --radius-element 8 · --radius-container 12 · --radius-page 28 · --radius-full
r_inner = r_outer - gap    →    --radius-nested: calc(--radius-container - --space-2)
```
全站只有一个 `radius.multiplier` 旋钮，不做逐元素自定义。禁止「圆角卡片 + 粗彩色侧边条」这类 AI tells。

### Space · 4px 栅格（2px 半步）

`--space-half 2` / `-1 4` / `-2 8` / `-3 12` / `-4 16` / `-5 20` / `-6 24` / `-8 32` / `-10 40` / `-12 48`。
分组递进：`label→input < 字段 < 组 < 章节`。用间距分组，不用嵌套卡片。

### Type · base 14 / ratio 1.2

| role | token | 值 |
|---|---|---|
| supporting / label | `--type-supporting`、`--type-label` | 12 |
| body | `--type-body` | 14 |
| large | `--type-large` | 17 |
| title | `--type-title` | 20 |
| heading | `--type-heading` | 24 |
| display | `--type-display` | 34 |

字重四档：`400 / 500 / 600 / 700` → `--weight-body / -label / -title / -strong`。
正文 `line-height: 1.5`，行长 `--measure: 72ch`（65–75ch 区间）。

### Size / Elevation / Motion

- 控件高度 `--control-sm 28 / -md 32 / -lg 36`，触摸目标 `--hit-target 44`
- 阴影 `--shadow-low < -med < -high`，对应堆叠 `--z-base < -dropdown < -sticky < -overlay < -toast < -tooltip`；输入框状态环是独立 inset 家族，**不算 elevation**
- `--ease-standard: cubic-bezier(0.2, 0, 0, 1)`；`--motion-fast 175ms`（微交互）/ `--motion-medium 410ms`（进出场）
- 只动 `transform` / `opacity`；`prefers-reduced-motion` 下归零；不用 spring / bounce / elastic

## 三、状态表现

| 状态 | 表现 |
|---|---|
| Rest | 基础 token，无交互层 |
| Hover | `--color-overlay-hover` alpha tint 叠在底色上 |
| Pressed | `scale(0.98)` + `--color-overlay-pressed` |
| Focus | 2px `--color-accent` outline @ 3px offset（`:focus-visible`） |
| Selected | 按组件族选一种：filled / surface / edge / border / depressed，族内保持一致 |
| Disabled | `--color-text-disabled`，非交互，附原因说明 |
| Status | muted（持久）/ inverted（高severity）/ temporal（toast），**语义 token + 图标，不能只靠颜色** |

## 四、本轮重构动作

| # | 改动 | 文件 |
|---|---|---|
| 1 | 新建单一 token 层（role 语义、明暗双模、兼容映射） | `src/styles/tokens.css` |
| 2 | 主界面移除 150 行旧 iOS 变量区，改由 token 层供给 | `src/styles/global.css` |
| 3 | 4 种材质（磨砂/亚克力/云母/纯色）统一为不透明表面；移除全部 `backdrop-filter`、渐变、噪点、发光高光。**组件表面（卡片/按钮/弹层）恒不透明；页面级底色（Dock、内容区）保留半透明让壁纸透出** | `global.css` |
| 4 | 圆角 12 种散乱值 → 4 档 role token；间距 258 处 → 4px 栅格 token | `global.css`、`reader.css` |
| 5 | 字号 85 处 → 7 档 role token | `global.css`、`reader.css` |
| 6 | 时长/缓动统一 175/410ms + `--ease-standard`；去 spring、3D 倾斜、hover 放大、渐变文字 | `anim.ts`、`BookCard`、`BookDetail`、`TabBar`、`TopBar`、`NotesPage`、`PlaceholderPage` |
| 7 | 五语动效文案去掉「弹性 / springy / 弹出」等已不成立的描述 | `src/lib/i18n.ts` |
| 8 | 全局 focus / pressed / disabled 状态规范 | `tokens.css` |

**移除的产品特色**（按用户确认的「全面换成 Astryx 视觉」）：毛玻璃与壁纸透出、Liquid Glass 默认封面渐变、封面 3D 倾斜跟随、spring 弹性入场、详情翻卡式 3D 转场、文字微光。
**保留的功能**：壁纸导入与透明度滑块（页面级底色半透明，滑块直接控制 alpha；组件表面不受影响）、5 种入场动效（收敛到同一时长/缓动族）。
**0.12.1 修正**：初版把页面级底色也做成了 100% 不透明，导致壁纸完全不可见；浅色下还有「白罩 + 白表面」双重漂白与暗壁纸安全底一刀切的问题。现改为——适配罩深浅分离（深色压暗重 / 浅色提亮轻），亮壁纸走半透明表面，暗壁纸安全底用 84% 高不透明而非全不透明，既透出壁纸又保住 AA 对比。
**0.12.1 阅读器**：`color-scheme` 由 `ReaderApp` 按夜间/跟随主题动态设置，`reader.css` 补显式滚动条配色（`--r-fg` 派生），深色阅读主题下右侧滚动条不再退回浅色。
**0.12.2 修正**：① 浅色安全底不再写死 84% 白，改 `max(0.55, 用户透明度)`，并减轻白罩到 0.15——
鲜艳彩色壁纸被平均亮度误判为「暗」时也会被 84% 白洗成粉白。② 阅读器 `systemDark` 初值恒 false，
主界面在开阅读器之前切的深色广播收不到，导致「跟随」按浅色启动、滚动条浅色；
现由主进程随 URL 传 `&theme=` 初始化，EPUB 独立 iframe 也补 `color-scheme` 与滚动条配色。
详见 `RELEASE-v43.md` 第八节。

## 五（补）、v44（0.13.0）：默认封面也切到 Astryx

此前封面生成仍是 iOS Liquid Glass（高饱和渐变 + 径向光斑 + 玻璃文字卡 + 内高光），
与已重构的界面语言割裂。`src/lib/cover.ts` 整体重写，契约不变（300×400 dataURL、coverSeed → 配色）：

- 7 组带色调中性配色（深色组自动换浅前景，均过 AA），禁纯黑白、禁满版渐变
- 同心圆角：28（page）→ 12（container）→ 8（element）→ 4（inner）
- 4px 栅格、字号 role 阶梯（27/15/13）、字重 600/400/500
- 单一 primary emphasis：顶部 40×8 accent 条 + 底部 accent 标签；不用玻璃/发光/装饰渐变

同轮修掉 3 处回归：设置页 `1fr` 被 `nowrap` 文字撑破（改 `minmax(0,1fr)`）、
页面切换 VT 带 `translateY/scale` 导致上弹裁切（改纯 175ms opacity）、
详情弹层残留 `perspective/preserve-3d` 造成透明错位与 410ms 延迟
（移除 3D + 恒不透明表面 + 175ms tween + 遮罩 0.32→0.48）。
详见 `RELEASE-v44.md`。

## 五之二、v45 封面定稿（0.14.0）

用户从六版方案中选定「04 巨型首字水印」，追加低饱和、相邻异色、深浅双版三条要求。

- **色板**：8 组 HSL 低饱和色相 `[212,192,148,36,352,18,264,172]`，饱和度 10–30%；
  明度错位数组让相邻槽位同时拉开色相与明度（浅色 L88–96 / 深色 L12–22），
  同槽位深浅共用色相，切换主题「换明暗不换身份」
- **相邻异色**：`BookGrid` 按当前可见列表顺序分配 `i % 8`，`BookGrid → BookCard/BookDetail`
  共享槽位表；手动「随机封面」锁定槽位不被覆盖
- **深浅双版**：封面从 store 预生成缓存改为组件按 `settings.theme` 派生，
  `getProcCover(book, mode)` 以 `id|mode|slot|title|author|seed` 缓存；`Store.procCovers` 移除
- **版式**：满版直角、圆角统一由容器裁切；巨型首字尺寸/基线随书名行数自适应
  （150/136/120px，基线 210/172/136），与标题首行保持约 48px 间隙；
  底部 60px 留给格式徽标；无内卡片、无底部标签、无书脊
- **留白根因**：`.book-cover-wrap` 的 `background` + `1px border` + 12px 圆角
  与封面自带 28px 圆角不匹配，露出容器底色形成白边 → 容器只留 `overflow:hidden` + 圆角

详见 `RELEASE-v45.md`。

## 五之三、v46（0.14.1）：壁纸模式下深浅界面重新分工

用户要求「降低蒙版程度、保证界面选项可读性、保证壁纸可见性」。
按 Astryx 的「组件表面恒不透明 / 页面级底色只做色调归一」重新分配职责：

- **框架**（侧栏、顶栏）：深色暗板 `rgba(20,21,24,~0.53)` + 浅字 / 浅色亮板 `rgba(233,237,244,0.55)` + 深字，
  作为稳定导航区，保持较高不透明度
- **内容区**：只做等量反向的极轻染色（深 `rgba(22,23,26,0.24)` / 浅 `rgba(251,252,253,0.24)`），
  滑块按 `0.42` / `0.34` 系数映射到低蒙版区间；适配罩深色 `0.85→0.34`、浅色 `0.15→0.08`；
  浅色暗壁纸安全底 `0.55→0.42→0.24`
- **可读性**：新增 `--surface-textplate`（深 `rgba(28,30,34,0.94)` / 浅 `rgba(251,252,253,0.94)`），
  仅在 `[data-no-wallpaper='0']` 时给统计文字、筛选 chip（含选中态）、分组 chip、
  排序下拉、搜索框、尺寸按钮、空状态各自一块近不透明表面。
  hover 状态仍用 `color-mix` alpha tint，不改成实色
- **深浅区别**不再靠大面积白雾/黑幕，改由框架色、承载面明暗、文字色三者承担

**动效**：`::view-transition-group(book-cover)` 320ms → 175ms；
补齐 `::view-transition-group(root)`（Chromium 默认 250ms，之前漏设）；
`bookMorph` 420ms → 200ms；非 morph 的 `layoutId` 封面从 spring 改 `MOTION_FAST`。
`ANIM_PROBE` 实测点击后 11 个在跑动画全部 175ms。

详见 `RELEASE-v46.md`。

## 六、已知遗留（下一轮）

- 控件高度仍有少量硬编码（20/22/26/30px 等图标与微调尺寸），`--control-*` 已定义，需按元素逐个迁移，避免误伤图标尺寸。
- `z-index` 仍有魔法数字，`--z-*` 语义层级已定义，待迁移。
- 状态色配图标目前只在 Toast / 设置项部分覆盖，表单校验等处待补。
- 同心圆角公式 `--radius-nested` 已定义，关键容器对（卡片 → 内部 chip）尚未逐一应用。
- 兼容层旧变量名（`--text-1`、`--surf-2`、`--acrylic-card` 等）仍被旧规则引用，逐步替换为 `--color-*` 后可删除。
- 参考 Astryx 的 `🟢 Objective` 自动化检查（tokens-only、AA、4px 栅格、同心圆角）尚未做成 linter。
