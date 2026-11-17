# 墨鱼阅读器 · v44（0.13.0）发布说明

> 日期：2026-11-17 ｜ 基线：v43（0.12.3）→ **v44（0.13.0）**
> 主题：按 Astryx 视觉重做默认书籍封面 + 修掉 3 处交互/排版回归
> 规范文档：[`DESIGN-ASTRYX.md`](./DESIGN-ASTRYX.md)

---

## 一、默认书籍封面：全面切换到 Astryx 视觉

旧封面是 iOS Liquid Glass：高饱和彩虹渐变、径向光斑、玻璃文字卡、内高光、书脊渐变。
`src/lib/cover.ts` 整体重写，契约不变（300×400 PNG dataURL、`coverSeed → 配色`、函数签名与全部调用处）。

| Astryx 约定 | 落地 |
|---|---|
| 禁纯黑白、中性色带色调 | 7 组语义配色（对应 neutral / butter / chocolate / matcha / stone / gothic / y2k 取向），深色组自动切浅色字，明暗都过 AA |
| 一个界面只有一个 primary emphasis | 顶部单条 40×8 accent 色条 + 底部 accent 标签，不再满版渐变 |
| 同心圆角 `r_inner = r_outer − gap` | 封面 28（page）→ 书名容器 12（container）→ 顶部色条/标签 8（element）→ 4（inner） |
| 4px 栅格 | 外边距 24、内边距 16、间隙 8/16/20 |
| 字号 role 阶梯 | 书名 27px/600、作者 15px/400、标签 13px/500 |
| 反对玻璃拟态/发光/装饰渐变 | 全部移除；无 `createLinearGradient` / `createRadialGradient` / 半透明文字卡 |
| 反对「卡片套卡片」 | 书名容器与底色同色，仅用 1px 语义描边区分，不叠一层玻璃底 |

底部 `MOYU BOOKS` 标签宽度按实测文字量计算，避免固定 88px 裁字。

## 二、三处回归修复

### 1) 设置页排版错误（用户实拍）

用真实 profile 副本量到实际溢出：`.anim-grid` 容器 678px、内容 **729px（溢出 51px）**，
第 4 个设置块 `720→749`；语言按钮 `flex: 1 0 30%` 折成 3+2，第一行 221px、第二行 333px 明显不齐。

- `.seg.lang-seg` 改 `grid-template-columns: repeat(5, minmax(0,1fr))`，5 个按钮严格等宽（实测均 131px）
- `.anim-grid` 改 `repeat(5, minmax(0,1fr))` + `.anim-card { min-width: 0 }`：`1fr` 会被 `nowrap` 文字的 min-content 撑破
- `.anim-hint` 去掉 `white-space: nowrap` 单行锁，允许最多两行并让 grid 行等高，描述不再截成「书页翻卷，平…」

修复后实测：`animGrid 678/678`、`content 720/720`、`block4 720/718`、语言宽度 `[131,131,131,131,131]`、5 个描述均未截断。

### 2) 主页面切换时向上弹出、显示不完全

`::view-transition-new(page)` 的 `vt-page-in` 带 `translateY(10px) scale(0.998)`，
过渡帧里 `.app-content` 被位移+裁切；`vt-page-out` 也有 `translateY(-4px) scale()`。

按 Astryx `Predictable movement` 改为**纯 opacity 淡变**，时长统一 `--motion-fast`（175ms），
`group` / `old` / `new` / `root` 全部同步，去掉所有位移与缩放。

### 3) 书籍详情弹层：显示 / 透明 / 延迟错误

| 症状 | 根因与修复 |
|---|---|
| 透明错误 | `perspective: 1400px` + `transform-style: preserve-3d` 是旧 3D 翻卡遗留，强制生成 3D 合成层导致弹层半透明/错位 → 全部移除；弹层改为独立恒不透明表面 + 1px 语义描边 + `--shadow-high`，不再依赖 `mat-acrylic` 历史材质类 |
| 显示错误 | `grid-template-columns: 240px 1fr` 会被长路径撑破 → `240px minmax(0,1fr)`；`z-index` 改语义 `--z-overlay` |
| 延迟错误 | 面板 410ms 入场 + 遮罩**未声明 transition**（默认 spring） → 两层都改 175ms 标准 tween，入场去掉 `y: 8` 位移只做 opacity |
| 遮罩过淡 | 浅色 `--detail-scrim` 由 0.32 提到 0.48（仍为 Astryx 要求的 alpha tint，不是实色） |

真实点击验证：`panelBg=rgb(251,252,253)`、`border=1px`、`transformStyle=flat`、`perspective=none`、水平溢出 0。

## 三（补）、书卡 3D 合成层清理

核对打包产物时发现 `transform-style: preserve-3d`、`transformPerspective: 900` 与整套
`useMotionValue/useSpring/useTransform` 链路仍挂在书卡上——Astryx 重构时只把 3D 倾斜跟随
停用了（`onMove` 恒 `set(0)`），没删绑定。每张卡仍会创建 3D 合成层（16 张 = 16 层），
纯开销且无任何视觉效果。已移除：
`BookCard.tsx` 的 hooks / `onMove` / `onLeave` / `cover-glare` 节点（CSS 早已 `display:none`），
`book-card-inner` 改普通 `div`；`global.css` 去掉两条 `preserve-3d`。

> 打包版冒烟需同时清 `ELECTRON_RUN_AS_NODE` 与 `NODE_OPTIONS`：
> 宿主注入的 `NODE_OPTIONS` 在 packaged app 里会触发 `Most NODE_OPTIONs are not supported`，
> 表现为进程卡住无输出。

## 四、验证

- `tsc --noEmit` 干净；**单测 161/161**；构建通过
- **真实 profile 副本**（16 本书、爱弥斯壁纸、全局透明度 57%）+ `show:true` 可见窗口验证：
  设置页排版、书架新封面、详情弹层三张截图人工核对
- 全量 **35/35 状态 `NO_RENDER_ERRORS`**（开发版 + 打包版各一次）

## 五、已知遗留

- 程序化封面在导入时生成并缓存；已有书若想换成新封面，可在详情弹层点「随机封面」重新生成。
- `src/types/book.ts` 的 `ANIM_MODES.hint` 仍保留旧文案「弹性跟手」（设置页动效卡片用），
  书架统计行取的是 i18n 的「平顺入场」，两处不一致；后续可统一。
- 控件高度 / `z-index` 硬编码、同心圆角逐对应用、Astryx 🟢 Objective linter 仍未做。
