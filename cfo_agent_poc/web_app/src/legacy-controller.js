const currency = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  maximumFractionDigits: 2,
});

const compactCurrency = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  maximumFractionDigits: 0,
});

const categoryNames = {
  coffee_tea: "咖啡/奶茶",
  food_delivery: "外卖/餐饮",
  parking: "停车交通",
  car_charging: "车辆充电",
  auto: "爱车养车",
  groceries: "超市便利",
  fruit: "水果鲜果",
  bakery: "烘焙面包",
  education: "教育考试",
  books: "图书书店",
  ecommerce: "网购",
  transport: "交通",
  healthcare: "医疗",
  investment: "投资理财",
  property: "物业生活",
  telecom: "通信充值",
  entertainment: "演出票务",
  credit_repayment: "信用借还",
  utilities: "水电燃缴费",
  stationery: "文具用品",
  digital_services: "数字服务",
  general_shopping: "日常购物",
  leisure_travel: "旅行休闲",
  lottery: "彩票",
  personal_transfer: "个人转账",
  uncategorized: "未分类",
};

const paymentAppNames = {
  wechat: "微信",
  alipay: "支付宝",
};

const chatAvatarAssets = {
  user: new URL("../assets/avatar-user.png", import.meta.url).href,
  agent: new URL("../assets/avatar-cfo.png", import.meta.url).href,
};

// 类别色板只服务于数据编码（构成条、权重条、流水色点），不参与界面配色。
// 同一个分类在所有视图里必须是同一个颜色，切换周期也不能变色，所以按 key 定色。
const CATEGORY_PALETTE = [
  "var(--cat-1)",
  "var(--cat-2)",
  "var(--cat-3)",
  "var(--cat-4)",
  "var(--cat-5)",
  "var(--cat-6)",
  "var(--cat-7)",
];

// 取色顺序，不是随便排的：构成条只画金额最高的 6 类，所以把「通常占比靠前」的
// 分类排在最前面，它们就必然落在不同色槽上。
//
// 这里原先用 key 的哈希取色，26 个分类砸进 7 个槽，分布还极不均匀——
// 实测账本里 top6 只拿到 3 个颜色（外卖和数字服务同色，演出票务、网购、
// 通信充值三个同色）。哈希的「稳定」只保证同一分类不变色，
// 完全不保证同屏的几个分类不撞色。
const CATEGORY_COLOR_ORDER = [
  "food_delivery",
  "entertainment",
  "ecommerce",
  "digital_services",
  "car_charging",
  "telecom",
  "groceries",
  "books",
  "parking",
  "utilities",
  "lottery",
  "personal_transfer",
  "leisure_travel",
  "coffee_tea",
  "fruit",
  "education",
  "healthcare",
  "general_shopping",
  "transport",
  "bakery",
  "property",
  "stationery",
  "auto",
  "credit_repayment",
  "investment",
];

const CATEGORY_COLOR_INDEX = new Map(CATEGORY_COLOR_ORDER.map((key, index) => [key, index]));

function categoryColor(key) {
  const value = String(key || "uncategorized");
  // 「未分类」和「其他」共用中性灰：它们是兜底桶，不该抢真实分类的颜色。
  if (value === "uncategorized") return "var(--cat-8)";

  const index = CATEGORY_COLOR_INDEX.get(value);
  if (index !== undefined) return CATEGORY_PALETTE[index % CATEGORY_PALETTE.length];

  // 新分类还没进上面的顺序表时的兜底，保证至少是稳定的。
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length];
}

const ledgerPageSize = 10;
const primaryLedgerCategories = ["all", "books", "food_delivery", "groceries", "property", "car_charging"];
const budgetStorageKey = "ericCfoBudgets";
const defaultBudgets = {
  day: 100,
  week: 700,
  month: 3000,
};

const ICONS = {
  empty: `<svg viewBox="0 0 24 24"><path d="M4 7.5h16v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z"/><path d="M4 7.5 6.4 4h11.2L20 7.5"/><path d="M9.6 11.4h4.8"/></svg>`,
  filter: `<svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg>`,
  spark: `<svg viewBox="0 0 24 24"><path d="M4 16.5 9 11l3.4 3.2L20 6.5"/><path d="M15.4 6.5H20V11"/></svg>`,
  mail: `<svg viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4.5 7.5 7.5 5.5 7.5-5.5"/></svg>`,
  alert: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.8v4.6M12 15.8v.4"/></svg>`,
};

function loadBudgetConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(budgetStorageKey) || "{}");
    return {
      day: Number(saved.day) > 0 ? Number(saved.day) : defaultBudgets.day,
      week: Number(saved.week) > 0 ? Number(saved.week) : defaultBudgets.week,
      month: Number(saved.month) > 0 ? Number(saved.month) : defaultBudgets.month,
    };
  } catch {
    return { ...defaultBudgets };
  }
}

let state = {
  transactions: [],
  generatedAt: null,
  period: "today",
  filter: "all",
  merchantFocus: "",
  // 从趋势明细格跳过来的时间区间 { start, end, label }。设了它就不再叠顶部周期。
  dateRange: null,
  ledgerFilterExpanded: false,
  ledgerPage: 1,
  chatHistory: [],
  chatBusy: false,
  syncBusy: false,
  budgets: loadBudgetConfig(),
  trendMode: "day",
  activeTrendSeries: [],
  trendSelected: null,
  classificationPendingCount: 0,
  activeEvidenceUid: null,
  evidencePayload: null,
  evidenceEditing: false,
  evidenceSaving: false,
  returnFocusElement: null,
  chatExpanded: false,
  chatReturnFocusElement: null,
  chatReturnScrollPosition: null,
  chatTransitionCancel: null,
  profileReport: null,
  profileReportStale: false,
  profileReportBusy: false,
  profileReportIndex: 0,
  profileReportPageCount: 0,
  profileReportStageTimer: null,
  profileReportScrollFrame: null,
  hasLoaded: false,
};

function $(id) {
  return document.getElementById(id);
}

const reducedMotionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
const transitionWatchers = new WeakMap();

function prefersReducedMotion() {
  return Boolean(reducedMotionQuery?.matches);
}

/**
 * 以真实的 transitionend 作为状态清理时机；fallback 只防止节点被替换、
 * 浏览器丢失事件等异常路径，不再承担视觉节奏。
 */
function afterTransition(element, callback, options = {}) {
  if (!element) {
    callback();
    return () => {};
  }

  transitionWatchers.get(element)?.();
  let settled = false;
  let fallbackTimer = 0;
  const property = options.property || "transform";
  const finish = () => {
    if (settled) return;
    settled = true;
    window.clearTimeout(fallbackTimer);
    element.removeEventListener("transitionend", handleEnd);
    transitionWatchers.delete(element);
    callback();
  };
  const cancel = () => {
    if (settled) return;
    settled = true;
    window.clearTimeout(fallbackTimer);
    element.removeEventListener("transitionend", handleEnd);
    transitionWatchers.delete(element);
  };
  const handleEnd = (event) => {
    if (event.target === element && (!property || event.propertyName === property)) finish();
  };

  transitionWatchers.set(element, cancel);
  if (prefersReducedMotion()) {
    requestAnimationFrame(finish);
    return cancel;
  }

  element.addEventListener("transitionend", handleEnd);
  fallbackTimer = window.setTimeout(finish, options.fallback ?? 480);
  return cancel;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[char];
  });
}

function recoveryMessage(error, action) {
  const message = String(error?.message || "").trim();
  if (error instanceof TypeError || /Failed to fetch|NetworkError|fetch/i.test(message)) {
    return `${action}失败，请确认本地服务仍在运行后重试。`;
  }
  return message || `${action}失败，请稍后重试。`;
}

function renderInlineMarkdown(value) {
  const codeSpans = [];
  let html = escapeHtml(value).replace(/`([^`]+)`/g, (_, code) => {
    const token = `@@CODE_SPAN_${codeSpans.length}@@`;
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, href) => {
    return `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`;
  });
  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^\*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");

  codeSpans.forEach((code, index) => {
    html = html.replace(`@@CODE_SPAN_${index}@@`, code);
  });
  return html;
}

function isMarkdownTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitMarkdownTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderMarkdownTable(lines) {
  const headers = splitMarkdownTableRow(lines[0]);
  const rows = lines.slice(2).map(splitMarkdownTableRow);
  return `
    <div class="markdown-table-wrap">
      <table>
        <thead>
          <tr>${headers.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderMarkdown(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && isMarkdownTableSeparator(lines[index + 1])) {
      const tableLines = [line, lines[index + 1]];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        tableLines.push(lines[index]);
        index += 1;
      }
      blocks.push(renderMarkdownTable(tableLines));
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length + 3, 6);
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push(`<blockquote>${quoteLines.map(renderInlineMarkdown).join("<br>")}</blockquote>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(`<ul>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(`<ol>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ol>`);
      continue;
    }

    const paragraph = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^```/.test(lines[index]) &&
      !/^(#{1,3})\s+/.test(lines[index]) &&
      !/^\s*>\s?/.test(lines[index]) &&
      !/^\s*[-*]\s+/.test(lines[index]) &&
      !/^\s*\d+\.\s+/.test(lines[index]) &&
      !(lines[index].includes("|") && index + 1 < lines.length && isMarkdownTableSeparator(lines[index + 1]))
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(`<p>${paragraph.map(renderInlineMarkdown).join("<br>")}</p>`);
  }

  return blocks.join("");
}

/**
 * 回答完成后只确认一次“结果已到达”，不再拆字等待。
 * Markdown、表格和长段落保持完整排版，避免逐字动画拖慢阅读。
 */
function animateSplitText(node) {
  if (!node || prefersReducedMotion()) return;
  node.classList.remove("answer-result-in");
  requestAnimationFrame(() => {
    node.classList.add("answer-result-in");
    node.addEventListener("animationend", () => node.classList.remove("answer-result-in"), { once: true });
  });
}

function setMessageContent(node, role, text, options = {}) {
  if (role === "agent") {
    node.classList.add("markdown-message");
    node.classList.remove("answer-result-in");
    node.innerHTML = renderMarkdown(text);
    if (options.split) animateSplitText(node);
    return;
  }
  node.classList.remove("answer-result-in");
  node.textContent = text;
  if (options.split) animateSplitText(node);
}

function parseDate(value) {
  return value ? new Date(value) : new Date(NaN);
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function sameDay(a, b) {
  return dateKey(a) === dateKey(b);
}

function inSameMonth(date, anchor) {
  return date.getFullYear() === anchor.getFullYear() && date.getMonth() === anchor.getMonth();
}

function startOfWeek(date) {
  const start = new Date(date);
  const day = start.getDay() || 7;
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - day + 1);
  return start;
}

function inSameWeek(date, anchor) {
  const start = startOfWeek(anchor);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return date >= start && date < end;
}

function getAnchorDate() {
  // 统计口径以用户当前本地时间为准，不能停在最后一笔交易或快照时间。
  // 这样跨过 00:00 后，今日会自然切换到新的一天。
  return new Date();
}

function startOfDay(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function normalizeAmount(tx) {
  const amount = Math.abs(Number(tx.amount || 0));
  return tx.direction === "inflow" ? -amount : amount;
}

function positiveSpend(tx) {
  return Math.max(normalizeAmount(tx), 0);
}

function sum(transactions) {
  return transactions.reduce((total, tx) => total + normalizeAmount(tx), 0);
}

function clamp(value, min, max) {
  const safeMax = Math.max(min, max);
  return Math.min(Math.max(value, min), safeMax);
}

function scopedTransactions(period = state.period) {
  const anchor = getAnchorDate();
  return state.transactions.filter((tx) => {
    const paidAt = parseDate(tx.paid_at);
    if (Number.isNaN(paidAt.getTime())) return false;
    if (paidAt > anchor) return false;
    if (period === "today") return sameDay(paidAt, anchor);
    if (period === "week") return inSameWeek(paidAt, anchor);
    if (period === "month") return inSameMonth(paidAt, anchor);
    return true;
  });
}

function transactionsBetween(start, end) {
  const anchor = getAnchorDate();
  return state.transactions.filter((tx) => {
    const paidAt = parseDate(tx.paid_at);
    return !Number.isNaN(paidAt.getTime()) && paidAt >= start && paidAt < end && paidAt <= anchor;
  });
}

function sumBetween(start, end) {
  return sum(transactionsBetween(start, end));
}

function groupByCategory(transactions) {
  return transactions.reduce((acc, tx) => {
    const key = tx.category || "uncategorized";
    if (!acc[key]) acc[key] = { amount: 0, count: 0 };
    acc[key].amount += positiveSpend(tx);
    acc[key].count += 1;
    return acc;
  }, {});
}

function topCategory(transactions) {
  return Object.entries(groupByCategory(transactions)).sort((a, b) => b[1].amount - a[1].amount)[0] || null;
}

function largest(transactions) {
  return [...transactions].sort((a, b) => positiveSpend(b) - positiveSpend(a))[0] || null;
}

/** 商户名做归并键：商户缺失时退回商品名，都没有就当作无法归并。 */
function merchantKey(tx) {
  return (tx.merchant || tx.product || "").trim();
}

/** 按商户聚合，只保留能归并的交易。 */
function groupByMerchant(transactions) {
  return transactions.reduce((acc, tx) => {
    const key = merchantKey(tx);
    if (!key) return acc;
    if (!acc[key]) acc[key] = { amount: 0, count: 0, latest: null, category: tx.category || "uncategorized" };
    acc[key].amount += positiveSpend(tx);
    acc[key].count += 1;
    const paidAt = parseDate(tx.paid_at);
    if (!Number.isNaN(paidAt.getTime()) && (!acc[key].latest || paidAt > acc[key].latest)) acc[key].latest = paidAt;
    return acc;
  }, {});
}

/** 按自然日聚合支出，用于找出周期内花得最狠的一天。 */
function groupByDay(transactions) {
  return transactions.reduce((acc, tx) => {
    const paidAt = parseDate(tx.paid_at);
    if (Number.isNaN(paidAt.getTime())) return acc;
    const key = dateKey(paidAt);
    if (!acc[key]) acc[key] = { amount: 0, count: 0, date: startOfDay(paidAt) };
    acc[key].amount += positiveSpend(tx);
    acc[key].count += 1;
    return acc;
  }, {});
}

function averageConfidence(transactions) {
  if (!transactions.length) return 0;
  return Math.round((transactions.reduce((total, tx) => total + Number(tx.confidence || 0), 0) / transactions.length) * 100);
}

function formatMoney(value) {
  return currency.format(Number(value || 0));
}

function formatMoneyShort(value) {
  const amount = Number(value || 0);
  if (Math.abs(amount) >= 10000) return `${(amount / 10000).toFixed(1)}万`;
  return compactCurrency.format(amount);
}

function displayDate(value) {
  const d = parseDate(value);
  if (Number.isNaN(d.getTime())) return "--";
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function displayDateTime(value) {
  const d = parseDate(value);
  if (Number.isNaN(d.getTime())) return "--";
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function periodName(period = state.period) {
  if (period === "today") return "今日净支出";
  if (period === "week") return "本周累计支出";
  if (period === "month") return "本月累计支出";
  return "全部记录支出";
}

function periodLabel(period = state.period) {
  if (period === "today") return "今日";
  if (period === "week") return "本周";
  if (period === "month") return "本月";
  return "全部";
}

function consumptionAnalysisTitle(period = state.period) {
  if (period === "today") return "今日消费分析";
  if (period === "week") return "本周消费分析";
  if (period === "month") return "本月消费分析";
  return "整体消费分析";
}

// 快捷提问模板：文字随顶部选中的时段变化，避免提问时间词与所选时段语义不匹配。
const QUICK_PROMPT_TEMPLATES = {
  spend: {
    label: { today: "今日支出", week: "本周支出", month: "本月支出", all: "全部支出" },
    question: {
      today: "我今天花了多少钱？",
      week: "我本周花了多少钱？",
      month: "我本月花了多少钱？",
      all: "我一共花了多少钱？",
    },
  },
  largest: {
    question: {
      today: "今天最大的支出是什么？",
      week: "本周最大的支出是什么？",
      month: "本月最大的支出是什么？",
      all: "目前最大的一笔支出是什么？",
    },
  },
  analysis: {
    question: {
      today: "分析下我今天的消费情况",
      week: "分析下我本周的消费情况",
      month: "分析下我本月的消费情况",
      all: "分析下我目前整体的消费情况",
    },
  },
  takeout: {
    question: {
      today: "我今天外卖点得多吗？",
      week: "我本周外卖点得多吗？",
      month: "我本月外卖点得多吗？",
      all: "我最近外卖点得多吗？",
    },
  },
  budget: {
    question: {
      today: "今日预算使用率是多少？",
      week: "本周预算使用率是多少？",
      month: "本月预算使用率是多少？",
      all: "预算使用率是多少？",
    },
  },
};

function updateQuickPrompts(period = state.period) {
  const key = ["today", "week", "month"].includes(period) ? period : "all";
  document.querySelectorAll(".quick-prompts button").forEach((button) => {
    const template = QUICK_PROMPT_TEMPLATES[button.dataset.promptKey];
    if (!template) return;
    if (template.question[key]) button.dataset.question = template.question[key];
    if (template.label && template.label[key]) button.textContent = template.label[key];
  });
}

function categoryLabel(category) {
  return categoryNames[category] || category || "未分类";
}

function filterButton(category, options = {}) {
  const label = category === "all" ? "全部" : categoryLabel(category);
  const classes = ["ledger-filter-chip"];
  if (state.filter === category) classes.push("active");
  if (options.current) classes.push("current-extra");
  return `<button class="${classes.join(" ")}" data-filter="${escapeHtml(category)}" type="button" aria-pressed="${state.filter === category}">${escapeHtml(label)}</button>`;
}

function paymentLabel(app) {
  return paymentAppNames[app] || app || "未知渠道";
}

function evidenceSourceLabel(value) {
  const labels = {
    rule: "规则分类",
    llm: "Agent 分类",
    manual: "手动修正",
    legacy: "历史字段",
    none: "尚未分类",
  };
  return labels[value] || value || "未记录";
}

function evidenceField(label, value, { edited = false } = {}) {
  const mark = edited ? `<em class="evidence-edited" title="这个字段被人工校正过">已校正</em>` : "";
  return `<div class="evidence-field${edited ? " is-edited" : ""}"><span>${escapeHtml(label)}${mark}</span><strong>${escapeHtml(value ?? "未识别")}</strong></div>`;
}

/* --------------------- 解析字段的人工兜底编辑 --------------------- */

/** 与后端 EDITABLE_FIELDS 一一对应；改这里必须同步改 server.py。 */
const EVIDENCE_EDIT_FIELDS = [
  { name: "amount", label: "金额", type: "number", attrs: 'step="0.01" min="0.01" inputmode="decimal" required' },
  // step=1 保留秒：不带秒的话，光打开再保存就会把秒抹成 00，被记成一次「校正」。
  { name: "paid_at", label: "交易时间", type: "datetime-local", attrs: 'step="1" required' },
  { name: "merchant", label: "商户", type: "text", attrs: 'maxlength="60" placeholder="未识别"' },
  { name: "thing", label: "消费内容", type: "text", attrs: 'maxlength="40" placeholder="未识别"' },
  { name: "category", label: "分类", type: "select" },
  { name: "payment_app", label: "支付渠道", type: "select" },
  { name: "payment_method", label: "支付方式", type: "text", attrs: 'maxlength="30" placeholder="未识别"' },
  { name: "card_last4", label: "卡片尾号", type: "text", attrs: 'maxlength="4" inputmode="numeric" placeholder="4 位数字"' },
];

/** datetime-local 只认 `YYYY-MM-DDTHH:mm`，且必须是本地时间，不能直接塞 ISO 串。 */
function toLocalInputValue(value) {
  const date = parseDate(value);
  if (!date || Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function evidenceEditControl(field, tx) {
  const id = `evidenceEdit_${field.name}`;
  if (field.type === "select") {
    const options = field.name === "category" ? categoryNames : paymentAppNames;
    const current = tx[field.name] || "";
    const blank = field.name === "payment_app" ? `<option value="">未识别</option>` : "";
    const list = Object.entries(options)
      .map(([value, label]) => `<option value="${escapeHtml(value)}"${value === current ? " selected" : ""}>${escapeHtml(label)}</option>`)
      .join("");
    return `<select id="${id}" name="${field.name}">${blank}${list}</select>`;
  }
  const value = field.name === "paid_at" ? toLocalInputValue(tx.paid_at) : (tx[field.name] ?? "");
  return `<input id="${id}" name="${field.name}" type="${field.type}" value="${escapeHtml(String(value))}" ${field.attrs || ""} />`;
}

function parsedFieldsSection(payload, editing) {
  const tx = payload.transaction || {};
  const edited = new Set(payload.edited_fields || []);
  const canEdit = payload.editable !== false;

  if (!editing) {
    return `
      <div class="evidence-section-head">
        <h3 id="parsedHeading">解析字段</h3>
        ${canEdit ? `<button class="btn btn-quiet btn-sm" type="button" data-evidence-edit>校正</button>` : ""}
      </div>
      <div class="evidence-grid">
        ${evidenceField("金额", formatMoney(tx.amount), { edited: edited.has("amount") })}
        ${evidenceField("交易时间", displayDateTime(tx.paid_at), { edited: edited.has("paid_at") })}
        ${evidenceField("商户", tx.merchant || tx.platform, { edited: edited.has("merchant") })}
        ${evidenceField("消费内容", tx.thing || tx.product, { edited: edited.has("thing") })}
        ${evidenceField("分类", categoryLabel(tx.category), { edited: edited.has("category") })}
        ${evidenceField("支付渠道", paymentLabel(tx.payment_app), { edited: edited.has("payment_app") })}
        ${evidenceField("支付方式", tx.payment_method, { edited: edited.has("payment_method") })}
        ${evidenceField("卡片尾号", tx.card_last4 ? `•••• ${tx.card_last4}` : null, { edited: edited.has("card_last4") })}
      </div>
      ${edited.size ? `<p class="evidence-hint">有 ${edited.size} 个字段被人工校正过，重新解析这张截图时会保留。</p>` : ""}
    `;
  }

  return `
    <div class="evidence-section-head">
      <h3 id="parsedHeading">校正解析字段</h3>
    </div>
    <form class="evidence-edit-form" data-evidence-form novalidate>
      <div class="evidence-grid is-editing">
        ${EVIDENCE_EDIT_FIELDS.map((field) => `
          <label class="evidence-field" for="evidenceEdit_${field.name}">
            <span>${escapeHtml(field.label)}</span>
            ${evidenceEditControl(field, tx)}
          </label>
        `).join("")}
      </div>
      <p class="evidence-edit-error" data-evidence-error hidden></p>
      <div class="evidence-edit-actions">
        <span class="evidence-hint">${payload.image_url ? "对照左上角的原始截图核对。" : "这笔没有截图，改动只作用于这条记录。"}</span>
        <button class="btn btn-quiet btn-sm" type="button" data-evidence-cancel>取消</button>
        <button class="btn btn-primary btn-sm" type="submit">保存</button>
      </div>
    </form>
  `;
}

function categorySummary(transactions) {
  const top = topCategory(transactions);
  if (!top) return "暂无场景";
  return `${categoryLabel(top[0])} ${formatMoney(top[1].amount)}`;
}

function emptyState({ icon = "empty", title, hint = "", action = "" }) {
  return `
    <div class="empty-state">
      <span class="empty-state-icon" aria-hidden="true">${ICONS[icon] || ICONS.empty}</span>
      <strong>${escapeHtml(title)}</strong>
      ${hint ? `<span>${escapeHtml(hint)}</span>` : ""}
      ${action}
    </div>
  `;
}

function budgetLabel(mode = state.trendMode) {
  if (mode === "day") return "日预算";
  if (mode === "week") return "周预算";
  return "月预算";
}

/** 顶部周期 → 预算口径。「全部」没有对应预算。 */
function budgetKeyForPeriod(period = state.period) {
  if (period === "today") return "day";
  if (period === "week") return "week";
  if (period === "month") return "month";
  return null;
}

/** 顶部周期 → 趋势刻度。「全部」是历史累计，月度是最接近的粒度。 */
function trendModeForPeriod(period = state.period) {
  return budgetKeyForPeriod(period) || "month";
}

function trendModeTitle(mode = state.trendMode) {
  if (mode === "day") return "近7天每日支出";
  if (mode === "week") return "上月至今周度支出";
  return "本年月度支出";
}

function formatShortDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function weekEndFor(cursor) {
  const day = cursor.getDay() || 7;
  return addDays(cursor, 7 - day);
}

function trendSeries(mode = state.trendMode) {
  const anchor = startOfDay(getAnchorDate());

  if (mode === "day") {
    return Array.from({ length: 7 }, (_, index) => {
      const start = addDays(anchor, index - 6);
      const end = addDays(start, 1);
      return {
        label: formatShortDate(start),
        title: `${start.getMonth() + 1}月${start.getDate()}日`,
        amount: sumBetween(start, end),
        // 起止随序列一起带出去，明细格的「查看这段交易」要用它筛账本
        start,
        end,
        current: index === 6,
      };
    });
  }

  if (mode === "week") {
    const previousMonthStart = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1);
    const series = [];
    // 从「上月 1 号所在自然周的周一」一路展示到当前周。
    // 起止都遵循周一至周日的完整自然周口径，避免首周被月界硬切后，
    // 用不足 7 天的数据和完整周预算比较。
    let cursor = startOfWeek(previousMonthStart);

    while (cursor <= anchor) {
      const endDate = weekEndFor(cursor);
      const end = addDays(startOfDay(endDate), 1);
      series.push({
        // 跨了两个月，「第 N 周」是「哪个月的第 N 周」说不清，改用周起始日。
        // 完整区间在下方明细格和 tooltip 里给（title 字段），轴上只要能对上号。
        label: formatShortDate(cursor),
        title: `${formatShortDate(cursor)}-${formatShortDate(endDate)}`,
        amount: sumBetween(cursor, end),
        start: cursor,
        end,
      });
      cursor = end;
    }
    if (series.length) series[series.length - 1].current = true;
    return series;
  }

  const yearStart = new Date(anchor.getFullYear(), 0, 1);
  const series = [];
  for (let cursor = yearStart; cursor <= anchor; cursor = addMonths(cursor, 1)) {
    const end = addMonths(cursor, 1);
    series.push({
      label: `${cursor.getMonth() + 1}月`,
      title: `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`,
      amount: sumBetween(cursor, end),
      start: cursor,
      end,
    });
  }
  if (series.length) series[series.length - 1].current = true;
  return series;
}

function currentBudgetSpend(mode = state.trendMode) {
  const anchor = startOfDay(getAnchorDate());
  if (mode === "day") return sumBetween(anchor, addDays(anchor, 1));
  if (mode === "week") {
    const start = startOfWeek(anchor);
    return sumBetween(start, addDays(start, 7));
  }
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  return sumBetween(start, addMonths(start, 1));
}

function remainingBudgetDays(mode = state.trendMode) {
  const anchor = startOfDay(getAnchorDate());
  if (mode === "day") return 1;
  if (mode === "week") {
    const end = addDays(startOfWeek(anchor), 7);
    return Math.max(1, Math.ceil((end - anchor) / 86400000));
  }
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
  return Math.max(1, Math.ceil((end - anchor) / 86400000));
}

/** 当前周期已过去的天数，用于「日均支出」。 */
function elapsedDaysInPeriod(period = state.period) {
  const anchor = startOfDay(getAnchorDate());
  if (period === "today") return 1;
  if (period === "week") return Math.max(1, Math.round((anchor - startOfWeek(anchor)) / 86400000) + 1);
  if (period === "month") return Math.max(1, anchor.getDate());
  const dates = state.transactions
    .map((tx) => parseDate(tx.paid_at))
    .filter((date) => !Number.isNaN(date.getTime()));
  if (!dates.length) return 1;
  const earliest = startOfDay(new Date(Math.min(...dates)));
  return Math.max(1, Math.round((anchor - earliest) / 86400000) + 1);
}

/**
 * 环比基准。今日不和「昨天一整天」比（口径不对等），
 * 而是和最近 7 天（不含今天）的日均比；周/月则比较上一周期的同期区间，
 * 避免当前周期尚未结束时拿累计值和完整周期硬比。
 */
function comparisonBaseline(period = state.period) {
  const anchor = startOfDay(getAnchorDate());
  if (period === "today") {
    const total = sumBetween(addDays(anchor, -7), anchor);
    return { label: "较 7 日均值", value: total / 7 };
  }
  if (period === "week") {
    const start = startOfWeek(anchor);
    const elapsedDays = Math.max(1, Math.round((anchor - start) / 86400000) + 1);
    const previousStart = addDays(start, -7);
    return {
      label: "较上周同期",
      value: sumBetween(previousStart, addDays(previousStart, elapsedDays)),
    };
  }
  if (period === "month") {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const elapsedDays = Math.max(1, Math.round((anchor - start) / 86400000) + 1);
    const previousStart = addMonths(start, -1);
    const previousMonthDays = new Date(
      previousStart.getFullYear(),
      previousStart.getMonth() + 1,
      0,
    ).getDate();
    const comparableDays = Math.min(elapsedDays, previousMonthDays);
    return {
      label: "较上月同期",
      value: sumBetween(previousStart, addDays(previousStart, comparableDays)),
    };
  }
  return null;
}

function trendSubtitle(mode = state.trendMode) {
  if (mode === "day") return "近 7 天每日支出，虚线是日预算。";
  if (mode === "week") return "上月至今周度支出，虚线是周预算。";
  return "本年第一月到当前月，虚线是月预算。";
}

function annotateTrendSeries(series, mode = state.trendMode) {
  const budget = state.budgets[mode] || 0;
  const label = budgetLabel(mode);
  return series.map((item) => {
    const overBy = budget > 0 ? item.amount - budget : 0;
    return {
      ...item,
      budget,
      budgetLabel: label,
      overBudget: overBy > 0,
      overBy: Math.max(overBy, 0),
    };
  });
}

/** 把坐标轴上界收敛到 1/2/2.5/5 × 10ⁿ，避免出现 437 这种刻度。 */
function niceCeil(value) {
  if (!(value > 0)) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const normalized = value / base;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return step * base;
}

function trendChartSvg(series, mode) {
  const width = 760;
  const height = 300;
  const padding = { top: 22, right: 16, bottom: 34, left: 56 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const budget = state.budgets[mode] || 0;
  const rawMax = Math.max(...series.map((item) => item.amount), budget, 1);
  const topValue = niceCeil(rawMax * 1.08);
  const band = chartWidth / Math.max(series.length, 1);
  const colWidth = Math.min(band * 0.5, 30);
  const xFor = (index) => padding.left + band * index + band / 2;
  const yFor = (value) => padding.top + chartHeight - (clamp(value, 0, topValue) / topValue) * chartHeight;
  const baseY = padding.top + chartHeight;

  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = (topValue / 4) * index;
    const y = yFor(value);
    return `
      <line class="${index === 0 ? "trend-baseline" : "trend-grid-line"}" x1="${padding.left}" x2="${width - padding.right}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"></line>
      <text class="trend-axis-value" x="${padding.left - 10}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${formatMoneyShort(value)}</text>
    `;
  }).join("");

  const budgetY = yFor(budget);
  const budgetGuide = budget > 0
    ? `
      <line class="trend-budget-line" x1="${padding.left}" x2="${width - padding.right}" y1="${budgetY.toFixed(1)}" y2="${budgetY.toFixed(1)}"></line>
      <text class="trend-budget-text" x="${width - padding.right}" y="${Math.max(budgetY - 6, padding.top + 9).toFixed(1)}" text-anchor="end">${escapeHtml(budgetLabel(mode))} ${escapeHtml(formatMoneyShort(budget))}</text>
    `
    : "";

  const columns = series
    .map((point, index) => {
      const x = xFor(index);
      const y = yFor(point.amount);
      const barHeight = Math.max(baseY - y, point.amount > 0 ? 3 : 1);
      const classes = ["trend-col"];
      if (point.overBudget) classes.push("over-budget");
      if (point.current) classes.push("is-current");
      const description = `${point.title}，${formatMoney(point.amount)}${point.overBudget ? `，超出${point.budgetLabel}${formatMoney(point.overBy)}` : ""}`;
      return `
        <g class="trend-slot" data-trend-index="${index}" tabindex="0" role="button" aria-pressed="false" aria-label="${escapeHtml(description)}">
          <rect class="trend-hit-zone" data-trend-index="${index}" x="${(x - band / 2).toFixed(1)}" y="${padding.top}" width="${band.toFixed(1)}" height="${chartHeight}"></rect>
          <rect class="${classes.join(" ")}" data-trend-index="${index}" x="${(x - colWidth / 2).toFixed(1)}" y="${(baseY - barHeight).toFixed(1)}" width="${colWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="3"></rect>
        </g>
        <text class="trend-axis-label${point.current ? " is-current" : ""}" data-trend-index="${index}" x="${x.toFixed(1)}" y="${height - 12}" text-anchor="middle">${escapeHtml(point.label)}</text>
      `;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(trendModeTitle(mode))}">
      ${grid}
      ${budgetGuide}
      ${columns}
    </svg>
  `;
}

/**
 * 图表下方的逐期明细。刻意只给三件事：哪一期、花了多少、有没有超预算。
 * 合计 / 均值 / 峰值这类派生指标不放这儿，属于外围模块的事。
 * 每格是个真按钮：点一下会把上面对应的柱子点亮，所以不能是 <li> 纯文本。
 */
function renderTrendBreakdown(series, mode) {
  const budget = state.budgets[mode] || 0;

  $("trendBreakdown").innerHTML = series
    .map((item, index) => {
      const amount = Math.max(item.amount, 0);
      const note = budget <= 0 ? "未设预算" : item.overBudget ? `超出 ${formatMoney(item.overBy)}` : "未超预算";
      const classes = ["trend-cell"];
      if (item.overBudget) classes.push("is-over");
      if (item.current) classes.push("is-current");
      if (amount <= 0) classes.push("is-empty");

      // 格子本身已经是 button（承载点选高亮），箭头不能嵌在里面，
      // 只能并列成兄弟节点；选中/悬停的底色因此挂到外层 li 上。
      return `
        <li class="${classes.join(" ")}">
          <button
            class="trend-cell-body"
            type="button"
            data-trend-index="${index}"
            aria-pressed="false"
            aria-label="高亮 ${escapeHtml(item.title)} 对应的柱子，${escapeHtml(formatMoney(amount))}，${escapeHtml(note)}"
          >
            <span class="trend-cell-label">
              ${escapeHtml(item.title)}
              ${item.current ? '<em class="trend-cell-flag">当前</em>' : ""}
            </span>
            <strong class="trend-cell-amount">${escapeHtml(formatMoney(amount))}</strong>
            <small class="trend-cell-note">${escapeHtml(note)}</small>
          </button>
          <button
            class="trend-cell-jump"
            type="button"
            data-trend-jump="${index}"
            title="查看这段时间的交易"
            aria-label="查看 ${escapeHtml(item.title)} 的交易明细"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
          </button>
        </li>
      `;
    })
    .join("");
}

/** 当前那一期在序列里的下标（日刻度是最后一根；周/月同理）。 */
function currentTrendIndex() {
  const index = state.activeTrendSeries.findIndex((item) => item.current);
  return index >= 0 ? index : null;
}

/**
 * 点选联动：明细格和柱子是同一期数据的两种画法，选中一格另一边必须跟着亮。
 * 这是点击态，不是悬停态——鼠标扫过时依旧什么都不发生（上次去掉悬停联动的结论）。
 *
 * 总有一根柱子是选中的：取消（再点同一格 / 点空白处 / 传 null）一律落回当前那一期，
 * 而不是回到「什么都没选」——右栏永远在算某一期的数，图上就该有对应的高亮。
 *
 * 压暗其余柱子只在「看的不是当前期」时才开：那时才需要一眼定位点的是哪一根；
 * 默认停在当前期时图表保持全亮，趋势本身才读得出来。这条规则和「回到当前」
 * 按钮的显隐是同一个判据，两者同进同退。
 */
function setTrendSelection(index) {
  const fallback = currentTrendIndex();
  const toggled = index === null || index === state.trendSelected ? null : index;
  const next = toggled === null ? fallback : toggled;
  state.trendSelected = next;

  const atCurrent = next === null || next === fallback;
  const chart = $("trendChart");
  chart.classList.toggle("has-selection", !atCurrent);
  chart.querySelectorAll("[data-trend-index]").forEach((node) => {
    const active = Number(node.dataset.trendIndex) === next;
    node.classList.toggle("is-selected", active);
    if (node.classList.contains("trend-slot")) node.setAttribute("aria-pressed", active ? "true" : "false");
  });

  // 选中态挂在外层 li（整张卡变色），aria-pressed 挂在里面那个真按钮上
  $("trendBreakdown")
    .querySelectorAll(".trend-cell-body")
    .forEach((body) => {
      const active = Number(body.dataset.trendIndex) === next;
      body.closest(".trend-cell")?.classList.toggle("is-selected", active);
      body.setAttribute("aria-pressed", active ? "true" : "false");
    });

  // 右侧预算区是同一份选中态的第三种画法：柱子亮了，数字也要跟着换口径。
  renderTrendBudgetPanel();
  // 只有翻看别的一期才滚动，否则弹窗一打开就会在窄屏上自己动一下。
  if (!atCurrent) revealBudgetPanel();
}

/**
 * 窄屏下预算区被挤到图表下方，点了柱子却什么都看不见。
 * 只在它整块落在视口外时才滚，且用 nearest —— 已经看得见就不要动画面。
 */
function revealBudgetPanel() {
  const panel = $("trendBudgetPanel");
  if (!panel) return;
  const rect = panel.getBoundingClientRect();
  if (rect.top < window.innerHeight - 72 && rect.bottom > 0) return;
  panel.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "nearest" });
}

/** 数值换了才动一下，同一个值反复写不该闪。 */
function swapText(node, text) {
  if (!node) return;
  const next = String(text);
  if (node.textContent === next) return;
  node.textContent = next;
  if (prefersReducedMotion()) return;
  node.animate?.(
    [
      { opacity: 0, transform: "translateY(4px)" },
      { opacity: 1, transform: "none" },
    ],
    { duration: 200, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  );
}

function trendSpendLabel(mode = state.trendMode) {
  if (mode === "day") return "当日支出";
  if (mode === "week") return "当周支出";
  return "当月支出";
}

function trendScopeText(mode = state.trendMode) {
  if (mode === "day") return "今日";
  if (mode === "week") return "本周";
  return "本月";
}

/**
 * 预算区跟着选中的柱子走，数字一律取那根柱子的值——右栏和图上被高亮的那一期
 * 必须是同一个数（周刻度跨月时，序列里的当周和 currentBudgetSpend 本来就可能不等，
 * 以图表为准）。停在当前那一期是默认态，翻看别的一期才算「查看中」：
 * 玉色边框、「回到当前」按钮、底部那行换成实际支出，都用这个判据。
 *
 * 结余那一格的标题先判超支：超了一律「超出预算」，不分时态；没超再看时态，
 * 还在进行中的说「还能花」（用户此刻真正要问的是还能花多少），
 * 已经过去的那一期是既成事实，叫「结余」。时态本身由上方口径行的胶囊承担。
 * 底部那行也从「日均可用」换成那一期的实际支出——对已完成的区间来说，
 * 日均可用没有意义。
 */
function renderTrendBudgetPanel() {
  const mode = state.trendMode;
  const budget = state.budgets[mode] || 0;
  const index = state.trendSelected;
  const item = index === null ? null : state.activeTrendSeries[index] || null;
  // 停在当前那一期 = 默认态，它同时也是唯一还在进行中的那一期；
  // 翻看别的一期 = 查看中，那一期已经走完。
  const ongoing = item ? Boolean(item.current) : true;
  const inspecting = Boolean(item) && !ongoing;
  const spend = item ? Math.max(item.amount, 0) : currentBudgetSpend(mode);
  const hasBudget = budget > 0;
  const usage = hasBudget ? Math.round((spend / budget) * 100) : null;
  const remaining = budget - spend;
  const average = remaining / remainingBudgetDays(mode);

  $("trendBudgetPanel").classList.toggle("is-inspecting", inspecting);
  swapText($("trendBudgetScopeText"), inspecting ? item.title : trendScopeText(mode));
  swapText($("trendBudgetScopeState"), ongoing ? "进行中" : "已完成");
  $("trendBudgetReset").hidden = !inspecting;

  swapText($("trendBudgetLabel"), budgetLabel(mode));
  swapText($("trendBudgetValue"), formatMoney(budget));
  swapText($("trendBudgetPercent"), hasBudget ? `${usage}%` : "--");
  // 「结余 -¥265」是句病句：超了就直说超了多少，符号和标签不该互相打架。
  const over = hasBudget && remaining < 0;
  const restLabel = over ? "超出预算" : ongoing ? "还能花" : "结余";
  swapText($("trendBudgetRestLabel"), restLabel);
  swapText($("trendBudgetRemaining"), hasBudget ? formatMoney(Math.abs(remaining)) : "--");

  if (inspecting) {
    swapText($("trendBudgetAverageLabel"), trendSpendLabel(mode));
    swapText($("trendBudgetAverage"), formatMoney(spend));
  } else {
    swapText($("trendBudgetAverageLabel"), mode === "day" ? "计算口径" : "日均可用");
    swapText($("trendBudgetAverage"), mode === "day" ? "按今日消费计算" : formatMoney(average));
  }

  const progress = $("trendBudgetProgress");
  progress.style.setProperty("--meter-ratio", String(clamp(usage || 0, 0, 100) / 100));
  const meter = progress.closest(".meter");
  if (meter) meter.dataset.level = !hasBudget ? "ok" : usage > 100 ? "over" : usage >= 80 ? "warn" : "ok";
  $("trendBudgetRemaining").closest(".budget-rest")?.classList.toggle("is-negative", over);
}

function renderTrendModal() {
  const mode = state.trendMode;
  const series = annotateTrendSeries(trendSeries(mode), mode);
  state.activeTrendSeries = series;

  $("trendSubtitle").textContent = trendSubtitle(mode);
  $("trendChart").innerHTML = trendChartSvg(series, mode);
  renderTrendBreakdown(series, mode);
  // 换口径后同一个序号指的是另一段时间，选中态不能沿用；预算区也随之回到当前周期。
  state.trendSelected = null;
  setTrendSelection(null);

  document.querySelectorAll("[data-trend-mode]").forEach((button) => {
    const active = button.dataset.trendMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  });
}

function renderBudgetForm() {
  $("dayBudgetInput").value = state.budgets.day;
  $("weekBudgetInput").value = state.budgets.week;
  $("monthBudgetInput").value = state.budgets.month;
  clearBudgetError();
}

function clearBudgetError() {
  const error = $("budgetError");
  error.hidden = true;
  error.textContent = "";
  document.querySelectorAll("#budgetForm .field-control").forEach((node) => node.classList.remove("has-error"));
}

function saveBudgets(budgets) {
  state.budgets = budgets;
  localStorage.setItem(budgetStorageKey, JSON.stringify(budgets));
  if (!$("trendModal").hidden) renderTrendModal();
  renderHeroBudget();
}

/* ------------------------------- 弹窗 ------------------------------- */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
const modalReturnFocus = new Map();

function syncModalPageLock() {
  const hasOpenLayer = ["profileReportModal", "trendModal", "budgetModal", "syncModal", "evidenceDrawer"]
    .map($)
    .some((layer) => layer && !layer.hidden);
  document.body.classList.toggle("modal-open", hasOpenLayer);
}

function focusableIn(modal) {
  return Array.from(modal.querySelectorAll(FOCUSABLE)).filter((node) => node.offsetParent !== null || node === document.activeElement);
}

function openModal(id) {
  const modal = $(id);
  if (!modal || modal.classList.contains("modal-visible")) return;
  const shell = modal.querySelector(".modal-shell");
  transitionWatchers.get(shell)?.();
  modalReturnFocus.set(id, document.activeElement);
  modal.hidden = false;
  syncModalPageLock();
  if (id === "trendModal") renderTrendModal();
  if (id === "budgetModal") renderBudgetForm();
  if (id === "syncModal") resetSyncModal();
  if (id === "profileReportModal") loadProfileReportForModal();
  requestAnimationFrame(() => {
    modal.classList.add("modal-visible");
    if (id === "profileReportModal") {
      shell?.focus({ preventScroll: true });
    } else {
      const first = focusableIn(modal).find((node) => !node.classList.contains("modal-close")) || modal.querySelector(".modal-close");
      first?.focus({ preventScroll: true });
    }
  });
}

function closeModal(id) {
  const modal = $(id);
  if (!modal || modal.hidden) return;
  const shell = modal.querySelector(".modal-shell");
  afterTransition(shell, () => {
    if (modal.classList.contains("modal-visible")) return;
    modal.hidden = true;
    syncModalPageLock();
  }, { fallback: 300 });
  modal.classList.remove("modal-visible");
  $("trendTooltip").hidden = true;

  const trigger = modalReturnFocus.get(id);
  modalReturnFocus.delete(id);
  if (trigger && document.contains(trigger)) trigger.focus({ preventScroll: true });
}

function topmostOpenModal() {
  return ["profileReportModal", "budgetModal", "syncModal", "trendModal"].map($).find((modal) => modal && !modal.hidden) || null;
}

function topmostOpenLayer() {
  return [
    $("evidenceDrawer"),
    topmostOpenModal(),
    state.chatExpanded ? $("heroChat") : null,
  ].find((layer) => layer && !layer.hidden) || null;
}

function trapFocus(event) {
  if (event.key !== "Tab") return;
  const modal = topmostOpenLayer();
  if (!modal) return;
  const nodes = focusableIn(modal);
  if (!nodes.length) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (!modal.contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
  }
}

function renderEvidence(payload, { editing = false } = {}) {
  state.evidencePayload = payload;
  const tx = payload.transaction || {};
  const warnings = Array.isArray(payload.parse_warnings) ? payload.parse_warnings : [];
  $("evidenceStatus").textContent = tx.classification_status === "pending" ? "等待分类" : "证据完整";
  $("evidenceTitle").textContent = tx.merchant || tx.product || "未知商户";
  $("evidenceSubtitle").textContent = `${displayDate(tx.paid_at)} · ${formatMoney(tx.amount)}`;
  $("evidenceContent").innerHTML = `
    <section class="evidence-section" aria-labelledby="captureHeading">
      <h3 id="captureHeading">原始账单</h3>
      <div class="evidence-image-frame">
        ${payload.image_url
          ? `<img src="${escapeHtml(payload.image_url)}" alt="${escapeHtml(tx.merchant || "交易")}的原始账单截图" />`
          : `<div class="evidence-unavailable">这笔记录没有可用截图。交易字段仍可通过 OCR 文本核查。</div>`}
      </div>
    </section>
    <section class="evidence-section" aria-labelledby="parsedHeading" data-parsed-host>
      ${parsedFieldsSection(payload, editing)}
    </section>
    <section class="evidence-section" aria-labelledby="basisHeading">
      <h3 id="basisHeading">识别依据</h3>
      <div class="evidence-grid">
        ${evidenceField("OCR 解析可信度", Number.isFinite(Number(tx.confidence)) ? `${Math.round(Number(tx.confidence) * 100)}%` : null)}
        ${evidenceField("分类来源", evidenceSourceLabel(tx.classification_source))}
        ${evidenceField("分类可信度", Number(tx.classification_confidence) > 0 ? `${Math.round(Number(tx.classification_confidence) * 100)}%` : "未提供")}
        ${evidenceField("交易编号", tx.transaction_uid)}
      </div>
      ${warnings.length ? `<div class="evidence-error"><strong>解析提醒</strong>${warnings.map((warning) => `<div>${escapeHtml(warning)}</div>`).join("")}</div>` : `<div class="evidence-note">没有发现解析警告。分类只使用结构化字段，不会把原始 OCR 文本发送给 DeepSeek。</div>`}
    </section>
    <section class="evidence-section" aria-labelledby="ocrHeading">
      <h3 id="ocrHeading">OCR 原文</h3>
      <pre class="ocr-text">${escapeHtml(payload.ocr_text || "没有保存 OCR 文本。")}</pre>
    </section>
  `;
}

/** 只换「解析字段」这一段，不重绘整个抽屉，避免截图闪一下、滚动位置跳掉。 */
function setEvidenceEditing(editing) {
  const host = $("evidenceContent")?.querySelector("[data-parsed-host]");
  if (!host || !state.evidencePayload) return;
  state.evidenceEditing = editing;
  host.innerHTML = parsedFieldsSection(state.evidencePayload, editing);
  if (editing) host.querySelector("input, select")?.focus({ preventScroll: true });
  else host.querySelector("[data-evidence-edit]")?.focus({ preventScroll: true });
}

async function saveEvidenceEdits(form) {
  if (state.evidenceSaving) return;
  const uid = state.activeEvidenceUid;
  if (!uid) return;

  const data = new FormData(form);
  const fields = {};
  for (const { name } of EVIDENCE_EDIT_FIELDS) fields[name] = String(data.get(name) ?? "").trim();

  const errorNode = form.querySelector("[data-evidence-error]");
  const submit = form.querySelector('button[type="submit"]');
  const fail = (message) => {
    if (!errorNode) return;
    errorNode.textContent = message;
    errorNode.hidden = false;
  };
  if (errorNode) errorNode.hidden = true;

  // 服务端会再校验一遍，这里只是让明显的错误不用等一个来回。
  if (!fields.amount || !(Number(fields.amount) > 0)) return fail("金额要填一个大于 0 的数字。");
  if (!fields.paid_at) return fail("交易时间不能为空。");

  state.evidenceSaving = true;
  if (submit) {
    submit.disabled = true;
    submit.textContent = "保存中…";
  }
  try {
    const response = await fetch("./api/transaction-edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, fields }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.answer || `保存失败：HTTP ${response.status}`);
    if (state.activeEvidenceUid !== uid) return;

    renderEvidence(payload);
    state.evidenceEditing = false;

    // 金额和时间会改变每一个派生视图，重新拉一次快照最省心。
    await loadSnapshot();
    renderAll();
    if (!$("trendModal").hidden) renderTrendModal();
    window.refreshCfoMotion?.();
    const saved = (payload.saved_fields || []).length;
    if (!saved) showToast("没有需要保存的改动");
    else showToast(payload.persisted ? `已校正 ${saved} 个字段，重新解析这张截图时会保留` : `已校正 ${saved} 个字段`);
  } catch (error) {
    fail(recoveryMessage(error, "保存交易改动"));
  } finally {
    state.evidenceSaving = false;
    if (submit && submit.isConnected) {
      submit.disabled = false;
      submit.textContent = "保存";
    }
  }
}

async function openEvidence(transactionUid) {
  if (!transactionUid) return;
  state.activeEvidenceUid = transactionUid;
  state.evidencePayload = null;
  state.evidenceEditing = false;
  state.returnFocusElement = document.activeElement;
  const drawer = $("evidenceDrawer");
  transitionWatchers.get(drawer.querySelector(".evidence-drawer"))?.();
  const localTx = state.transactions.find((tx) => tx.transaction_uid === transactionUid);
  $("evidenceStatus").textContent = "交易证据";
  $("evidenceTitle").textContent = localTx?.merchant || localTx?.product || "正在载入";
  $("evidenceSubtitle").textContent = localTx ? `${displayDate(localTx.paid_at)} · ${formatMoney(localTx.amount)}` : "--";
  $("evidenceContent").innerHTML = `<div class="evidence-loading">正在读取本地截图、OCR 与解析记录…</div>`;
  drawer.hidden = false;
  syncModalPageLock();
  requestAnimationFrame(() => {
    drawer.classList.add("drawer-visible");
    drawer.querySelector('[role="dialog"]')?.focus({ preventScroll: true });
  });

  try {
    const response = await fetch(`./api/transaction-evidence?uid=${encodeURIComponent(transactionUid)}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.answer || `读取失败：HTTP ${response.status}`);
    if (state.activeEvidenceUid === transactionUid) renderEvidence(payload);
  } catch (error) {
    if (state.activeEvidenceUid !== transactionUid) return;
    $("evidenceContent").innerHTML = `<div class="evidence-error"><strong>无法读取这笔交易的证据</strong><span>${escapeHtml(recoveryMessage(error, "读取交易证据"))}</span></div>`;
  }
}

function closeEvidence() {
  const drawer = $("evidenceDrawer");
  if (!drawer || drawer.hidden) return;
  const panel = drawer.querySelector(".evidence-drawer");
  state.activeEvidenceUid = null;
  state.evidencePayload = null;
  state.evidenceEditing = false;
  afterTransition(panel, () => {
    if (drawer.classList.contains("drawer-visible")) return;
    drawer.hidden = true;
    syncModalPageLock();
  }, { fallback: 300 });
  drawer.classList.remove("drawer-visible");
  if (state.returnFocusElement instanceof HTMLElement) {
    state.returnFocusElement.focus({ preventScroll: true });
  }
}

/* ------------------------------- 轻提示 ------------------------------- */

function showToast(message, tone = "info") {
  const region = $("toastRegion");
  if (!region) return;
  const node = document.createElement("div");
  node.className = "toast";
  node.dataset.tone = tone;
  node.textContent = message;
  node.setAttribute("role", "button");
  node.setAttribute("tabindex", "0");
  node.setAttribute("aria-label", `${message}，点击关闭提示`);
  let autoDismissTimer = 0;
  const dismiss = ({ instant = false } = {}) => {
    window.clearTimeout(autoDismissTimer);
    if (instant || prefersReducedMotion()) {
      node.remove();
      return;
    }
    node.classList.add("is-leaving");
    afterTransition(node, () => node.remove(), { property: "opacity", fallback: 220 });
  };
  node.addEventListener("click", () => dismiss({ instant: true }));
  node.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    dismiss({ instant: true });
  });
  region.appendChild(node);
  autoDismissTimer = window.setTimeout(() => dismiss(), 4200);
}

function acknowledgeAgentStatus() {
  const dot = document.querySelector(".pulse-dot");
  if (!dot || prefersReducedMotion()) return;
  dot.classList.remove("is-acknowledging");
  requestAnimationFrame(() => {
    dot.classList.add("is-acknowledging");
    dot.addEventListener("animationend", () => dot.classList.remove("is-acknowledging"), { once: true });
  });
}

/* ------------------------------- 渲染 ------------------------------- */

function renderHeader() {
  const latest = state.transactions[0];

  $("headerSummary").textContent = latest
    ? `账本已同步 · ${state.transactions.length} 笔记录`
    : "账本还没有数据，可以先同步邮箱账单。";

  const eyebrow = document.querySelector(".agent-eyebrow");
  if (state.demo && eyebrow && !eyebrow.querySelector(".demo-badge")) {
    const badge = document.createElement("span");
    badge.className = "demo-badge";
    badge.textContent = "演示数据";
    eyebrow.appendChild(badge);
  }

  const generated = $("footerGenerated");
  if (generated) {
    generated.textContent = state.generatedAt ? `快照时间 ${displayDateTime(state.generatedAt)}` : "快照时间 --";
  }
}

function renderMetrics() {
  const selected = scopedTransactions(state.period);
  const selectedSpend = sum(selected);
  const maxTx = largest(selected);
  const selectedCategories = Object.keys(groupByCategory(selected));

  $("periodLabel").textContent = periodName();
  $("analysisTitle").textContent = consumptionAnalysisTitle();
  $("coreAmount").textContent = formatMoney(selectedSpend);
  $("primaryMeta").textContent = selected.length
    ? `${selected.length} 笔消费 · ${selectedCategories.length} 个场景 · 最高 ${categorySummary(selected)}`
    : "这个周期还没有记录到消费。";

  renderDelta(selectedSpend);

  // #coreNarrative 归 renderDecisionFeed 管：它要念出实际选中的那几条结论。
  // 「今日」时日均就等于头图那个数字，换成笔均，避免同一个值出现两次。
  const perTransaction = state.period === "today";
  $("avgSpendLabel").textContent = perTransaction ? "笔均支出" : "日均支出";
  $("avgDailySpend").textContent = selected.length
    ? formatMoney(perTransaction ? selectedSpend / selected.length : selectedSpend / elapsedDaysInPeriod())
    : "--";
  $("txnCount").textContent = `${selected.length} 笔`;
  $("largestSpend").textContent = maxTx ? formatMoney(maxTx.amount) : "--";
  $("confidenceScore").textContent = selected.length ? `${averageConfidence(selected)}%` : "--";
  $("signalMeta").textContent = `${periodLabel()} · ${selected.length} 笔样本`;

  const stateChip = $("analysisState");
  stateChip.textContent = selected.length ? "Active" : "Learning";
  stateChip.dataset.state = selected.length ? "active" : "idle";
}

function renderDelta(currentSpend) {
  const node = $("coreDelta");
  const baseline = comparisonBaseline();
  if (!baseline || !(baseline.value > 0)) {
    node.textContent = "";
    node.removeAttribute("data-trend");
    node.hidden = true;
    return;
  }
  const ratio = (currentSpend - baseline.value) / baseline.value;
  const percent = Math.round(Math.abs(ratio) * 100);
  const trend = percent < 2 ? "flat" : ratio > 0 ? "up" : "down";
  node.hidden = false;
  node.dataset.trend = trend;
  node.textContent = trend === "flat" ? `${baseline.label}持平` : `${baseline.label} ${ratio > 0 ? "+" : "−"}${percent}%`;
}

function renderHeroBudget() {
  const key = budgetKeyForPeriod();
  const label = $("heroBudgetLabel");
  const value = $("heroBudgetValue");
  const fill = $("heroBudgetFill");
  const meter = $("heroBudgetMeter");
  const foot = $("heroBudgetFoot");

  if (!key) {
    label.textContent = "预算口径";
    value.textContent = "不适用";
    fill.style.setProperty("--meter-ratio", "0");
    meter.setAttribute("aria-valuenow", "0");
    meter.dataset.level = "ok";
    foot.textContent = "「全部」是历史累计，没有对应的预算周期。";
    return;
  }

  const budget = state.budgets[key] || 0;
  const spend = sum(scopedTransactions(state.period));
  const usage = budget > 0 ? Math.round((spend / budget) * 100) : 0;
  const remaining = budget - spend;

  label.textContent = budgetLabel(key);
  value.textContent = `${formatMoney(spend)} / ${formatMoney(budget)}`;
  fill.style.setProperty("--meter-ratio", String(clamp(usage, 0, 100) / 100));
  meter.setAttribute("aria-valuenow", String(clamp(usage, 0, 100)));
  meter.setAttribute("aria-valuetext", `已用 ${usage}%`);
  meter.dataset.level = usage > 100 ? "over" : usage >= 80 ? "warn" : "ok";

  foot.innerHTML = budget > 0
    ? remaining >= 0
      ? `已用 <b>${usage}%</b>，还剩 <b>${escapeHtml(formatMoney(remaining))}</b>。`
      : `已超 <b>${escapeHtml(formatMoney(Math.abs(remaining)))}</b>，占预算 <b>${usage}%</b>。`
    : "还没设预算，去「预算」里填一个数就能看到进度。";
}

function renderHeroSpark() {
  const isProfile = state.period === "all";
  const trendContent = $("heroTrendContent");
  const profileContent = $("heroProfileContent");
  const button = $("heroSpark");
  trendContent.hidden = isProfile;
  profileContent.hidden = !isProfile;
  button.classList.toggle("is-profile", isProfile);
  // 画像卡比迷你趋势矮一大截，末行得改成弹性高度把剩下的空间吃掉，
  // 否则 space-between 会在预算块和画像卡之间留一片没有边界的空白。
  button.closest(".hero-figure")?.classList.toggle("has-profile", isProfile);

  if (isProfile) {
    const count = scopedTransactions("all").filter((tx) => positiveSpend(tx) > 0).length;
    $("heroProfileMeta").textContent = count
      ? `基于 ${count} 笔消费，生成专属账单画像`
      : "同步消费记录后，就能生成专属画像";
    $("heroProfileActionLabel").textContent = state.profileReport ? "查看画像" : "生成画像";
    button.setAttribute("aria-label", state.profileReport ? "查看账单人格报告" : "生成账单人格报告");
    return;
  }

  // 走势徽标是 App.jsx 里的静态图形，不吃数据，这里只负责说清这个按钮是干什么的。
  button.setAttribute("aria-label", "查看现金流趋势");
}

/* ------------------------------- 账单人格报告 ------------------------------- */

function clearProfileReportStageTimer() {
  if (state.profileReportStageTimer) window.clearInterval(state.profileReportStageTimer);
  state.profileReportStageTimer = null;
}

function setProfileReportBusy(busy) {
  state.profileReportBusy = busy;
  [$("refreshProfileReport"), $("updateProfileReport")].forEach((button) => {
    if (button) button.disabled = busy;
  });
}

function renderProfileReportLoading() {
  clearProfileReportStageTimer();
  $("profileReportNavigation").hidden = true;
  $("profileReportStale").hidden = true;
  $("refreshProfileReport").hidden = true;
  $("profileReportProgress").textContent = "正在生成";
  $("profileReportPages").innerHTML = `
    <section class="profile-report-state profile-report-loading" aria-label="正在生成账单人格报告">
      <span class="profile-loading-orbit" aria-hidden="true"><i></i><i></i><i></i></span>
      <h3>正在读懂你的消费轨迹</h3>
      <p>这次不只算钱，还要找出藏在账单里的生活节奏。</p>
      <ol class="profile-loading-stages">
        <li class="is-active">整理消费足迹</li>
        <li>提炼长期习惯</li>
        <li>命名消费人格</li>
      </ol>
    </section>
  `;
  let stage = 0;
  state.profileReportStageTimer = window.setInterval(() => {
    stage = Math.min(stage + 1, 2);
    document.querySelectorAll(".profile-loading-stages li").forEach((item, index) => {
      item.classList.toggle("is-active", index === stage);
      item.classList.toggle("is-done", index < stage);
    });
    if (stage === 2) clearProfileReportStageTimer();
  }, 1150);
}

function renderProfileReportError(message) {
  clearProfileReportStageTimer();
  $("profileReportNavigation").hidden = true;
  $("profileReportStale").hidden = true;
  $("refreshProfileReport").hidden = true;
  $("profileReportProgress").textContent = "生成未完成";
  $("profileReportPages").innerHTML = `
    <section class="profile-report-state profile-report-error" role="alert">
      <span class="profile-error-mark" aria-hidden="true">
        <svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="18"/><path d="M24 14v12M24 33v.5"/></svg>
      </span>
      <h3>这次画像没有整理好</h3>
      <p>${escapeHtml(message || "生成过程中遇到问题，请稍后再试。")}</p>
      <button class="btn btn-primary" type="button" data-profile-retry>重新生成</button>
    </section>
  `;
}

function profileCoverageLabel(coverage = {}) {
  const formatDateOnly = (value, fallback) => {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日` : fallback;
  };
  const start = formatDateOnly(coverage.start_date, "最早记录");
  const end = formatDateOnly(coverage.end_date, "现在");
  return `${start} — ${end}`;
}

function renderProfileReport(report) {
  if (!report) return;
  clearProfileReportStageTimer();
  state.profileReport = report;
  state.profileReportIndex = 0;
  const coverage = report.coverage || {};
  const traits = Array.isArray(report.persona?.traits) ? report.persona.traits : [];
  const tags = Array.isArray(report.tags) ? report.tags : [];
  const highlights = Array.isArray(report.highlights) ? report.highlights : [];
  const moments = Array.isArray(report.moments) ? report.moments : [];
  const wellbeing = report.wellbeing && typeof report.wellbeing === "object" ? report.wellbeing : null;
  const wellbeingSignals = Array.isArray(wellbeing?.signals) ? wellbeing.signals : [];
  const takeaways = Array.isArray(report.cfo?.takeaways) ? report.cfo.takeaways : [];
  const suggestions = Array.isArray(report.cfo?.suggestions) ? report.cfo.suggestions : [];
  const pages = [
    `
      <section class="profile-report-page profile-report-cover" data-profile-page="0" aria-label="报告封面">
        <div class="profile-cover-image" aria-hidden="true"></div>
        <div class="profile-cover-content">
          <span class="profile-cover-rule" aria-hidden="true"></span>
          <h3>你的消费人格<br>已经被账本写出来了</h3>
          <p>${escapeHtml(profileCoverageLabel(coverage))}</p>
          <div class="profile-cover-stats">
            <span><b>${escapeHtml(String(coverage.transaction_count || 0))}</b> 笔消费</span>
            <span><b>${escapeHtml(formatMoney(coverage.total_outflow_cny || 0))}</b> 累计支出</span>
            <span><b>${escapeHtml(String(coverage.active_days || 0))}</b> 个活跃日</span>
          </div>
        </div>
      </section>
    `,
    `
      <section class="profile-report-page profile-persona-page" data-profile-page="1" aria-label="消费人格">
        <div class="profile-persona-seal" aria-hidden="true"><span></span><i></i></div>
        <div class="profile-persona-copy">
          <p>如果消费习惯是一种生活流派，你属于</p>
          <h3>${escapeHtml(report.persona?.title || "待命名的生活玩家")}</h3>
          <strong>${escapeHtml(report.persona?.subtitle || "")}</strong>
          <p class="profile-persona-intro">${escapeHtml(report.persona?.intro || report.persona?.summary || "")}</p>
          <ul class="profile-persona-points">
            ${traits.map((trait) => `
              <li>
                <span aria-hidden="true">${escapeHtml(trait.emoji)}</span>
                <div><b>${escapeHtml(trait.label)}</b><p>${escapeHtml(trait.text)}</p></div>
                <small>${escapeHtml(trait.evidence)}</small>
              </li>
            `).join("")}
          </ul>
        </div>
      </section>
    `,
    `
      <section class="profile-report-page profile-tags-page" data-profile-page="2" aria-label="人格标签">
        <div class="profile-page-heading">
          <h3>账单给你的生活贴了这些标签</h3>
          <p>不是印象判断，每一条都能在流水里找到来处。</p>
        </div>
        <div class="profile-tag-list">
          ${tags.map((tag, index) => `
            <article class="profile-tag-row">
              <span aria-hidden="true">${escapeHtml(tag.emoji || String(index + 1).padStart(2, "0"))}</span>
              <div><h4>${escapeHtml(tag.label)}</h4><p>${escapeHtml(tag.reason)}</p></div>
              <small>${escapeHtml(tag.evidence)}</small>
            </article>
          `).join("")}
        </div>
      </section>
    `,
    `
      <section class="profile-report-page profile-highlights-page" data-profile-page="3" aria-label="关键数字">
        <div class="profile-page-heading">
          <h3>三个数字，拼出你的消费节奏</h3>
          <p>总额之外，更能说明习惯的往往是频次、偏好与反复出现的选择。</p>
        </div>
        <div class="profile-highlight-list">
          ${highlights.map((item) => `
            <article class="profile-highlight-item">
              <span class="profile-highlight-emoji" aria-hidden="true">${escapeHtml(item.emoji || "")}</span>
              <strong>${escapeHtml(item.value)}</strong>
              <h4>${escapeHtml(item.label)}</h4>
              <p>${escapeHtml(item.context)}</p>
            </article>
          `).join("")}
        </div>
      </section>
    `,
    `
      <section class="profile-report-page profile-moments-page" data-profile-page="4" aria-label="账单名场面">
        <div class="profile-page-heading">
          <h3>账单里的几个名场面</h3>
          <p>某些选择只出现一次，某些习惯却一直在提醒你：这很像你。</p>
        </div>
        <div class="profile-moment-list">
          ${moments.map((moment) => `
            <article class="profile-moment-row">
              <div>
                <h4><span aria-hidden="true">${escapeHtml(moment.emoji || "")}</span>${escapeHtml(moment.title)}</h4>
                <ul>${(moment.lines || (moment.detail ? [moment.detail] : [])).map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
              </div>
              <small>${escapeHtml(moment.evidence)}</small>
            </article>
          `).join("")}
        </div>
      </section>
    `,
    wellbeing ? `
      <section class="profile-report-page profile-wellbeing-page" data-profile-page="5" aria-label="生活健康画像">
        <div class="profile-page-heading">
          <h3>消费时间里，藏着怎样的生活节奏</h3>
          <p>把餐饮付款时段和食物类型放在一起看，试着还原你的作息与饮食习惯。</p>
        </div>
        <div class="profile-wellbeing-layout">
          <div class="profile-wellbeing-overview">
            <span class="profile-wellbeing-confidence" data-confidence="${escapeHtml(wellbeing.confidence || "低")}">
              推测可信度 ${escapeHtml(wellbeing.confidence || "低")}
            </span>
            <h4>${escapeHtml(wellbeing.headline || "账单正在积累生活线索")}</h4>
            <p>${escapeHtml(wellbeing.summary || "目前的付款记录还不足以形成稳定判断。")}</p>
            <div class="profile-wellbeing-reminder">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.2c4.8-2.7 7.4-6.3 7.4-10.2A4.2 4.2 0 0 0 12 7.2 4.2 4.2 0 0 0 4.6 10c0 3.9 2.6 7.5 7.4 10.2Z"/><path d="M12 7.2v8.4M8.8 11.8 12 15l3.2-3.2"/></svg>
              <div><strong>生活提醒</strong><p>${escapeHtml(wellbeing.reminder || "继续记录，等生活节奏更清晰后再判断。")}</p></div>
            </div>
          </div>
          <ol class="profile-wellbeing-signals">
            ${wellbeingSignals.map((signal) => `
              <li>
                <div class="profile-wellbeing-signal-head">
                  <h4>${escapeHtml(signal.label)}</h4>
                  <span>可信度 ${escapeHtml(signal.confidence || "低")}</span>
                </div>
                <p>${escapeHtml(signal.inference)}</p>
                <small>${escapeHtml(signal.evidence)}</small>
              </li>
            `).join("")}
          </ol>
        </div>
        <p class="profile-wellbeing-disclaimer">${escapeHtml(wellbeing.disclaimer || "付款记录只能提供生活线索，不能替代真实饮食和作息记录。")}</p>
      </section>
    ` : "",
    `
      <section class="profile-report-page profile-cfo-page" data-profile-page="6" aria-label="CFO 总结">
        <div class="profile-cfo-mark" aria-hidden="true"><span>CFO</span></div>
        <div class="profile-cfo-copy">
          <h3>最后，让 CFO 说句实在话</h3>
          <p class="profile-cfo-headline">${escapeHtml(report.cfo?.headline || report.cfo?.verdict || "")}</p>
          <div class="profile-cfo-takeaways">
            ${takeaways.map((item) => `
              <article>
                <span aria-hidden="true">${escapeHtml(item.emoji || "")}</span>
                <div><b>${escapeHtml(item.label)}</b><p>${escapeHtml(item.text)}</p></div>
              </article>
            `).join("")}
          </div>
          <div class="profile-cfo-next">
            <strong>接下来，可以这样做</strong>
            <ul>${suggestions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          </div>
          <button class="profile-cfo-ask" type="button" data-profile-ask>
            让 CFO 继续解读
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" /></svg>
          </button>
        </div>
      </section>
    `,
  ].filter(Boolean);

  state.profileReportPageCount = pages.length;
  $("profileReportPages").innerHTML = pages.join("");
  $("profileReportDots").innerHTML = pages.map((_, index) => `
    <button type="button" role="tab" data-profile-index="${index}" aria-label="查看报告第 ${index + 1} 页" aria-selected="${index === 0 ? "true" : "false"}"></button>
  `).join("");
  $("profileReportNavigation").hidden = false;
  $("refreshProfileReport").hidden = false;
  $("profileReportStale").hidden = !state.profileReportStale;
  renderHeroSpark();
  requestAnimationFrame(() => setProfileReportIndex(0, "auto"));
}

function setProfileReportIndex(index, behavior = "smooth") {
  const viewport = $("profileReportViewport");
  const count = state.profileReportPageCount;
  if (!viewport || !count) return;
  const next = clamp(Number(index) || 0, 0, count - 1);
  state.profileReportIndex = next;
  viewport.scrollTo({ left: viewport.clientWidth * next, top: 0, behavior: prefersReducedMotion() ? "auto" : behavior });
  $("profileReportProgress").textContent = `${next + 1} / ${count}`;
  $("profileReportPrev").disabled = next === 0;
  $("profileReportNext").disabled = next === count - 1;
  $("profileReportDots").querySelectorAll("button").forEach((button, buttonIndex) => {
    const active = buttonIndex === next;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
}

async function fetchProfileReportMetadata() {
  const response = await fetch("./api/profile-report", { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.answer || `画像读取失败：HTTP ${response.status}`);
  state.profileReport = payload.has_report ? payload.report : null;
  state.profileReportStale = Boolean(payload.stale);
  if (state.period === "all") renderHeroSpark();
  return payload;
}

async function generateProfileReport(force = false) {
  if (state.profileReportBusy) return;
  setProfileReportBusy(true);
  renderProfileReportLoading();
  try {
    const response = await fetch("./api/profile-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.answer || `生成失败：HTTP ${response.status}`);
    state.profileReport = payload.report;
    state.profileReportStale = false;
    renderProfileReport(payload.report);
  } catch (error) {
    if (state.profileReport) {
      renderProfileReport(state.profileReport);
      showToast(`画像更新失败：${error.message}`, "error");
    } else {
      renderProfileReportError(error.message);
    }
  } finally {
    setProfileReportBusy(false);
  }
}

async function loadProfileReportForModal() {
  if (state.profileReportBusy) return;
  if (state.profileReport) renderProfileReport(state.profileReport);
  try {
    const payload = await fetchProfileReportMetadata();
    if (payload.has_report) {
      renderProfileReport(payload.report);
      return;
    }
    await generateProfileReport(false);
  } catch (error) {
    if (!state.profileReport) renderProfileReportError(error.message);
  }
}

function askFromProfileReport() {
  if (!state.profileReport || state.chatBusy) {
    if (state.chatBusy) showToast("上一个问题还在回答，等它结束再继续。", "info");
    return;
  }
  const report = state.profileReport;
  const labels = (report.tags || []).map((tag) => tag.label).join("、");
  const wellbeing = report.wellbeing?.headline ? `生活健康画像提示“${report.wellbeing.headline}”。` : "";
  const question = `请继续解读我的账单人格报告：消费人格是“${report.persona?.title || ""}”，标签包括${labels}。${wellbeing}结合全部账本，告诉我最值得肯定、最值得调整的消费习惯，并简短补充一条生活健康提醒。`;
  closeModal("profileReportModal");
  window.setTimeout(() => {
    openChatExpanded();
    submitQuestion(question);
  }, prefersReducedMotion() ? 20 : 280);
}

function renderComposition() {
  const selected = scopedTransactions(state.period);
  const grouped = groupByCategory(selected);
  const entries = Object.entries(grouped).sort((a, b) => b[1].amount - a[1].amount);
  const total = entries.reduce((acc, [, value]) => acc + value.amount, 0);

  $("categoryCount").textContent = entries.length ? `${entries.length} 类 · 按金额` : "--";

  if (!entries.length || total <= 0) {
    $("coreNodes").classList.remove("has-data");
    $("coreNodes").innerHTML = emptyState({
      icon: "spark",
      title: "还没有可拆解的消费",
      hint: "同步账单或换一个周期，场景权重会自动出现。",
    });
    return;
  }
  $("coreNodes").classList.add("has-data");

  const top = entries.slice(0, 6);
  const restAmount = entries.slice(6).reduce((acc, [, value]) => acc + value.amount, 0);
  const segments = top.map(([key, value]) => ({
    key,
    label: categoryLabel(key),
    amount: value.amount,
    color: categoryColor(key),
  }));
  if (restAmount > 0) segments.push({ key: "__rest", label: "其他", amount: restAmount, color: "var(--cat-8)" });

  $("coreNodes").innerHTML = `
    <div class="composition-bar" role="img" aria-label="${escapeHtml(segments.map((seg) => `${seg.label} ${Math.round((seg.amount / total) * 100)}%`).join("，"))}">
      ${segments
        .map(
          (seg) =>
            `<span class="composition-seg" style="--segment-weight:${seg.amount.toFixed(2)};--seg-color:${seg.color}"></span>`,
        )
        .join("")}
    </div>
    <ul class="composition-legend">
      ${segments
        .map(
          (seg) => `
            <li>
              <span class="legend-dot" style="--seg-color:${seg.color}" aria-hidden="true"></span>
              ${escapeHtml(seg.label)}
              <b>${Math.round((seg.amount / total) * 100)}%</b>
            </li>
          `,
        )
        .join("")}
    </ul>
  `;
}

/** 周期的完整天数，用于把「已花的钱」按节奏推到周期末。 */
function periodTotalDays(period = state.period) {
  const anchor = startOfDay(getAnchorDate());
  if (period === "week") return 7;
  if (period === "month") return new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
  return elapsedDaysInPeriod(period);
}

function shortChineseDate(date) {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/**
 * 「全部」这个周期词直接塞进句子里不通顺（"全部出现了 12 次"、"占了全部的 24%"），
 * 所以按用途分两套说法：when 用于时间状语，scope 用于「占某某支出」。
 */
function periodPhrase(kind, period = state.period) {
  const isAll = !["today", "week", "month"].includes(period);
  if (kind === "scope") return isAll ? "全部支出" : `${periodLabel(period)}支出`;
  return isAll ? "累计" : periodLabel(period);
}

/**
 * 分析卡片的候选池。一条结论要进池子，必须同时满足：
 *   1. 说的是别处没说过的事——首屏已经给了总额、环比、预算进度和最大单笔金额，
 *      这里再复述一遍就是浪费一整块面积；
 *   2. 带一个能被核对的数字；
 *   3. 至少有一条去处：能筛出对应明细、能打开原始证据，或者能直接把问题甩给 Agent。
 * 最后按 weight 取前三条。之前是固定三格，样本不够时只能填「继续观察即可」这种
 * 没有信息量的占位话；现在宁可换一条真有内容的结论上来。
 */
function buildDecisionCandidates() {
  const selected = scopedTransactions(state.period);
  const selectedSpend = sum(selected);
  const label = periodLabel();
  const candidates = [];

  // — 支出集中：占比之外，还给出和第二名的差额，才知道「集中」到什么程度 —
  const categoryEntries = Object.entries(groupByCategory(selected)).sort((a, b) => b[1].amount - a[1].amount);
  const [top, second] = categoryEntries;
  if (top && selectedSpend > 0) {
    const share = Math.round((top[1].amount / selectedSpend) * 100);
    candidates.push({
      weight: share >= 55 ? 82 : share >= 40 ? 66 : share >= 30 ? 52 : 34,
      type: "支出集中",
      tone: share >= 55 ? "warn" : "normal",
      title: `${categoryLabel(top[0])}占了${periodPhrase("scope")}的 ${share}%`,
      copy: second
        ? `${top[1].count} 笔合计 ${formatMoney(top[1].amount)}，比第二位的${categoryLabel(second[0])}多 ${formatMoney(top[1].amount - second[1].amount)}。`
        : `${top[1].count} 笔合计 ${formatMoney(top[1].amount)}，目前所有消费都落在这一类。`,
      actions: [
        { kind: "ledger", text: `看这 ${top[1].count} 笔`, category: top[0] },
        {
          kind: "ask",
          text: "让 Agent 拆开",
          // 气泡左侧已经有一枚周期标签，问题开头再写一遍「本月」会读成结巴。
          question: `${categoryLabel(top[0])}${periodPhrase("when")}一共 ${top[1].count} 笔、合计 ${formatMoney(top[1].amount)}。帮我逐笔拆一下都花在哪，并指出其中哪几笔属于可以砍掉的开销。`,
        },
      ],
    });
  }

  // — 重复商户：全站只有这里看得到「同一家店来了几次」 —
  const repeat = Object.entries(groupByMerchant(selected))
    .filter(([, info]) => info.count >= 2)
    .sort((a, b) => b[1].count - a[1].count || b[1].amount - a[1].amount)[0];
  if (repeat) {
    const [name, info] = repeat;
    candidates.push({
      weight: info.count >= 4 ? 76 : info.count === 3 ? 62 : 48,
      type: "重复消费",
      tone: info.count >= 4 ? "warn" : "normal",
      title: `${name}${periodPhrase("when")}出现了 ${info.count} 次`,
      copy: `合计 ${formatMoney(info.amount)}，平均每次 ${formatMoney(info.amount / info.count)}${info.latest ? `，最近一次 ${shortChineseDate(info.latest)}` : ""}。`,
      actions: [
        { kind: "ledger", text: `看这 ${info.count} 笔`, category: info.category, merchant: name },
        {
          kind: "ask",
          text: "问问值不值",
          question: `我在「${name}」${periodPhrase("when")}消费了 ${info.count} 次、合计 ${formatMoney(info.amount)}。这个频率算高吗？按这个节奏一个月大概要花多少，有没有更省的替代方案？`,
        },
      ],
    });
  }

  // — 预算推演：首屏给的是「已用多少」，这里给的是「照这样下去会怎样」 —
  const budgetKey = budgetKeyForPeriod();
  const budget = budgetKey ? state.budgets[budgetKey] || 0 : 0;
  if (budget > 0 && selectedSpend > 0 && ["week", "month"].includes(state.period)) {
    const elapsed = elapsedDaysInPeriod();
    const totalDays = periodTotalDays();
    const daily = selectedSpend / elapsed;
    const projected = daily * totalDays;
    const overBy = projected - budget;
    const remainingDays = Math.max(totalDays - elapsed, 0);
    const safeDaily = remainingDays > 0 ? Math.max(budget - selectedSpend, 0) / remainingDays : 0;
    candidates.push({
      weight: overBy > 0 ? 88 : 44,
      type: "预算推演",
      tone: overBy > 0 ? "warn" : "good",
      title: overBy > 0 ? `照这个节奏，${label}会超预算 ${formatMoney(overBy)}` : `照这个节奏，${label}能守住预算`,
      copy: `前 ${elapsed} 天日均 ${formatMoney(daily)}，推到${label}末约 ${formatMoney(projected)}，预算 ${formatMoney(budget)}。${
        remainingDays > 0
          ? overBy > 0
            ? `剩下 ${remainingDays} 天要压到日均 ${formatMoney(safeDaily)} 以内才守得住。`
            : `剩下 ${remainingDays} 天日均还有 ${formatMoney(safeDaily)} 的空间。`
          : ""
      }`,
      actions: [
        { kind: "trend", text: "打开趋势图", mode: budgetKey },
        {
          kind: "ask",
          text: "问怎么收",
          question: `我${label}已经花了 ${formatMoney(selectedSpend)}，预算是 ${formatMoney(budget)}，还剩 ${remainingDays} 天。帮我判断会不会超支，如果要守住预算，具体该从哪几类消费里省。`,
        },
      ],
    });
  }

  // — 单日峰值：哪天花得反常，只有按天聚合才看得出来 —
  if (state.period !== "today") {
    const days = Object.values(groupByDay(selected)).sort((a, b) => b.amount - a.amount);
    const peak = days[0];
    // 均值只按「有消费的天」算，否则周末不花钱会把基准压低，天天都成峰值。
    const activeAverage = days.length ? selectedSpend / days.length : 0;
    if (days.length >= 3 && peak && peak.amount > 0 && peak.amount >= activeAverage * 1.8) {
      candidates.push({
        weight: 64,
        type: "单日峰值",
        tone: "normal",
        title: `${shortChineseDate(peak.date)}一天就花了 ${formatMoney(peak.amount)}`,
        copy: `当天 ${peak.count} 笔，是有消费那几天平均值的 ${(peak.amount / activeAverage).toFixed(1)} 倍。`,
        actions: [
          { kind: "trend", text: "打开趋势图", mode: "day" },
          {
            kind: "ask",
            text: "问那天怎么了",
            question: `${shortChineseDate(peak.date)}这一天我花了 ${formatMoney(peak.amount)}、共 ${peak.count} 笔，明显高于平时。帮我看看那天的钱具体花在哪，是一次性支出还是有异常。`,
          },
        ],
      });
    }
  }

  // — 待核实：解析不确定的账，越早核对越省事 —
  // 除了 OCR 解析置信低，分类环节「勉强给了个答案」的也算：
  // deepseek_low 是模型低分命中，local_industry 是靠行业词猜的，
  // unresolved 是重试到上限也没结论。这些都比「识别中」强，但值得人扫一眼。
  const WEAK_CLASSIFICATION = new Set(["deepseek_low", "local_industry", "unresolved"]);
  // 人工在证据面板核对过就不再提示：解析置信低只说明机器没把握，
  // 人对着截图确认过之后，这笔的不确定性就已经消掉了。
  const unsure = selected
    .filter(
      (tx) =>
        !tx.reviewed_at &&
        (tx.classification_status === "pending" ||
          Number(tx.confidence || 0) < 0.6 ||
          WEAK_CLASSIFICATION.has(tx.classification_source)),
    )
    .sort((a, b) => positiveSpend(b) - positiveSpend(a));
  if (unsure.length) {
    const unsureSpend = unsure.reduce((total, tx) => total + positiveSpend(tx), 0);
    candidates.push({
      weight: 70 + Math.min(unsure.length, 8),
      type: "待核实",
      tone: "warn",
      title: `${unsure.length} 笔的解析结果还不确定`,
      copy: `合计 ${formatMoney(unsureSpend)}，分类或金额可能不准，建议对着原始截图核一遍。`,
      actions: [
        { kind: "evidence", text: "去核对", uid: unsure[0].transaction_uid || "" },
        {
          kind: "ask",
          text: "让 Agent 复核",
          question: `账本里有 ${unsure.length} 笔消费的解析置信度偏低、合计 ${formatMoney(unsureSpend)}。帮我把这几笔列出来，说明每一笔的分类依据，并指出最可能分错的是哪一笔。`,
        },
      ],
    });
  }

  // — 最大单笔：兜底项，同时也是最直接的一条追溯入口 —
  const maxTx = largest(selected);
  if (maxTx) {
    const name = merchantKey(maxTx) || "未知商户";
    const share = selectedSpend > 0 ? Math.round((positiveSpend(maxTx) / selectedSpend) * 100) : 0;
    candidates.push({
      weight: share >= 40 ? 72 : share >= 25 ? 56 : 30,
      type: "最大单笔",
      tone: "normal",
      title: `${name} · ${formatMoney(maxTx.amount)}`,
      copy: `${share > 0 ? `占${periodPhrase("scope")} ${share}%，` : ""}${paymentLabel(maxTx.payment_app)}支付于 ${displayDate(maxTx.paid_at)}。`,
      actions: [
        { kind: "evidence", text: "看原始证据", uid: maxTx.transaction_uid || "" },
        {
          kind: "ask",
          text: "这笔正常吗",
          question: `「${name}」这笔 ${formatMoney(maxTx.amount)} 是${periodPhrase("scope")}里最大的一笔。帮我核对它的分类和消费内容对不对，并判断这类支出多久出现一次算正常。`,
        },
      ],
    });
  }

  // — 兜底：候选不足三条时，至少留一个明确的追问入口，而不是空着半块面板 —
  candidates.push({
    weight: 5,
    type: "样本太少",
    tone: "normal",
    title: `${periodPhrase("when")}记录了 ${selected.length} 笔消费`,
    copy: "样本还不算多，可以让 Agent 直接把这些消费按金额排一遍，先建立一个基线。",
    actions: [
      { kind: "ledger", text: "看全部明细", category: "all" },
      {
        kind: "ask",
        text: "让 Agent 排个序",
        question: `把这个周期里的每一笔消费按金额从高到低列出来，标注商户、分类和支付渠道，最后告诉我哪几笔最值得关注。`,
      },
    ],
  });

  return candidates;
}

function buildDecisionItems() {
  return buildDecisionCandidates()
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);
}

const DECISION_ACTION_ICONS = {
  ledger: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h9"/></svg>`,
  evidence: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.5h8L18 9v10.5H6z"/><path d="M13.5 4.5V9H18"/></svg>`,
  trend: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16.5 9 11l3.4 3.2L20 6.5"/><path d="M15.4 6.5H20V11"/></svg>`,
  ask: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.2a2.3 2.3 0 0 1-2.3 2.3H8.5L4 21V6.3A2.3 2.3 0 0 1 6.3 4h11.4A2.3 2.3 0 0 1 20 6.3z"/></svg>`,
};

function decisionActionButton(action) {
  const attributes = [
    `type="button"`,
    `class="decision-action${action.kind === "ask" ? " is-ask" : ""}"`,
    `data-decision-action="${escapeHtml(action.kind)}"`,
  ];
  if (action.category) attributes.push(`data-category="${escapeHtml(action.category)}"`);
  if (action.merchant) attributes.push(`data-merchant="${escapeHtml(action.merchant)}"`);
  if (action.uid) attributes.push(`data-uid="${escapeHtml(action.uid)}"`);
  if (action.mode) attributes.push(`data-mode="${escapeHtml(action.mode)}"`);
  if (action.question) attributes.push(`data-question="${escapeHtml(action.question)}"`);
  return `<button ${attributes.join(" ")}>${DECISION_ACTION_ICONS[action.kind] || ""}<span>${escapeHtml(action.text)}</span></button>`;
}

/**
 * 「关键观察」的导语。它得念出这一屏真正算出了什么——
 * 读了多少笔、落在几个场景、最后挑中的是哪三条结论。
 * 写死一句「下面是最值得处理的三条」等于没说：换周期、换数据它都不动，
 * 而下面那三张卡是会变的。
 */
function renderSectionNarrative(items) {
  const node = $("coreNarrative");
  const selected = scopedTransactions(state.period);

  if (!selected.length) {
    node.textContent = `${periodLabel()}还没有消费记录，换个周期，或者同步一次邮箱账单。`;
    return;
  }

  const scenes = Object.keys(groupByCategory(selected)).length;
  const types = items.map((item) => item.type);
  // 量词跟着下面那块面板的名字走：面板叫「…消费分析」（consumptionAnalysisTitle），
  // 这里就说「N 条消费分析」，指向明确。用「类」会和右侧「支出去向 13 类」撞词义。
  node.textContent = `${periodPhrase("when")} ${selected.length} 笔消费散在 ${scenes} 个场景里，优先处理 ${types.length} 条消费分析：${types.join(" · ")}。`;
}

function renderDecisionFeed() {
  const selected = scopedTransactions(state.period);
  if (!selected.length) {
    renderSectionNarrative([]);
    $("decisionFeed").innerHTML = emptyState({
      icon: "alert",
      title: `${periodLabel()}还没有消费记录`,
      hint: "换一个周期，或者同步一次邮箱账单，Agent 就会开始给结论。",
    });
    return;
  }

  const items = buildDecisionItems();
  renderSectionNarrative(items);

  $("decisionFeed").innerHTML = items
    .map(
      (item) => `
      <div class="decision-item${item.tone === "warn" ? " warn" : item.tone === "good" ? " good" : ""}">
        <span class="decision-type">${escapeHtml(item.type)}</span>
        <div class="decision-copy">
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.copy)}</span>
          ${
            item.actions?.length
              ? `<div class="decision-actions">${item.actions.filter((action) => action.kind !== "evidence" || action.uid).map(decisionActionButton).join("")}</div>`
              : ""
          }
        </div>
      </div>
    `,
    )
    .join("");
}

/**
 * 从分析卡片跳到账本：按分类（可再叠加商户）筛好再滚过去，
 * 让「看这 4 笔」真的只剩那 4 笔，而不是把人扔到一张全量表前面。
 */
function focusLedger({ category = "all", merchant = "", range = null } = {}) {
  state.filter = category || "all";
  state.merchantFocus = merchant || "";
  state.dateRange = range;
  state.ledgerFilterExpanded = false;
  state.ledgerPage = 1;
  renderFilters();
  renderTransactions();
  // 先让滚动揭示动画把新行的位移清掉，再滚过去：反过来的话滚动落点会被随后的
  // 布局变化带偏，人到了账本却停在半空。
  window.refreshCfoMotion?.({ scope: "ledger" });
  requestAnimationFrame(() => {
    document.getElementById("ledger")?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start",
    });
  });
}

/**
 * 从趋势明细格跳到账本：把这一期的起止塞进 dateRange，关掉弹窗再滚过去。
 * 这里不带分类/商户条件——用户点的是「这段时间」，不是「这段时间的某一类」。
 */
function jumpToTrendPeriod(index) {
  const item = state.activeTrendSeries[index];
  if (!item?.start || !item?.end) return;
  closeModal("trendModal");
  focusLedger({ range: { start: item.start, end: item.end, label: item.title } });
}

/** 从分析卡片直接追问：先把对话滚进视野，再把问题发出去。 */
function askFromInsight(question) {
  if (!question) return;
  document.getElementById("heroChat")?.scrollIntoView({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block: "center",
  });
  if (state.chatBusy) {
    showToast("上一个问题还在回答，等它结束再追问。", "info");
    return;
  }
  submitQuestion(question);
}

function renderCategoryStack() {
  const selected = scopedTransactions(state.period);
  const grouped = groupByCategory(selected);
  const entries = Object.entries(grouped).sort((a, b) => b[1].amount - a[1].amount);
  // 分类只统计正向消费，因此占比总额也必须使用分类金额总和，不能混用净支出。
  const total = entries.reduce((acc, [, value]) => acc + value.amount, 0);

  $("categoryStack").innerHTML = entries.length
    ? entries
        .map(([category, value]) => {
          const share = total > 0 ? (value.amount / total) * 100 : 0;
          return `
            <div class="category-row">
              <div class="category-name">
                <span class="legend-dot" style="--seg-color:${categoryColor(category)}" aria-hidden="true"></span>
                <strong>${escapeHtml(categoryLabel(category))}</strong>
              </div>
              <div class="category-value">${escapeHtml(formatMoney(value.amount))}</div>
              <div class="category-track" aria-hidden="true"><span style="--category-ratio:${(clamp(share, 0, 100) / 100).toFixed(4)};--seg-color:${categoryColor(category)}"></span></div>
              <div class="category-sub">${value.count} 笔 · 占 ${Math.round(share)}%</div>
            </div>
          `;
        })
        .join("")
    : ""; // 空态已经由上方的构成条给出，这里不再重复一遍
}

function renderFilters() {
  const categories = ["all", ...new Set(state.transactions.map((tx) => tx.category || "uncategorized"))];
  const categorySet = new Set(categories);
  const primaryCategories = primaryLedgerCategories.filter((category) => categorySet.has(category));
  const otherCategories = categories.filter((category) => !primaryCategories.includes(category));
  const selectedIsExtra = state.filter !== "all" && otherCategories.includes(state.filter);

  $("filterBar").innerHTML = `
    <div class="filter-strip">
      <div class="filter-strip-scroll">
        ${state.merchantFocus ? `
          <button class="ledger-filter-chip is-merchant" data-clear-merchant type="button" aria-label="取消按商户「${escapeHtml(state.merchantFocus)}」筛选">
            ${escapeHtml(state.merchantFocus)} <span aria-hidden="true">×</span>
          </button>
        ` : ""}
        ${state.dateRange ? `
          <button class="ledger-filter-chip is-range" data-clear-range type="button" aria-label="取消按时间区间「${escapeHtml(state.dateRange.label)}」筛选">
            ${escapeHtml(state.dateRange.label)} <span aria-hidden="true">×</span>
          </button>
        ` : ""}
        ${primaryCategories.map((category) => filterButton(category)).join("")}
        ${selectedIsExtra ? filterButton(state.filter, { current: true }) : ""}
      </div>
      ${otherCategories.length ? `
        <button class="ledger-filter-more${state.ledgerFilterExpanded ? " active" : ""}" data-filter-action="toggle-more" type="button" aria-expanded="${state.ledgerFilterExpanded ? "true" : "false"}">
          更多分类 <span aria-hidden="true">${state.ledgerFilterExpanded ? "收起" : `+${otherCategories.length}`}</span>
        </button>
      ` : ""}
    </div>
    ${otherCategories.length ? `
      <div class="filter-popover${state.ledgerFilterExpanded ? " open" : ""}">
        <div class="filter-popover-section">
          <div class="filter-popover-title">常用分类</div>
          <div class="filter-popover-grid">
            ${primaryCategories.map((category) => filterButton(category)).join("")}
          </div>
        </div>
        <div class="filter-popover-section">
          <div class="filter-popover-title">其他分类</div>
          <div class="filter-popover-grid">
            ${otherCategories.map((category) => filterButton(category)).join("")}
          </div>
        </div>
      </div>
    ` : ""}
  `;
}

function renderTransactions() {
  // 有显式区间时不再叠顶部周期：区间是用户从趋势图点进来的，
  // 再和「本月」求交集只会得到一张空表。
  let transactions = state.dateRange
    ? transactionsBetween(state.dateRange.start, state.dateRange.end)
    : scopedTransactions(state.period);
  if (state.filter !== "all") transactions = transactions.filter((tx) => (tx.category || "uncategorized") === state.filter);
  // 商户维度只由分析卡片的「看这 N 笔」写入，筛选栏里以一枚可关闭的胶囊呈现。
  if (state.merchantFocus) transactions = transactions.filter((tx) => merchantKey(tx) === state.merchantFocus);

  const totalPages = Math.max(1, Math.ceil(transactions.length / ledgerPageSize));
  state.ledgerPage = Math.min(Math.max(state.ledgerPage, 1), totalPages);
  const start = (state.ledgerPage - 1) * ledgerPageSize;
  const pageTransactions = transactions.slice(start, start + ledgerPageSize);

  if (!transactions.length) {
    const isFiltered = state.filter !== "all" || Boolean(state.merchantFocus) || Boolean(state.dateRange);
    const scopeName = state.merchantFocus || (state.filter !== "all" ? categoryLabel(state.filter) : "");
    const rangeName = state.dateRange?.label || periodLabel();
    const body = state.transactions.length
      ? emptyState({
          icon: isFiltered ? "filter" : "empty",
          title: isFiltered ? `${scopeName}在${rangeName}没有记录` : `${periodLabel()}还没有交易`,
          hint: isFiltered ? "换个分类，或者清掉筛选看全部。" : "把账单截图发到绑定邮箱，同步后就会出现在这里。",
          action: isFiltered
            ? `<button class="btn btn-quiet" type="button" data-filter="all">清掉筛选</button>`
            : "",
        })
      : emptyState({
          icon: "mail",
          title: "账本还是空的",
          hint: "从「同步」拉取一次未读账单邮件，Agent 会自动 OCR 并分类。",
          action: `<button class="btn btn-primary" type="button" data-open-modal="syncModal" data-start-sync="true">同步邮箱账单</button>`,
        });
    $("transactionList").innerHTML = `<tr><td colspan="5">${body}</td></tr>`;
    $("ledgerPagination").innerHTML = "";
    return;
  }

  $("transactionList").innerHTML = pageTransactions
    .map((tx) => {
      const title = tx.merchant || tx.product || "未知商户";
      const thing = tx.thing || tx.product || "未识别消费内容";
      const method = tx.payment_method || "未知支付方式";
      const source = `${paymentLabel(tx.payment_app)} · ${method}`;
      const pending = tx.classification_status === "pending";
      const category = tx.category || "uncategorized";
      const isInflow = tx.direction === "inflow";
      return `
        <tr
          class="txn-row"
          role="row"
          data-motion-row
          data-transaction-uid="${escapeHtml(tx.transaction_uid || "")}"
          tabindex="0"
          aria-label="查看 ${escapeHtml(title)} ${escapeHtml(formatMoney(tx.amount))} 的交易证据"
        >
          <td role="cell" class="td-time">${escapeHtml(displayDate(tx.paid_at))}</td>
          <td role="cell" class="td-main">
            <div class="txn-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
            <div class="txn-meta" title="${escapeHtml(thing)}">${escapeHtml(thing)}</div>
          </td>
          <td role="cell" class="td-category">
            <span class="txn-chip${pending ? " is-pending" : ""}">
              <span class="legend-dot" style="--seg-color:${pending ? "var(--amber-8)" : categoryColor(category)}" aria-hidden="true"></span>
              <span>${escapeHtml(pending ? "识别中" : categoryLabel(category))}</span>
            </span>
          </td>
          <td role="cell" class="td-source">${escapeHtml(source)}</td>
          <td role="cell" class="td-amount${isInflow ? " is-inflow" : ""}">${escapeHtml(`${isInflow ? "+" : ""}${formatMoney(tx.amount)}`)}</td>
        </tr>
      `;
    })
    .join("");

  $("ledgerPagination").innerHTML = transactions.length > ledgerPageSize
    ? `
      <div class="pagination-summary">共 ${transactions.length} 条 · 第 ${state.ledgerPage} / ${totalPages} 页</div>
      <form class="pagination-jump" data-page-jump-form>
        <label for="ledgerPageJump">跳至</label>
        <input
          id="ledgerPageJump"
          type="number"
          inputmode="numeric"
          min="1"
          max="${totalPages}"
          value="${state.ledgerPage}"
          aria-label="输入页码跳转"
        />
        <span>页</span>
        <button type="submit">跳转</button>
      </form>
      <div class="pagination-actions">
        <button type="button" data-page-action="prev" ${state.ledgerPage <= 1 ? "disabled" : ""}>上一页</button>
        <button type="button" data-page-action="next" ${state.ledgerPage >= totalPages ? "disabled" : ""}>下一页</button>
      </div>
    `
    : "";
}

/* ------------------------------- 对话 ------------------------------- */

function setChatPageLock(locked) {
  const body = document.body;
  if (locked) {
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    body.style.setProperty("--chat-scrollbar-compensation", `${scrollbarWidth}px`);
    body.classList.add("chat-expanded-open");
    return;
  }
  body.classList.remove("chat-expanded-open");
  body.style.removeProperty("--chat-scrollbar-compensation");
}

function restoreChatScrollPosition(position) {
  if (!position) return;
  const root = document.documentElement;
  const previousScrollBehavior = root.style.scrollBehavior;
  root.style.scrollBehavior = "auto";
  window.scrollTo(position.left, position.top);
  root.style.scrollBehavior = previousScrollBehavior;
}

function chatIsAtLatest() {
  const messages = $("chatMessages");
  if (!messages) return true;
  return messages.scrollHeight - messages.scrollTop - messages.clientHeight < 28;
}

function updateChatLatestButton() {
  const button = $("chatLatestButton");
  if (!button) return;
  button.hidden = !state.chatExpanded || chatIsAtLatest();
}

function scrollChatToLatest() {
  const messages = $("chatMessages");
  if (!messages) return;
  messages.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });
  window.setTimeout(updateChatLatestButton, 340);
}

function latestAgentAnswer() {
  return [...state.chatHistory].reverse().find((item) => item.role === "assistant")?.content || "";
}

async function copyLastAnswer() {
  const answer = latestAgentAnswer();
  if (!answer) {
    showToast("还没有可以复制的 CFO 回答", "error");
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(answer);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = answer;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    showToast("最近一条 CFO 回答已复制");
  } catch {
    showToast("复制失败，请手动选择回答内容", "error");
  }
}

function prepareChatCollapsePreview(chat, placeholder) {
  const preview = chat.cloneNode(true);
  preview.removeAttribute("id");
  preview.classList.remove("is-expanded", "is-expanded-active", "is-collapsing");
  preview.classList.add("chat-collapse-preview");
  preview.setAttribute("aria-hidden", "true");
  preview.style.removeProperty("transition");
  preview.style.removeProperty("transform");
  preview.style.removeProperty("transform-origin");
  preview.style.removeProperty("opacity");
  preview.querySelector("#copyLastAnswerButton")?.setAttribute("hidden", "");
  preview.querySelector("#closeChatExpandButton")?.setAttribute("hidden", "");
  preview.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  placeholder.replaceChildren(preview);
  return preview;
}

function openChatExpanded() {
  if (state.chatExpanded) return;
  const chat = $("heroChat");
  const backdrop = $("chatExpandBackdrop");
  const placeholder = $("chatExpandPlaceholder");
  const expandButton = $("expandChatButton");
  const copyButton = $("copyLastAnswerButton");
  const closeButton = $("closeChatExpandButton");
  if (!chat || !backdrop || !placeholder || !copyButton || !closeButton) return;

  state.chatTransitionCancel?.();
  state.chatTransitionCancel = null;
  placeholder.replaceChildren();
  const originRect = chat.getBoundingClientRect();
  state.chatExpanded = true;
  state.chatReturnFocusElement = document.activeElement;
  state.chatReturnScrollPosition = { left: window.scrollX, top: window.scrollY };
  setChatPageLock(true);
  backdrop.hidden = false;
  placeholder.hidden = false;
  placeholder.classList.add("is-visible");
  copyButton.hidden = false;
  closeButton.hidden = false;
  chat.classList.remove("is-collapsing");
  chat.classList.add("is-expanded");
  chat.style.transition = "none";
  chat.style.transformOrigin = "top left";
  chat.style.opacity = "1";
  chat.style.transform = "none";
  chat.style.willChange = "transform, opacity";
  const targetRect = chat.getBoundingClientRect();
  const startScaleX = targetRect.width ? originRect.width / targetRect.width : 1;
  const startScaleY = targetRect.height ? originRect.height / targetRect.height : 1;
  chat.style.transform = `translate3d(${originRect.left - targetRect.left}px, ${originRect.top - targetRect.top}px, 0) scale(${startScaleX}, ${startScaleY})`;
  expandButton?.setAttribute("aria-expanded", "true");
  updateChatLatestButton();

  requestAnimationFrame(() => {
    backdrop.classList.add("is-visible");
    chat.classList.add("is-expanded-active");
    chat.style.transition = "transform var(--motion-chat-enter) var(--ease-out), opacity var(--motion-overlay-enter) var(--ease-out)";
    chat.style.transform = "none";
    closeButton.focus({ preventScroll: true });
  });

  state.chatTransitionCancel = afterTransition(chat, () => {
    if (!state.chatExpanded) return;
    chat.style.transition = "";
    chat.style.transform = "";
    chat.style.transformOrigin = "";
    chat.style.opacity = "";
    chat.style.willChange = "";
    state.chatTransitionCancel = null;
  }, { fallback: 540 });
}

function closeChatExpanded() {
  if (!state.chatExpanded) return;
  const chat = $("heroChat");
  const backdrop = $("chatExpandBackdrop");
  const placeholder = $("chatExpandPlaceholder");
  const expandButton = $("expandChatButton");
  const copyButton = $("copyLastAnswerButton");
  const closeButton = $("closeChatExpandButton");
  if (!chat || !backdrop || !placeholder || !copyButton || !closeButton) return;

  state.chatTransitionCancel?.();
  state.chatTransitionCancel = null;
  placeholder.hidden = false;
  placeholder.classList.add("is-visible");
  const preview = prepareChatCollapsePreview(chat, placeholder);
  const renderedOpacity = getComputedStyle(chat).opacity;
  chat.style.transition = "none";
  chat.style.transform = "none";
  chat.style.opacity = renderedOpacity;
  chat.style.transformOrigin = "";
  chat.style.willChange = "opacity";
  state.chatExpanded = false;
  chat.classList.add("is-collapsing");
  backdrop.classList.remove("is-visible");
  expandButton?.setAttribute("aria-expanded", "false");

  requestAnimationFrame(() => {
    preview.classList.add("is-preview-visible");
    chat.style.transition = "opacity var(--motion-chat-exit) var(--ease-out)";
    chat.style.opacity = "0";
  });

  state.chatTransitionCancel = afterTransition(chat, () => {
    if (state.chatExpanded) return;
    chat.classList.remove("is-expanded", "is-expanded-active", "is-collapsing");
    copyButton.hidden = true;
    closeButton.hidden = true;
    placeholder.replaceChildren();
    placeholder.classList.remove("is-visible");
    placeholder.hidden = true;
    backdrop.hidden = true;
    setChatPageLock(false);
    chat.style.transition = "";
    chat.style.transform = "";
    chat.style.transformOrigin = "";
    chat.style.opacity = "";
    chat.style.willChange = "";
    if (state.chatReturnFocusElement instanceof HTMLElement) {
      state.chatReturnFocusElement.focus({ preventScroll: true });
    } else {
      expandButton?.focus({ preventScroll: true });
    }
    const returnScrollPosition = state.chatReturnScrollPosition;
    if (returnScrollPosition) {
      restoreChatScrollPosition(returnScrollPosition);
      requestAnimationFrame(() => {
        restoreChatScrollPosition(returnScrollPosition);
      });
    }
    state.chatReturnFocusElement = null;
    state.chatReturnScrollPosition = null;
    state.chatTransitionCancel = null;
  }, { property: "opacity", fallback: 360 });
}

function messageUsesDocumentLayout(text) {
  const content = String(text || "");
  return (
    content.length > 180 ||
    /(^|\n)\s*(#{1,3}\s|[-*]\s|\d+\.\s|>\s)/.test(content) ||
    /\|.+\|/.test(content)
  );
}

function addMessage(role, text, options = {}) {
  const shouldSave = options.save !== false;
  const container = $("chatMessages");
  const node = document.createElement("div");
  node.className = `message ${role}`;
  if (options.reset) node.classList.add("reset-message");
  if (role === "agent" && !options.thinking && messageUsesDocumentLayout(text)) {
    node.classList.add("document-message");
  }
  node.setAttribute("aria-label", role === "user" ? "提问者消息" : "CFO Agent 回答");

  const avatar = document.createElement("img");
  avatar.className = "message-avatar";
  avatar.src = role === "user" ? chatAvatarAssets.user : chatAvatarAssets.agent;
  avatar.alt = role === "user" ? "提问者像素头像" : "CFO Agent 像素头像";
  avatar.width = 36;
  avatar.height = 36;
  avatar.loading = "lazy";
  avatar.decoding = "async";

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  if (options.thinking) {
    node.classList.add("thinking-message");
    bubble.innerHTML = `<span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>${escapeHtml(text)}</span>`;
  } else {
    if (options.periodTag) {
      const chip = document.createElement("span");
      chip.className = "period-chip";
      chip.textContent = options.periodTag;
      bubble.appendChild(chip);
    }
    const body = document.createElement("div");
    body.className = "message-body";
    setMessageContent(body, role, text, options);
    bubble.appendChild(body);
  }
  node.append(avatar, bubble);
  container.appendChild(node);
  container.scrollTop = container.scrollHeight;
  updateChatLatestButton();
  if (shouldSave && (role === "user" || role === "agent")) {
    state.chatHistory.push({
      role: role === "agent" ? "assistant" : "user",
      content: text,
    });
    state.chatHistory = state.chatHistory.slice(-12);
  }
  return node;
}

function setChatBusy(busy) {
  state.chatBusy = busy;
  const button = document.querySelector(".chat-send");
  const clearButton = $("clearChatButton");
  const input = $("chatInput");
  if (button) {
    button.disabled = busy;
    const text = button.querySelector(".chat-send-text");
    if (text) text.textContent = busy ? button.dataset.labelBusy : button.dataset.labelIdle;
  }
  if (input) input.setAttribute("aria-busy", busy ? "true" : "false");
  if (clearButton) clearButton.disabled = busy;
  document.querySelectorAll(".quick-prompts button").forEach((node) => {
    node.disabled = busy;
  });
}

function clearChatSession() {
  if (state.chatBusy) return;
  state.chatHistory = [];
  $("chatMessages").innerHTML = "";
  $("headerSummary").textContent = "会话已清空 · 等待你的下一次提问";
  const resetMessage = addMessage(
    "agent",
    "会话面板已清空，我们再来聊点什么呢。",
    { save: false, reset: true },
  );
  resetMessage.setAttribute("aria-label", "CFO Agent 会话状态提示");
  $("chatInput").value = "";
  updateChatLatestButton();
  $("chatInput").focus();
  showToast("会话已清空，随时可以继续提问");
}

async function askCfoAgent(question, history) {
  const response = await fetch("./api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: question,
      period: state.period,
      history,
      budgets: state.budgets,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.answer || `请求失败：HTTP ${response.status}`);
  return data.answer || "模型没有返回可展示的内容，请再问一次。";
}

async function submitQuestion(question) {
  if (state.chatBusy) return;
  setChatBusy(true);
  const priorHistory = [...state.chatHistory];
  addMessage("user", question, { periodTag: periodLabel(state.period) });
  const thinkingNode = addMessage("agent", "正在读取账本并生成回答", { save: false, thinking: true });
  try {
    const answer = await askCfoAgent(question, priorHistory);
    thinkingNode.classList.remove("thinking-message");
    thinkingNode.classList.toggle("document-message", messageUsesDocumentLayout(answer));
    const bubble = thinkingNode.querySelector(".message-bubble");
    bubble.innerHTML = "";
    const body = document.createElement("div");
    body.className = "message-body";
    bubble.appendChild(body);
    setMessageContent(body, "agent", answer, { split: true });
    state.chatHistory.push({ role: "assistant", content: answer });
    state.chatHistory = state.chatHistory.slice(-12);
  } catch (error) {
    const fallback = `没能拿到回答：${error.message}`;
    thinkingNode.classList.remove("thinking-message");
    thinkingNode.classList.remove("document-message");
    thinkingNode.classList.add("error-message");
    const bubble = thinkingNode.querySelector(".message-bubble");
    bubble.innerHTML = "";
    const body = document.createElement("div");
    body.className = "message-body";
    bubble.appendChild(body);
    setMessageContent(body, "agent", fallback);
    state.chatHistory.push({ role: "assistant", content: fallback });
    state.chatHistory = state.chatHistory.slice(-12);
  } finally {
    setChatBusy(false);
    $("chatMessages").scrollTop = $("chatMessages").scrollHeight;
    updateChatLatestButton();
  }
}

/* ------------------------------- 邮箱同步 ------------------------------- */

function setSyncModalState(kind, title, meta) {
  const card = $("syncStateCard");
  card.className = `sync-state-card ${kind || ""}`.trim();
  $("syncStatusLabel").textContent = kind === "running" ? "同步中" : kind === "success" ? "同步完成" : kind === "error" ? "同步失败" : "准备同步";
  $("syncStatusTitle").textContent = title;
  $("syncStatusMeta").textContent = meta;
}

function renderSyncMetrics(payload = {}) {
  $("syncCandidateCount").textContent = payload.candidate_count ?? "--";
  $("syncMatchedCount").textContent = payload.matched_messages ?? "--";
  $("syncAttachmentCount").textContent = payload.processed_attachments ?? "--";
  $("syncNewCount").textContent = payload.new_transactions ?? "--";
}

function renderSyncItems(items = []) {
  $("syncItemList").innerHTML = items.length
    ? items
        .map(
          (item) => `
          <div class="sync-item">
            <div>
              <div class="sync-item-title">${escapeHtml(item.merchant || "未知商户")}</div>
              <div class="sync-item-meta">${escapeHtml(displayDate(item.paid_at))} · ${escapeHtml(item.transaction_uid || item.uid || "未生成交易号")}</div>
            </div>
            <div>
              <div class="sync-item-amount">${escapeHtml(formatMoney(item.amount))}</div>
              <div class="sync-item-category">${escapeHtml(item.classification_status === "pending" ? "识别中" : categoryLabel(item.category))}</div>
            </div>
          </div>
        `,
        )
        .join("")
    : emptyState({ icon: "mail", title: "本次没有新的账单附件", hint: "所有未读账单邮件都已经处理过了。" });
}

function resetSyncModal() {
  setSyncModalState("idle", "等待开始", "将扫描未读账单邮件，成功处理后自动标记已读。");
  renderSyncMetrics();
  $("syncFinishedAt").textContent = "未开始";
  $("syncItemList").innerHTML = emptyState({ icon: "mail", title: "还没有开始同步", hint: "点击下方「开始同步」连接邮箱。" });
}

async function syncMailData() {
  if (state.syncBusy) return;
  state.syncBusy = true;
  $("startSyncButton").disabled = true;
  $("openSyncModal").disabled = true;
  $("startSyncButton").textContent = "同步中…";
  setSyncModalState("running", "正在连接邮箱并扫描未读账单", "同步期间请保持当前 Web 服务运行。");
  renderSyncMetrics({ candidate_count: "--", matched_messages: "--", processed_attachments: "--", new_transactions: "--" });
  $("syncFinishedAt").textContent = "进行中";
  $("syncItemList").innerHTML = `
    <div class="empty-state">
      <span class="skeleton skeleton-row" style="width:70%"></span>
      <span class="skeleton skeleton-row" style="width:48%"></span>
      <span>正在读取邮箱与 OCR 账单截图…</span>
    </div>
  `;

  try {
    const response = await fetch("./api/sync-mail", { method: "POST" });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.answer || `同步请求失败：HTTP ${response.status}`);
    }

    await loadSnapshot();
    renderAll();
    if (!$("trendModal").hidden) renderTrendModal();
    window.refreshCfoMotion?.();

    renderSyncMetrics(payload);
    renderSyncItems(payload.items || []);
    $("syncFinishedAt").textContent = payload.finished_at ? displayDateTime(payload.finished_at) : "刚刚";
    const title = payload.new_transactions > 0
      ? `已同步 ${payload.new_transactions} 笔新交易`
      : "没有发现新的未读账单";
    const meta = `扫描 ${payload.candidate_count} 封候选邮件，命中 ${payload.matched_messages} 封，处理 ${payload.processed_attachments} 个附件，用时 ${payload.duration_seconds}s。`;
    setSyncModalState("success", title, meta);
    acknowledgeAgentStatus();
    if (payload.new_transactions > 0) showToast(`同步完成，新增 ${payload.new_transactions} 笔交易`);
    refreshPendingClassifications();
  } catch (error) {
    renderSyncMetrics({ candidate_count: 0, matched_messages: 0, processed_attachments: 0, new_transactions: 0 });
    $("syncFinishedAt").textContent = "失败";
    $("syncItemList").innerHTML = emptyState({ icon: "alert", title: "同步中断", hint: error.message });
    setSyncModalState("error", "邮箱同步没有完成", error.message);
    showToast("邮箱同步失败，详情见弹窗", "error");
  } finally {
    state.syncBusy = false;
    $("startSyncButton").disabled = false;
    $("openSyncModal").disabled = false;
    $("startSyncButton").textContent = "重新同步";
  }
}

async function refreshPendingClassifications(maxAttempts = 10) {
  for (let attempt = 0; attempt < maxAttempts && state.classificationPendingCount > 0; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
    await loadSnapshot();
    renderAll();
    if (!$("trendModal").hidden) renderTrendModal();
  }
}

function renderAll() {
  renderHeader();
  renderMetrics();
  renderHeroBudget();
  renderHeroSpark();
  renderComposition();
  renderDecisionFeed();
  renderCategoryStack();
  renderFilters();
  renderTransactions();
}

/* ------------------------------- 导航 ------------------------------- */

function setActiveNav(sectionId) {
  document.querySelectorAll("[data-nav-section]").forEach((item) => {
    const active = item.dataset.navSection === sectionId;
    item.classList.toggle("is-active", active);
    item.classList.toggle("active", active);
    if (active) {
      item.setAttribute("aria-current", "location");
    } else {
      item.removeAttribute("aria-current");
    }
  });
}

function syncNavWithScroll() {
  const sections = ["chat", "signals", "ledger"]
    .map((id) => ({ id, element: $(id) }))
    .filter((item) => item.element);
  if (!sections.length) return;

  const railHeight = document.querySelector(".rail")?.getBoundingClientRect().height || 0;
  const anchorY = railHeight + Math.min(window.innerHeight * 0.42, 360);
  let current = sections[0];

  for (const section of sections) {
    if (section.element.getBoundingClientRect().top <= anchorY) {
      current = section;
    }
  }

  setActiveNav(current.id);
}

function wireScrollSpy() {
  let ticking = false;
  const update = () => {
    ticking = false;
    syncNavWithScroll();
    document.body.classList.toggle("is-scrolled", window.scrollY > 8);
  };
  const requestUpdate = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };

  window.addEventListener("scroll", requestUpdate, { passive: true });
  window.addEventListener("resize", requestUpdate);
  requestUpdate();
}

/* ------------------------------- 周期控件 ------------------------------- */

function periodButtons() {
  return Array.from(document.querySelectorAll(".period-btn"));
}

function movePeriodThumb() {
  const control = document.querySelector(".period-control");
  const thumb = control?.querySelector(".period-thumb");
  const active = control?.querySelector(".period-btn.active");
  if (!control || !thumb || !active) return;
  const controlRect = control.getBoundingClientRect();
  const activeRect = active.getBoundingClientRect();
  // 滑块静态位置是 left:3px（= padding），所以位移要减掉边框和这 3px。
  const offset = activeRect.left - controlRect.left - control.clientLeft - 3;
  thumb.style.width = `${activeRect.width}px`;
  thumb.style.transform = `translateX(${offset}px)`;
}

function selectPeriod(button, options = {}) {
  if (!button) return;
  state.period = button.dataset.period;
  // 换周期后旧商户可能一笔都没有，留着只会得到一张空表。
  // 时间区间同理：既然选了新周期，从趋势图带过来的那段就该让位。
  state.merchantFocus = "";
  state.dateRange = null;
  state.ledgerPage = 1;
  periodButtons().forEach((item) => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-checked", active ? "true" : "false");
    item.tabIndex = active ? 0 : -1;
  });
  movePeriodThumb();
  updateQuickPrompts();
  renderAll();
  if (options.focus) button.focus();
  window.refreshCfoMotion?.({ scope: "global" });
}

/* ------------------------------- 事件 ------------------------------- */

function wireInteractions() {
  window.addEventListener("cfo:open-evidence", (event) => {
    if (event.detail?.uid) openEvidence(event.detail.uid);
  });

  // 顶栏已经表达过关注哪个时间尺度，弹窗别把这个上下文丢了。
  // （「分析」信号卡的深链自己指定刻度，不走这里。）
  const openTrendForPeriod = () => {
    state.trendMode = trendModeForPeriod();
    openModal("trendModal");
  };
  $("openTrendModal").addEventListener("click", openTrendForPeriod);
  $("heroSpark").addEventListener("click", () => {
    if (state.period === "all") {
      openModal("profileReportModal");
      return;
    }
    openTrendForPeriod();
  });
  $("openBudgetSettings").addEventListener("click", () => openModal("budgetModal"));

  $("openSyncModal").addEventListener("click", () => {
    openModal("syncModal");
    syncMailData();
  });

  $("startSyncButton").addEventListener("click", () => syncMailData());
  $("clearChatButton").addEventListener("click", clearChatSession);
  $("expandChatButton").addEventListener("click", openChatExpanded);
  $("closeChatExpandButton").addEventListener("click", closeChatExpanded);
  $("copyLastAnswerButton").addEventListener("click", copyLastAnswer);
  $("chatLatestButton").addEventListener("click", scrollChatToLatest);
  $("backToTopButton").addEventListener("click", (event) => {
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  $("chatMessages").addEventListener("scroll", updateChatLatestButton, { passive: true });

  $("chatExpandBackdrop").addEventListener("click", closeChatExpanded);

  $("refreshProfileReport").addEventListener("click", () => generateProfileReport(true));
  $("updateProfileReport").addEventListener("click", () => generateProfileReport(true));
  $("profileReportPrev").addEventListener("click", () => setProfileReportIndex(state.profileReportIndex - 1));
  $("profileReportNext").addEventListener("click", () => setProfileReportIndex(state.profileReportIndex + 1));
  $("profileReportDots").addEventListener("click", (event) => {
    const button = event.target.closest("[data-profile-index]");
    if (button) setProfileReportIndex(Number(button.dataset.profileIndex));
  });
  $("profileReportPages").addEventListener("click", (event) => {
    if (event.target.closest("[data-profile-retry]")) generateProfileReport(true);
    if (event.target.closest("[data-profile-ask]")) askFromProfileReport();
  });
  $("profileReportViewport").addEventListener("scroll", () => {
    if (state.profileReportScrollFrame) return;
    state.profileReportScrollFrame = requestAnimationFrame(() => {
      state.profileReportScrollFrame = null;
      const viewport = $("profileReportViewport");
      if (!viewport.clientWidth || !state.profileReportPageCount) return;
      const index = clamp(Math.round(viewport.scrollLeft / viewport.clientWidth), 0, state.profileReportPageCount - 1);
      if (index !== state.profileReportIndex) {
        state.profileReportIndex = index;
        $("profileReportProgress").textContent = `${index + 1} / ${state.profileReportPageCount}`;
        $("profileReportPrev").disabled = index === 0;
        $("profileReportNext").disabled = index === state.profileReportPageCount - 1;
        $("profileReportDots").querySelectorAll("button").forEach((button, buttonIndex) => {
          const active = buttonIndex === index;
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-selected", active ? "true" : "false");
        });
      }
    });
  }, { passive: true });

  document.querySelectorAll("[data-modal-close]").forEach((button) => {
    button.addEventListener("click", () => closeModal(button.dataset.modalClose));
  });

  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeModal(backdrop.id);
    });
  });

  $("evidenceDrawer").addEventListener("click", (event) => {
    if (event.target.closest("[data-evidence-edit]")) {
      setEvidenceEditing(true);
      return;
    }
    if (event.target.closest("[data-evidence-cancel]")) {
      setEvidenceEditing(false);
      return;
    }
    if (event.target === $("evidenceDrawer") || event.target.closest("[data-drawer-close]")) closeEvidence();
  });

  // 表单是 innerHTML 重绘出来的，只能在抽屉上做事件委托。
  $("evidenceDrawer").addEventListener("submit", (event) => {
    const form = event.target.closest("[data-evidence-form]");
    if (!form) return;
    event.preventDefault();
    saveEvidenceEdits(form);
  });

  // 弹窗内、空态里出现的「打开某个弹窗」按钮
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-open-modal]");
    if (!trigger) return;
    const target = trigger.dataset.openModal;
    const current = trigger.closest(".modal-backdrop");
    if (current && current.id !== target) closeModal(current.id);
    openModal(target);
    if (trigger.dataset.startSync === "true") syncMailData();
  });

  $("trendModeControl").addEventListener("click", (event) => {
    const button = event.target.closest("[data-trend-mode]");
    if (!button) return;
    state.trendMode = button.dataset.trendMode;
    renderTrendModal();
  });

  $("trendModeControl").addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const buttons = Array.from($("trendModeControl").querySelectorAll("[data-trend-mode]"));
    const index = buttons.findIndex((node) => node.dataset.trendMode === state.trendMode);
    const next = buttons[(index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length];
    event.preventDefault();
    state.trendMode = next.dataset.trendMode;
    renderTrendModal();
    $("trendModeControl").querySelector(`[data-trend-mode="${next.dataset.trendMode}"]`)?.focus();
  });

  const showTrendTooltip = (index, anchorRect) => {
    const item = state.activeTrendSeries[index];
    const tooltip = $("trendTooltip");
    if (!item) return;
    const rect = $("trendChart").getBoundingClientRect();
    tooltip.innerHTML = `
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(formatMoney(item.amount))}</span>
      ${item.overBudget ? `<small class="trend-tooltip-warning">超出${escapeHtml(item.budgetLabel)} ${escapeHtml(formatMoney(item.overBy))}</small>` : ""}
    `;
    tooltip.hidden = false;
    tooltip.style.visibility = "hidden";

    const tooltipRect = tooltip.getBoundingClientRect();
    const gap = 12;
    const margin = 8;
    const pointerX = anchorRect.x - rect.left;
    const pointerY = anchorRect.y - rect.top;
    let left = pointerX + gap;
    let top = pointerY - tooltipRect.height - gap;

    if (left + tooltipRect.width > rect.width - margin) left = pointerX - tooltipRect.width - gap;
    if (top < margin) top = pointerY + gap;

    tooltip.style.left = `${clamp(left, margin, rect.width - tooltipRect.width - margin)}px`;
    tooltip.style.top = `${clamp(top, margin, rect.height - tooltipRect.height - margin)}px`;
    tooltip.style.visibility = "visible";
  };

  $("trendChart").addEventListener("pointermove", (event) => {
    const target = event.target.closest("[data-trend-index]");
    if (!target) {
      $("trendTooltip").hidden = true;
      return;
    }
    showTrendTooltip(Number(target.dataset.trendIndex), { x: event.clientX, y: event.clientY });
  });

  $("trendChart").addEventListener("pointerleave", () => {
    $("trendTooltip").hidden = true;
  });

  // 柱子和明细格互为入口：点哪边都选中同一期，点图表空白处取消。
  $("trendChart").addEventListener("click", (event) => {
    const slot = event.target.closest(".trend-slot");
    setTrendSelection(slot ? Number(slot.dataset.trendIndex) : null);
  });

  // <g role="button"> 不像原生按钮那样把回车翻译成 click，得自己接。
  $("trendChart").addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    const slot = event.target.closest(".trend-slot");
    if (!slot) return;
    event.preventDefault();
    setTrendSelection(Number(slot.dataset.trendIndex));
  });

  $("trendBreakdown").addEventListener("click", (event) => {
    // 箭头优先：它和格子是并列按钮，点箭头不该只是高亮一下
    const jump = event.target.closest("[data-trend-jump]");
    if (jump) {
      jumpToTrendPeriod(Number(jump.dataset.trendJump));
      return;
    }
    const body = event.target.closest(".trend-cell-body");
    if (!body) return;
    setTrendSelection(Number(body.dataset.trendIndex));
  });

  // 回到当前那一期的高亮，不是取消选中。
  $("trendBudgetReset").addEventListener("click", () => setTrendSelection(currentTrendIndex()));

  // 键盘用户也能读到每根柱子的数值
  $("trendChart").addEventListener(
    "focusin",
    (event) => {
      const slot = event.target.closest(".trend-slot");
      if (!slot) return;
      const box = slot.querySelector(".trend-col").getBoundingClientRect();
      showTrendTooltip(Number(slot.dataset.trendIndex), { x: box.left + box.width / 2, y: box.top });
    },
    true,
  );

  $("trendChart").addEventListener(
    "focusout",
    () => {
      $("trendTooltip").hidden = true;
    },
    true,
  );

  $("budgetForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const inputs = [
      { id: "dayBudgetInput", name: "日预算" },
      { id: "weekBudgetInput", name: "周预算" },
      { id: "monthBudgetInput", name: "月预算" },
    ];
    clearBudgetError();

    const invalid = inputs.find(({ id }) => {
      const raw = $(id).value.trim();
      return raw !== "" && !(Number(raw) >= 0);
    });
    if (invalid) {
      const error = $("budgetError");
      error.textContent = `${invalid.name}需要是 0 或更大的数字。`;
      error.hidden = false;
      $(invalid.id).closest(".field-control").classList.add("has-error");
      $(invalid.id).focus();
      return;
    }

    saveBudgets({
      day: Math.max(0, Number($("dayBudgetInput").value || 0)),
      week: Math.max(0, Number($("weekBudgetInput").value || 0)),
      month: Math.max(0, Number($("monthBudgetInput").value || 0)),
    });
    closeModal("budgetModal");
    showToast("预算已更新");
  });

  $("budgetForm").addEventListener("input", clearBudgetError);

  $("resetBudgetButton").addEventListener("click", () => {
    saveBudgets({ ...defaultBudgets });
    renderBudgetForm();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const overlay = document.querySelector(".opening-overlay");
      if (overlay && document.body.classList.contains("motion-running")) {
        window.skipCfoOpening?.();
        return;
      }
      if (state.chatExpanded) {
        closeChatExpanded();
        return;
      }
      const modal = topmostOpenModal();
      if (!modal) {
        if (!$("evidenceDrawer").hidden) closeEvidence();
      } else {
        closeModal(modal.id);
      }
      return;
    }

    const profileOpen = !$("profileReportModal").hidden;
    const tag = document.activeElement?.tagName;
    if (profileOpen && tag !== "INPUT" && tag !== "TEXTAREA" && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      setProfileReportIndex(state.profileReportIndex + (event.key === "ArrowRight" ? 1 : -1));
      return;
    }

    trapFocus(event);

    // "/" 聚焦提问框；输入态里不劫持
    if (event.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
      event.preventDefault();
      $("chatInput").focus();
    }
  });

  document.querySelector(".period-control").addEventListener("click", (event) => {
    const button = event.target.closest(".period-btn");
    if (button) selectPeriod(button);
  });

  document.querySelector(".period-control").addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = periodButtons();
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? buttons[0]
        : event.key === "End"
          ? buttons[buttons.length - 1]
          : buttons[(index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length];
    selectPeriod(next, { focus: true });
  });

  window.addEventListener("resize", movePeriodThumb);

  $("decisionFeed").addEventListener("click", (event) => {
    const button = event.target.closest("[data-decision-action]");
    if (!button) return;
    const { decisionAction, category, merchant, uid, mode, question } = button.dataset;
    if (decisionAction === "ask") {
      askFromInsight(question);
      return;
    }
    if (decisionAction === "evidence") {
      openEvidence(uid);
      return;
    }
    if (decisionAction === "trend") {
      if (mode) state.trendMode = mode;
      openModal("trendModal");
      return;
    }
    if (decisionAction === "ledger") focusLedger({ category, merchant });
  });

  $("filterBar").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.filterAction === "toggle-more") {
      state.ledgerFilterExpanded = !state.ledgerFilterExpanded;
      renderFilters();
      window.refreshCfoMotion?.({ scope: "ledger", quiet: true });
      return;
    }
    if (button.hasAttribute("data-clear-range")) {
      state.dateRange = null;
      state.ledgerPage = 1;
      renderFilters();
      renderTransactions();
      window.refreshCfoMotion?.({ scope: "ledger" });
      return;
    }
    if (button.hasAttribute("data-clear-merchant")) {
      state.merchantFocus = "";
      state.ledgerPage = 1;
      renderFilters();
      renderTransactions();
      window.refreshCfoMotion?.({ scope: "ledger" });
      return;
    }
    if (!button.dataset.filter) return;
    // 手动选分类＝重新划定范围，之前带过来的商户和时间区间约束到此为止。
    state.merchantFocus = "";
    state.dateRange = null;
    state.filter = button.dataset.filter;
    state.ledgerFilterExpanded = false;
    state.ledgerPage = 1;
    renderFilters();
    renderTransactions();
    window.refreshCfoMotion?.({ scope: "ledger" });
  });

  // 空态里的「查看全部分类」也走同一条路径
  $("transactionList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (button) {
      state.filter = button.dataset.filter;
      state.merchantFocus = "";
      state.dateRange = null;
      state.ledgerPage = 1;
      renderFilters();
      renderTransactions();
      return;
    }
    const transaction = event.target.closest("[data-transaction-uid]");
    if (transaction) openEvidence(transaction.dataset.transactionUid);
  });

  $("transactionList").addEventListener("keydown", (event) => {
    if (!['Enter', ' '].includes(event.key)) return;
    const transaction = event.target.closest("[data-transaction-uid]");
    if (!transaction) return;
    event.preventDefault();
    openEvidence(transaction.dataset.transactionUid);
  });

  // 捕获阶段：#filterBar 自己的处理器会重建 innerHTML，冒泡时 target 已脱离文档，
  // closest("#filterBar") 就永远是 null 了。
  document.addEventListener(
    "click",
    (event) => {
      if (!state.ledgerFilterExpanded) return;
      if (event.target.closest?.("#filterBar")) return;
      state.ledgerFilterExpanded = false;
      renderFilters();
    },
    true,
  );

  $("ledgerPagination").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || button.disabled || !button.dataset.pageAction) return;
    if (button.dataset.pageAction === "prev") state.ledgerPage -= 1;
    if (button.dataset.pageAction === "next") state.ledgerPage += 1;
    renderTransactions();
    document.querySelector(".table-wrap")?.scrollIntoView({ block: "nearest" });
    window.refreshCfoMotion?.({ scope: "ledger" });
  });

  $("ledgerPagination").addEventListener("submit", (event) => {
    const form = event.target.closest("[data-page-jump-form]");
    if (!form) return;
    event.preventDefault();
    const input = form.querySelector("input");
    const requestedPage = Number.parseInt(input?.value || "", 10);
    const maxPage = Number.parseInt(input?.max || "1", 10);
    if (!Number.isFinite(requestedPage)) return;
    state.ledgerPage = Math.min(Math.max(requestedPage, 1), maxPage);
    renderTransactions();
    window.refreshCfoMotion?.({ scope: "ledger" });
  });

  updateQuickPrompts();
  document.querySelector(".quick-prompts").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-question]");
    if (!button || button.disabled) return;
    submitQuestion(button.dataset.question);
  });

  $("chatForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("chatInput");
    const question = input.value.trim();
    if (!question) {
      input.focus();
      return;
    }
    input.value = "";
    submitQuestion(question);
  });

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      if (item.dataset.navSection) setActiveNav(item.dataset.navSection);
    });
  });

  wireScrollSpy();
  movePeriodThumb();
  if (document.fonts?.ready) document.fonts.ready.then(movePeriodThumb);
}

/* ------------------------------- 启动 ------------------------------- */

async function loadSnapshot() {
  const response = await fetch("./data.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`data.json 加载失败：HTTP ${response.status}`);
  const data = await response.json();
  state.generatedAt = data.generated_at || null;
  state.demo = Boolean(data.demo);
  state.classificationPendingCount = Number(data.classification_pending_count || 0);
  state.transactions = (data.transactions || []).sort((a, b) => parseDate(b.paid_at) - parseDate(a.paid_at));
  state.hasLoaded = true;
}

/** 致命错误不再清空 body：保留外壳，只在主区域给一块可重试的说明。 */
function renderFatalError(title, message, { retry = true } = {}) {
  const host = document.querySelector(".main") || document.body;
  document.body.classList.remove("app-loading", "motion-running");
  document.body.classList.add("motion-ready", "motion-complete");
  host.innerHTML = `
    <section class="app-error" role="alert">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      ${retry ? `<button class="btn btn-primary" type="button" data-retry-boot>重新加载</button>` : ""}
    </section>
  `;
  host.querySelector("[data-retry-boot]")?.addEventListener("click", () => window.location.reload());
}

async function boot() {
  if (window.location.protocol === "file:") {
    renderFatalError(
      "请通过本地服务打开",
      "当前是 file:// 页面，浏览器会阻止读取 data.json。请打开 http://localhost:8091/ 后重试。",
      { retry: false },
    );
    return;
  }

  const dataReady = loadSnapshot().then(() => {
    renderAll();
    if (!$("trendModal").hidden) renderTrendModal();
    fetchProfileReportMetadata().catch(() => {});
  });
  window.cfoDataReady = dataReady;

  addMessage("agent", "账本已经同步好了，你可以来咨询任何一笔消费，尽管来问吧🤗");
  wireInteractions();
  window.initCfoMotion?.();
  await dataReady;
}

boot().catch((error) => {
  window.skipCfoOpening?.();
  renderFatalError("账本加载失败", error.message);
});
