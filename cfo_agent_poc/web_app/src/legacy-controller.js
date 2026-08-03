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

// 类别色板只服务于数据编码（构成条、权重条、流水色点），不参与界面配色。
// 同一个分类在所有视图里必须是同一个颜色，所以用 key 的稳定哈希取色。
const CATEGORY_PALETTE = [
  "var(--cat-1)",
  "var(--cat-2)",
  "var(--cat-3)",
  "var(--cat-4)",
  "var(--cat-5)",
  "var(--cat-6)",
  "var(--cat-7)",
];

function categoryColor(key) {
  const value = String(key || "uncategorized");
  if (value === "uncategorized") return "var(--cat-8)";
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
  day: 300,
  week: 2000,
  month: 12000,
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
  ledgerFilterExpanded: false,
  ledgerPage: 1,
  chatHistory: [],
  chatBusy: false,
  syncBusy: false,
  budgets: loadBudgetConfig(),
  trendMode: "day",
  activeTrendSeries: [],
  classificationPendingCount: 0,
  hasLoaded: false,
};

function $(id) {
  return document.getElementById(id);
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

const SPLIT_MAX_CHARS = 40;

/**
 * 只给回答的前 40 个字做浮现，长答案直接整段显示。
 * 旧版本对整段逐字建 span（最长 90 字 × 18ms ≈ 1.6s），读起来是负担。
 */
function animateSplitText(node) {
  if (!node || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  if ((node.textContent || "").length > 600) return;

  const skipTags = new Set(["A", "CODE", "PRE", "SCRIPT", "STYLE", "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR"]);
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
    acceptNode(textNode) {
      if (!textNode.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
      let parent = textNode.parentElement;
      while (parent && parent !== node) {
        if (skipTags.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        parent = parent.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  let index = 0;
  textNodes.forEach((textNode) => {
    if (index >= SPLIT_MAX_CHARS) return;
    const fragment = document.createDocumentFragment();
    Array.from(textNode.nodeValue).forEach((char) => {
      if (/\s/.test(char) || index >= SPLIT_MAX_CHARS) {
        fragment.appendChild(document.createTextNode(char));
        if (!/\s/.test(char)) index += 1;
        return;
      }
      const span = document.createElement("span");
      span.className = "split-answer-char";
      span.style.setProperty("--split-index", String(index));
      span.textContent = char;
      fragment.appendChild(span);
      index += 1;
    });
    textNode.replaceWith(fragment);
  });

  if (index > 0) node.classList.add("split-answer-active");
}

function setMessageContent(node, role, text, options = {}) {
  if (role === "agent") {
    node.classList.add("markdown-message");
    node.classList.remove("split-answer-active");
    node.innerHTML = renderMarkdown(text);
    if (options.split) animateSplitText(node);
    return;
  }
  node.classList.remove("split-answer-active");
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
  const dates = state.transactions
    .map((tx) => parseDate(tx.paid_at))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b - a);

  if (dates.length) return dates[0];
  if (state.generatedAt) return parseDate(state.generatedAt);
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
    if (period === "today") return sameDay(paidAt, anchor);
    if (period === "week") return inSameWeek(paidAt, anchor);
    if (period === "month") return inSameMonth(paidAt, anchor);
    return true;
  });
}

function transactionsBetween(start, end) {
  return state.transactions.filter((tx) => {
    const paidAt = parseDate(tx.paid_at);
    return !Number.isNaN(paidAt.getTime()) && paidAt >= start && paidAt < end;
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

function trendModeTitle(mode = state.trendMode) {
  if (mode === "day") return "近7天每日支出";
  if (mode === "week") return "本月周度支出";
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
        current: index === 6,
      };
    });
  }

  if (mode === "week") {
    const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    const series = [];
    let cursor = monthStart;

    while (cursor <= anchor && cursor <= monthEnd) {
      const endDate = new Date(Math.min(weekEndFor(cursor), monthEnd));
      const end = addDays(startOfDay(endDate), 1);
      series.push({
        label: `第${series.length + 1}周`,
        title: `${formatShortDate(cursor)}-${formatShortDate(endDate)}`,
        amount: sumBetween(cursor, end),
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
 * 而是和最近 7 天（不含今天）的日均比，标签也写清楚。
 */
function comparisonBaseline(period = state.period) {
  const anchor = startOfDay(getAnchorDate());
  if (period === "today") {
    const total = sumBetween(addDays(anchor, -7), anchor);
    return { label: "较 7 日均值", value: total / 7 };
  }
  if (period === "week") {
    const start = startOfWeek(anchor);
    return { label: "较上周", value: sumBetween(addDays(start, -7), start) };
  }
  if (period === "month") {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    return { label: "较上月", value: sumBetween(addMonths(start, -1), start) };
  }
  return null;
}

function trendSubtitle(mode = state.trendMode) {
  if (mode === "day") return "近 7 天每日支出，虚线是日预算。";
  if (mode === "week") return "本月第一周到当前周，虚线是周预算。";
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
        <g class="trend-slot" data-trend-index="${index}" tabindex="0" role="button" aria-label="${escapeHtml(description)}">
          <rect class="trend-hit-zone" data-trend-index="${index}" x="${(x - band / 2).toFixed(1)}" y="${padding.top}" width="${band.toFixed(1)}" height="${chartHeight}"></rect>
          <rect class="${classes.join(" ")}" data-trend-index="${index}" x="${(x - colWidth / 2).toFixed(1)}" y="${(baseY - barHeight).toFixed(1)}" width="${colWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="3"></rect>
        </g>
        <text class="trend-axis-label${point.current ? " is-current" : ""}" x="${x.toFixed(1)}" y="${height - 12}" text-anchor="middle">${escapeHtml(point.label)}</text>
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

function renderTrendModal() {
  const mode = state.trendMode;
  const series = annotateTrendSeries(trendSeries(mode), mode);
  state.activeTrendSeries = series;
  const spend = currentBudgetSpend(mode);
  const budget = state.budgets[mode] || 0;
  const usage = budget > 0 ? Math.round((spend / budget) * 100) : 0;
  const remaining = budget - spend;
  const average = remaining / remainingBudgetDays(mode);

  $("trendSubtitle").textContent = trendSubtitle(mode);
  $("trendChart").innerHTML = trendChartSvg(series, mode);
  $("trendBudgetLabel").textContent = budgetLabel(mode);
  $("trendBudgetValue").textContent = formatMoney(budget);
  $("trendBudgetPercent").textContent = `${usage}%`;
  $("trendBudgetRemaining").textContent = formatMoney(remaining);
  $("trendBudgetAverageLabel").textContent = mode === "day" ? "计算口径" : "日均可用";
  $("trendBudgetAverage").textContent = mode === "day" ? "按今日消费计算" : formatMoney(average);

  const progress = $("trendBudgetProgress");
  progress.style.width = `${clamp(usage, 0, 100)}%`;
  const meter = progress.closest(".meter");
  if (meter) meter.dataset.level = usage > 100 ? "over" : usage >= 80 ? "warn" : "ok";
  $("trendBudgetRemaining").closest(".budget-rest")?.classList.toggle("is-negative", remaining < 0);

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

function focusableIn(modal) {
  return Array.from(modal.querySelectorAll(FOCUSABLE)).filter((node) => node.offsetParent !== null || node === document.activeElement);
}

function openModal(id) {
  const modal = $(id);
  if (!modal || modal.classList.contains("modal-visible")) return;
  modalReturnFocus.set(id, document.activeElement);
  modal.hidden = false;
  document.body.classList.add("modal-open");
  if (id === "trendModal") renderTrendModal();
  if (id === "budgetModal") renderBudgetForm();
  if (id === "syncModal") resetSyncModal();
  requestAnimationFrame(() => {
    modal.classList.add("modal-visible");
    const first = focusableIn(modal).find((node) => !node.classList.contains("modal-close")) || modal.querySelector(".modal-close");
    first?.focus({ preventScroll: true });
  });
}

function closeModal(id) {
  const modal = $(id);
  if (!modal || modal.hidden) return;
  modal.classList.remove("modal-visible");
  window.setTimeout(() => {
    if (modal.classList.contains("modal-visible")) return;
    modal.hidden = true;
    if ($("trendModal").hidden && $("budgetModal").hidden && $("syncModal").hidden) {
      document.body.classList.remove("modal-open");
    }
  }, 360);
  $("trendTooltip").hidden = true;

  const trigger = modalReturnFocus.get(id);
  modalReturnFocus.delete(id);
  if (trigger && document.contains(trigger)) trigger.focus({ preventScroll: true });
}

function topmostOpenModal() {
  return ["budgetModal", "syncModal", "trendModal"].map($).find((modal) => modal && !modal.hidden) || null;
}

function trapFocus(event) {
  if (event.key !== "Tab") return;
  const modal = topmostOpenModal();
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

/* ------------------------------- 轻提示 ------------------------------- */

function showToast(message, tone = "info") {
  const region = $("toastRegion");
  if (!region) return;
  const node = document.createElement("div");
  node.className = "toast";
  node.dataset.tone = tone;
  node.textContent = message;
  region.appendChild(node);
  window.setTimeout(() => node.remove(), 4200);
}

/* ------------------------------- 渲染 ------------------------------- */

function renderHeader() {
  const month = scopedTransactions("month");
  const latest = state.transactions[0];
  const categories = Object.keys(groupByCategory(month));

  $("headerSummary").textContent = latest
    ? `已解析 ${state.transactions.length} 笔消费。最近一笔是 ${displayDate(latest.paid_at)} 的 ${latest.merchant || latest.thing || "消费"}，本月覆盖 ${categories.length} 个消费场景。`
    : "账本还没有数据，先同步一次邮箱账单吧。";

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
  const top = topCategory(selected);
  const selectedCategories = Object.keys(groupByCategory(selected));

  $("periodLabel").textContent = periodName();
  $("coreAmount").textContent = formatMoney(selectedSpend);
  $("primaryMeta").textContent = selected.length
    ? `${selected.length} 笔消费 · ${selectedCategories.length} 个场景 · 最高 ${categorySummary(selected)}`
    : "这个周期还没有记录到消费。";

  renderDelta(selectedSpend);

  $("coreNarrative").textContent = top
    ? `${periodLabel()}权重最高的是 ${categoryLabel(top[0])}，Agent 正在把该周期的金额、频率、支付渠道和单笔峰值一起分析。`
    : "等待 Agent 建立当前消费画像。";
  // 「今日」时日均就等于头图那个数字，换成笔均，避免同一个值出现两次。
  const perTransaction = state.period === "today";
  $("avgSpendLabel").textContent = perTransaction ? "笔均支出" : "日均支出";
  $("avgDailySpend").textContent = selected.length
    ? formatMoney(perTransaction ? selectedSpend / selected.length : selectedSpend / elapsedDaysInPeriod())
    : "--";
  $("txnCount").textContent = `${selected.length} 笔`;
  $("largestSpend").textContent = maxTx ? formatMoney(maxTx.amount) : "--";
  $("confidenceScore").textContent = selected.length ? `${averageConfidence(selected)}%` : "--";
  $("signalMeta").textContent = `${periodLabel()}样本 ${selected.length} 笔 · ${averageConfidence(selected)}% 置信`;

  const stateChip = $("analysisState");
  stateChip.textContent = selected.length ? "Active" : "Learning";
  stateChip.dataset.state = selected.length ? "active" : "idle";
}

function renderDelta(currentSpend) {
  const node = $("coreDelta");
  const baseline = comparisonBaseline();
  if (!baseline || !(baseline.value > 0)) {
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
    fill.style.width = "0%";
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
  fill.style.width = `${clamp(usage, 0, 100)}%`;
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
  const series = trendSeries("day");
  const max = Math.max(...series.map((item) => item.amount), 1);
  const width = 140;
  const height = 46;
  const band = width / series.length;
  const barWidth = Math.min(band * 0.56, 12);

  const bars = series
    .map((item, index) => {
      const barHeight = Math.max((Math.max(item.amount, 0) / max) * height, 2);
      const x = band * index + (band - barWidth) / 2;
      return `<rect class="spark-bar${item.current ? " is-today" : ""}" x="${x.toFixed(1)}" y="${(height - barHeight).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="2"></rect>`;
    })
    .join("");

  $("heroSparkChart").innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>`;
  $("heroSpark").setAttribute(
    "aria-label",
    `近 7 天每日支出，最高 ${formatMoney(max)}。打开现金流趋势`,
  );
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
            `<span class="composition-seg" style="width:${((seg.amount / total) * 100).toFixed(2)}%;--seg-color:${seg.color}"></span>`,
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

function buildDecisionItems() {
  const selected = scopedTransactions(state.period);
  const selectedSpend = sum(selected);
  const maxTx = largest(selected);
  const grouped = groupByCategory(selected);
  const top = topCategory(selected);
  const foodAmount = (grouped.food_delivery?.amount || 0) + (grouped.coffee_tea?.amount || 0);
  const foodCount = (grouped.food_delivery?.count || 0) + (grouped.coffee_tea?.count || 0);
  const apps = [...new Set(selected.map((tx) => paymentLabel(tx.payment_app)).filter(Boolean))];
  const topShare = top ? Math.round((top[1].amount / Math.max(selectedSpend, 1)) * 100) : 0;
  const label = periodLabel();

  return [
    {
      type: "事实",
      tone: "normal",
      title: `${label}共 ${selected.length} 笔消费`,
      copy: `当前选择周期的总支出为 ${formatMoney(selectedSpend)}，覆盖 ${Object.keys(grouped).length} 个消费场景。`,
    },
    {
      type: "模式",
      tone: "normal",
      title: top ? `${categoryLabel(top[0])} 是${label}最高权重` : "样本仍在建立",
      copy: top ? `该场景占当前选择周期支出的 ${topShare}%，说明现金流变化主要由少数场景驱动。` : "继续积累账单后，Agent 会开始判断稳定习惯。",
    },
    {
      type: "风险",
      tone: foodCount >= 2 ? "warn" : "normal",
      title: foodCount >= 2 ? `餐饮茶饮出现 ${foodCount} 次` : "餐饮频率暂无压力",
      copy: foodCount >= 2 ? `餐饮和茶饮合计 ${formatMoney(foodAmount)}。建议先观察频率，再决定是否设置预算线。` : "当前餐饮样本偏少，先保持监控。",
    },
    {
      type: "动作",
      tone: "normal",
      title: maxTx ? `最大单笔来自 ${maxTx.merchant || maxTx.product || "未知商户"}` : "暂无最大单笔",
      copy: maxTx ? `${formatMoney(maxTx.amount)} 已被标记为关键节点。支付渠道覆盖 ${apps.join("、") || "暂无"}。` : "新账单进入后会自动标记关键节点。",
    },
  ];
}

function renderDecisionFeed() {
  const selected = scopedTransactions(state.period);
  if (!selected.length) {
    $("decisionFeed").innerHTML = emptyState({
      icon: "alert",
      title: `${periodLabel()}还没有消费记录`,
      hint: "换一个周期，或者同步一次邮箱账单，Agent 就会开始给结论。",
    });
    return;
  }

  $("decisionFeed").innerHTML = buildDecisionItems()
    .map(
      (item) => `
      <div class="decision-item${item.tone === "warn" ? " warn" : ""}">
        <span class="decision-type">${escapeHtml(item.type)}</span>
        <div class="decision-copy">
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.copy)}</span>
        </div>
      </div>
    `,
    )
    .join("");
}

function renderCategoryStack() {
  const selected = scopedTransactions(state.period);
  const grouped = groupByCategory(selected);
  const entries = Object.entries(grouped).sort((a, b) => b[1].amount - a[1].amount);
  const peak = entries.length ? entries[0][1].amount : 0;
  const total = Math.max(sum(selected), 1);

  $("categoryStack").innerHTML = entries.length
    ? entries
        .map(([category, value]) => {
          const share = Math.round((value.amount / total) * 100);
          const width = peak > 0 ? (value.amount / peak) * 100 : 0;
          return `
            <div class="category-row">
              <div class="category-name">
                <span class="legend-dot" style="--seg-color:${categoryColor(category)}" aria-hidden="true"></span>
                <strong>${escapeHtml(categoryLabel(category))}</strong>
              </div>
              <div class="category-value">${escapeHtml(formatMoney(value.amount))}</div>
              <div class="category-track" aria-hidden="true"><span style="width:${width.toFixed(1)}%;--seg-color:${categoryColor(category)}"></span></div>
              <div class="category-sub">${value.count} 笔 · 占 ${share}%</div>
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
  let transactions = scopedTransactions(state.period);
  if (state.filter !== "all") transactions = transactions.filter((tx) => (tx.category || "uncategorized") === state.filter);

  const totalPages = Math.max(1, Math.ceil(transactions.length / ledgerPageSize));
  state.ledgerPage = Math.min(Math.max(state.ledgerPage, 1), totalPages);
  const start = (state.ledgerPage - 1) * ledgerPageSize;
  const pageTransactions = transactions.slice(start, start + ledgerPageSize);

  if (!transactions.length) {
    const isFiltered = state.filter !== "all";
    const body = state.transactions.length
      ? emptyState({
          icon: isFiltered ? "filter" : "empty",
          title: isFiltered ? `${categoryLabel(state.filter)}在${periodLabel()}没有记录` : `${periodLabel()}还没有交易`,
          hint: isFiltered ? "换个分类或者把周期放宽到「全部」。" : "把账单截图发到绑定邮箱，同步后就会出现在这里。",
          action: isFiltered
            ? `<button class="btn btn-quiet" type="button" data-filter="all">查看全部分类</button>`
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
        <tr class="txn-row" role="row" data-motion-row>
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

function addMessage(role, text, options = {}) {
  const shouldSave = options.save !== false;
  const container = $("chatMessages");
  const node = document.createElement("div");
  node.className = `message ${role}`;
  if (options.thinking) {
    node.classList.add("thinking-message");
    node.innerHTML = `<span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>${escapeHtml(text)}</span>`;
  } else {
    if (options.periodTag) {
      const chip = document.createElement("span");
      chip.className = "period-chip";
      chip.textContent = options.periodTag;
      node.appendChild(chip);
    }
    const body = document.createElement("div");
    body.className = "message-body";
    setMessageContent(body, role, text, options);
    node.appendChild(body);
  }
  container.appendChild(node);
  container.scrollTop = container.scrollHeight;
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
  const input = $("chatInput");
  if (button) {
    button.disabled = busy;
    const text = button.querySelector(".chat-send-text");
    if (text) text.textContent = busy ? button.dataset.labelBusy : button.dataset.labelIdle;
  }
  if (input) input.setAttribute("aria-busy", busy ? "true" : "false");
  document.querySelectorAll(".quick-prompts button").forEach((node) => {
    node.disabled = busy;
  });
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
    thinkingNode.innerHTML = "";
    const body = document.createElement("div");
    body.className = "message-body";
    thinkingNode.appendChild(body);
    setMessageContent(body, "agent", answer, { split: true });
    state.chatHistory.push({ role: "assistant", content: answer });
    state.chatHistory = state.chatHistory.slice(-12);
  } catch (error) {
    const fallback = `没能拿到回答：${error.message}`;
    thinkingNode.classList.remove("thinking-message");
    thinkingNode.classList.add("error-message");
    thinkingNode.innerHTML = "";
    const body = document.createElement("div");
    body.className = "message-body";
    thinkingNode.appendChild(body);
    setMessageContent(body, "agent", fallback);
    state.chatHistory.push({ role: "assistant", content: fallback });
    state.chatHistory = state.chatHistory.slice(-12);
  } finally {
    setChatBusy(false);
    $("chatMessages").scrollTop = $("chatMessages").scrollHeight;
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
  $("openTrendModal").addEventListener("click", () => openModal("trendModal"));
  $("heroSpark").addEventListener("click", () => openModal("trendModal"));
  $("openBudgetSettings").addEventListener("click", () => openModal("budgetModal"));

  $("openSyncModal").addEventListener("click", () => {
    openModal("syncModal");
    syncMailData();
  });

  $("startSyncButton").addEventListener("click", () => syncMailData());

  document.querySelectorAll("[data-modal-close]").forEach((button) => {
    button.addEventListener("click", () => closeModal(button.dataset.modalClose));
  });

  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeModal(backdrop.id);
    });
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
      const modal = topmostOpenModal();
      if (modal) closeModal(modal.id);
      return;
    }

    trapFocus(event);

    // "/" 聚焦提问框；输入态里不劫持
    const tag = document.activeElement?.tagName;
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

  $("filterBar").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.filterAction === "toggle-more") {
      state.ledgerFilterExpanded = !state.ledgerFilterExpanded;
      renderFilters();
      window.refreshCfoMotion?.({ scope: "ledger", quiet: true });
      return;
    }
    if (!button.dataset.filter) return;
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
    if (!button) return;
    state.filter = button.dataset.filter;
    state.ledgerPage = 1;
    renderFilters();
    renderTransactions();
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
  });
  window.cfoDataReady = dataReady;

  addMessage("agent", "账本已经同步好了。可以问我今日支出、本月最大一笔、预算使用率，或者最近外卖和奶茶的频率。");
  wireInteractions();
  window.initCfoMotion?.();
  await dataReady;

  let failures = 0;
  window.setInterval(async () => {
    try {
      await loadSnapshot();
      renderAll();
      if (!$("trendModal").hidden) renderTrendModal();
      window.refreshCfoMotion?.({ quiet: true });
      failures = 0;
    } catch (error) {
      failures += 1;
      console.warn("snapshot refresh failed", error);
      if (failures === 1) showToast("账本刷新失败，将继续重试", "error");
    }
  }, 30000);
}

boot().catch((error) => {
  window.skipCfoOpening?.();
  renderFatalError("账本加载失败", error.message);
});
