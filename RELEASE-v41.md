# 墨鱼阅读器 · v41（0.11.0）发布说明

> 日期：2026-11-10 ｜ 基线：v40（0.10.0）→ **v41（0.11.0）**
> 提交：`30e767d`（功能）· `29a6c95`（文档）· `c951070`（打包版截图修复）
> 主题：**稳定性收口**（阅读窗口崩溃调查 + 大文档 View Transitions 内存守卫）+ **关于页「检查更新」**
> 产物：`墨鱼阅读器-0.11.0-portable.exe`（126.8MB）/ `墨鱼阅读器-0.11.0-win.zip`（186.6MB）

---

## 一、本版修改动作总览

| # | 动作 | 类型 | 涉及文件 |
|---|---|---|---|
| 1 | 阅读窗口崩溃长时压力自检（vt / novt A/B） | 新增自检 | `electron/main.ts` |
| 2 | 大文档 View Transitions 内存守卫（超阈值退回同步更新） | 缺陷缓解 | `src/lib/vt.ts` |
| 3 | 关于页「检查更新」（GitHub Releases 版本比对 + 一键下载） | 新功能 | `electron/update.ts`、`electron/version.ts`、`electron/preload.ts`、`src/lib/native.ts`、`src/pages/SettingsPage.tsx`、`src/styles/global.css` |
| 4 | 打包版截图首状态 `-3` 竞争修复 | 缺陷修复 | `electron/main.ts` |
| 5 | 截图回归 34 → 35 状态（新增关于页） | 回归扩展 | `electron/main.ts` |
| 6 | 版本号 0.10.0 → 0.11.0；README / ROADMAP 同步 | 工程 | `package.json`、`README.md`、`ROADMAP.md` |
| 7 | semver 比较单测 +11（共 149） | 测试 | `tests/version.test.ts` |

---

## 二、逐项：现象 → 根因 → 解决方式

### 1. 阅读窗口渲染进程原生崩溃（`0x80000003` / STATUS_BREAKPOINT）

**现象**
用户偶发阅读窗口闪退；主进程日志只有渲染进程退出码 `-2147483645`（即 `0x80000003`），没有 JS 栈；历史版本未落 minidump，无栈可查。崩溃多发生在点开书面板之后。

**调查动作**
新增 `MOYU_TEST_STRESS="<书路径>|<轮数>|<vt|novt>"` 长时压力自检：反复「滚动推进 + 开关 目录/搜索/书签/笔记/排版 五个面板 + 主题轮换 + 大跳滚动（触发章节批量装卸）+ 主进程 hide/show（摸鱼热键路径）」，崩了自动重建窗口继续计数。对用户真实崩溃的那本 6.37MB TXT（191 章、正文滚动高度约 6.45M px）跑 **vt / novt 各 80 轮** 做 A/B；novt 组用 Chromium 开关 `--force-prefers-reduced-motion` 让 `motionAllowed()` 返回 false、View Transitions 全部退回同步更新。

**调查结论**
- 当前构建（0.10.0 及以后）**两组 80 轮均 0 崩溃** —— 已不复现；历史崩溃日志全部早于 0.10.0 构建，且用户后来同书复开两次未崩，说明大概率已被 0.9.3 的崩溃自愈/启动并行化顺带缓解。
- 但 A/B 测出真问题：**View Transitions 开启时渲染进程内存翻倍**（vt 组 Tab=446MB，novt 组 Tab=210MB，2.1×）。
- 根因（部分实证）：`src/lib/vt.ts` 没有 DOM 规模守卫，阅读窗每次面板开关都调用 `document.startViewTransition`，对**整页**（含 1.6 万段落的超大正文）拍快照并强制同步布局；快照/合成内存随快速连点叠加。大 DOM 下的内存压力是历史原生崩溃最可疑的诱因。
- 旁证：`crashReporter` 有效性已验证（`forcefullyCrashRenderer` → Crashpad 落 812KB `.dmp`）；默认 profile 无历史 dump，与「真实崩溃早于 0.9.10 才加的 minidump 落盘」时间线吻合。

**解决方式**
- `src/lib/vt.ts` 的 `motionAllowed()` 新增**第四条降级路径**：正文滚动容器（`.text-scroll / .pdf-scroll / .comic-scroll / .epub-container / .epub-view`）的 `scrollHeight` 超过 **20000px（约 22 屏）** 即退回同步更新（本就是降级路径，功能零损失，只少一段 cross-fade）。
  - 为什么量**内部滚动容器**而不是 `documentElement`：阅读窗 root/body 只有视口高（实测 936px），正文在内部容器里滚，量 root 永远不触发。
  - 为什么不用节点数：惰性挂载初期仅 1575 个节点，但估算滚动高度已 6.45M px，节点数会漏判。
  - 实测效果：大书 VT 内存 **446MB → 212MB**；小书（滚动高度 1179px）动效完整保留。
- 叠加既有的分层缓解：阅读窗崩溃**自愈**（自动重开一次并保留位置）→ 连续崩溃弹原生对话框「以兼容模式重启（关硬件加速）/ 再试一次 / 取消」→ Crashpad minidump 落盘供事后分析。

**验证**：`MOYU_TEST_STRESS` vt/novt 各 80 轮 0 崩；`MOYU_TEST_READERCRASH` → `READERCRASH_OK`（自愈重开 + 主窗存活 + `.dmp` 落盘）。

### 2. 关于页「检查更新」

**现象 / 需求**
应用无更新感知，用户不知道 GitHub 上发布了新版本；国内访问 GitHub 常受限，不能假设网络可用。

**解决方式**
- `electron/update.ts`：主进程用 node `https`（与 WebDAV 模块同一套路，不受渲染层 CSP 限制）拉 `releases/latest`（接口字段已对真实 API 逐一核验：`tag_name / name / html_url / published_at / body / assets[].browser_download_url`）；`semver` 三段数值比较（非字典序，保证 `0.10.0 > 0.9.3`）；下载资产按 README 推荐排序（`win.zip` > `portable.exe`），过滤 sha256/blockmap；12s 超时 + 2MB 响应上限；未认证限额 60 次/小时，手动检查远低于此，不存任何凭据。
- **仅手动触发**：关于页点「检查更新」才发一次请求；不做启动静默检查、不自动下载安装 —— 守住关于页「无后台请求、无遥测」的隐私承诺。
- **网络受限兜底**：任何失败（超时 / DNS / 限流 / 404）统一返回 `ok:false` + 友好中文提示 + 发布页 URL，界面给「手动前往发布页」按钮，绝不弹错误框、不阻塞。
- `electron/version.ts`：纯 `parseVer` / `compareVersions`（与网络 IO 分离，可单测），11 例单测。
- 桥接与 UI：`preload.ts` / `native.ts` 增加 `checkUpdate()`；关于页新增 `UpdateChecker`（检查按钮 / 「已是最新版本」徽标 / 「发现新版本」卡 + 一键下载 + 更新说明折叠 / 错误兜底链接）；Web 预览无原生桥时只渲染一个手动链接。

**验证**：`MOYU_TEST_UPDATE=1` → `UPDATE_CURRENT`（本地 0.11.0 领先已发布 0.9.3，资产排序正确）；`MOYU_TEST_UPDATE=fail`（注入不可达地址）→ `UPDATE_FALLBACK_OK`；`MOYU_TEST_UPDATE_UI=1`（真实点击）→ `UPDATE_UI_OK`。

### 3. 打包版截图首状态 `-3`（ERR_ABORTED）

**现象**
`win-unpacked` 跑 `--shot` 时首个状态 `01-home-flip` 报 `load error (-3)`，整轮 34/35；而 dev（`npm run shot`）35/35 全绿 —— 仅打包版复现。

**根因**
shot 模式 `createWindow()` 后**立即** `runShots()`，不等待首屏加载完成。打包版从 `app.asar` 读首屏比 dev 从磁盘慢，首屏导航仍在飞行时，状态 1 的 `loadFile` 把首屏导航 abort 成 `-3`（ERR_ABORTED），首状态截图失败。

**解决方式**
`runShots` 在逐状态加载前，先等首屏导航 `did-finish-load` / `did-fail-load` 落定（dev 首屏已提交则立即通过），消除首状态与首屏导航的竞争。修复后打包版 35/35。

### 4. 文档、版本与归档同步

- `package.json` 0.10.0 → 0.11.0（`__APP_VERSION__` 由构建注入，先改版本再 build）。
- README：基线 v40→v41；新增「更新检查」功能行与稳定性行；修正过期描述 —— 格式数「十一」→**十二**（契约层实为 12 种）、壁纸行合并为「仅本地导入 + 底纹叠加 + 亮度适配」（内置预设已移除）、Electron 33→45、删除「阅读内核未接入」的过期约束、截图 30→35 / 单测 138→149、目录补 `update.ts`/`version.ts`。
- ROADMAP：基线 v32→v41；新增「十三、v41 交付记录」；M4/C4 标注轻量更新检查已做、静默/增量自动更新明确不做。
- 归档：`_archive/2026-11-10_v41_稳定性收口与更新检查/`（MANIFEST + 双产物 + 关键截图），sha256 与交付根目录一致；旧 0.10.0 / 0.9.10 包移入旧包归档。

---

## 三、回归验证结果

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npx vitest run` | **149 passed**（原 138 + version 11） |
| `npm run shot`（dev） | **35/35**，fallback=0，`NO_RENDER_ERRORS` |
| 打包版 `--shot` 冒烟 | **35/35**，fallback=0，`NO_RENDER_ERRORS` |
| 崩溃压力 A/B（6.37MB TXT × 80 轮 ×2 组） | 均 **0 崩**；VT 内存 446→212MB（守卫后） |
| `MOYU_TEST_READERCRASH` | `READERCRASH_OK`（自愈 + 主窗存活 + 812KB `.dmp`） |
| `MOYU_TEST_UPDATE=1 / fail` | `UPDATE_CURRENT` / `UPDATE_FALLBACK_OK` |
| `MOYU_TEST_UPDATE_UI=1` | `UPDATE_UI_OK` |
| fixtures 排版回归 | **8/8 ALL_PASS** |
| `MOYU_TEST_CROSSWIN` | `CROSSWIN_OK` |
| 位置恢复 | txt 277→277 / pdf 2062→2062 / cbz 1769→1769 / epub `RESTORE_OK(cfi)` + 章内 OK |

产物校验（sha256）：
- `墨鱼阅读器-0.11.0-portable.exe` → `1f74e27a59271e9de7b9f257812f08a836873c313792cf88a0da5917cc6ca6c0`
- `墨鱼阅读器-0.11.0-win.zip` → `d59601cfca919cda08df5737e06c5eed65a52ad2ef74632ef21384e22f38722b`

---

## 四、没有解决的问题（已知遗留）

### 本轮已缓解、但未根除

1. **阅读窗原生崩溃根因未 100% 实证。** 当前构建在 80 轮 ×2 组压力下不复现，无法抓现行；只测得并移除了「VT 大文档内存翻倍」这一最可疑向量，并保留自愈/兼容模式/minidump 分层兜底。若日后仍偶发，需靠新落的 minidump 取栈定位。
2. **超大惰性挂载 TXT 的像素级位置恢复有约 115px 漂移**（600→715，容差 72）。根因是占位估算高度与实挂高度的差；小书精确（277→277）、不影响章节级定位。列为后续优化。

### 历史遗留（非本轮引入）

3. **无代码签名证书**：electron-builder 明确 skip signing（`signAndEditExecutable` 只写 exe 资源/版本信息，不等于签名）。分发时 Windows SmartScreen 可能提示。
4. **EPUB 作者自带 CSS 与主题冲突**：已用灰阶色适配缓解，彩色硬编码仍有风险（ROADMAP D6）。
5. **仅 Windows 交付**：macOS / Linux 未打包未验收（目标平台决策：Windows 优先）。
6. **`release*` 空壳目录清理（ROADMAP C5）** 仍未做，需先关文件监视器。
7. **Wallpaper Engine 同步**依赖本机已装 Steam 版；未安装时该功能不可用（界面会提示）。
8. **>60MB 的 PDF 不提取内嵌封面**（避免首开卡顿），回退书名封面。

### 明确不做（决策，非缺陷）

9. **静默 / 增量自动更新不做**：便携版 exe 被运行中实例锁定会导致替换失败，且用户应掌控更新时机；本轮只做「手动检查 + 一键下载」。
10. **云同步不做**：位置与偏好全在本地 IndexedDB（既有决策）。

---

## 五、升级指引

- 下载 `墨鱼阅读器-0.11.0-win.zip`（推荐，解压即用）或 `-portable.exe`（单文件便携）。
- 数据在本地 IndexedDB（`%APPDATA%\moyu-reader`），升级不丢书籍/进度/书签/笔记；也可先在「设置 → 数据」导出备份 JSON 再升级。
- 打开「设置 → 我的 → 关于」点「检查更新」可核对版本；侧栏左下角常驻 `vX.Y.Z`。
