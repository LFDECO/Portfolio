// Mobile navigation, 3D/2D THz mode orchestration, 2D synthetic raster scan,
// staggered pull-up reveal motion, conditional recent activity, and metric count-ups.
(() => {
  const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const prefersReducedMotion = () => reduceMotionQuery.matches;
  const reduceMotion = prefersReducedMotion();

  // 1. Close mobile navigation drawer when a link is clicked (or Escape / outside click)
  const menu = document.querySelector("details.menu");
  if (menu) {
    menu.querySelectorAll(".menu-panel a").forEach(link => {
      link.addEventListener("click", () => { menu.open = false; });
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && menu.open) menu.open = false;
    });
    document.addEventListener("click", e => {
      if (menu.open && !menu.contains(e.target)) menu.open = false;
    });
  }

  // 2. Simulated THz raster scan + 3D/2D mode switching inside #thz-figure
  const thzFigure = document.getElementById("thz-figure");
  const thz3d = document.getElementById("thz-3d");
  const canvas = document.getElementById("scan");
  const readout = document.getElementById("readout");
  const scaleBar = thzFigure ? thzFigure.querySelector(".scale-bar") : document.querySelector(".scale-bar");
  const scaleSpan = scaleBar ? scaleBar.querySelector("span") : null;
  const tabs = thzFigure ? [...thzFigure.querySelectorAll(".segmented button[data-band]")] : [];

  if (thzFigure && canvas && tabs.length) {
    const N = 46;
    const ctx = canvas.getContext("2d");
    const MODES_3D = new Set(["3d-specimen", "3d-relief"]);
    const IDLE_READOUT = {
      "3d-specimen": "46 × 46 × 6 mm · 2 voids",
      "3d-relief": "46 × 46 mm · fused thermal relief",
      "350": "46 × 46 px · 1 mm/px",
      "500": "46 × 46 px · 1 mm/px",
      "fused": "46 × 46 px · 1 mm/px",
    };

    // Seeded PRNG so the scan looks the same on every visit
    function rng(seed) {
      return () => {
        seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function gauss(r) {
      const u = Math.max(r(), 1e-9), v = r();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    // Ground-truth reflectivity of the sample
    const inside = (x, y) => x >= 5 && x <= 40 && y >= 5 && y <= 40;
    const voids = [
      { x: 29.5, y: 16.5, rx: 4.2, ry: 3.0, a: 0.22 },
      { x: 14.5, y: 30.5, rx: 2.4, ry: 2.0, a: 0.15 },
    ];
    function truth(x, y, freq) {
      if (!inside(x, y)) return 0.08;
      let v = 0.5;
      // rectilinear infill at 45°, stronger at the higher frequency
      const infill = Math.cos((2 * Math.PI * (x + y)) / 5.5);
      v += (freq === 500 ? 0.05 : 0.025) * infill;
      for (const d of voids) {
        const q = ((x - d.x) / d.rx) ** 2 + ((y - d.y) / d.ry) ** 2;
        if (q < 1) v += d.a * (freq === 500 ? 1 : 0.8);
      }
      // bright rim from edge scattering
      const edge = Math.min(x - 5, 40 - x, y - 5, 40 - y);
      if (edge < 1.5) v += 0.22 * (1 - edge / 1.5);
      return v;
    }
    function blur(src, sigma) {
      const k = [], R = Math.ceil(sigma * 3);
      let s = 0;
      for (let i = -R; i <= R; i++) {
        const w = Math.exp(-(i * i) / (2 * sigma * sigma));
        k.push(w); s += w;
      }
      for (let i = 0; i < k.length; i++) k[i] /= s;
      const tmp = new Float32Array(N * N), out = new Float32Array(N * N);
      const at = (a, x, y) => a[Math.min(N - 1, Math.max(0, y)) * N + Math.min(N - 1, Math.max(0, x))];
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        let v = 0; for (let i = -R; i <= R; i++) v += k[i + R] * at(src, x + i, y);
        tmp[y * N + x] = v;
      }
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        let v = 0; for (let i = -R; i <= R; i++) v += k[i + R] * at(tmp, x, y + i);
        out[y * N + x] = v;
      }
      return out;
    }
    function band(freq, sigma, noise, seed) {
      const r = rng(seed), t = new Float32Array(N * N);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) t[y * N + x] = truth(x, y, freq);
      const b = blur(t, sigma);
      for (let i = 0; i < b.length; i++) b[i] += noise * gauss(r);
      return b;
    }
    function interiorMedian(a) {
      const vals = [];
      for (let y = 8; y <= 37; y++) for (let x = 8; x <= 37; x++) vals.push(a[y * N + x]);
      vals.sort((p, q) => p - q);
      return vals[vals.length >> 1];
    }

    const b350 = band(350, 1.7, 0.03, 7);
    const b500 = band(500, 1.15, 0.05, 11);
    const m350 = interiorMedian(b350), m500 = interiorMedian(b500);
    const fused = new Float32Array(N * N);
    for (let i = 0; i < fused.length; i++) {
      const x = i % N, y = (i / N) | 0;
      // edge-artifact masking: rim pixels fall back to the median
      const masked = !inside(x, y) ? 0.16 : Math.min(x - 5, 40 - x, y - 5, 40 - y) < 2 ? 1 : null;
      fused[i] = masked ?? 0.5 * (b350[i] / m350 + b500[i] / m500);
    }
    // segmentation mask on the fused map, robust threshold
    const fVals = [];
    for (let y = 8; y <= 37; y++) for (let x = 8; x <= 37; x++) fVals.push(fused[y * N + x]);
    fVals.sort((p, q) => p - q);
    const med = fVals[fVals.length >> 1];
    const mad = [...fVals.map(v => Math.abs(v - med))].sort((p, q) => p - q)[fVals.length >> 1];
    const thresh = med + 6 * mad;
    const mask = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) mask[i] = fused[i] > thresh ? 1 : 0;

    const data = {
      350: { a: b350, lo: 0.05, hi: 0.85 },
      500: { a: b500, lo: 0.05, hi: 0.85 },
      fused: { a: fused, lo: 0.55, hi: 1.45 },
    };

    // Thermal colormap in the page's copper family (base matches --paper-sunken #090b0d)
    const stops = [
      [0.0, [9, 11, 13]], [0.22, [52, 36, 30]], [0.45, [128, 54, 24]],
      [0.65, [196, 98, 42]], [0.84, [232, 166, 94]], [1.0, [247, 233, 200]],
    ];
    function cmap(t) {
      t = Math.min(1, Math.max(0, t));
      for (let i = 1; i < stops.length; i++) {
        if (t <= stops[i][0]) {
          const [t0, c0] = stops[i - 1], [t1, c1] = stops[i], f = (t - t0) / (t1 - t0);
          return c0.map((c, k) => Math.round(c + (c1[k] - c) * f));
        }
      }
      return stops[stops.length - 1][1];
    }

    const initialTab = tabs.find(b => b.getAttribute("aria-selected") === "true");
    let activeMode = initialTab ? initialTab.dataset.band : "3d-specimen";
    let current2d = data[activeMode] ? activeMode : "fused";
    let hasSwept2d = false;
    let sweepToken = 0;
    const cell = canvas.width / N;

    function draw(rows = N) {
      if (!ctx || !data[current2d]) return;
      const { a, lo, hi } = data[current2d];
      ctx.fillStyle = "#090b0d";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let y = 0; y < rows; y++) for (let x = 0; x < N; x++) {
        const [r, g, b] = cmap((a[y * N + x] - lo) / (hi - lo));
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
      if (current2d === "fused" && rows === N) drawOutline();
    }

    function drawOutline() {
      ctx.strokeStyle = "rgba(247, 244, 236, 0.95)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      const m = (x, y) => (x >= 0 && y >= 0 && x < N && y < N ? mask[y * N + x] : 0);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        if (!m(x, y)) continue;
        const px = x * cell, py = y * cell;
        if (!m(x, y - 1)) { ctx.moveTo(px, py); ctx.lineTo(px + cell, py); }
        if (!m(x, y + 1)) { ctx.moveTo(px, py + cell); ctx.lineTo(px + cell, py + cell); }
        if (!m(x - 1, y)) { ctx.moveTo(px, py); ctx.lineTo(px, py + cell); }
        if (!m(x + 1, y)) { ctx.moveTo(px + cell, py); ctx.lineTo(px + cell, py + cell); }
      }
      ctx.stroke();
    }

    function sweep() {
      const token = ++sweepToken;
      if (prefersReducedMotion()) { draw(); return; }
      const start = performance.now(), dur = 1100;
      const step = now => {
        if (token !== sweepToken) return;
        const t = Math.min(1, (now - start) / dur);
        const e = 1 - Math.pow(1 - t, 3);
        draw(Math.max(1, Math.round(e * N)));
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }

    function sizeScale() {
      if (scaleSpan && !canvas.hidden && canvas.clientWidth > 0) {
        scaleSpan.style.width = `${(canvas.clientWidth * 10) / N}px`;
      }
    }

    function selectMode(mode, { emit = true } = {}) {
      if (!mode) return;
      activeMode = mode;
      sweepToken++;

      tabs.forEach(b => b.setAttribute("aria-selected", String(b.dataset.band === mode)));

      const is3d = MODES_3D.has(mode);
      if (thz3d) thz3d.hidden = !is3d;
      canvas.hidden = is3d;
      if (scaleBar) scaleBar.hidden = is3d;

      if (readout) {
        readout.textContent = IDLE_READOUT[mode] || IDLE_READOUT["3d-specimen"];
      }

      if (!is3d && data[mode]) {
        current2d = mode;
        sizeScale();
        requestAnimationFrame(sizeScale);
        if (!hasSwept2d) {
          hasSwept2d = true;
          sweep();
        } else {
          draw();
        }
      }

      if (emit) {
        document.dispatchEvent(new CustomEvent("thz:mode", { detail: { mode } }));
      }
    }

    tabs.forEach(b => b.addEventListener("click", () => selectMode(b.dataset.band)));
    tabs.forEach((b, i) => b.addEventListener("keydown", e => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      selectMode(next.dataset.band);
    }));

    canvas.addEventListener("mousemove", e => {
      if (canvas.hidden || !data[current2d]) return;
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const x = Math.floor(((e.clientX - r.left) / r.width) * N);
      const y = Math.floor(((e.clientY - r.top) / r.height) * N);
      if (x < 0 || y < 0 || x >= N || y >= N) return;
      const v = data[current2d].a[y * N + x];
      const label = current2d === "fused" ? "norm" : "refl";
      if (readout) {
        readout.textContent = `x ${String(x).padStart(2, "0")} mm  y ${String(y).padStart(2, "0")} mm  ${label} ${v.toFixed(3)}`;
      }
    });
    canvas.addEventListener("mouseleave", () => {
      if (!canvas.hidden && readout) {
        readout.textContent = IDLE_READOUT[activeMode] || IDLE_READOUT["350"];
      }
    });

    window.addEventListener("resize", sizeScale);
    selectMode(activeMode, { emit: false });
  }

  // 3. Granular staggered pull-up / bidirectional reveal system
  const hasReveal = !reduceMotion && typeof IntersectionObserver === "function";
  const REVEAL_PARENTS_TO_UNWRAP = [
    "article.entry",
    ".about-highlights",
    ".skills",
  ];
  const GRANULAR_REVEAL_SELECTORS = [
    ".hero-eyebrow",
    ".hero-name",
    ".hero .lede",
    ".hero .actions > .btn",
    "#hero-3d-wrap",
    ".section-head",
    ".about-narrative > p",
    ".about-highlights .figures-compact > div",
    ".focus-row",
    ".entry-side > *",
    ".entry-head",
    ".entry-body > p",
    ".entry-body > figure",
    ".entry-body > .spectral-showcase",
    ".entry-body .figures > div",
    ".entry-body .points > li",
    ".project",
    ".record-block",
    ".skills > div",
    "#contact > *",
  ];

  function prepareRevealTargets(root = document) {
    REVEAL_PARENTS_TO_UNWRAP.forEach(sel => {
      root.querySelectorAll(sel).forEach(el => el.removeAttribute("data-reveal"));
    });

    GRANULAR_REVEAL_SELECTORS.forEach(sel => {
      root.querySelectorAll(sel).forEach(el => {
        if (!el.closest("[hidden]")) {
          el.setAttribute("data-reveal", "");
        }
      });
    });

    // Ensure no element keeps data-reveal if an ancestor also has data-reveal
    root.querySelectorAll("[data-reveal]").forEach(el => {
      if (el.parentElement && el.parentElement.closest("[data-reveal]")) {
        el.removeAttribute("data-reveal");
      }
    });
  }

  prepareRevealTargets();

  const revealNodes = [...document.querySelectorAll("[data-reveal]")].filter(
    el => !el.closest("[hidden]")
  );
  let revealObserver = null;
  let resetObserver = null;
  let heroTweenLock = false;
  let initialCascadePending = false;
  const initialVisibleSet = new Set();
  let lastScrollY = window.scrollY;
  let scrollDirection = "down";

  const revealElement = (el, delayMs = 0) => {
    if (!el || el.classList.contains("is-revealed")) return;
    el.style.setProperty("--reveal-delay", `${delayMs}ms`);
    el.classList.add("is-revealed");
  };

  const observeRevealNode = el => {
    if (revealObserver) revealObserver.observe(el);
    if (resetObserver) resetObserver.observe(el);
  };

  if (hasReveal) {
    document.documentElement.classList.add("has-reveal");

    revealObserver = new IntersectionObserver((entries) => {
      const entering = entries.filter(entry => {
        if (!entry.isIntersecting) return false;
        const el = entry.target;
        if (el.closest("[hidden]")) return false;
        if (heroTweenLock && el.closest(".hero")) return false;
        if (initialCascadePending && initialVisibleSet.has(el)) return false;
        return !el.classList.contains("is-revealed");
      });
      if (!entering.length) return;

      if (scrollDirection === "up") entering.reverse();
      entering.forEach((entry, idx) => {
        revealElement(entry.target, Math.min(idx, 8) * 85);
      });
    }, { threshold: 0.05, rootMargin: "0px 0px -12px 0px" });

    resetObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) return;
        const el = entry.target;
        if (el.closest("[hidden]")) return;
        if (initialCascadePending && initialVisibleSet.has(el)) return;

        const rect = entry.boundingClientRect;
        el.style.setProperty("--reveal-delay", "0ms");
        if (rect.bottom <= 0) {
          el.setAttribute("data-reveal-from", "top");
        } else {
          el.setAttribute("data-reveal-from", "bottom");
        }
        el.classList.remove("is-revealed");
      });
    }, { threshold: 0, rootMargin: "48px 0px 48px 0px" });

    const initialVisible = [];
    revealNodes.forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.bottom <= -24) {
        el.setAttribute("data-reveal-from", "top");
      } else if (rect.top < window.innerHeight) {
        el.setAttribute("data-reveal-from", "bottom");
        initialVisible.push(el);
        initialVisibleSet.add(el);
      } else {
        el.setAttribute("data-reveal-from", "bottom");
      }
      observeRevealNode(el);
    });

    // Prioritize hero name first so it pulls up immediately on load, then cascade gracefully
    if (initialVisible.length) {
      initialCascadePending = true;
      const heroNameEl = initialVisible.find(el => el.classList.contains("hero-name"));
      const orderedInitial = heroNameEl
        ? [heroNameEl, ...initialVisible.filter(el => el !== heroNameEl)]
        : initialVisible;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          orderedInitial.forEach((el, idx) => {
            revealElement(el, Math.min(idx, 10) * 90);
          });
          initialCascadePending = false;
          initialVisibleSet.clear();
        });
      });
    }

    if (typeof reduceMotionQuery.addEventListener === "function") {
      reduceMotionQuery.addEventListener("change", () => {
        if (prefersReducedMotion()) {
          document.querySelectorAll("[data-reveal]").forEach(el => revealElement(el, 0));
        }
      });
    }
  } else {
    revealNodes.forEach(el => el.classList.add("is-revealed"));
  }

  function registerDynamicReveals(container) {
    if (!container) return;
    prepareRevealTargets(container);
    const dynamicNodes = [...container.querySelectorAll("[data-reveal]")];
    if (!dynamicNodes.length) return;

    if (!hasReveal || prefersReducedMotion()) {
      dynamicNodes.forEach(el => el.classList.add("is-revealed"));
      return;
    }

    const immediate = [];
    dynamicNodes.forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.bottom <= -24) {
        el.setAttribute("data-reveal-from", "top");
      } else if (rect.top < window.innerHeight) {
        el.setAttribute("data-reveal-from", "bottom");
        immediate.push(el);
      } else {
        el.setAttribute("data-reveal-from", "bottom");
      }
      observeRevealNode(el);
    });

    if (immediate.length) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          immediate.forEach((el, idx) => revealElement(el, Math.min(idx, 8) * 85));
        });
      });
    }
  }

  // 4. Conditional recent activity feed (GitHub commits/events, LeetCode, LinkedIn)
  async function initRecentActivity() {
    const activitySection = document.getElementById("activity");
    const activityList = document.getElementById("activity-list");
    if (!activitySection || !activityList) return;

    const DEFAULT_WINDOW_DAYS = 90;
    const CACHE_TTL_MS = 5 * 60 * 1000;
    const now = Date.now();

    const safeUrl = (raw, fallback) => {
      if (typeof raw === "string" && /^https?:\/\//i.test(raw)) return raw;
      return fallback;
    };

    const formatRelativeTime = (tsMs) => {
      const diffSec = Math.max(0, Math.floor((now - tsMs) / 1000));
      if (diffSec < 60) return "just now";
      const mins = Math.floor(diffSec / 60);
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      const days = Math.floor(hrs / 24);
      if (days < 14) return `${days}d ago`;
      try {
        return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(tsMs));
      } catch {
        return `${days}d ago`;
      }
    };

    const formatLang = (lang) => {
      if (!lang) return "";
      const map = {
        python3: "Python 3",
        python: "Python",
        cpp: "C++",
        java: "Java",
        javascript: "JavaScript",
        typescript: "TypeScript",
        mysql: "MySQL",
        c: "C",
      };
      return map[String(lang).toLowerCase()] || lang;
    };

    const slugToTitle = (slug) => {
      const cleaned = String(slug || "").replace(/^\d+-/, "");
      return cleaned
        .split("-")
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    };

    const truncateText = (text, maxLen = 78) => {
      const clean = String(text || "").replace(/\s+/g, " ").trim();
      if (clean.length <= maxLen) return clean;
      return `${clean.slice(0, maxLen - 1).trimEnd()}…`;
    };

    async function fetchJsonCached(cacheKey, url, timeoutMs = 5500) {
      try {
        const cachedRaw = sessionStorage.getItem(cacheKey);
        if (cachedRaw) {
          const parsed = JSON.parse(cachedRaw);
          if (parsed && (now - parsed.savedAt) < CACHE_TTL_MS) {
            return parsed.data;
          }
        }
      } catch {
        // Ignore storage errors
      }

      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : 0;
      try {
        const res = await fetch(url, {
          signal: controller ? controller.signal : undefined,
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return null;
        const data = await res.json();
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify({ savedAt: now, data }));
        } catch {
          // Ignore storage quota errors
        }
        return data;
      } catch {
        return null;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    async function fetchLocalUpdatesConfig() {
      try {
        const res = await fetch("assets/updates.json", { cache: "no-store" });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    }

    const config = await fetchLocalUpdatesConfig();
    const windowDays = (config && Number(config.windowDays) > 0)
      ? Number(config.windowDays)
      : DEFAULT_WINDOW_DAYS;
    const windowMs = windowDays * 24 * 60 * 60 * 1000;

    const isRecent = (tsMs) => Number.isFinite(tsMs) && tsMs <= now + 60000 && (now - tsMs) <= windowMs;

    const [lcPrimary, ghEvents, ghRepos] = await Promise.all([
      fetchJsonCached("sb_lc_v3", "https://leetcode-api-faisalshohag.vercel.app/LFDECO"),
      fetchJsonCached("sb_gh_v3", "https://api.github.com/users/LFDECO/events/public?per_page=30"),
      fetchJsonCached("sb_gh_repos_v3", "https://api.github.com/users/LFDECO/repos?sort=pushed&per_page=8"),
    ]);

    const items = [];
    const seenCommitShas = new Set();

    // 1) Recent GitHub commits from top recently pushed repositories (excluding LeetCode mirror repo)
    if (Array.isArray(ghRepos)) {
      const targetRepos = ghRepos
        .filter(r => {
          if (!r || !r.full_name || r.full_name === "LFDECO/Leetcode-solutions") return false;
          const pushedMs = Date.parse(r.pushed_at || "");
          return isRecent(pushedMs);
        })
        .slice(0, 5);

      const commitResults = await Promise.allSettled(
        targetRepos.map(repo =>
          fetchJsonCached(
            `sb_gh_commits_${repo.name}_v3`,
            `https://api.github.com/repos/${repo.full_name}/commits?per_page=4`
          ).then(commits => ({ repo, commits }))
        )
      );

      commitResults.forEach(result => {
        if (result.status !== "fulfilled" || !result.value || !Array.isArray(result.value.commits)) return;
        const { repo, commits } = result.value;
        const shortRepo = repo.name || (repo.full_name.startsWith("LFDECO/") ? repo.full_name.slice(7) : repo.full_name);
        let addedFromRepo = 0;

        commits.forEach(c => {
          if (!c || !c.sha || seenCommitShas.has(c.sha) || addedFromRepo >= 3) return;
          const authorLogin = c.author?.login || "";
          const authorName = c.commit?.author?.name || "";
          if (authorLogin.endsWith("[bot]") || authorName.includes("[bot]")) return;

          const tsMs = Date.parse(c.commit?.author?.date || c.commit?.committer?.date || "");
          if (!isRecent(tsMs)) return;

          const rawMsg = (c.commit?.message || "").split("\n")[0].trim();
          if (!rawMsg) return;

          seenCommitShas.add(c.sha);
          addedFromRepo++;
          const shortSha = c.sha.slice(0, 7);
          const branch = repo.default_branch || "main";

          items.push({
            source: "GitHub",
            title: `${shortRepo}: ${truncateText(rawMsg, 72)}`,
            url: safeUrl(c.html_url, `https://github.com/${repo.full_name}/commit/${c.sha}`),
            detail: `Commit ${shortSha} · ${branch}`,
            tsMs,
          });
        });
      });
    }

    // 2) Recent LeetCode solves (with secondary API + GitHub fallback)
    let lcSubmissions = lcPrimary && Array.isArray(lcPrimary.recentSubmissions)
      ? lcPrimary.recentSubmissions
      : null;

    if (!lcSubmissions) {
      const lcBackup = await fetchJsonCached(
        "sb_lc_alt_v3",
        "https://alfa-leetcode-api.onrender.com/LFDECO/acSubmission?limit=10"
      );
      if (lcBackup && Array.isArray(lcBackup.submission)) {
        lcSubmissions = lcBackup.submission;
      }
    }

    const seenSlugs = new Set();
    let lcCount = 0;
    if (lcSubmissions) {
      lcSubmissions.forEach(sub => {
        if (lcCount >= 3 || (sub.statusDisplay && sub.statusDisplay !== "Accepted") || !sub.titleSlug || seenSlugs.has(sub.titleSlug)) return;
        const tsMs = Number(sub.timestamp) * 1000;
        if (!isRecent(tsMs)) return;
        seenSlugs.add(sub.titleSlug);
        lcCount++;
        const langLabel = formatLang(sub.lang);
        items.push({
          source: "LeetCode",
          title: (sub.title || slugToTitle(sub.titleSlug)).trim(),
          url: `https://leetcode.com/problems/${encodeURIComponent(sub.titleSlug)}/`,
          detail: langLabel ? `Accepted · ${langLabel}` : "Accepted",
          tsMs,
        });
      });
    } else {
      const lcCommits = await fetchJsonCached(
        "sb_lc_gh_v3",
        "https://api.github.com/repos/LFDECO/Leetcode-solutions/commits?per_page=10"
      );
      if (Array.isArray(lcCommits)) {
        lcCommits.forEach(c => {
          if (lcCount >= 3) return;
          const msg = c?.commit?.message || "";
          const match = msg.match(/(?:Create readme\s*:\s*|Add\s+)(\d+-[a-z0-9-]+)/i);
          if (!match) return;
          const slug = match[1];
          if (seenSlugs.has(slug)) return;
          const tsMs = Date.parse(c?.commit?.author?.date || "");
          if (!isRecent(tsMs)) return;
          seenSlugs.add(slug);
          lcCount++;
          items.push({
            source: "LeetCode",
            title: slugToTitle(slug),
            url: `https://github.com/LFDECO/Leetcode-solutions/tree/main/${encodeURIComponent(slug)}`,
            detail: "Accepted solution",
            tsMs,
          });
        });
      }
    }

    // 3) Additional GitHub activity (PRs, issues, releases, repo creation, or pushes not already listed)
    if (Array.isArray(ghEvents)) {
      const IGNORED_REPOS = new Set(["LFDECO/Leetcode-solutions"]);
      const ALLOWED_EVENTS = new Set([
        "PushEvent",
        "PullRequestEvent",
        "CreateEvent",
        "IssuesEvent",
        "IssueCommentEvent",
        "PullRequestReviewEvent",
        "ReleaseEvent",
      ]);

      ghEvents.forEach(ev => {
        if (!ev || !ALLOWED_EVENTS.has(ev.type)) return;
        const repoName = ev.repo?.name || "";
        if (!repoName || IGNORED_REPOS.has(repoName)) return;
        const actor = ev.actor?.login || "";
        if (actor.endsWith("[bot]") || actor === "github-actions") return;

        const tsMs = Date.parse(ev.created_at || "");
        if (!isRecent(tsMs)) return;

        if (ev.type === "PushEvent") {
          const headSha = ev.payload?.head || "";
          if (headSha && seenCommitShas.has(headSha)) return;
          const commits = Array.isArray(ev.payload?.commits) ? ev.payload.commits : null;
          if (commits && commits.some(cm => cm?.sha && seenCommitShas.has(cm.sha))) return;
        }

        const shortRepo = repoName.startsWith("LFDECO/") ? repoName.slice(7) : repoName;
        const repoUrl = `https://github.com/${repoName}`;
        let title = shortRepo;
        let url = repoUrl;
        let detail = "";

        if (ev.type === "PushEvent") {
          const branch = (ev.payload?.ref || "").replace(/^refs\/heads\//, "");
          const commits = Array.isArray(ev.payload?.commits) ? ev.payload.commits : [];
          const latestMsg = commits.length ? (commits[commits.length - 1]?.message || "").split("\n")[0].trim() : "";
          if (latestMsg) {
            title = `${shortRepo}: ${truncateText(latestMsg, 72)}`;
            const sha = commits[commits.length - 1]?.sha || ev.payload?.head || "";
            if (sha) {
              seenCommitShas.add(sha);
              url = `${repoUrl}/commit/${sha}`;
            }
            detail = `${commits.length} commit${commits.length === 1 ? "" : "s"}${branch ? ` · ${branch}` : ""}`;
          } else {
            detail = branch ? `Pushed to ${branch}` : "Pushed commits";
          }
        } else if (ev.type === "PullRequestEvent") {
          const pr = ev.payload?.pull_request;
          const action = ev.payload?.action || "updated";
          title = pr?.title ? `${shortRepo}: ${pr.title}` : shortRepo;
          url = safeUrl(pr?.html_url, repoUrl);
          detail = `Pull request ${action}`;
        } else if (ev.type === "CreateEvent") {
          const refType = ev.payload?.ref_type || "repository";
          const refName = ev.payload?.ref || "";
          detail = refName ? `Created ${refType} ${refName}` : `Created ${refType}`;
        } else if (ev.type === "IssuesEvent") {
          const issue = ev.payload?.issue;
          const action = ev.payload?.action || "updated";
          title = issue?.title ? `${shortRepo}: ${issue.title}` : shortRepo;
          url = safeUrl(issue?.html_url, repoUrl);
          detail = `Issue ${action}`;
        } else if (ev.type === "IssueCommentEvent") {
          const issue = ev.payload?.issue;
          title = issue?.title ? `${shortRepo}: ${issue.title}` : shortRepo;
          url = safeUrl(ev.payload?.comment?.html_url || issue?.html_url, repoUrl);
          detail = "Commented on issue";
        } else if (ev.type === "PullRequestReviewEvent") {
          const pr = ev.payload?.pull_request;
          title = pr?.title ? `${shortRepo}: ${pr.title}` : shortRepo;
          url = safeUrl(pr?.html_url, repoUrl);
          detail = "Reviewed pull request";
        } else if (ev.type === "ReleaseEvent") {
          const tag = ev.payload?.release?.tag_name || "";
          url = safeUrl(ev.payload?.release?.html_url, repoUrl);
          detail = tag ? `Released ${tag}` : "Published release";
        }

        items.push({
          source: "GitHub",
          title,
          url,
          detail,
          tsMs,
        });
      });
    }

    // 4) Recent LinkedIn updates from assets/updates.json
    const linkedinProfile = safeUrl(
      config?.linkedinProfile,
      "https://www.linkedin.com/in/siddhartha-bhaduri-6468142ab/"
    );
    if (config && Array.isArray(config.linkedin)) {
      config.linkedin.forEach(post => {
        if (!post || !post.title) return;
        const tsMs = Date.parse(post.date || "");
        if (!isRecent(tsMs)) return;
        items.push({
          source: "LinkedIn",
          title: String(post.title),
          url: safeUrl(post.url, linkedinProfile),
          detail: post.summary ? String(post.summary) : "Post",
          tsMs,
        });
      });
    }

    if (!items.length) {
      activitySection.hidden = true;
      return;
    }

    items.sort((a, b) => b.tsMs - a.tsMs);

    const frag = document.createDocumentFragment();
    items.slice(0, 8).forEach(item => {
      const li = document.createElement("li");
      li.className = "activity-item";
      li.setAttribute("data-reveal", "");

      const sourceSpan = document.createElement("span");
      sourceSpan.className = "activity-source";
      const dot = document.createElement("span");
      dot.className = "activity-dot";
      dot.setAttribute("aria-hidden", "true");
      sourceSpan.append(dot, document.createTextNode(item.source));

      const mainDiv = document.createElement("div");
      mainDiv.className = "activity-main";
      const link = document.createElement("a");
      link.className = "activity-title";
      link.href = safeUrl(item.url, "#activity");
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = item.title;
      mainDiv.appendChild(link);

      if (item.detail) {
        const detailSpan = document.createElement("span");
        detailSpan.className = "activity-detail";
        detailSpan.textContent = item.detail;
        mainDiv.appendChild(detailSpan);
      }

      const timeSpan = document.createElement("span");
      timeSpan.className = "activity-time";
      timeSpan.textContent = formatRelativeTime(item.tsMs);

      li.append(sourceSpan, mainDiv, timeSpan);
      frag.appendChild(li);
    });

    activityList.replaceChildren(frag);
    activitySection.hidden = false;
    registerDynamicReveals(activitySection);
  }

  initRecentActivity();

  // 5. Smooth internal anchor scrolling + animated #scroll-top + hero scrollback replay
  let activeScrollTween = 0;
  let hasLeftHero = window.scrollY > 320;
  let heroPreArmed = false;
  let lastHeroReplayAt = 0;
  const scrollTopBtn = document.getElementById("scroll-top");

  function cancelActiveScrollTween() {
    if (activeScrollTween) {
      cancelAnimationFrame(activeScrollTween);
      activeScrollTween = 0;
    }
    if (heroTweenLock) {
      heroTweenLock = false;
      heroPreArmed = false;
      getHeroRevealNodes().forEach((el, idx) => {
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) {
          revealElement(el, Math.min(idx, 8) * 60);
        }
      });
    }
    if (scrollTopBtn) scrollTopBtn.classList.remove("is-launching");
  }

  ["wheel", "touchstart"].forEach(evt => {
    window.addEventListener(evt, cancelActiveScrollTween, { passive: true });
  });
  window.addEventListener("keydown", e => {
    if (activeScrollTween && ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Space", "Home", "End"].includes(e.key)) {
      cancelActiveScrollTween();
    }
  });

  function getHeroRevealNodes() {
    const heroEl = document.querySelector(".hero");
    if (!heroEl) return [];
    const nodes = [...heroEl.querySelectorAll("[data-reveal]")];
    const heroNameEl = nodes.find(el => el.classList.contains("hero-name"));
    return heroNameEl
      ? [heroNameEl, ...nodes.filter(el => el !== heroNameEl)]
      : nodes;
  }

  function preArmHeroReplay() {
    if (!hasReveal || prefersReducedMotion() || heroPreArmed) return;
    const nodes = getHeroRevealNodes();
    if (!nodes.length) return;
    heroPreArmed = true;
    heroTweenLock = true;
    nodes.forEach(el => {
      el.style.setProperty("--reveal-delay", "0ms");
      el.setAttribute("data-reveal-from", "top");
      el.classList.remove("is-revealed");
    });
  }

  function triggerHeroScrollbackReplay() {
    const nowTs = performance.now();
    if (nowTs - lastHeroReplayAt < 450) return;
    lastHeroReplayAt = nowTs;
    hasLeftHero = false;
    heroTweenLock = false;

    if (!hasReveal || prefersReducedMotion()) {
      heroPreArmed = false;
      return;
    }

    const nodes = getHeroRevealNodes();
    if (!nodes.length) return;

    const wasPreArmed = heroPreArmed;
    heroPreArmed = false;

    if (wasPreArmed) {
      void document.body.offsetWidth;
      requestAnimationFrame(() => {
        nodes.forEach((el, idx) => {
          revealElement(el, Math.min(idx, 10) * 90);
        });
        document.dispatchEvent(new CustomEvent("hero:arrive"));
      });
    } else {
      nodes.forEach((el, idx) => {
        if (!el.classList.contains("is-revealed")) {
          revealElement(el, Math.min(idx, 10) * 90);
        }
      });
      document.dispatchEvent(new CustomEvent("hero:arrive"));
    }
  }

  function animateScrollTo(targetY, { onArrive } = {}) {
    cancelActiveScrollTween();
    const clampedY = Math.max(0, Math.min(targetY, document.documentElement.scrollHeight - window.innerHeight));

    if (prefersReducedMotion()) {
      window.scrollTo(0, clampedY);
      if (typeof onArrive === "function") onArrive();
      return;
    }

    const startY = window.scrollY;
    const deltaY = clampedY - startY;
    if (Math.abs(deltaY) < 2) {
      if (typeof onArrive === "function") onArrive();
      return;
    }

    const duration = Math.min(1050, Math.max(620, Math.abs(deltaY) * 0.22));
    const startTime = performance.now();

    const tick = nowTime => {
      const t = Math.min(1, (nowTime - startTime) / duration);
      const eased = t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;
      window.scrollTo(0, startY + deltaY * eased);

      if (t < 1) {
        activeScrollTween = requestAnimationFrame(tick);
      } else {
        activeScrollTween = 0;
        if (typeof onArrive === "function") onArrive();
      }
    };

    activeScrollTween = requestAnimationFrame(tick);
  }

  document.addEventListener("click", e => {
    const anchor = e.target.closest('a[href^="#"]');
    if (!anchor || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    const href = anchor.getAttribute("href");
    if (!href || href === "#") return;
    const target = document.getElementById(href.slice(1));
    if (!target) return;

    e.preventDefault();
    if (menu && menu.open) menu.open = false;

    if (href === "#top") {
      if (window.scrollY > 280) preArmHeroReplay();
      animateScrollTo(0, {
        onArrive: () => {
          if (hasLeftHero || heroPreArmed) triggerHeroScrollbackReplay();
        },
      });
    } else {
      const headerEl = document.querySelector(".site-header");
      const offset = (headerEl ? headerEl.offsetHeight : 64) + 16;
      const targetY = Math.max(0, window.scrollY + target.getBoundingClientRect().top - offset);
      animateScrollTo(targetY);
    }

    try {
      if (window.location.hash !== href) {
        history.pushState(null, "", href);
      }
    } catch {
      // Ignore history restrictions on non-standard origins
    }

    // Transfer focus cleanly for keyboard-triggered jumps without forcing scroll jumps
    if (e.detail === 0) {
      const hadTabIndex = target.hasAttribute("tabindex");
      if (!hadTabIndex) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
      if (!hadTabIndex) {
        target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
      }
    }
  });

  if (scrollTopBtn) {
    scrollTopBtn.addEventListener("click", () => {
      if (!prefersReducedMotion()) {
        scrollTopBtn.classList.add("is-launching");
      }
      if (window.scrollY > 280) preArmHeroReplay();
      animateScrollTo(0, {
        onArrive: () => {
          scrollTopBtn.classList.remove("is-launching");
          triggerHeroScrollbackReplay();
        },
      });
    });
  }

  function updateScrollTopButton() {
    if (!scrollTopBtn) return;
    const visible = window.scrollY > 360;
    scrollTopBtn.classList.toggle("is-visible", visible);
    scrollTopBtn.setAttribute("aria-hidden", visible ? "false" : "true");
    scrollTopBtn.tabIndex = visible ? 0 : -1;
    if (!visible && document.activeElement === scrollTopBtn) {
      scrollTopBtn.blur();
    }
  }

  // 6. Scroll-top button, scroll progress & hero scrollback arrival + Nav Scroll-Spy
  const rootEl = document.documentElement;
  let scrollRafId = 0;
  function syncOnScroll() {
    scrollRafId = 0;
    const currentY = window.scrollY;
    if (currentY !== lastScrollY) {
      scrollDirection = currentY < lastScrollY ? "up" : "down";
      lastScrollY = currentY;
    }
    const maxScroll = Math.max(0, rootEl.scrollHeight - window.innerHeight);
    const progress = maxScroll > 0 ? Math.min(1, Math.max(0, currentY / maxScroll)) : 0;
    rootEl.style.setProperty("--scroll-progress", progress.toFixed(4));

    if (currentY > 360) {
      hasLeftHero = true;
    } else if (hasLeftHero && currentY <= 40 && !activeScrollTween) {
      triggerHeroScrollbackReplay();
    }

    updateScrollTopButton();
  }
  function scheduleScrollSync() {
    if (!scrollRafId) {
      scrollRafId = requestAnimationFrame(syncOnScroll);
    }
  }
  window.addEventListener("scroll", scheduleScrollSync, { passive: true });
  window.addEventListener("resize", scheduleScrollSync, { passive: true });
  syncOnScroll();

  const spySections = ["about", "research", "projects", "record", "contact"]
    .map(id => document.getElementById(id))
    .filter(Boolean);
  const heroSection = document.querySelector(".hero");
  const navLinks = [...document.querySelectorAll('.nav a[href^="#"], .menu-panel a[href^="#"]')];

  function setActiveNav(id) {
    const targetHref = id ? `#${id}` : null;
    navLinks.forEach(link => {
      const isCurrent = targetHref !== null && link.getAttribute("href") === targetHref;
      link.classList.toggle("is-current", isCurrent);
      if (isCurrent) {
        link.setAttribute("aria-current", "location");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  if (spySections.length && navLinks.length && typeof IntersectionObserver === "function") {
    const intersectingSections = new Set();

    const pickActiveSectionId = () => {
      const bandMid = window.innerHeight * 0.25;
      if (heroSection && intersectingSections.has(heroSection)) {
        if (heroSection.getBoundingClientRect().bottom > bandMid) return null;
      }
      let fallback = null;
      for (const section of spySections) {
        if (!intersectingSections.has(section)) continue;
        const rect = section.getBoundingClientRect();
        if (rect.top <= bandMid && rect.bottom >= bandMid) {
          return section.id;
        }
        fallback = section.id;
      }
      if (fallback) return fallback;
      const firstSection = spySections[0];
      if (firstSection && firstSection.getBoundingClientRect().top > bandMid) {
        return null;
      }
      return null;
    };

    const spyObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          intersectingSections.add(entry.target);
        } else {
          intersectingSections.delete(entry.target);
        }
      });
      setActiveNav(pickActiveSectionId());
    }, { rootMargin: "-18% 0px -68% 0px", threshold: 0 });

    if (heroSection) spyObserver.observe(heroSection);
    spySections.forEach(section => spyObserver.observe(section));
  }

  // 7. Tabular metric count-up (.figures dd) on first intersection
  const figureLists = [...document.querySelectorAll(".figures")];
  if (figureLists.length && !reduceMotion && typeof IntersectionObserver === "function") {
    const parseMetricNode = dd => {
      if (dd.querySelector(".arrow") || dd.textContent.includes("→")) return null;
      const firstNode = dd.firstChild;
      if (!firstNode || firstNode.nodeType !== Node.TEXT_NODE) return null;
      const original = firstNode.nodeValue;
      const match = original.match(/^(\s*)(\d[\d,]*(?:\.\d+)?)(.*)$/);
      if (!match) return null;

      const [, prefix, numStr, suffix] = match;
      const target = Number.parseFloat(numStr.replace(/,/g, ""));
      if (!Number.isFinite(target)) return null;

      const dotIdx = numStr.indexOf(".");
      const decimals = dotIdx >= 0 ? numStr.length - dotIdx - 1 : 0;
      const hasCommas = numStr.includes(",");

      return {
        node: firstNode,
        original,
        prefix,
        suffix,
        target,
        decimals,
        hasCommas,
      };
    };

    const formatMetric = (value, decimals, hasCommas) => {
      const fixed = value.toFixed(decimals);
      if (!hasCommas) return fixed;
      const [intPart, decPart] = fixed.split(".");
      const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      return decPart !== undefined ? `${grouped}.${decPart}` : grouped;
    };

    const animateFiguresList = dl => {
      const metrics = [...dl.querySelectorAll("dd")].map(parseMetricNode).filter(Boolean);
      if (!metrics.length || prefersReducedMotion()) return;

      const duration = 900;
      const start = performance.now();

      const tick = now => {
        if (prefersReducedMotion()) {
          metrics.forEach(m => { m.node.nodeValue = m.original; });
          return;
        }
        const t = Math.min(1, (now - start) / duration);
        if (t >= 1) {
          metrics.forEach(m => { m.node.nodeValue = m.original; });
          return;
        }
        const eased = 1 - Math.pow(1 - t, 3);
        metrics.forEach(m => {
          const current = m.target * eased;
          m.node.nodeValue = `${m.prefix}${formatMetric(current, m.decimals, m.hasCommas)}${m.suffix}`;
        });
        requestAnimationFrame(tick);
      };

      metrics.forEach(m => {
        m.node.nodeValue = `${m.prefix}${formatMetric(0, m.decimals, m.hasCommas)}${m.suffix}`;
      });
      requestAnimationFrame(tick);
    };

    const figuresObserver = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        obs.unobserve(entry.target);
        animateFiguresList(entry.target);
      });
    }, { threshold: 0.15 });

    figureLists.forEach(dl => figuresObserver.observe(dl));
  }
})();
