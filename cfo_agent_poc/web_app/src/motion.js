/**
 * 动效层。原则：
 * 1. 开场不挡路 —— 一次会话只播一次，可跳过，最多等数据 1.2s。
 * 2. 只做入场和状态反馈，不做常驻循环动画。
 * 3. 以 transform / opacity 为主，刷新反馈辅以短暂 blur / clipPath。
 * 4. prefers-reduced-motion 下整套直接跳过。
 */
(function () {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DATA_WAIT_MS = 1200;

  // 开场节奏（想调快慢改这两个数就行，单位秒）：
  //   0 → BUILD_END      入场：发丝线 / 字幕 / 插画依次铺开
  //   BUILD_END → +HOLD  停留：画面静止，同时把账本数据等完
  //   之后                退场：内容上移淡出 + 整屏向上擦除，露出应用
  // 三段严格串行。之前入场还没走完退场就开始了，所以才一闪而过。
  const OPENING_BUILD_END = 1.6;
  const OPENING_HOLD = 1.8;
  const OPENING_EXIT_AT = OPENING_BUILD_END + OPENING_HOLD;

  let initialized = false;
  let openingDone = false;
  let dynamicSnapshot = null;

  function $(selector, root = document) {
    return root.querySelector(selector);
  }

  function $$(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function hasGsap() {
    return Boolean(window.gsap);
  }

  function waitForData(timeout = DATA_WAIT_MS) {
    return Promise.race([
      Promise.resolve(window.cfoDataReady).catch(() => undefined),
      new Promise((resolve) => window.setTimeout(resolve, timeout)),
    ]);
  }

  /** 开场插画要先解码完，否则擦除动画播完了图才跳出来。 */
  function waitForStatic(timeout = 900) {
    return Promise.race([
      Promise.resolve(window.cfoStaticReady).catch(() => undefined),
      new Promise((resolve) => window.setTimeout(resolve, timeout)),
    ]);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => {
      const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
      return map[char];
    });
  }

  function wrapTitleMask(element) {
    if (!element || element.dataset.motionWrapped) return;
    element.innerHTML = `<span class="motion-title-mask"><span>${escapeHtml(element.textContent)}</span></span>`;
    element.dataset.motionWrapped = "true";
  }

  /** 只包裹内容稳定的标题；#periodLabel 由控制器每次渲染重写，包了会被冲掉。 */
  function markMotionTargets() {
    $$(".section-head h2, .modal-header h2").forEach(wrapTitleMask);
  }

  function settleApp() {
    document.body.classList.remove("app-loading", "motion-running");
    document.body.classList.add("motion-ready", "motion-complete");
    openingDone = true;
  }

  /* ------------------------------ 无动效路径 ------------------------------ */

  function finishWithoutMotion() {
    const overlay = $(".opening-overlay");
    if (overlay) overlay.style.display = "none";
    document.documentElement.classList.add("motion-reduced");
    settleApp();
    primeDynamicState();
  }

  /* ------------------------------ 开场 ------------------------------ */

  function playOpening() {
    const gsap = window.gsap;
    const overlay = $(".opening-overlay");
    const rail = $(".rail");
    const heroFigure = $(".hero-figure");
    const heroChat = $(".hero-chat");

    document.body.classList.remove("app-loading");
    document.body.classList.add("motion-running", "motion-ready");

    gsap.set([rail, heroFigure, heroChat].filter(Boolean), { y: 18, autoAlpha: 0 });

    const timeline = gsap.timeline({
      defaults: { ease: "power3.out" },
      onComplete: () => {
        gsap.set(overlay, { autoAlpha: 0 });
        gsap.set([rail, heroFigure, heroChat].filter(Boolean), { clearProps: "transform,opacity,visibility" });
        settleApp();
        setupScrollAnimations();
        primeDynamicState();
      },
    });

    timeline
      // —— 入场：0 → OPENING_BUILD_END ——
      .fromTo(".opening-rule", { scaleX: 0 }, { scaleX: 1, duration: 0.86, stagger: 0.1, ease: "power3.out" }, 0)
      .fromTo(".opening-kicker", { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.46 }, 0.14)
      .fromTo(
        ".opening-title > span > i",
        { yPercent: 112, scaleX: 0.86, autoAlpha: 0 },
        { yPercent: 0, scaleX: 1, autoAlpha: 1, duration: 0.94, stagger: 0.11, ease: "expo.out" },
        0.24,
      )
      .fromTo(
        ".opening-illustration-wrap",
        { x: 36, autoAlpha: 0 },
        { x: 0, autoAlpha: 1, duration: 0.94, ease: "power4.out" },
        0.5,
      )
      .fromTo(
        ".opening-illustration",
        { scale: 1.08, y: 16 },
        { scale: 1, y: 0, duration: 1.05, ease: "power4.out" },
        0.55,
      )
      // 宣传语跟在字标后面起，发丝线随即从它下方拉过
      .fromTo(".opening-tagline", { y: 14, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.56 }, 0.56)
      .fromTo(".opening-scan", { scaleX: 0 }, { scaleX: 1, duration: 0.74 }, 0.68)
      .fromTo(".opening-subline", { y: 12, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.46 }, 0.98)
      .fromTo(".opening-skip", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 }, 1.15)

      // —— 停留：铺完之后静止 OPENING_HOLD 秒，顺带把数据等完 ——
      .add(() => {
        timeline.pause();
        waitForData().finally(() => {
          if (!openingDone) timeline.resume();
        });
      }, OPENING_EXIT_AT)

      // —— 退场 ——
      .to(".opening-skip", { autoAlpha: 0, duration: 0.25 }, OPENING_EXIT_AT)
      .to(".opening-content", { y: -18, autoAlpha: 0, duration: 0.46, ease: "power2.in" }, OPENING_EXIT_AT + 0.04)
      .to(
        ".opening-rule",
        { scaleX: 0, transformOrigin: "right center", duration: 0.5, ease: "power2.in" },
        OPENING_EXIT_AT + 0.08,
      )
      .to(overlay, { clipPath: "inset(0% 0% 100% 0%)", duration: 0.7, ease: "power4.inOut" }, OPENING_EXIT_AT + 0.22)
      .to(rail, { y: 0, autoAlpha: 1, duration: 0.52 }, OPENING_EXIT_AT + 0.42)
      .to(heroFigure, { y: 0, autoAlpha: 1, duration: 0.64 }, OPENING_EXIT_AT + 0.48)
      .to(heroChat, { y: 0, autoAlpha: 1, duration: 0.64 }, OPENING_EXIT_AT + 0.56);

    window.skipCfoOpening = () => {
      if (openingDone) return;
      timeline.kill();
      window.gsap.set([rail, heroFigure, heroChat].filter(Boolean), { clearProps: "all" });
      window.gsap.set(overlay, { autoAlpha: 0 });
      settleApp();
      setupScrollAnimations();
      primeDynamicState();
      Promise.resolve(window.cfoDataReady).then(primeDynamicState).catch(() => undefined);
    };

    $("[data-opening-skip]")?.addEventListener("click", () => window.skipCfoOpening());
    overlay?.addEventListener("click", () => window.skipCfoOpening());
  }

  /* ------------------------------ 滚动入场 ------------------------------ */

  const SECTION_TARGETS = {
    signals: ".stat, .analysis-feed, .category-console",
    ledger: ".filter-bar, .table-wrap, .ledger-pagination",
  };

  function playReveal(element, keyframes, options) {
    if (!element?.animate) return;
    element.animate(keyframes, {
      duration: options.duration,
      delay: options.delay || 0,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      fill: "backwards",
    });
  }

  function revealSection(sectionId, targetSelector) {
    const section = document.getElementById(sectionId);
    if (!section || section.dataset.motionPrepared) return;
    section.dataset.motionPrepared = "true";

    const reveal = () => {
      if (section.dataset.motionRevealed) return;
      section.dataset.motionRevealed = "true";
      const titleInner = $(".section-head .motion-title-mask > span", section);
      const copy = $(".section-head p", section);
      const cards = $$(targetSelector, section);
      playReveal(titleInner, [
        { opacity: 0.55, transform: "translateY(8px)" },
        { opacity: 1, transform: "none" },
      ], { duration: 240 });
      playReveal(copy, [
        { opacity: 0.55, transform: "translateY(6px)" },
        { opacity: 1, transform: "none" },
      ], { duration: 200, delay: 30 });
      cards.forEach((card, index) => {
        playReveal(card, [
          { opacity: 0.45, transform: "translateY(10px)" },
          { opacity: 1, transform: "none" },
        ], { duration: 260, delay: Math.min(index * 36, 108) });
      });
    };

    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      reveal();
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.04 });
    observer.observe(section);
  }

  function setupScrollAnimations() {
    Object.entries(SECTION_TARGETS).forEach(([id, selector]) => revealSection(id, selector));
  }

  /* ------------------------------ 数据变化反馈 ------------------------------ */

  const VALUE_TARGETS = [
    "#coreAmount",
    "#coreDelta",
    "#primaryMeta",
    "#heroBudgetValue",
    "#heroBudgetFoot",
    "#avgDailySpend",
    "#txnCount",
    "#largestSpend",
    "#confidenceScore",
    "#signalMeta",
    "#categoryCount",
  ];
  const REGION_TARGETS = ["#coreNarrative", "#decisionFeed", "#coreNodes", "#categoryStack"];

  function snapshotDynamicContent() {
    const values = new Map(VALUE_TARGETS.map((selector) => [selector, $(selector)?.textContent?.trim() || ""]));
    const regions = new Map(REGION_TARGETS.map((selector) => [selector, $(selector)?.textContent?.replace(/\s+/g, " ").trim() || ""]));
    const rows = new Map($$(".txn-row[data-transaction-uid]").map((row) => [
      row.dataset.transactionUid,
      row.textContent?.replace(/\s+/g, " ").trim() || "",
    ]));
    return { values, regions, rows };
  }

  function primeDynamicState() {
    dynamicSnapshot = snapshotDynamicContent();
  }

  function animateNode(node, keyframes, options) {
    if (!node?.animate || node.hidden) return;
    node.getAnimations().forEach((animation) => animation.cancel());
    node.animate(keyframes, {
      duration: options.duration,
      delay: options.delay || 0,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      fill: "backwards",
    });
  }

  function animateDynamicContent(options = {}) {
    if (!initialized || reduceMotion) return;
    const scope = options.scope || "global";
    const previous = dynamicSnapshot;
    const current = snapshotDynamicContent();
    dynamicSnapshot = current;
    if (options.quiet || !previous) return;

    const changedRows = $$(".txn-row[data-transaction-uid]").filter((row) => {
      const uid = row.dataset.transactionUid;
      return previous.rows.get(uid) !== current.rows.get(uid);
    });
    changedRows.forEach((row, index) => {
      animateNode(row, [
        { opacity: 0.45, transform: "translateY(4px)" },
        { opacity: 1, transform: "none" },
      ], { duration: 220, delay: Math.min(index * 12, 72) });
    });

    if (scope === "ledger") {
      return;
    }

    VALUE_TARGETS.forEach((selector) => {
      if (previous.values.get(selector) === current.values.get(selector)) return;
      animateNode($(selector), [
        { opacity: 0.48, transform: "translateY(4px)" },
        { opacity: 1, transform: "none" },
      ], { duration: 220 });
    });

    REGION_TARGETS.forEach((selector) => {
      if (previous.regions.get(selector) === current.regions.get(selector)) return;
      animateNode($(selector), [{ opacity: 0.68 }, { opacity: 1 }], { duration: 180 });
    });
  }

  /* ------------------------------ 对外接口 ------------------------------ */

  window.skipCfoOpening = () => {};

  window.initCfoMotion = async function initCfoMotion() {
    if (initialized) {
      animateDynamicContent({ quiet: true });
      return;
    }
    initialized = true;

    if (reduceMotion || !hasGsap()) {
      await waitForData();
      finishWithoutMotion();
      return;
    }

    markMotionTargets();

    // 每次刷新都完整播放；不想看的用 Esc / 点击跳过。
    await waitForStatic();
    playOpening();
  };

  window.refreshCfoMotion = function refreshCfoMotion(options = {}) {
    requestAnimationFrame(() => {
      markMotionTargets();
      animateDynamicContent(options);
    });
  };
})();
