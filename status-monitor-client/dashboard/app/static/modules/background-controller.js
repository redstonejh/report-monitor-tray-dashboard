export function initializeBackgroundController({ portalFloatingMenu, restoreFloatingMenu, originalMenuParent }) {
  const closeBackgroundToneMenu = (menu) => {
    if (!menu) return;
    const popover = menu.querySelector(".background-tone-popover") || document.querySelector(".workspace-menu-overlay-layer > .background-tone-popover");
    popover?.classList.remove("open");
    restoreFloatingMenu(popover);
    menu.removeAttribute("open");
  };
  const linearizeChannel = (value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  };
  const parseRgbFromColorValue = (value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return null;
    if (trimmed.startsWith("#")) {
      const hex = trimmed.replace("#", "");
      if (hex.length === 3 || hex.length === 4) {
        const normalized = hex
          .split("")
          .slice(0, 3)
          .map((digit) => parseInt(`${digit}${digit}`, 16))
          .filter((number) => !Number.isNaN(number));
        if (normalized.length !== 3) return null;
        return { r: normalized[0], g: normalized[1], b: normalized[2] };
      }
      if (hex.length >= 6) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        if ([r, g, b].some((channel) => Number.isNaN(channel))) return null;
        return { r, g, b };
      }
      return null;
    }
    const rgbMatch = trimmed.match(/^rgba?\(([^)]+)\)/);
    if (!rgbMatch) return null;
    const channels = rgbMatch[1]
      .split(",")
      .slice(0, 3)
      .map((channel) => parseFloat(channel.trim()))
      .filter((channel) => Number.isFinite(channel));
    if (channels.length !== 3) return null;
    return {
      r: Math.max(0, Math.min(255, channels[0])),
      g: Math.max(0, Math.min(255, channels[1])),
      b: Math.max(0, Math.min(255, channels[2])),
    };
  };
  const computeRelativeLuminance = (color) => {
    if (!color) return 0;
    const { r, g, b } = color;
    const linearR = linearizeChannel(r);
    const linearG = linearizeChannel(g);
    const linearB = linearizeChannel(b);
    return (0.2126 * linearR) + (0.7152 * linearG) + (0.0722 * linearB);
  };
  const clamp01 = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    if (numeric <= 0) return 0;
    if (numeric >= 1) return 1;
    return numeric;
  };
  const getBackgroundThemeRoots = () => {
    const roots = [document.documentElement, document.body];
    return roots.filter((element) => element instanceof HTMLElement);
  };
  const COLOR_PRESETS = {
    "tone-light-grey": { label: "Light grey", hex: "#d1d5db" },
    "tone-grey": { label: "Grey", hex: "#6b7280" },
    "tone-dark-grey": { label: "Dark grey", hex: "#1f2937" },
    "tone-black": { label: "Black", hex: "#000000" },
  };
  const LEGACY_TONE_MIGRATIONS = {
    "warm-white": "tone-light-grey",
    "cool-white": "tone-light-grey",
    "soft-grey": "tone-light-grey",
    "cool-grey": "tone-light-grey",
    "medium-cool-grey": "tone-grey",
    "darker-soft-grey": "tone-grey",
    "warm-grey": "tone-grey",
    "slate": "tone-grey",
    "slate-grey": "tone-grey",
    "graphite-light": "tone-grey",
    "graphite-grey": "tone-grey",
    "light-blue-grey": "tone-light-grey",
    "muted-blue-grey": "tone-grey",
    "blue-slate": "tone-grey",
    "neutral-dim": "tone-grey",
    "stone-slate": "tone-grey",
    "stone-grey": "tone-grey",
    "industrial-grey": "tone-grey",
    "blue-mist": "tone-light-grey",
    "frosted-light": "tone-light-grey",
    "very-pale-grey": "tone-light-grey",
    "pale-cool-grey": "tone-light-grey",
    "pale-warm-grey": "tone-light-grey",
    "medium-soft-grey": "tone-grey",
    "medium-grey": "tone-grey",
    "neutral-grey": "tone-grey",
    "charcoal-grey": "tone-dark-grey",
    "deep-grey": "tone-dark-grey",
    "near-black-grey": "tone-dark-grey",
    "black": "tone-black",
    "near-black": "tone-black",
    "soft-black": "tone-dark-grey",
    "warm-near-black": "tone-dark-grey",
    "charcoal": "tone-dark-grey",
    "soft-charcoal": "tone-dark-grey",
    "graphite": "tone-dark-grey",
    "gunmetal": "tone-dark-grey",
    "dark-grey": "tone-dark-grey",
    "dark-blue-grey": "tone-dark-grey",
    "deep-navy": "tone-dark-grey",
    "desaturated-dark-blue": "tone-dark-grey",
    "muted-navy": "tone-dark-grey",
    "muted-midnight-blue": "tone-dark-grey",
    "deep-slate": "tone-dark-grey",
    "cool-dark-steel": "tone-dark-grey",
    "dark-steel": "tone-dark-grey",
    "soft-cinema": "tone-dark-grey",
    "dark-frosted": "tone-dark-grey",
  };
  const normalizeHex = (value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    const short = trimmed.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
    if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
    return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toLowerCase() : null;
  };
  const stateLabel = (state) => {
    if (!state) return COLOR_PRESETS["tone-dark-grey"].label;
    if (state.kind === "photo") return state.tone.replace(/-/g, " ");
    return COLOR_PRESETS[state.tone]?.label || COLOR_PRESETS["tone-dark-grey"].label;
  };
  // Adaptive material compensation was removed: objects now use one stable
  // material recipe regardless of background luminance. The fixed default
  // values in tokens.css for --workspace-bg-luminance,
  // --workspace-bg-darkness, --surface-exposure-compensation,
  // --surface-white-mix-compensation, --surface-saturation-compensation,
  // and --surface-glass-alpha are the single source of truth. This
  // function is kept as a no-op so existing call sites stay valid; no
  // adaptive vars are written.
  // ── Photo / image background system ───────────────────────────────
  const PHOTO_BACKGROUNDS = {
    "photo-bark":        { src: "app/static/backgrounds/nature/bark.webp",        luminance: 0.08 },
    "photo-cloud":       { src: "app/static/backgrounds/nature/cloud.webp",       luminance: 0.70 },
    "photo-jungle":      { src: "app/static/backgrounds/nature/jungle.webp",      luminance: 0.06 },
    "photo-moss":        { src: "app/static/backgrounds/nature/moss.webp",        luminance: 0.10 },
    "photo-sand":        { src: "app/static/backgrounds/nature/sand.webp",        luminance: 0.65 },
    "photo-shore":       { src: "app/static/backgrounds/nature/shore.webp",       luminance: 0.42 },
    "photo-turf":        { src: "app/static/backgrounds/nature/turf.webp",        luminance: 0.12 },
    "photo-water":       { src: "app/static/backgrounds/nature/water.webp",       luminance: 0.08 },
    "photo-water2":      { src: "app/static/backgrounds/nature/water2.webp",      luminance: 0.58 },
    "photo-denim":       { src: "app/static/backgrounds/textures/denim.webp",     luminance: 0.08 },
    "photo-marble":      { src: "app/static/backgrounds/textures/marble.webp",    luminance: 0.72 },
    "photo-leather":     { src: "app/static/backgrounds/textures/leather.webp",   luminance: 0.22 },
    "photo-texture":     { src: "app/static/backgrounds/textures/texture.webp",   luminance: 0.55 },
    "photo-paint":       { src: "app/static/backgrounds/abstract/paint.webp",     luminance: 0.50 },
    "photo-paintspill":  { src: "app/static/backgrounds/abstract/paintspill.webp",luminance: 0.05 },
    "photo-city":        { src: "app/static/backgrounds/urban/city.webp",         luminance: 0.04 },
    "photo-modern":      { src: "app/static/backgrounds/urban/modern.webp",       luminance: 0.40 },
    "photo-mercury":     { src: "app/static/backgrounds/space/mercury.webp",      luminance: 0.04 },
    "photo-venus":       { src: "app/static/backgrounds/space/venus.webp",        luminance: 0.12 },
    "photo-earth":       { src: "app/static/backgrounds/space/earth.webp",        luminance: 0.06 },
    "photo-mars":        { src: "app/static/backgrounds/space/mars.webp",         luminance: 0.08 },
    "photo-jupiter":     { src: "app/static/backgrounds/space/jupiter.webp",      luminance: 0.12 },
    "photo-saturn":      { src: "app/static/backgrounds/space/saturn.webp",       luminance: 0.06 },
    "photo-uranus":      { src: "app/static/backgrounds/space/uranus.webp",       luminance: 0.10 },
    "photo-neptune":     { src: "app/static/backgrounds/space/neptune.webp",      luminance: 0.08 },
    "photo-pluto":       { src: "app/static/backgrounds/space/pluto.webp",        luminance: 0.06 },
    "solar-system":      { luminance: 0.06, solarSystem: true },
  };
  const SOLAR_SYSTEM_SEQUENCE = [
    "app/static/backgrounds/space/mercury.webp",
    "app/static/backgrounds/space/venus.webp",
    "app/static/backgrounds/space/earth.webp",
    "app/static/backgrounds/space/mars.webp",
    "app/static/backgrounds/space/jupiter.webp",
    "app/static/backgrounds/space/saturn.webp",
    "app/static/backgrounds/space/uranus.webp",
    "app/static/backgrounds/space/neptune.webp",
    "app/static/backgrounds/space/pluto.webp",
  ];
  const isPhotoTone = (tone) => tone && (tone.startsWith("photo-") || tone === "solar-system");
  const getPhotoImages = (tone) =>
    tone === "solar-system"
      ? [...SOLAR_SYSTEM_SEQUENCE]
      : (PHOTO_BACKGROUNDS[tone]?.src ? [PHOTO_BACKGROUNDS[tone].src] : []);
  
  let photoBackdropEl = null;
  let photoTrackEl = null;
  let photoScrollHandler = null;
  let photoResizeObserver = null;
  let photoPanelCount = 0;
  let photoCurrentTone = null;
  let photoCurrentImages = [];
  let photoApplyToken = 0;
  const photoDecodeCache = new Map();

  const setPhotoPreloadReady = (promise) => {
    window.__dashboardBackgroundPreloadDone = false;
    window.__dashboardBackgroundPreloadReady = promise.finally(() => {
      window.__dashboardBackgroundPreloadDone = true;
    });
    return window.__dashboardBackgroundPreloadReady;
  };

  const decodePhotoImage = (src) => {
    if (photoDecodeCache.has(src)) return photoDecodeCache.get(src);
    const promise = (async () => {
      const image = new Image();
      image.decoding = "async";
      image.src = src;
      const loadReady = image.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            image.onload = resolve;
            image.onerror = resolve;
          });
      const timeoutReady = new Promise((resolve) => window.setTimeout(resolve, 1000));
      try {
        if (typeof image.decode === "function") {
          await Promise.race([image.decode(), loadReady, timeoutReady]);
        } else {
          await Promise.race([loadReady, timeoutReady]);
        }
        return { src, ok: image.naturalWidth > 0 && image.naturalHeight > 0 };
      } catch {
        return { src, ok: false };
      }
    })();
    photoDecodeCache.set(src, promise);
    return promise;
  };

  const predecodePhotoImages = (images) => setPhotoPreloadReady(
    Promise.all(images.map((src) => decodePhotoImage(src)))
  );
  
  const photoEnsurePanel = (panelIndex) => {
    if (!photoTrackEl || !photoCurrentImages.length) return;
    const src = photoCurrentImages[panelIndex % photoCurrentImages.length];
    const panel = document.createElement("div");
    panel.className = "workspace-photo-panel";
    panel.style.backgroundImage = `url("${src}")`;
    photoTrackEl.appendChild(panel);
    photoPanelCount++;
  };
  
  const photoEnsureEnoughPanels = () => {
    if (!photoTrackEl) return;
    const vh = window.innerHeight || 1;
    const needed = Math.max(3, Math.ceil((window.scrollY + vh * 3) / vh));
    while (photoPanelCount < needed) photoEnsurePanel(photoPanelCount);
  };
  
  const photoSyncScroll = () => {
    if (!photoTrackEl) return;
    photoTrackEl.style.transform = `translateY(${-window.scrollY}px)`;
    photoEnsureEnoughPanels();
  };
  
  const applyPhotoBackground = (tone) => {
    const meta = PHOTO_BACKGROUNDS[tone];
    if (!meta) return Promise.resolve([]);
    const newImages = getPhotoImages(tone);
    const token = ++photoApplyToken;
    const ready = predecodePhotoImages(newImages);
    ready.then(() => {
      if (token !== photoApplyToken) return;
      const toneChanged = tone !== photoCurrentTone;
      if (toneChanged) {
        if (photoTrackEl) photoTrackEl.replaceChildren();
        photoPanelCount = 0;
        photoCurrentTone = tone;
        photoCurrentImages = newImages;
      }
      if (!photoBackdropEl) {
        photoBackdropEl = document.createElement("div");
        photoBackdropEl.className = "workspace-photo-backdrop";
        photoBackdropEl.setAttribute("aria-hidden", "true");
        photoTrackEl = document.createElement("div");
        photoTrackEl.className = "workspace-photo-track";
        photoBackdropEl.appendChild(photoTrackEl);
        document.body.insertBefore(photoBackdropEl, document.body.firstChild);
      }
      photoBackdropEl.hidden = false;
      if (!photoScrollHandler) {
        photoScrollHandler = () => photoSyncScroll();
        window.addEventListener("scroll", photoScrollHandler, { passive: true });
      }
      if (!photoResizeObserver) {
        photoResizeObserver = new ResizeObserver(() => photoEnsureEnoughPanels());
        photoResizeObserver.observe(document.documentElement);
      }
      document.documentElement.classList.add("has-photo-background");
      document.body.classList.add("has-photo-background");
      // Adaptive material vars intentionally NOT written here. Photo
      // backgrounds use the same fixed token values as solid backgrounds;
      // photo-specific glass comes from the body.has-photo-background CSS
      // block in themes.css with its own fixed tokens.
      photoEnsureEnoughPanels();
      photoSyncScroll();
    });
    return ready;
  };
  
  const destroyPhotoBackground = () => {
    photoApplyToken++;
    if (photoScrollHandler) {
      window.removeEventListener("scroll", photoScrollHandler, { passive: true });
      photoScrollHandler = null;
    }
    if (photoResizeObserver) {
      photoResizeObserver.disconnect();
      photoResizeObserver = null;
    }
    photoBackdropEl?.remove();
    photoBackdropEl = null;
    photoTrackEl = null;
    photoPanelCount = 0;
    photoCurrentTone = null;
    photoCurrentImages = [];
    setPhotoPreloadReady(Promise.resolve([]));
    document.documentElement.classList.remove("has-photo-background");
    document.body.classList.remove("has-photo-background");
  };
  
  const backgroundDefault = "tone-grey";
  const backgroundStorageKey = "dashboard-background";
  const parseBackgroundState = (value) => {
    if (typeof value === "string" && value.trim().startsWith("{")) {
      return { kind: "preset", tone: backgroundDefault, hex: COLOR_PRESETS[backgroundDefault].hex };
    }
    if (isPhotoTone(value)) return { kind: "photo", tone: value };
    const migrated = LEGACY_TONE_MIGRATIONS[value] || value;
    const preset = COLOR_PRESETS[migrated] ? migrated : backgroundDefault;
    return { kind: "preset", tone: preset, hex: COLOR_PRESETS[preset].hex };
  };
  const serializeBackgroundState = (state) => state?.tone || backgroundDefault;
  const savedBackgroundState = () => {
    try {
      const stored = localStorage.getItem(backgroundStorageKey);
      return parseBackgroundState(stored || backgroundDefault);
    } catch {
      return parseBackgroundState(backgroundDefault);
    }
  };
  const persistBackgroundState = (state) => {
    try {
      localStorage.setItem(backgroundStorageKey, serializeBackgroundState(state));
    } catch {}
  };
  const stateKey = (state) => state?.tone;
  const backgroundHistory = [];
  let previewBackgroundState = null;
  let currentCommittedState = savedBackgroundState();
  const pushBackgroundHistory = (previous, next) => {
    if (!previous || serializeBackgroundState(previous) === serializeBackgroundState(next)) return;
    backgroundHistory.push(previous);
    if (backgroundHistory.length > 12) backgroundHistory.shift();
  };
  const syncSelectionUI = (activeState) => {
    const activeKey = stateKey(activeState);
    document.querySelectorAll(".background-tone-option, .background-photo-option").forEach((btn) => {
      const sel = btn.dataset.backgroundTone === activeKey;
      btn.classList.toggle("is-selected", sel);
      btn.setAttribute("aria-pressed", sel.toString());
    });
    document.querySelectorAll(".background-tone-trigger").forEach((trigger) => {
      trigger.setAttribute("aria-label", `Workspace background: ${stateLabel(activeState)}`);
    });
  };
  const applyBackgroundState = (state = savedBackgroundState(), options = {}) => {
    const themeRoots = getBackgroundThemeRoots();
    const selectedState = options.preview ? currentCommittedState : state;

    if (state.kind === "photo") {
      themeRoots.forEach((root) => {
        root.dataset.background = state.tone;
        root.style.removeProperty("--base-tone");
      });
      applyPhotoBackground(state.tone);
      syncSelectionUI(selectedState);
      return;
    }

    if (photoBackdropEl) {
      if (options.preview) {
        photoBackdropEl.hidden = true;
        document.documentElement.classList.remove("has-photo-background");
        document.body.classList.remove("has-photo-background");
      } else {
        destroyPhotoBackground();
      }
    } else if (!options.preview) {
      setPhotoPreloadReady(Promise.resolve([]));
    }

    const baseTone = COLOR_PRESETS[state.tone]?.hex || COLOR_PRESETS[backgroundDefault].hex;
    themeRoots.forEach((themeRoot) => {
      themeRoot.dataset.background = state.tone;
      themeRoot.style.setProperty("--base-tone", baseTone);
      themeRoot.style.setProperty("--bg", baseTone);
      themeRoot.style.setProperty("--bg-end", baseTone);
    });
    syncSelectionUI(selectedState);
  };
  const previewBackgroundOption = (button) => {
    const tone = button?.dataset?.backgroundTone || backgroundDefault;
    if (!tone) return;
    previewBackgroundState = parseBackgroundState(tone);
    applyBackgroundState(previewBackgroundState, { preview: true });
  };
  const revertBackgroundPreview = () => {
    if (!previewBackgroundState) return;
    previewBackgroundState = null;
    applyBackgroundState(currentCommittedState);
  };
  const commitBackgroundState = (state) => {
    const previous = currentCommittedState;
    previewBackgroundState = null;
    currentCommittedState = state;
    pushBackgroundHistory(previous, state);
    persistBackgroundState(state);
    applyBackgroundState(state);
  };
  const undoBackgroundState = () => {
    const previous = backgroundHistory.pop();
    if (!previous) return false;
    previewBackgroundState = null;
    currentCommittedState = previous;
    persistBackgroundState(previous);
    applyBackgroundState(previous);
    return true;
  };
  applyBackgroundState(currentCommittedState);
  document.querySelectorAll(".background-tone-option, .background-photo-option").forEach((button) => {
    button.addEventListener("pointerenter", () => previewBackgroundOption(button));
    button.addEventListener("focus", () => previewBackgroundOption(button));
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const tone = button.dataset.backgroundTone || backgroundDefault;
      commitBackgroundState(parseBackgroundState(tone));
      const toneMenu = button.closest(".background-tone-menu") ||
        originalMenuParent(button.closest(".background-tone-popover"));
      closeBackgroundToneMenu(toneMenu);
    });
  });
  document.querySelectorAll(".panel-undo-button").forEach((button) => {
    button.addEventListener("click", (event) => {
      if (!undoBackgroundState()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    });
  });  document.querySelectorAll(".background-tone-menu, .appearance-control-group.background-tone-group").forEach((container) => {
    container.addEventListener("pointerleave", revertBackgroundPreview);
    container.addEventListener("focusout", (event) => {
      if (event.relatedTarget && container.contains(event.relatedTarget)) return;
      revertBackgroundPreview();
    });
  });
  document.querySelectorAll(".background-tone-menu").forEach((menu) => {
    const trigger = menu.querySelector(".background-tone-trigger");
    const popover = menu.querySelector(".background-tone-popover");
    menu.addEventListener("toggle", () => {
      if (menu.open) {
        popover?.classList.add("open");
        portalFloatingMenu(popover, trigger, { align: "left", offset: 8 });
        return;
      }
      revertBackgroundPreview();
      popover?.classList.remove("open");
      restoreFloatingMenu(popover);
    });
    popover?.addEventListener("pointerdown", (event) => event.stopPropagation());
    popover?.addEventListener("click", (event) => event.stopPropagation());
    popover?.addEventListener("pointerleave", revertBackgroundPreview);
    popover?.addEventListener("focusout", (event) => {
      if (event.relatedTarget && popover.contains(event.relatedTarget)) return;
      revertBackgroundPreview();
    });
    document.addEventListener("pointerdown", (event) => {
      if (!menu.open) return;
      if (menu.contains(event.target) || popover?.contains(event.target)) return;
      closeBackgroundToneMenu(menu);
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeBackgroundToneMenu(menu);
    });
  });
  
}
