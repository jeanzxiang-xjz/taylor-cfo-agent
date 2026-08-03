/**
 * 动效层。原则：
 * 1. 开场不挡路 —— 一次会话只播一次，可跳过，最多等数据 1.2s。
 * 2. 只做入场和状态反馈，不做常驻循环动画。
 * 3. 只动 transform / opacity。
 * 4. prefers-reduced-motion 下整套直接跳过。
 */
(function () {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const OPENING_SEEN_KEY = "cfoOpeningSeen";
  const DATA_WAIT_MS = 1200;

  let initialized = false;
  let openingDone = false;

  function $(selector, root = document) {
    return root.querySelector(selector);
  }

  function $$(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function hasGsap() {
    return Boolean(window.gsap && window.ScrollTrigger);
  }

  function openingAlreadySeen() {
    try {
      return sessionStorage.getItem(OPENING_SEEN_KEY) === "1";
    } catch {
      return false;
    }
  }

  function markOpeningSeen() {
    try {
      sessionStorage.setItem(OPENING_SEEN_KEY, "1");
    } catch {
      /* 隐私模式下 sessionStorage 可能不可写，忽略即可。 */
    }
  }

  function waitForData(timeout = DATA_WAIT_MS) {
    return Promise.race([
      Promise.resolve(window.cfoDataReady).catch(() => undefined),
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
    markOpeningSeen();
  }

  /* ------------------------------ 无动效路径 ------------------------------ */

  function finishWithoutMotion() {
    const overlay = $(".opening-overlay");
    if (overlay) overlay.style.display = "none";
    document.documentElement.classList.add("motion-reduced");
    settleApp();
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
        window.ScrollTrigger.refresh();
      },
    });

    timeline
      .fromTo(".opening-kicker", { y: 14, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.34 }, 0)
      .fromTo(
        ".opening-title span",
        { yPercent: 108, autoAlpha: 0 },
        { yPercent: 0, autoAlpha: 1, duration: 0.62, stagger: 0.07, ease: "expo.out" },
        0.06,
      )
      .fromTo(".opening-scan", { scaleX: 0 }, { scaleX: 1, duration: 0.55 }, 0.3)
      .fromTo(".opening-meta", { y: 10, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.34 }, 0.42)
      .add(() => {
        timeline.pause();
        waitForData().finally(() => {
          if (!openingDone) timeline.resume();
        });
      }, 0.72)
      .to(".opening-inner", { y: -18, autoAlpha: 0, duration: 0.4, ease: "power2.in" }, 0.78)
      .to(overlay, { clipPath: "inset(0% 0% 100% 0%)", duration: 0.62, ease: "power4.inOut" }, 0.86)
      .to(rail, { y: 0, autoAlpha: 1, duration: 0.5 }, 1.0)
      .to(heroFigure, { y: 0, autoAlpha: 1, duration: 0.62 }, 1.06)
      .to(heroChat, { y: 0, autoAlpha: 1, duration: 0.62 }, 1.14);

    window.skipCfoOpening = () => {
      if (openingDone) return;
      timeline.kill();
      window.gsap.set([rail, heroFigure, heroChat].filter(Boolean), { clearProps: "all" });
      window.gsap.set(overlay, { autoAlpha: 0 });
      settleApp();
      setupScrollAnimations();
      window.ScrollTrigger.refresh();
    };

    $("[data-opening-skip]")?.addEventListener("click", () => window.skipCfoOpening());
    overlay?.addEventListener("click", () => window.skipCfoOpening());
  }

  /** 本次会话已经看过开场：直接把首屏做一次轻入场。 */
  function quickEnter() {
    const gsap = window.gsap;
    const overlay = $(".opening-overlay");
    if (overlay) overlay.style.display = "none";
    document.body.classList.remove("app-loading");
    document.body.classList.add("motion-ready");

    gsap.fromTo(
      [".rail", ".hero-figure", ".hero-chat"],
      { y: 14, autoAlpha: 0 },
      {
        y: 0,
        autoAlpha: 1,
        duration: 0.5,
        stagger: 0.07,
        ease: "power3.out",
        clearProps: "transform,opacity,visibility",
        onComplete: () => {
          settleApp();
          setupScrollAnimations();
          window.ScrollTrigger.refresh();
        },
      },
    );
  }

  /* ------------------------------ 滚动入场 ------------------------------ */

  const SECTION_TARGETS = {
    signals: ".stat, .analysis-feed, .category-console",
    ledger: ".filter-bar, .table-wrap, .ledger-pagination",
  };

  function revealSection(sectionId, targetSelector) {
    const section = document.getElementById(sectionId);
    if (!section || section.dataset.motionPrepared) return;
    section.dataset.motionPrepared = "true";

    const gsap = window.gsap;
    const titleInner = $(".section-head .motion-title-mask > span", section);
    const copy = $(".section-head p", section);
    const cards = $$(targetSelector, section);

    gsap.set(titleInner, { yPercent: 110 });
    gsap.set(copy, { y: 12, autoAlpha: 0 });
    gsap.set(cards, { y: 20, autoAlpha: 0 });

    gsap
      .timeline({
        scrollTrigger: { trigger: section, start: "top 82%", once: true },
        defaults: { ease: "power3.out" },
      })
      .to(titleInner, { yPercent: 0, duration: 0.72 })
      .to(copy, { y: 0, autoAlpha: 1, duration: 0.5 }, "-=0.5")
      .to(cards, { y: 0, autoAlpha: 1, duration: 0.55, stagger: 0.06, clearProps: "transform" }, "-=0.38");
  }

  function setupScrollAnimations() {
    Object.entries(SECTION_TARGETS).forEach(([id, selector]) => revealSection(id, selector));
    // 保险丝：只处理「已经进入视口却还是全透明」的情况——
    // ScrollTrigger 没起作用时内容不能永远看不见，但正常的滚动入场不受影响。
    const rescue = () => {
      Object.entries(SECTION_TARGETS).forEach(([id, selector]) => {
        const section = document.getElementById(id);
        if (!section) return;
        if (section.getBoundingClientRect().top > window.innerHeight * 0.9) return;
        const stuck = $$(selector, section).filter((node) => Number(getComputedStyle(node).opacity) < 0.05);
        if (stuck.length) window.gsap.set(stuck, { clearProps: "all" });
      });
    };
    window.setTimeout(rescue, 2600);
    window.addEventListener("load", () => window.setTimeout(rescue, 1200), { once: true });
  }

  /* ------------------------------ 数据变化反馈 ------------------------------ */

  function animateDynamicContent(options = {}) {
    if (!initialized || reduceMotion || !hasGsap()) return;
    window.ScrollTrigger.refresh();
    if (options.quiet) return;

    const gsap = window.gsap;
    const scope = options.scope || "global";
    const ledgerTargets = $$(".txn-row");

    const run = (targets, config = {}) => {
      if (!targets.length) return;
      gsap.fromTo(
        targets,
        { y: config.y ?? 10, autoAlpha: 0 },
        {
          y: 0,
          autoAlpha: 1,
          duration: config.duration ?? 0.42,
          stagger: config.stagger ?? 0.03,
          ease: "power2.out",
          overwrite: true,
          clearProps: "transform",
        },
      );
    };

    if (scope === "ledger") {
      run(ledgerTargets, { duration: 0.3, stagger: 0.018, y: 8 });
      return;
    }

    // 周期切换：数字轻微上浮，让「这块变了」一眼可见。
    const figure = $("#coreAmount");
    if (figure) {
      gsap.fromTo(figure, { y: 8, autoAlpha: 0.2 }, { y: 0, autoAlpha: 1, duration: 0.42, ease: "power3.out", overwrite: true });
    }
    run($$(".stat strong, .decision-item, .category-row, .composition-legend > li"), { y: 8, stagger: 0.025 });
    run(ledgerTargets, { duration: 0.3, stagger: 0.018, y: 8 });
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

    window.gsap.registerPlugin(window.ScrollTrigger);
    markMotionTargets();

    if (openingAlreadySeen()) {
      await waitForData();
      quickEnter();
      return;
    }

    playOpening();
  };

  window.refreshCfoMotion = function refreshCfoMotion(options = {}) {
    requestAnimationFrame(() => {
      markMotionTargets();
      animateDynamicContent(options);
    });
  };
})();
