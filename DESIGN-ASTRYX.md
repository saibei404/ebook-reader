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

## 五、已知遗留（下一轮）

- 控件高度仍有少量硬编码（20/22/26/30px 等图标与微调尺寸），`--control-*` 已定义，需按元素逐个迁移，避免误伤图标尺寸。
- `z-index` 仍有魔法数字，`--z-*` 语义层级已定义，待迁移。
- 状态色配图标目前只在 Toast / 设置项部分覆盖，表单校验等处待补。
- 同心圆角公式 `--radius-nested` 已定义，关键容器对（卡片 → 内部 chip）尚未逐一应用。
- 兼容层旧变量名（`--text-1`、`--surf-2`、`--acrylic-card` 等）仍被旧规则引用，逐步替换为 `--color-*` 后可删除。
- 参考 Astryx 的 `🟢 Objective` 自动化检查（tokens-only、AA、4px 栅格、同心圆角）尚未做成 linter。
