# 墨鱼阅读器 · v43（0.12.0）发布说明

> 日期：2026-11-16 ｜ 基线：v42（0.11.1）→ **v43（0.12.0）**
> 主题：**参考 [meta/astryx](https://github.com/meta/astryx) 重构设计语言**（用户确认：全面换成 Astryx 视觉 + 全界面 token 化）
> 规范文档：[`DESIGN-ASTRYX.md`](./DESIGN-ASTRYX.md)
> 产物：`墨鱼阅读器-0.12.0-portable.exe` / `墨鱼阅读器-0.12.0-win.zip`

---

## 一、参考了什么

Astryx 是 Meta 2026 年开源的 React 19 + StyleX 设计系统（Beta，内部 13,000+ 应用在用）。
其 [Design Conventions](https://github.com/meta/astryx/wiki/Design-Conventions) 给出的不是一套皮肤，而是**可验证的设计约定 + CSS 变量主题机制**：主题 = 一组 CSS 自定义属性覆盖。

本项目是原生 CSS + 自定义组件的 Electron 应用，直接引入 `@astryxdesign/core` 等于重写 UI，因此只借鉴**约定与 token 架构**，不引入组件库 / StyleX / CLI。

## 二、落地内容

| # | 改动 | 文件 |
|---|---|---|
| 1 | 新建单一 token 层：role 语义颜色、明暗双模、AA 对比、兼容映射 | `src/styles/tokens.css`（新增） |
| 2 | 主界面移除 150 行旧 iOS 变量区，改由 token 层供给；阅读窗口共用同一 token 源 | `global.css`、`reader.css` |
| 3 | 4 种材质统一为不透明表面；移除全部 `backdrop-filter`、渐变、噪点、发光高光 | `global.css` |
| 4 | 圆角 12 种散乱值 → 4 档 role token（同心公式已定义）；间距 258 处 → 4px 栅格 token | `global.css`、`reader.css` |
| 5 | 字号 85 处 → 7 档 role token（base 14 / ratio 1.2） | `global.css`、`reader.css` |
| 6 | 时长/缓动统一 175/410ms + `--ease-standard`；去 spring、3D 倾斜、hover 放大、渐变文字 | `anim.ts`、`BookCard`、`BookDetail`、`TabBar`、`TopBar`、`NotesPage`、`PlaceholderPage` |
| 7 | 全局 focus / pressed / disabled 状态规范；`prefers-reduced-motion` 归零 | `tokens.css` |
| 8 | 五语动效文案与材质文案同步（去掉「弹性 / springy / blur」等已不成立的描述） | `i18n.ts` |
| 9 | 移除失去意义的「材质 4 选 1」与「窗口级原生亚克力」开关，改为表面规范说明 | `SettingsPage.tsx`、`global.css` |
| 10 | 版本 0.11.1 → 0.12.0；README / ROADMAP / 规范文档同步 | `package.json`、`README.md`、`ROADMAP.md`、`DESIGN-ASTRYX.md` |

## 三、移除的产品特色（按用户确认）

毛玻璃 / 壁纸透出、Liquid Glass 默认封面渐变（CSS 层）、封面 3D 倾斜跟随、spring 弹性入场、详情翻卡式 3D 转场、文字微光、材质 4 选 1。

**保留的功能**：壁纸导入与透明度滑块（改为控制「表面 ←→ 底色」混合比，仍可见可调）、5 种入场动效（收敛到同一时长/缓动族）、程序化生成的书籍封面（内容资产，非 UI chrome）。

## 四、验证

- `tsc --noEmit` 干净；**单测 161/161**
- 构建通过；硬编码残留检查：裸 px 圆角 **0**、裸 px 字号 **0**、渐变 **0**、`backdrop-filter` 声明 **0**、`type:'spring'` **0**
- 35 状态截图 `desktop=35 fallback=0`、`NO_RENDER_ERRORS`；窗口级截图人工核对书架页与设置页：深色带色调中性底、无毛玻璃/壁纸透出、圆角与卡片统一、无布局塌陷
- 打包版另跑一次 `--shot` 冒烟（隔离 profile）

> 截图自检的 desktop 捕获会受用户桌面其它窗口干扰（窗口 `show:false` + 透明合成），
> 视觉核对以 `screenshots/window/` 窗口级截图为准。

## 五、已知遗留（下一轮，详见 DESIGN-ASTRYX.md）

- 控件高度仍有少量硬编码（图标/微调尺寸），`--control-*` 已定义待逐个迁移
- `z-index` 魔法数字待映射到 `--z-*` 语义层级
- 同心圆角 `--radius-nested` 已定义，关键容器对尚未逐一应用
- 兼容层旧变量名（`--text-1` / `--surf-2` / `--acrylic-card` 等）仍被旧规则引用
- 状态色配图标、Astryx `🟢 Objective` 自动化检查（tokens-only / AA / 4px / 同心）尚未做成 linter

## 六、工程注意

- 版本号必须**先于** `npm run build` 修改（`__APP_VERSION__` 构建时注入）
- 打包/自检必须 `env -u ELECTRON_RUN_AS_NODE`；冒烟用 `--user-data-dir` 隔离
- 截图自检要单独跑，不要与多个 RESTORE 自检串在同一 shell 任务里连启 Electron（会资源竞争卡住）

---

## 七、0.12.1 回归修复（用户实拍反馈）

初版 0.12.0 把「组件表面不透明」误推广到了**页面级底色**，引入两个回归：

| 问题 | 根因 | 修复 |
|---|---|---|
| 浅色模式壁纸显示错误（看不到壁纸 / 一片白） | `--content-surface` / `--dock-bg` 改成 `color-mix` 完全不透明；适配罩从白/黑改成灰；浅色「安全底」规则把表面设成 100% 不透明；且「白罩 40% + 白表面 66%」两次叠加把壁纸彻底漂白 | 页面级底色恢复 `rgba(... var(--content-opacity))` 半透明；适配罩深浅分离（深色 `rgba(0,0,0,.85)` 压暗重、浅色 `rgba(255,255,255,.3)` 提亮轻）；暗壁纸安全底改为 84% 高不透明而非全不透明（底色仍约 rgb(212,218,229)，与 `#1b1d21` 文字对比 >9:1） |
| 深色阅读主题右侧滚动条仍为浅色 | `reader.css` 的 `:root` 写死 `color-scheme: light`；夜间主题只换 `--r-bg/--r-fg`，从没改过 `color-scheme`；阅读窗口也没有滚动条样式 | `ReaderApp` 按 `dark` 动态设 `document.documentElement.style.colorScheme`；`reader.css` 补 `::-webkit-scrollbar*` 规则，滑块用 `--r-fg` 派生，自动跟随纸白/米黄/夜间 |

验证：
- `tsc` 干净 / 单测 161/161 / 构建通过 / 全量 35 状态 `NO_RENDER_ERRORS`（定向壁纸状态重跑亦全绿）
- 窗口级截图人工核对：`27-wallpaper-texture`（深色）与 `28-wallpaper-texture-light`（浅色）壁纸纹理均可见，文字清晰、无异常偏色
- 夜间主题探针 `SCROLLBAR_PROBE`：`clickedNight=true`、`inlineColorScheme=dark`、`computedColorScheme=dark`、`--r-fg=#e8e6e3`、thumb 规则为 `color-mix(in srgb, var(--r-fg) 22%, transparent)`
- 组件表面（卡片/按钮/弹层）仍恒不透明，Astryx token 体系与克制观感未回退
