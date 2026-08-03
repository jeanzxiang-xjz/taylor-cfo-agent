// 首屏静态骨架。所有 id / data-* 属性都是 legacy-controller.js 的渲染契约，
// 改名前请同步检查 src/legacy-controller.js。

function AppLoadingScreen() {
  return (
    <div className="app-loading-screen" aria-hidden="true">
      <div className="loading-mark">
        <span className="loading-mark-bar" />
        <span className="loading-mark-bar" />
        <span className="loading-mark-bar" />
      </div>
    </div>
  );
}

/**
 * 开场动画：只做一次品牌字幕擦除，可点击/按键跳过，
 * 数据就绪或 1.4s 超时（以先到者为准）后自动收起。
 */
function OpeningOverlay() {
  return (
    <div className="opening-overlay" role="presentation">
      <div className="opening-inner">
        <p className="opening-kicker">本地账本 · 实时解析</p>
        <div className="opening-title">
          <span>Jeanz</span>
          <span>CFO</span>
        </div>
        <div className="opening-scan" />
        <p className="opening-meta">正在读取账本快照</p>
      </div>
      <button className="opening-skip" type="button" data-opening-skip>
        跳过 <kbd>Esc</kbd>
      </button>
    </div>
  );
}

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="9" className="brand-mark-plate" />
      <path className="brand-mark-stroke" d="M21.5 11.2a6.6 6.6 0 1 0 0 9.6" />
      <path className="brand-mark-tick" d="M9 22.6h14" />
    </svg>
  );
}

function TopRail() {
  return (
    <header className="rail" id="top">
      <a className="brand" href="#main">
        <BrandMark />
        <span className="brand-text">
          <span className="brand-name">Jeanz CFO</span>
          <span className="brand-sub">私人财务大脑</span>
        </span>
      </a>

      <nav className="rail-nav" aria-label="页面区块">
        <a className="nav-item is-active" href="#chat" data-nav-section="chat" aria-current="location">
          对话
        </a>
        <a className="nav-item" href="#signals" data-nav-section="signals">
          分析
        </a>
        <a className="nav-item" href="#ledger" data-nav-section="ledger">
          账本
        </a>
      </nav>

      <div className="rail-tail">
        <div className="period-control" role="radiogroup" aria-label="统计周期">
          <span className="period-thumb" aria-hidden="true" />
          <button className="period-btn active" data-period="today" type="button" role="radio" aria-checked="true" tabIndex={0}>
            今日
          </button>
          <button className="period-btn" data-period="week" type="button" role="radio" aria-checked="false" tabIndex={-1}>
            本周
          </button>
          <button className="period-btn" data-period="month" type="button" role="radio" aria-checked="false" tabIndex={-1}>
            本月
          </button>
          <button className="period-btn" data-period="all" type="button" role="radio" aria-checked="false" tabIndex={-1}>
            全部
          </button>
        </div>

        <div className="rail-actions">
          <button id="openTrendModal" className="rail-action" type="button" aria-label="现金流趋势" title="现金流趋势">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M1.8 11.2 5.6 7l2.8 2.6L14.2 3.4" />
              <path d="M10.6 3.4h3.6v3.6" />
            </svg>
            <span className="rail-action-text">趋势</span>
          </button>
          <button id="openSyncModal" className="rail-action" type="button" aria-label="同步邮箱账单" title="同步邮箱账单">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M13.6 6.9A5.7 5.7 0 0 0 3.2 5.1" />
              <path d="M2.4 9.1a5.7 5.7 0 0 0 10.4 1.8" />
              <path d="M13.9 2.6v3.9h-3.9M2.1 13.4V9.5H6" />
            </svg>
            <span className="rail-action-text">同步</span>
          </button>
          <button id="openBudgetSettings" className="rail-action rail-action-icon" type="button" aria-label="预算配置" title="预算配置">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M3 4.2h10M3 8h10M3 11.8h10" />
              <circle cx="6.2" cy="4.2" r="1.7" className="is-filled" />
              <circle cx="10.4" cy="11.8" r="1.7" className="is-filled" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}

/** 首屏：左侧是当期数字，右侧是 CFO 对话。 */
function OverviewHero() {
  return (
    <section className="hero" id="chat" aria-labelledby="periodLabel">
      <article className="panel hero-figure" aria-label="当期概览">
        <div className="hero-figure-top">
          <p className="eyebrow agent-eyebrow">当前周期</p>
          <h1 className="hero-title" id="periodLabel">
            今日净支出
          </h1>
          <div className="figure-row">
            <p className="figure" id="coreAmount">
              <span className="skeleton skeleton-figure" aria-hidden="true" />
              <span className="visually-hidden">读取中</span>
            </p>
            <p className="figure-delta" id="coreDelta" hidden />
          </div>
          <p className="figure-meta" id="primaryMeta">
            <span className="skeleton skeleton-line" aria-hidden="true" />
          </p>
        </div>

        <div className="hero-budget" id="heroBudget">
          <div className="hero-budget-head">
            <span className="micro-label" id="heroBudgetLabel">
              日预算
            </span>
            <span className="hero-budget-value" id="heroBudgetValue">
              --
            </span>
          </div>
          <div className="meter" role="progressbar" aria-labelledby="heroBudgetLabel" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0} id="heroBudgetMeter">
            <span className="meter-fill" id="heroBudgetFill" />
            <span className="meter-tick" aria-hidden="true" />
          </div>
          <p className="hero-budget-foot" id="heroBudgetFoot">
            设置预算后可在这里看到使用进度。
          </p>
        </div>

        <button className="hero-spark" id="heroSpark" type="button" aria-label="查看现金流趋势">
          <span className="hero-spark-head">
            <span className="micro-label">近 7 天</span>
            <span className="hero-spark-cta">
              趋势
              <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path d="M6 3.5 10.5 8 6 12.5" />
              </svg>
            </span>
          </span>
          <span className="hero-spark-chart" id="heroSparkChart" />
        </button>
      </article>

      <article className="panel hero-chat" aria-label="CFO 对话">
        <header className="chat-head">
          <div className="chat-head-title">
            <span className="pulse-dot" aria-hidden="true" />
            <h2>与 CFO Agent 对话</h2>
          </div>
          <p id="headerSummary" className="chat-head-summary">
            正在读取账本快照。
          </p>
        </header>

        <div id="chatMessages" className="chat-messages" role="log" aria-live="polite" aria-label="对话记录" tabIndex={0} />

        <div className="chat-foot">
          <div className="quick-prompts" aria-label="快捷提问">
            <button data-prompt-key="spend" data-question="我今天花了多少钱？" type="button">
              今日支出
            </button>
            <button data-prompt-key="largest" data-question="今天最大的支出是什么？" type="button">
              最大支出
            </button>
            <button data-prompt-key="analysis" data-question="分析下我今天的消费情况" type="button">
              消费分析
            </button>
            <button data-prompt-key="takeout" data-question="我今天外卖点得多吗？" type="button">
              外卖频率
            </button>
            <button data-prompt-key="budget" data-question="今日预算使用率是多少？" type="button">
              预算状态
            </button>
          </div>

          <form id="chatForm" className="chat-form" noValidate>
            <label className="visually-hidden" htmlFor="chatInput">
              向 CFO Agent 提问
            </label>
            <div className="chat-input-row">
              <input
                id="chatInput"
                type="text"
                autoComplete="off"
                enterKeyHint="send"
                maxLength={600}
                placeholder="问点什么，比如「这周奶茶花了多少」"
                aria-describedby="chatHint"
              />
              <button type="submit" className="chat-send" data-label-idle="发送" data-label-busy="生成中">
                <span className="chat-send-text">发送</span>
                <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path d="M2.6 8h9.6M8.4 4.2 12.2 8l-3.8 3.8" />
                </svg>
              </button>
            </div>
            <p className="chat-hint" id="chatHint">
              回车发送 · 按 <kbd>/</kbd> 聚焦输入框 · 回答基于本机账本
            </p>
          </form>
        </div>
      </article>
    </section>
  );
}

function IntelligencePanel() {
  return (
    <section className="section intelligence-panel" id="signals" aria-labelledby="signalsTitle">
      <header className="section-head">
        <div className="section-head-copy">
          <h2 id="signalsTitle">财务智能核心</h2>
          <p id="coreNarrative">等待 Agent 建立当前消费画像。</p>
        </div>
        <div className="section-head-actions">
          <span className="state-chip" id="analysisState">
            Learning
          </span>
        </div>
      </header>

      <div className="stat-row" aria-label="核心指标">
        <div className="stat">
          <span className="micro-label" id="avgSpendLabel">
            日均支出
          </span>
          <strong id="avgDailySpend">--</strong>
        </div>
        <div className="stat">
          <span className="micro-label">消费笔数</span>
          <strong id="txnCount">--</strong>
        </div>
        <div className="stat">
          <span className="micro-label">最大单笔</span>
          <strong id="largestSpend">--</strong>
        </div>
        <div className="stat">
          <span className="micro-label">解析置信</span>
          <strong id="confidenceScore">--</strong>
        </div>
      </div>

      <div className="analysis-grid">
        <article className="panel analysis-feed" aria-labelledby="analysisTitle">
          <div className="mini-heading analysis-heading">
            <h3 id="analysisTitle">Agent 对消费行为的分析</h3>
            <span id="signalMeta">等待样本</span>
          </div>
          <div id="decisionFeed" className="decision-feed" />
        </article>

        <article className="panel category-console" aria-labelledby="categoryTitle">
          <div className="mini-heading">
            <h3 id="categoryTitle">消费场景权重</h3>
            <span id="categoryCount">--</span>
          </div>
          <div id="coreNodes" className="composition-body" />
          <div id="categoryStack" className="category-stack" />
        </article>
      </div>
    </section>
  );
}

function LedgerPanel() {
  return (
    <section className="section ledger-panel" id="ledger" aria-labelledby="ledgerTitle">
      <header className="section-head ledger-heading">
        <div className="section-head-copy">
          <h2 id="ledgerTitle">交易流水</h2>
          <p>每一笔账单截图都会成为 Agent 可追溯的事实节点。</p>
        </div>
      </header>

      <div id="filterBar" className="filter-bar" aria-label="分类筛选" />

      <div className="table-wrap">
        <table className="ledger-table">
          <caption className="visually-hidden">当前周期的交易明细</caption>
          <thead>
            <tr>
              <th scope="col">时间</th>
              <th scope="col">商户 / 内容</th>
              <th scope="col">分类</th>
              <th scope="col">渠道</th>
              <th scope="col" className="col-amount">
                金额
              </th>
            </tr>
          </thead>
          <tbody id="transactionList" />
        </table>
      </div>

      <div id="ledgerPagination" className="ledger-pagination" aria-label="交易分页" />
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="site-foot">
      <p className="site-foot-note">
        账本存放在本机 SQLite，截图与账单不会上传到第三方；只有你主动提问时才会把当期汇总发给模型。
      </p>
      <p className="site-foot-meta">
        <span id="footerGenerated">快照时间 --</span>
        <span aria-hidden="true">·</span>
        <a href="#top">回到顶部</a>
      </p>
    </footer>
  );
}

function TrendModal() {
  return (
    <div id="trendModal" className="modal-backdrop" hidden>
      <section className="modal-shell trend-modal" role="dialog" aria-modal="true" aria-labelledby="trendTitle">
        <div className="modal-header">
          <div>
            <h2 id="trendTitle">现金流趋势</h2>
            <p id="trendSubtitle">正在读取现金流曲线。</p>
          </div>
          <button className="modal-close" type="button" data-modal-close="trendModal" aria-label="关闭趋势弹窗">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M4.4 4.4 11.6 11.6M11.6 4.4 4.4 11.6" />
            </svg>
          </button>
        </div>

        <div className="trend-control" id="trendModeControl" role="radiogroup" aria-label="趋势周期">
          <button className="active" data-trend-mode="day" type="button" role="radio" aria-checked="true" tabIndex={0}>
            日
          </button>
          <button data-trend-mode="week" type="button" role="radio" aria-checked="false" tabIndex={-1}>
            周
          </button>
          <button data-trend-mode="month" type="button" role="radio" aria-checked="false" tabIndex={-1}>
            月
          </button>
        </div>

        <div className="trend-layout">
          <div className="trend-chart-panel">
            <div id="trendChart" className="trend-chart" />
            <div id="trendTooltip" className="trend-tooltip" role="status" hidden />
          </div>

          <aside className="trend-budget-panel" aria-label="预算状态">
            <div className="budget-kpi">
              <span id="trendBudgetLabel">月预算</span>
              <strong id="trendBudgetValue">--</strong>
            </div>
            <div className="budget-usage">
              <div className="budget-usage-head">
                <span>使用率</span>
                <strong id="trendBudgetPercent">--</strong>
              </div>
              <div className="meter">
                <span className="meter-fill" id="trendBudgetProgress" />
                <span className="meter-tick" aria-hidden="true" />
              </div>
            </div>
            <div className="budget-rest">
              <span>预计结余</span>
              <strong id="trendBudgetRemaining">--</strong>
              <div className="budget-rest-meta">
                <span id="trendBudgetAverageLabel">日均可用</span>
                <small id="trendBudgetAverage">--</small>
              </div>
            </div>
            <p className="budget-hint">
              预算可在
              <button type="button" className="link-button" data-open-modal="budgetModal">
                预算配置
              </button>
              里调整。
            </p>
          </aside>
        </div>
      </section>
    </div>
  );
}

function SyncModal() {
  return (
    <div id="syncModal" className="modal-backdrop" hidden>
      <section className="modal-shell sync-modal" role="dialog" aria-modal="true" aria-labelledby="syncTitle">
        <div className="modal-header">
          <div>
            <h2 id="syncTitle">消费数据同步</h2>
            <p id="syncSubtitle">连接邮箱，拉取最新账单截图并写入本地账本。</p>
          </div>
          <button className="modal-close" type="button" data-modal-close="syncModal" aria-label="关闭消费数据同步">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M4.4 4.4 11.6 11.6M11.6 4.4 4.4 11.6" />
            </svg>
          </button>
        </div>

        <div className="sync-body">
          <div className="sync-state-card" id="syncStateCard">
            <span id="syncStatusLabel">准备同步</span>
            <strong id="syncStatusTitle">等待开始</strong>
            <small id="syncStatusMeta">将扫描未读账单邮件，成功处理后自动标记已读。</small>
          </div>

          <div className="sync-metrics" aria-label="同步指标">
            <div>
              <span className="micro-label">候选邮件</span>
              <strong id="syncCandidateCount">--</strong>
            </div>
            <div>
              <span className="micro-label">命中邮件</span>
              <strong id="syncMatchedCount">--</strong>
            </div>
            <div>
              <span className="micro-label">处理附件</span>
              <strong id="syncAttachmentCount">--</strong>
            </div>
            <div>
              <span className="micro-label">新增交易</span>
              <strong id="syncNewCount">--</strong>
            </div>
          </div>

          <div className="sync-log-panel">
            <div className="mini-heading">
              <h3>同步明细</h3>
              <span id="syncFinishedAt">未开始</span>
            </div>
            <div id="syncItemList" className="sync-item-list" />
          </div>

          <div className="sync-actions">
            <button id="startSyncButton" className="btn btn-primary" type="button">
              开始同步
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function BudgetModal() {
  return (
    <div id="budgetModal" className="modal-backdrop" hidden>
      <section className="modal-shell budget-modal" role="dialog" aria-modal="true" aria-labelledby="budgetTitle">
        <div className="modal-header">
          <div>
            <h2 id="budgetTitle">预算配置</h2>
            <p>日、周、月预算会同时用于趋势弹窗和 CFO Agent 的对话上下文。</p>
          </div>
          <button className="modal-close" type="button" data-modal-close="budgetModal" aria-label="关闭预算配置">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M4.4 4.4 11.6 11.6M11.6 4.4 4.4 11.6" />
            </svg>
          </button>
        </div>

        <form id="budgetForm" className="budget-form" noValidate>
          <div className="field">
            <label htmlFor="dayBudgetInput">日预算</label>
            <div className="field-control">
              <span className="field-prefix" aria-hidden="true">
                ¥
              </span>
              <input id="dayBudgetInput" type="number" min="0" step="1" inputMode="decimal" aria-describedby="budgetError" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="weekBudgetInput">周预算</label>
            <div className="field-control">
              <span className="field-prefix" aria-hidden="true">
                ¥
              </span>
              <input id="weekBudgetInput" type="number" min="0" step="1" inputMode="decimal" aria-describedby="budgetError" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="monthBudgetInput">月预算</label>
            <div className="field-control">
              <span className="field-prefix" aria-hidden="true">
                ¥
              </span>
              <input id="monthBudgetInput" type="number" min="0" step="1" inputMode="decimal" aria-describedby="budgetError" />
            </div>
          </div>

          <p className="form-error" id="budgetError" role="alert" hidden />

          <div className="budget-actions">
            <button id="resetBudgetButton" className="btn btn-quiet" type="button">
              恢复默认
            </button>
            <button className="btn btn-primary" type="submit">
              保存配置
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default function App() {
  return (
    <>
      <AppLoadingScreen />
      <OpeningOverlay />
      <div className="app-shell">
        <a className="skip-link" href="#main">
          跳到主要内容
        </a>
        <TopRail />
        <main className="main" id="main" tabIndex={-1}>
          <OverviewHero />
          <IntelligencePanel />
          <LedgerPanel />
          <SiteFooter />
        </main>
        <TrendModal />
        <SyncModal />
        <BudgetModal />
        <div className="toast-region" id="toastRegion" role="status" aria-live="polite" />
      </div>
    </>
  );
}
