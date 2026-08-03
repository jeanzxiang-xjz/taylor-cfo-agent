# Jeanz CFO 前端重构报告

**范围**：`cfo_agent_poc/web_app/`（Vite + React 外壳 + 原生 DOM 控制器）以及 `server.py` 里内联的登录页模板。
**约束**：不改动任何数据流、API 契约与业务逻辑语义。后端 Python 模块（bill_store / bill_classifier / classification_service / mail_sync）零改动。
**方法**：按 `.claude/skills/redesign-existing-projects/SKILL.md` 走「现状审计 → 模块级路线 → 分优先级落地」。

---

## 一、现状审计

### 0. 一句话结论

改造前的界面是一套**高饱和霓虹薄荷 + 装饰性「AI 光环」**的暗色仪表盘：视觉噪声集中在装饰件上，信息层级几乎是平的，最重要的数字和最重要的分析视图都没有拿到应有的位置；交互上缺状态、缺键盘、缺反馈。它看起来"很科技"，但读起来不像一个能每天用的记账工具。

### 1. 通用 / 廉价的「AI 感」模式（skill 清单命中项）

| # | 模式 | 证据（改造前） |
|---|---|---|
| 1 | 单一霓虹色刷满全站 | `--accent: #52f1cf`（HSL 168°, **85%** 饱和）出现在几乎每条边框、每个 `box-shadow: 0 0 Npx`、每段强调文字上。skill 要求饱和度 < 80%。 |
| 2 | 装饰性「神经网络」环 | `.neural-map` / `.ring-one|two|three` / `.scan-plane` / `.core-pulse`（中心写着 `AI` + `CFO`），常驻 `spinCore` 16s/28s 旋转 + `signalPulse` 呼吸，占据智能面板约 40% 面积，**零信息量**。 |
| 3 | AI 生成头图 | `assets/cfo-agent-hero.png`：像素风巴菲特 + 比特币 + 假 HUD 仪表盘，**1.97 MB**，占据 hero 右侧 40% 宽度。旁边还叠了 `.agent-portrait-orbit-one/two` + `.agent-portrait-halo` 三层旋转光环。 |
| 4 | 全大写等宽 kicker | `PRIVATE CASHFLOW INTELLIGENCE`、`LIVE LEDGER BRAIN`、`PRIVATE CFO AGENT`，`letter-spacing: 0.16em` + `var(--mono)`。 |
| 5 | 阻塞式开场动画 | GSAP 时间线最后一个 tween 起于 **2.62s**、持续 0.56s（总计约 3.2s），**不可跳过、每次刷新都播**，期间 `.app-shell` 被 `visibility: hidden` 完全挡住。 |
| 6 | 网格纹理叠三层 | `body::before` 叠了 6 层渐变（含两组 `repeating-linear-gradient` 网格），`.agent-hero::after` 和 `.agent-visual::after` 各自再叠一层网格；三处 `mix-blend-mode: screen`。 |
| 7 | 均匀三/四等分卡片 | `.metric-matrix` 四格等宽等重，`.sync-metrics` 同样四等分。 |
| 8 | 全站唯一圆角 | `--radius: 8px`，从 42px 的品牌方块到 1120px 的弹窗全部一个值。 |

### 2. 视觉层级

- **同一个数字渲染了两次**：`renderMetrics()` 里 `$("coreAmount")` 和 `$("monthSpend")` 都赋值 `formatMoney(selectedSpend)`，即"今日净支出"和指标格里的"周期累计"永远相等。四格指标中有一格是纯冗余。
- **最重要的分析视图被藏起来**：现金流趋势 + 预算进度只存在于弹窗里，首屏完全看不到"我这个周期超没超预算"。
- **对话被挤压**：`.agent-hero` 用 `grid-template-columns: 1.12fr 0.68fr`，左列还要塞下 h1 + 摘要 + 消息区 + 5 个 chip + 输入框，消息滚动区实际只有 `minmax(300px, 1fr)`；右列 40% 宽度全给了装饰头像。
- **同一份数据两种表达**：`.node-cloud`（Top4 分类占比芯片）与 `.category-stack`（分类金额排行）来自同一个 `groupByCategory()`。
- **`.decision-type`** 用 `FACT / PATTERN / RISK / ACTION` 英文大写标签，在全中文界面里既不解释语义也不参与层级。

### 3. 排版

- 字体是系统栈 `ui-sans-serif, -apple-system, ...`，**没有任何字体身份**；`--mono` 兜底到各平台不同的等宽字体，同一份金额在 macOS / Windows 上字形不一致。
- 字重用了 `840 / 820 / 780 / 760` 这类**非标准值**——静态字体会被浏览器四舍五入到 700/800，等于没有中间层级。
- **数字没有 `tabular-nums`**：金额列在切周期、翻页时会左右跳动。
- 标题带发光 `text-shadow: 0 0 26px rgba(82,241,207,.1)`，属于典型的"科技感"补丁。

### 4. 布局 / 间距节奏

- `.main { max-width: none; padding: 24px 30px }`——**没有容器约束**。在 2560px 显示器上单条流水会被拉到 ~2500px 宽，`.transaction-item` 的 5 列 grid 中间出现巨大空洞。
- `.agent-hero { height: clamp(650px, calc(100dvh - 112px), 760px) }` 用固定高度硬撑首屏，内部再用 `grid-template-rows: auto auto auto minmax(300px,1fr) auto auto` 六行硬塞。
- `.filter-strip::after` 的渐变遮罩写死 `right: 128px`——这是"更多分类"按钮的估算宽度，按钮文案一变就错位。

### 5. 状态与空态

- **加载**：只有一个转圈 spinner，没有任何骨架屏。
- **空态**：`.empty-state` 就是一行灰字（`当前筛选没有交易。` / `暂无分类数据。`），没有图示、没有解释、没有出口动作。
- **错误**：`boot().catch` 直接 `document.body.innerHTML = "<main style=...>"`，**把整个应用连同外壳一起替换掉**，且用内联样式；30s 轮询失败只 `console.warn`，用户完全无感。
- **对话忙碌态**：`state.chatBusy` 为 true 时 `submitQuestion` 静默 `return`——按钮还能点，但什么都不会发生，**零反馈**。
- 思考中提示用 `.shiny-text` 彩虹扫光（`linear-gradient(115deg, ...)` 220% 背景位移），比内容本身更抢眼。

### 6. 动效

- 回答逐字浮现对**整段文本**建 `<span>`，`Math.min(index, 90)` × `18ms` ≈ 最后一个字要 **1.6s** 才出现——读一句话要等它演完。
- 三处 `scrub` 视差全部挂在**纯装饰元素**上（`.agent-visual` / `.agent-portrait` / `.neural-map`）。
- 首屏常驻的无限循环动画 7 个（`spinCore` ×2、`spinPortraitOrbit` ×2、`breathePlane`、`signalPulse`、`portraitHaloPulse`），另有思考态的彩虹扫光。

### 7. 响应式

- `@media (max-width: 760px)` 把 `.transaction-item` 塌成 `grid-template-columns: 1fr`——每笔交易变成时间/商户/分类/渠道/金额**五行堆叠**，一屏只能看两笔，读起来像日志。
- 顶栏在 760px 以下变三行（品牌 / 导航 / 周期），常驻吃掉约 130px 垂直空间。

### 8. 可访问性

| 问题 | 证据 |
|---|---|
| 没有 skip link | 键盘用户每次都要 Tab 过整个顶栏。 |
| 假的 tab 语义 | `.period-control` 挂 `role="tablist"`，但四个按钮**没有 `role="tab"` / `aria-selected`**，也没有 tabpanel，没有方向键。 |
| 弹窗无焦点管理 | 有 `aria-modal="true"`，但**焦点不进弹窗、不被困住、关闭后也不归还**给触发按钮。 |
| `aria-current="true"` | 区块导航应为 `location`。 |
| 趋势图只能用鼠标 | 数值只在 `pointermove` 时出现在 tooltip 里，键盘/读屏用户拿不到任何数据点。 |
| 对比度不足 | 11–12px 的次要文字用 `rgba(186,211,204,0.72)` / `#5f7972`，实测低于 4.5:1。 |

### 9. 代码质量

- **约 200 行死 CSS**：`.cockpit-header` / `.header-copy` / `.agent-neural-map` / `.agent-orbit-one|two` / `.agent-crosshair` / `.agent-avatar-core` / `.agent-visual-card-top` 对应的 DOM 在 `App.jsx` 里已不存在。
- z-index 是魔数：`120 / 100 / 40 / 20 / 5 / 4 / 3`，没有比例尺。
- 缺 `<meta name="description">`、缺 OG 标签；`<link rel="icon" href="data:," />` 是**空 favicon**。
- `.transaction-list` 是一堆 `div`，表格数据没有表格语义。

---

## 二、模块级重构路线

优先级：**P0** = 影响每天使用 / 可访问性阻断；**P1** = 主要观感与信息架构；**P2** = 打磨。

| # | 模块 | 问题 | 目标 | 具体改动 | 优先级 | 状态 |
|---|---|---|---|---|---|---|
| 1 | 设计令牌 | 单一霓虹色刷全站、圆角/阴影/层级无体系 | 建立可复用的色阶、字阶、间距、圆角、阴影、层级、动效令牌 | 墨绿中性 13 阶 + 玉色 5 阶 + 3 组语义色；圆角 6 档；阴影 4 档统一顶光；z-index 8 档命名 | P0 | ✅ |
| 2 | 排版 | 系统字体、非法字重、数字跳动 | 有身份、有层级、数字稳定 | 自托管 Instrument Sans 可变字体（拉丁 subset）+ 系统 CJK 栈；字重收敛到 400/500/600/700；金额全部 `tabular-nums` | P0 | ✅ |
| 3 | 开场动画 | 3.2s 阻塞、不可跳过、每次都播 | 保留品牌瞬间但不挡路 | 压到 ~1.6s；可点击 / Esc 跳过；`sessionStorage` 一会话只播一次；数据等待封顶 1.2s；reduced-motion 直接跳过 | P0 | ✅ |
| 4 | 首屏信息架构 | 关键数字被埋、对话被挤、40% 给装饰图 | 落地即答"花了多少 / 超没超" | 非对称双栏：左＝当期数字 + 环比 + 预算计量条 + 近 7 天迷你柱；右＝完整对话面板 | P0 | ✅ |
| 5 | 头图与装饰件 | AI 生成插画 1.97MB、旋转光环、神经环 | 用真实数据替代装饰 | 移除头图与所有装饰环；空出来的位置改放真实图表 | P0 | ✅ |
| 6 | 指标区 | 同一数字渲染两次、四等分无主次 | 四个指标各自承担独立信息 | 首格加宽打破等分；`monthSpend` → 随周期自适应的**笔均/日均支出** | P0 | ✅ |
| 7 | 分析区 | 构成与排行重复 | 一个面板，两级细节 | 堆叠构成条（总览）+ 排行条（明细）合并进「消费场景权重」；分类颜色跨视图一致 | P1 | ✅ |
| 8 | 账本 | div 汤、宽屏拉伸、移动端五行堆叠 | 真表格语义 + 两种形态 | `<table>` + 显式 `role`；桌面固定列宽表格，≤860px 转卡片且语义不丢 | P1 | ✅ |
| 9 | 趋势弹窗 | 面积+折线+柱三重编码、刻度是 437 这种数 | 一种编码，可读刻度，键盘可达 | 只保留柱形 + 预算虚线；`niceCeil` 收敛刻度到 1/2/2.5/5×10ⁿ；每根柱 `tabindex=0`，聚焦即出数值 | P1 | ✅ |
| 10 | 状态设计 | 无骨架、空态一行字、错误清空 body | 三态完整可用 | 骨架占位；带图示/说明/出口动作的空态；错误只替换主区域并给"重新加载" | P0 | ✅ |
| 11 | 对话反馈 | 忙碌静默、彩虹扫光、逐字 1.6s | 每次操作都有回应 | 按钮进入禁用+「生成中」；三点打字指示；逐字只演前 40 字（360ms）；失败走错误气泡 | P0 | ✅ |
| 12 | 可访问性 | skip link / 焦点陷阱 / 假 tab / 对比度 | 键盘可完整操作 | skip link；radiogroup + roving tabindex + 方向键；弹窗焦点陷阱与归还；`--muted-dim` 校准到 4.5:1 | P0 | ✅ |
| 13 | 响应式 | 顶栏三行、表格堆叠 | 三档断点各自成立 | 1180 / 1080 / 860 / 720 四档；手机顶栏收成两行、动作按钮转纯图标 | P1 | ✅ |
| 14 | 元信息 | 空 favicon、无 description | 分享/收藏可辨识 | 内联 SVG favicon（品牌标记）、description、OG 标签、`noindex` | P2 | ✅ |
| 15 | 登录页 | 内联模板仍是旧霓虹配色 | 与应用同一套语言 | 用同一套令牌重写 `server.py::LOGIN_PAGE`（纯模板，无逻辑改动） | P2 | ✅ |
| 16 | 代码清理 | 200 行死 CSS、魔数 z-index | 可维护 | styles.css 重写；z-index 令牌化；死规则清零 | P1 | ✅ |

---

## 三、实际改动

### 改动的文件

| 文件 | 性质 |
|---|---|
| `cfo_agent_poc/web_app/styles.css` | 全量重写（设计系统 + 全部组件） |
| `cfo_agent_poc/web_app/src/App.jsx` | 结构重排（保留全部 id / data-* 契约） |
| `cfo_agent_poc/web_app/src/legacy-controller.js` | 渲染模板 + 状态/交互/无障碍改造，**数据逻辑逐函数保留** |
| `cfo_agent_poc/web_app/src/motion.js` | 重写动效策略 |
| `cfo_agent_poc/web_app/src/main.jsx` | 移除已无用的图片预加载 |
| `cfo_agent_poc/web_app/index.html` | 元信息、favicon、首帧兜底样式、noscript |
| `cfo_agent_poc/web_app/server.py` | **仅** `LOGIN_PAGE` 这个 HTML 字符串 |
| `cfo_agent_poc/web_app/assets/fonts/*.woff2` | 新增（2 个，41 KB） |

### 设计系统

**配色**——从「霓虹薄荷刷全站」改成「墨绿中性 + 单一玉色强调」：

```
中性 13 阶  --ink-0 … --ink-12    统一 hue≈168、极低彩度，冷暖不混
强调 5 阶   --jade-bg … --jade-9  #2e9e7b (S 55%) / #58cda4 (S 51%)，全部 < 60%
语义 3 组   amber（预警）/ rose（超支、错误）/ jade（正向）
数据色板 8  --cat-1 … --cat-8     只用于图表与色点，不参与界面色
```

关键纪律：**界面色（边框、面板、次要文字）全部走中性阶**，玉色只在"当前选中 / 主操作 / 正向数值"上出现。这一条改完，霓虹感就消失了 80%。分类色板是独立的第二套体系——数据编码需要多色，但它不允许泄漏到界面 chrome 里。

**排版**——自托管 Instrument Sans 可变字体（`wght 400–700`，仅拉丁 subset，两个文件共 41 KB）+ 系统 CJK 栈（PingFang SC / Noto Sans SC / 微软雅黑）。中文走系统字体是刻意的：CJK webfont 动辄 3–10 MB，对一个本地工具是净负担。金额与刻度统一 `font-variant-numeric: tabular-nums`。

**其他令牌**：圆角 6 档（容器 22px / 卡片 16px / 内件 10px / 芯片 6px / 微件 4px）；阴影 4 档，全部用页面底色 `rgba(3,6,5,·)` 染色 + `inset 0 1px 0 rgba(255,255,255,.04)` 顶部高光，统一光源方向；z-index 8 档命名（`--z-base … --z-overlay`）；动效 4 档时长 + 2 条缓动曲线。

**质感**：删掉三层网格叠加，换成一层固定的 `feTurbulence` 噪点（`opacity: .032`）+ 一道右上角环境光。

### 逐模块

**顶栏** — 从"品牌 / 周期 / 导航"三段式改成 `品牌 | 区块导航 | 周期 + 工具`。周期选择器改成带滑块的分段控件（滑块位置由 `getBoundingClientRect` 实测，随字体加载重算），语义是 `role="radiogroup"` + roving tabindex + ←/→/Home/End。趋势/同步/预算三个工具按钮从散落各处收进顶栏右侧，用一条竖线与周期分隔。顶栏默认透明，滚动超过 8px 才加毛玻璃和分隔线（`body.is-scrolled`）。

**首屏** — 非对称双栏 `0.82fr / 1.18fr`：

- 左：当期净支出（`clamp(2.75rem, 4.4vw, 4rem)`，`letter-spacing: -0.042em`）+ 环比胶囊 + 预算计量条（带 25% 刻度、80%/100% 三档变色）+ 近 7 天迷你柱（可点击进趋势弹窗）。
- 右：完整对话面板——消息 `align-content: end` 贴底（真实聊天的行为）、快捷提问、带键盘提示的输入条。

`<h1>` 就是 `#periodLabel` 本身（"今日净支出"），标题和数字构成一句话，而不是再挂一句营销文案。

**智能核心** — 四格指标改成 `1.35fr 1fr 1fr 1fr` 打破等分；首格随周期自适应（今日看**笔均**，其余看**日均**），彻底消除与首屏数字的重复。分析结论标签从 `FACT/PATTERN/RISK/ACTION` 改成中文「事实 / 模式 / 风险 / 动作」，风险条走 amber 语义色。「消费场景权重」面板改成两级：顶部堆叠构成条（Top6 + 其他）+ 图例，下方分类排行（色点 + 金额 + 相对峰值的条 + 笔数占比）。

**账本** — 真 `<table>`，`table-layout: fixed`，列宽 118/auto/152/212/142；`<thead>` 常驻。每行显式带 `role="row"` / `role="cell"`，所以 ≤860px 切成卡片布局（`display: block/grid`）时表格语义**不丢失**。分类色点与上方图表同色。筛选保持"常用条 + 更多分类浮层"，浮层改成绝对定位卡片，点击外部关闭（**捕获阶段**监听——因为 `#filterBar` 自己的处理器会重建 innerHTML，冒泡时 target 已脱离文档）。

**趋势弹窗** — 原来同一份数据画了面积 + 折线 + 柱三层。现在只留柱形（离散周期本来就该用柱），加预算虚线（带金额标注）、当前周期高亮、超预算转 rose。Y 轴用 `niceCeil()` 把上界收敛到 1/2/2.5/5×10ⁿ，刻度从"437"变成"¥500"。每根柱是 `<g class="trend-slot" tabindex="0" role="button" aria-label="8月3日，¥357.20，超出日预算¥57.20">`，聚焦即弹数值——键盘和读屏用户第一次能读到这张图。

**状态** — 骨架屏（`skeleton-figure` / `skeleton-line`，尊重 reduced-motion）；空态统一走 `emptyState({icon, title, hint, action})`，四种场景各有出口（筛选无结果 → "查看全部分类"；账本为空 → "同步邮箱账单"）；致命错误改成 `renderFatalError()`，只替换 `<main>` 内容并给"重新加载"，外壳与样式都保住；轮询失败弹一次 toast 而不是只 `console.warn`。

**对话** — 忙碌时发送按钮禁用并变成「生成中」、快捷提问一并禁用；彩虹扫光换成三点打字指示；逐字动画只演前 40 字（40 × 9ms = 360ms，超过 600 字直接跳过）；请求失败走独立的错误气泡样式。新增 `/` 聚焦输入框。

**动效** — 开场 ~1.6s、可跳过、一会话一次；滚动入场只保留标题遮罩上推 + 卡片错落淡入；周期切换时主数字轻微上浮，作为"这块变了"的反馈；删掉全部装饰性视差和 9 个常驻循环动画（只留一个 2.8s 的在线呼吸点）。`prefers-reduced-motion` 下整套动效跳过。

**可访问性** — skip link（用 `:focus` 而非 `:focus-visible`，因为它只有键盘能到）；弹窗焦点进入 / Tab 环陷阱 / 关闭后归还触发元素；`aria-current="location"`；计量条 `role="progressbar"` + `aria-valuenow/valuetext`；`--muted-dim` 从 `#5c6a66` 校准到 `#75837f`（在 `--surface` 上实测 4.75:1）。

---

## 四、设计决策与取舍

1. **删掉 AI 生成头图**（`cfo-agent-hero.png`，1.97 MB 的像素巴菲特 + 比特币 HUD）。这是全项目最强的"AI 生成"指纹，也是最大的性能负担。**文件仍在仓库里**（`assets/` 未删），恢复只需在 `App.jsx` 里加回一个 `<img>`。空出来的位置没有换成另一张图，而是换成了真实数据——对一个数据产品来说，图表就是它的图像。

2. **保留绿色家族，放弃霓虹**。`#52f1cf → #58cda4`（饱和度 85% → 51%）。完全换色（比如换成蓝或琥珀）视觉冲击更大，但会丢掉产品既有的身份。取舍是：**色相不变，把彩度和使用范围砍掉**。

3. **界面色与数据色分成两套**。skill 说"只留一个强调色"，但分类数据客观需要多色编码。做法是划清边界：数据色板只允许出现在色点、构成条、排行条里，绝不出现在按钮、边框、面板上。

4. **保留开场动画而不是删掉**。原作者显然在意这个品牌瞬间。取舍是把"每次 3.2s 强制观看"改成"一会话一次、可跳过、最长 1.6s"——保住意图，去掉代价。

5. **今日的环比不跟"昨天一整天"比**。上午 10 点的今日支出 vs 昨天全天是不对等口径，会持续给出误导性的"下降"。改成**跟近 7 日日均比**，标签直写「较 7 日均值」。周/月仍与上一个完整周期比。

6. **趋势图只留一种编码**。原来面积 + 折线 + 柱同时表示同一个序列。柱形对"离散周期支出"更诚实。代价是失去了"趋势线"的连续观感——对 7 天/12 月的桶状数据，这个代价可以接受。

7. **账本用真表格**。响应式表格比 div 网格麻烦，但屏幕阅读器能读出"第 3 行，金额列，¥37.56"。通过显式 `role` 属性，卡片形态下语义也不丢。

8. **中文不上 webfont**。拉丁字体自托管（41 KB），中文走系统栈。这让金额、刻度、品牌有了字体身份，同时首屏不需要下载几 MB 的 CJK 字形，也不需要运行时联网——对本地优先的工具是正确的取舍。

9. **只改了 `server.py` 的登录页模板字符串**。不这样做的话，公网 demo 的第一屏还是旧霓虹配色，和进入后的应用是两个产品。这是纯 CSS/HTML 模板改动，没有触碰任何路由、鉴权或数据逻辑。

10. **保留 `legacy-controller.js` 这个架构**。React 只做静态骨架、原生 DOM 做渲染，这个组合并不优雅，但把它迁移成受控 React 组件是一次高风险重写，与"不破坏现有功能"直接冲突。改动限制在**模板字符串和交互接线**，所有纯函数（`scopedTransactions` / `groupByCategory` / `trendSeries` / `normalizeAmount` …）逐字保留。

---

## 五、验证

| 项目 | 结果 |
|---|---|
| `npm run build` | ✅ 通过 |
| Python 测试 `python3 -m unittest discover -s cfo_agent_poc/tests` | ✅ **30 passed** |
| 真实运行（demo 账本 138 笔，`server.py --port 8097`） | ✅ |
| 浏览器控制台（CDP 抓 `console.error` / `exceptionThrown` / `Log.entryAdded`） | ✅ 全部 **NO CONSOLE ERRORS**：首屏（完整动效）、滚动到底、切周期、三个弹窗、发消息、筛选空态、同步失败、移动端、平板、登录页——15 次驱动运行 |
| 断点 1512 / 1440 / 1200 / 1000 / 390 | ✅ 逐一截图核对 |
| 完整动效路径 + `prefers-reduced-motion` 路径 | ✅ 两条都验证 |
| 对比度实测（15 处最小号文字） | ✅ 全部 ≥ 4.50（最低 4.70 @11px） |
| 键盘：skip link / 周期方向键 / 弹窗焦点归还 / 趋势柱聚焦 | ✅ |

**回归验证过的交互**：切周期（数字、标题、自适应指标、滑块、`aria-checked`、表格、分页同步更新：`¥175.04 今日 → ¥1,128.62 本月`）、分类筛选与"更多分类"浮层、分页与跳页、发送提问（走通 demo 回答链路）、预算表单校验与保存、邮箱同步（无 `.env` 时正确落到错误态）、Esc 关闭弹窗、锚点导航与滚动高亮。

**体积变化**：

```
移除    cfo-agent-hero.png        -1,966 KB
新增    Instrument Sans (2 files)    +41 KB
CSS     10.55 KB gz  →  10.43 KB gz
控制器  12.04 KB gz  →  16.09 KB gz   (骨架/空态/图表/无障碍代码)
─────────────────────────────────────
首屏净变化                        ≈ -1.93 MB
```

---

## 六、未完成 / 已知限制

1. **只有暗色主题**。`color-scheme: dark`，令牌结构已经支持再加一套亮色映射，但本次没做——原项目也只有暗色，加亮色属于扩大范围。
2. **30s 轮询仍是全量重渲染**。`loadSnapshot()` 拉完整 `data.json` 后 `renderAll()` 重建所有 innerHTML。138 笔数据下无感，上万笔会开始掉帧。真正的修法是增量 diff 或迁移到受控组件，属于架构改动。
3. **账本没有虚拟滚动**，靠每页 10 条兜住。
4. **趋势图的柱子可以 Tab 聚焦，但没有 ←/→ 在柱之间跳**（模式切换按钮有方向键）。柱数最多 12 根，Tab 可接受，但不算最佳实践。
5. **`.agent-eyebrow` 这个类名留着没改**——`renderHeader()` 靠它挂 demo 徽章。语义上它现在是"当前周期"标签，名字对不上了，属于故意保留的契约债。
6. **`assets/cfo-agent-hero.{png,webp}` 和 `opening-cfo-illustration.webp` 仍在仓库里但不再被引用**，构建产物不包含它们。留着是为了让"恢复头图"这个决定可以一行回滚；确认不要之后可以直接删掉 2 MB。
7. **移动端顶栏仍是两行**（品牌+导航 / 周期+工具）。再压需要把区块导航折进汉堡菜单，考虑到只有三个区块，这样反而更差，就停在两行。
8. **登录页用系统字体**，没有加载自托管的 Instrument Sans——它由 `server.py` 直出，拿不到 Vite 的哈希文件名。视觉上只影响拉丁字形，可接受。
