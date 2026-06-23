(() => {
  const definitions = new Map();
  const aliases = new Map();

  // Visualization libraries are vendored locally under ./vendor/ and loaded
  // from there instead of a CDN, so no remote script ever executes in this
  // fs-privileged renderer (enforced by the CSP in index.html). Resolved
  // against this module's own URL so it works wherever the dashboard is mounted.
  const VENDOR_BASE = new URL("./vendor/", import.meta.url).href;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));

  const parseConfig = (value) => {
    if (!value) return {};
    if (typeof value === "object") return { ...value };
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };

  const normalizedSize = (size, fallbackCols = 1, fallbackRows = 1) => ({
    cols: Math.max(1, Math.min(6, Number(size?.cols) || fallbackCols)),
    rows: Math.max(1, Number(size?.rows) || fallbackRows),
  });

  const normalizedSettingsSchema = (schema = {}, fallbackSettings = []) => {
    const sections = Array.isArray(schema.sections) ? schema.sections : [];
    const normalizedSections = sections.map((section, sectionIndex) => ({
      id: String(section.id || `section-${sectionIndex}`),
      label: String(section.label || "Settings"),
      fields: (Array.isArray(section.fields) ? section.fields : []).map((field) => ({
        key: String(field.key || "").trim(),
        label: String(field.label || field.key || ""),
        type: String(field.type || "text"),
        defaultValue: field.defaultValue,
        options: Array.isArray(field.options) ? field.options : [],
        placeholder: field.placeholder || "",
        min: field.min,
        max: field.max,
        step: field.step,
        required: Boolean(field.required),
        multiple: Boolean(field.multiple),
        valueType: field.valueType || null,
        affectsQuery: Boolean(field.affectsQuery),
        affectsContext: Boolean(field.affectsContext),
        surface: field.surface || "",
        validation: field.validation || {},
      })).filter((field) => field.key),
    })).filter((section) => section.fields.length);
    return {
      version: Number(schema.version) || 1,
      sections: normalizedSections.length ? normalizedSections : [{
        id: "general",
        label: "General",
        fields: fallbackSettings
          .filter((setting) => ["title", "label"].includes(setting))
          .map((setting) => ({ key: setting, label: "Title", type: "text", affectsQuery: false, affectsContext: false, validation: {} })),
      }].filter((section) => section.fields.length),
    };
  };

  const unique = (values) => [...new Set(values.filter(Boolean))];
  const DENSITY_TIERS = ["tiny", "compact", "standard", "expanded", "rich"];
  const WIDGET_LAYERS = ["presentation", "backend", "both"];
  const normalizeDensity = (value, fallback = "standard") => DENSITY_TIERS.includes(value) ? value : fallback;
  const normalizeWidgetLayer = (value, fallback = "presentation") => (
    WIDGET_LAYERS.includes(value) ? value : fallback
  );
  const resolveWidgetDensity = (instance = {}, availableSize = {}, definition = null) => {
    if (definition?.densityBehavior?.resolve && typeof definition.densityBehavior.resolve === "function") {
      return normalizeDensity(definition.densityBehavior.resolve(instance, availableSize), "standard");
    }
    const cols = Number(instance.cols) || Number(definition?.defaultSize?.cols) || 1;
    const rows = Number(instance.rows) || Number(definition?.defaultSize?.rows) || 1;
    const width = Number(availableSize.width) || 0;
    const height = Number(availableSize.height) || 0;
    const panelContained = Boolean(availableSize.panelContained || instance.parentPanelId);
    let score = cols + (rows * 1.35);
    if (width && width < 132) score -= 1.25;
    else if (width && width >= 520) score += 1;
    if (height && height < 82) score -= 1.15;
    else if (height && height >= 280) score += 1;
    if (panelContained) score -= 0.35;
    if ((width && width < 118) || (height && height < 58)) return "tiny";
    if (score <= 4) return "compact";
    if (score >= 10) return "rich";
    if (score >= 7) return "expanded";
    return "standard";
  };
  const compactDensity = (density) => ["tiny", "compact"].includes(normalizeDensity(density));
  const richDensity = (density) => ["expanded", "rich"].includes(normalizeDensity(density));
  const chartVisualDensity = (density) => {
    const tier = normalizeDensity(density);
    if (tier === "tiny") return "tiny";
    if (tier === "compact") return "small";
    if (tier === "rich") return "large";
    return "medium";
  };

  const numberValue = (value) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.replace(/[$,%\s,]/g, ""));
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const formatMetricValue = (value, format = "number") => {
    if (format === "since") return formatSinceValue(value);
    const numeric = numberValue(value);
    if (numeric == null) return String(value ?? "");
    if (format === "currency") {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: Math.abs(numeric) >= 100 ? 0 : 2,
      }).format(numeric);
    }
    if (format === "percent") {
      return new Intl.NumberFormat(undefined, {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(numeric);
    }
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: Number.isInteger(numeric) ? 0 : 2,
    }).format(numeric);
  };

  const statLabelFor = (config) => config?.label || config?.title || "Stat";

  // Humanized "time since" for stat cards whose value is an epoch-ms timestamp
  // (e.g. the most recent failed ping). Two units max: "3d 4h", "5h 12m", "45s".
  const formatSinceValue = (timestampMs) => {
    const numeric = numberValue(timestampMs);
    if (numeric == null || numeric <= 0) return "—";
    const elapsed = Date.now() - numeric;
    if (elapsed < 0) return "now";
    const seconds = Math.floor(elapsed / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
  };

  // ── Persistent ping-focus highlight ──────────────────────────────────────────
  // The highlight is no longer a 2.4s flash — a focused row (or, with multiple
  // viewers, the matching row in every per-viewer table) STAYS lit until the user
  // clicks somewhere neutral (the "click away to dismiss" handler below). The
  // single source of truth is the focused minute; painting toggles the class on
  // every matching row so a new focus replaces the old one and windowed tables
  // re-apply it on each render.
  let pingFocusMinute = null;
  const minuteOfIso = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? Math.floor(t / 60000) : null; };
  const paintPingFocus = (root = document) => {
    root.querySelectorAll('.runtime-table tbody tr[data-checked-at]').forEach((tr) => {
      tr.classList.toggle("ping-focus", pingFocusMinute != null && minuteOfIso(tr.dataset.checkedAt) === pingFocusMinute);
    });
  };
  const setPingFocus = (checkedAt) => {
    pingFocusMinute = minuteOfIso(checkedAt);
    paintPingFocus();
  };
  const clearPingFocus = () => {
    if (pingFocusMinute == null) return false;
    pingFocusMinute = null;
    document.querySelectorAll(".runtime-table tbody tr.ping-focus").forEach((tr) => tr.classList.remove("ping-focus"));
    return true;
  };

  // Scroll the history table to the ping checked at `checkedAt` and light the
  // same status-aware highlight the timeline uses (.ping-focus). Shared by the
  // chart's ping click and the single-event stat cards (min/max/since-down).
  // The row centres inside the table's OWN scroll well; the page only moves if
  // needed to keep the graph and the table in the viewport together.
  const focusHistoryRow = (checkedAt) => {
    if (!checkedAt) return false;
    // Match across EVERY visible table — the default history table AND each per-
    // viewer table. The chart shows consensus pings keyed to the minute while rows
    // carry the exact time, so match by minute (exact-timestamp fast path).
    const ms = Date.parse(checkedAt);
    const targetMinute = Number.isFinite(ms) ? Math.floor(ms / 60000) : null;
    const minuteOf = minuteOfIso;
    // Apply the persistent highlight to every matching row up front (replacing
    // any previous focus); the loop below only handles scrolling each table well.
    setPingFocus(checkedAt);
    const flashed = [];
    const flash = (row) => {
      if (!row) return;
      row.classList.add("ping-focus");
      flashed.push(row);
    };
    for (const table of document.querySelectorAll('.widget-card[data-widget-runtime-type="table"] .runtime-table')) {
      if (table.offsetParent === null) continue; // hidden tab
      const scroller = table.closest(".widget-content-well") || findTableScroller(table);
      if (scroller && scroller.__vtable) {
        // Windowed table: most rows aren't in the DOM. Resolve via the data — it
        // scrolls the match into the window and hands back the now-live <tr>.
        flash(scroller.__vtable.locate(checkedAt));
        continue;
      }
      // Fully-rendered table: scan its DOM rows and scroll its own well.
      const match = [...table.querySelectorAll('tbody tr[data-checked-at]')].find((tr) =>
        tr.dataset.checkedAt === checkedAt || (targetMinute != null && minuteOf(tr.dataset.checkedAt) === targetMinute));
      if (!match) continue;
      if (scroller && scroller !== document.body) {
        const rowTop = match.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
        scroller.scrollTo({ top: Math.max(0, rowTop - (scroller.clientHeight - match.offsetHeight) / 2), behavior: "smooth" });
      }
      flash(match);
    }
    if (!flashed.length) return false;
    // Keep the stat widgets, the graph and the (first) table framed in the
    // viewport together. Including the visible stat cards pulls the frame's top
    // up to them, so a click that scrolls to the table doesn't push the stats
    // off-screen — at the default window size all three co-fit, so the fit-branch
    // below scrolls exactly to the stats' top; on a smaller window the frame no
    // longer fits and it falls back to anchoring the graph as before.
    const chartCard = [...document.querySelectorAll(".widget-card")].find((el) => typeof el.__focusChartPing === "function");
    const tableCard = flashed[0].closest(".widget-card");
    const statCards = [...document.querySelectorAll(".stat-card")].filter((el) => el.offsetParent !== null);
    const rects = [chartCard, tableCard, ...statCards].filter(Boolean).map((el) => el.getBoundingClientRect());
    if (rects.length) {
      const top = Math.min(...rects.map((r) => r.top)) + window.scrollY - 12;
      const bottom = Math.max(...rects.map((r) => r.bottom)) + window.scrollY + 12;
      const outOfView = top < window.scrollY || bottom > window.scrollY + window.innerHeight;
      if (outOfView) {
        const chartTop = (chartCard ? chartCard.getBoundingClientRect().top : rects[0].top) + window.scrollY - 12;
        window.scrollTo({
          top: Math.max(0, bottom - top <= window.innerHeight ? top : chartTop),
          behavior: "smooth",
        });
      }
    }
    return true;
  };

  // Navigate the status timeline chart to one specific ping: drill to a window
  // narrow enough that individual ping bars render, then flash/highlight the
  // target bar. The chart mount registers __focusChartPing on its card.
  const focusChartPing = (checkedAt) => {
    if (!checkedAt) return false;
    const card = [...document.querySelectorAll(".widget-card")]
      .find((el) => typeof el.__focusChartPing === "function");
    if (!card) return false;
    card.__focusChartPing(checkedAt);
    return true;
  };

  // A drag that ends over a widget still fires a click on pointer release —
  // track the pointer's travel so drag releases never register as clicks.
  let pointerDownAt = null;
  document.addEventListener("pointerdown", (event) => {
    pointerDownAt = { x: event.clientX, y: event.clientY };
  }, true);
  const wasDragGesture = (event) => Boolean(
    event.detail > 0 && pointerDownAt &&
    Math.hypot(event.clientX - pointerDownAt.x, event.clientY - pointerDownAt.y) > 6
  );

  // Single-event stat cards (min/max/since-down) carry the matching ping's
  // timestamp on their value element; clicking the card jumps to that table row
  // and navigates the timeline chart to the same ping. Count cards (Fails)
  // cycle: first click is the most recent event, the next click the one before
  // it, and so on.
  document.addEventListener("click", (event) => {
    if (wasDragGesture(event)) return;
    if (document.body.classList.contains("panel-interaction-active")) return;
    if (event.target?.closest?.(".widget-tools, .panel-tool-drawer, .widget-workbench-panel")) return;
    const card = event.target?.closest?.(".widget-card");
    if (!card) return;
    const cycleEl = card.querySelector(":scope [data-focus-cycle]");
    if (cycleEl) {
      let list = [];
      try { list = JSON.parse(cycleEl.dataset.focusCycle || "[]"); } catch {}
      if (!list.length) return;
      const key = list.join("|");
      if (card.__focusCycleKey !== key) {
        card.__focusCycleKey = key;
        card.__focusCycleIndex = -1;
      }
      card.__focusCycleIndex = (card.__focusCycleIndex + 1) % list.length;
      const stamp = list[card.__focusCycleIndex];
      focusHistoryRow(stamp);
      focusChartPing(stamp);
      return;
    }
    const focusEl = card.querySelector(":scope [data-focus-checked-at]");
    if (focusEl) {
      focusHistoryRow(focusEl.dataset.focusCheckedAt);
      focusChartPing(focusEl.dataset.focusCheckedAt);
    }
  });

  // Click-away to dismiss the persistent highlight. Any click that did NOT land
  // on a focus producer — a ping table row, a stat card that carries a focus
  // timestamp, or the timeline chart — clears it, the same way clicking in an
  // empty area closes a menu. Clicks on a producer leave the highlight to that
  // producer (which sets/replaces it). Registered last so it observes the final
  // target; drag-release clicks are ignored.
  document.addEventListener("click", (event) => {
    if (pingFocusMinute == null) return;
    if (wasDragGesture(event)) return;
    const el = event.target;
    if (el?.closest?.('.runtime-table tbody tr[data-checked-at]')) return; // a ping row
    const card = el?.closest?.(".widget-card");
    if (card && (card.matches('[data-widget-runtime-type="chart"]')
      || card.querySelector(":scope [data-focus-checked-at], :scope [data-focus-cycle]"))) return; // chart / focus stat card
    clearPingFocus();
  });

  const displaySchemaFields = (data = null) => (
    Array.isArray(data?.schema?.fields)
      ? data.schema.fields.map((field) => field?.name || field).filter(Boolean)
      : []
  );
  const tableConfiguredColumns = (config) => Array.isArray(config?.columns)
    ? config.columns.map((field) => String(field || "").trim()).filter(Boolean)
    : [];
  const tableVisibleColumnCount = (cols) => {
    const safeCols = Number(cols) || 2;
    if (safeCols <= 2) return 3;
    if (safeCols <= 3) return 4;
    return 8;
  };
  const tableVisibleRowCount = (rows, limit) => {
    // Render up to the configured limit (the scroll container handles overflow)
    // so a table shows every row in range rather than just what fits its panel;
    // a floor keeps small panels filled, and 500 caps DOM for huge ranges.
    const safeRows = Math.max(1, Number(rows) || 1);
    const rowFloor = Math.max(2, (safeRows * 3) - 1);
    const configuredLimit = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : 50;
    return Math.min(Math.max(configuredLimit, rowFloor), 2000);
  };
  const filterFieldForType = (filter) => {
    const explicit = String(filter?.field || "").trim();
    if (explicit) return explicit;
    return "";
  };
  const filterControlsFromConfig = (config) => {
    const configured = Array.isArray(config?.filters) && config.filters.length
      ? config.filters
      : [{ id: "search", type: "text", label: "Search", operator: "contains", value: "" }];
    return configured.map((filter, index) => {
      const type = filter.type || "text";
      const field = filterFieldForType(filter);
      const options = Array.isArray(filter.options) && filter.options.length
        ? filter.options
        : [];
      return {
        id: filter.id || `filter-${index + 1}`,
        type,
        label: filter.label || (field ? field.replace(/[_-]+/g, " ") : "Filter"),
        field,
        operator: filter.operator || (type === "text" ? "contains" : "eq"),
        value: filter.value ?? "",
        values: Array.isArray(filter.values) ? filter.values.map(String) : [],
        min: filter.min ?? "",
        max: filter.max ?? "",
        start: filter.start ?? "",
        end: filter.end ?? "",
        enabled: Boolean(filter.enabled),
        options,
      };
    });
  };
  const renderFilterControl = (filter) => {
    const base = `data-filter-id="${escapeHtml(filter.id)}" data-filter-type="${escapeHtml(filter.type)}"`;
    const label = `<span class="filter-widget-label">${escapeHtml(filter.label)}</span>`;
    if (filter.type === "dropdown" || filter.type === "category") {
      return `<label class="filter-widget-control filter-widget-control-select" ${base}>${label}<select class="filter-widget-input filter-widget-select" data-filter-part="value" aria-label="${escapeHtml(filter.label)}">
        <option value="">All</option>
        ${filter.options.map((option) => `<option value="${escapeHtml(option)}"${String(filter.value) === String(option) ? " selected" : ""}>${escapeHtml(option)}</option>`).join("")}
      </select></label>`;
    }
    if (filter.type === "multi-select") {
      const options = filter.options.length ? filter.options : filter.values;
      return `<fieldset class="filter-widget-control filter-widget-control-options" ${base}><legend>${escapeHtml(filter.label)}</legend>
        <div class="filter-widget-option-grid">${options.slice(0, 6).map((option) => `<label class="filter-widget-option">
          <input class="filter-widget-input" type="checkbox" data-filter-part="option" value="${escapeHtml(option)}"${filter.values.includes(String(option)) ? " checked" : ""}>
          <span>${escapeHtml(option)}</span>
        </label>`).join("")}</div>
      </fieldset>`;
    }
    if (filter.type === "number-range") {
      return `<div class="filter-widget-control filter-widget-control-range" ${base}>${label}
        <div class="filter-widget-range-pair">
          <input class="filter-widget-input filter-widget-field" type="number" data-filter-part="min" value="${escapeHtml(filter.min)}" aria-label="${escapeHtml(`${filter.label} minimum`)}" placeholder="Min">
          <input class="filter-widget-input filter-widget-field" type="number" data-filter-part="max" value="${escapeHtml(filter.max)}" aria-label="${escapeHtml(`${filter.label} maximum`)}" placeholder="Max">
        </div>
      </div>`;
    }
    if (filter.type === "date-range") {
      return `<div class="filter-widget-control filter-widget-control-range" ${base}>${label}
        <div class="filter-widget-range-pair">
          <input class="filter-widget-input filter-widget-field" type="date" data-filter-part="start" value="${escapeHtml(filter.start)}" aria-label="${escapeHtml(`${filter.label} start`)}">
          <input class="filter-widget-input filter-widget-field" type="date" data-filter-part="end" value="${escapeHtml(filter.end)}" aria-label="${escapeHtml(`${filter.label} end`)}">
        </div>
      </div>`;
    }
    if (filter.type === "boolean") {
      return `<label class="filter-widget-control filter-widget-control-toggle" ${base}>
        <input class="filter-widget-input" type="checkbox" data-filter-part="enabled"${filter.enabled ? " checked" : ""}>
        <span>${escapeHtml(filter.label)}</span>
      </label>`;
    }
    return `<label class="filter-widget-control filter-widget-control-text" ${base}>${label}
      <input class="filter-widget-input filter-widget-field" type="search" data-filter-part="value" value="${escapeHtml(filter.value)}" aria-label="${escapeHtml(filter.label)}" placeholder="Search">
    </label>`;
  };
  const dataFilterModes = [
    { value: "logic", label: "Logic Operator" },
    { value: "type-conversion", label: "Type Conversion" },
  ];
  const dataFilterTypes = [
    { value: "auto", label: "Auto" },
    { value: "string", label: "String" },
    { value: "integer", label: "Integer" },
    { value: "float", label: "Float" },
    { value: "number", label: "Number" },
    { value: "boolean", label: "Boolean" },
  ];
  const dataFilterConversionBehaviors = [
    { value: "round", label: "Round" },
    { value: "floor", label: "Floor" },
    { value: "ceil", label: "Ceil" },
    { value: "truncate", label: "Truncate" },
  ];
  const dataFilterFallbackBehaviors = [
    { value: "null", label: "Output null" },
    { value: "default", label: "Use default value" },
    { value: "block", label: "Block output" },
  ];

  const TIMEFRAME_OPTIONS = Object.freeze([
    { id: "today", label: "Today" },
    { id: "yesterday", label: "Yesterday" },
    { id: "last_1_hour", label: "Last hour", buttonLabel: "1hr", defaultFilterId: "time-last-1-hour" },
    { id: "last_6_hours", label: "Last 6 hours", buttonLabel: "6hr", defaultFilterId: "time-last-6-hours" },
    { id: "last_1_day", label: "Last 24 hours", buttonLabel: "1d", defaultFilterId: "time-last-1-day" },
    { id: "last_2_days", label: "Last 48 hours", buttonLabel: "2d" },
    { id: "this_week", label: "This week" },
    { id: "last_week", label: "Last week" },
    { id: "this_month", label: "This month" },
    { id: "last_month", label: "Last month" },
    { id: "last_7_days", label: "Last 7 days", buttonLabel: "1w", defaultFilterId: "time-last-7-days" },
    { id: "last_14_days", label: "Last 14 days", buttonLabel: "2w" },
    { id: "last_30_days", label: "Last 30 days", buttonLabel: "1m", defaultFilterId: "time-last-30-days" },
    { id: "last_60_days", label: "Last 60 days", buttonLabel: "2m" },
    { id: "last_180_days", label: "Last 180 days", buttonLabel: "6m" },
    { id: "last_365_days", label: "Last 365 days", buttonLabel: "1yr", defaultFilterId: "time-last-365-days" },
    { id: "month_to_date", label: "Month to date" },
    { id: "year_to_date", label: "Year to date" },
    { id: "custom_fixed", label: "Custom fixed range" },
    { id: "custom_repeating", label: "Custom repeating interval" },
    { id: "custom", label: "Custom range" },
  ]);
  const TIMEFRAME_DEFAULT_OPTIONS = TIMEFRAME_OPTIONS.filter((option) => option.defaultFilterId);
  const WEEKDAY_OPTIONS = [
    { value: 0, label: "Sunday" },
    { value: 1, label: "Monday" },
    { value: 2, label: "Tuesday" },
    { value: 3, label: "Wednesday" },
    { value: 4, label: "Thursday" },
    { value: 5, label: "Friday" },
    { value: 6, label: "Saturday" },
  ];
  const datePad = (value) => String(value).padStart(2, "0");
  const dateOnly = (date) => `${date.getFullYear()}-${datePad(date.getMonth() + 1)}-${datePad(date.getDate())}`;
  const parseDateOnly = (value) => {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const localToday = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  };
  const localDateFrom = (value) => {
    const source = value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date(value || Date.now());
    return new Date(source.getFullYear(), source.getMonth(), source.getDate());
  };
  const shiftedDate = (date, days) => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  };
  const addMonths = (date, months) => {
    const next = new Date(date);
    const day = next.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + months);
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(day, lastDay));
    return next;
  };
  const daysBetween = (start, end) => Math.round((localDateFrom(end) - localDateFrom(start)) / 86400000);
  const timeframePresetById = (id) => TIMEFRAME_OPTIONS.find((preset) => preset.id === id) || null;
  const timeframeFilterTypeById = (id) => timeframePresetById(id) || null;
  const normalizeWeekStartDay = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(6, Math.round(numeric)));
  };
  const timeframeLabel = (timeRange, fallback = "Any time") => {
    if (!timeRange?.start && !timeRange?.end) return fallback;
    if (timeRange.label) return timeRange.label;
    if (timeRange.start && timeRange.end) return `${timeRange.start} - ${timeRange.end}`;
    if (timeRange.start) return `Since ${timeRange.start}`;
    return `Until ${timeRange.end}`;
  };
  const TIMEFRAME_MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const timeframeDateDisplay = (value) => {
    const date = parseDateOnly(value);
    if (!date) return String(value || "");
    return `${TIMEFRAME_MONTH_LABELS[date.getMonth()]} ${date.getDate()}`;
  };
  const timeframeRangeDisplay = (timeRange) => {
    if (!timeRange?.start && !timeRange?.end) return "No active range";
    if (timeRange.start && timeRange.end) return `${timeframeDateDisplay(timeRange.start)} - ${timeframeDateDisplay(timeRange.end)}`;
    if (timeRange.start) return `Since ${timeframeDateDisplay(timeRange.start)}`;
    return `Until ${timeframeDateDisplay(timeRange.end)}`;
  };
  const normalizeTimeframeFilter = (filter, index = 0) => {
    const type = String(filter?.type || filter?.preset || filter?.id || "today").trim();
    const typeRecord = timeframeFilterTypeById(type) || { id: type, label: type };
    const id = String(filter?.id || `time-filter-${index + 1}`).trim();
    return {
      id,
      label: String(filter?.label || typeRecord.label || id).trim() || typeRecord.label || "Time filter",
      type: typeRecord.id || type,
      weekStartDay: filter?.weekStartDay,
      start: filter?.start || filter?.fixedStart || filter?.customStart || "",
      end: filter?.end || filter?.fixedEnd || filter?.customEnd || "",
      seedStart: filter?.seedStart || filter?.start || "",
      seedEnd: filter?.seedEnd || filter?.end || "",
      repeatUnit: String(filter?.repeatUnit || "weeks"),
      repeatEvery: Math.max(1, Math.round(Number(filter?.repeatEvery) || 1)),
      occurrence: ["previous", "current", "next"].includes(filter?.occurrence) ? filter.occurrence : "current",
    };
  };
  const legacyPresetToFilter = (preset, index = 0) => {
    const record = typeof preset === "string"
      ? timeframePresetById(preset) || { id: preset, label: preset }
      : { id: preset?.id, label: preset?.label || preset?.id };
    return normalizeTimeframeFilter({ id: `time-${record.id || index}`, label: record.label, type: record.id }, index);
  };
  const normalizeTimeframeFilters = (config = {}) => {
    if (Array.isArray(config.filters)) {
      return config.filters.map(normalizeTimeframeFilter).filter((filter) => filter.id && filter.type);
    }
    const configured = Array.isArray(config.presets) && config.presets.length
      ? config.presets.map(legacyPresetToFilter)
      : TIMEFRAME_DEFAULT_OPTIONS.map((option, index) => normalizeTimeframeFilter({
        id: option.defaultFilterId,
        label: option.buttonLabel || option.label,
        type: option.id,
      }, index));
    return configured.filter((filter) => filter.id && filter.type);
  };
  const selectedTimeframeFilterId = (config = {}, filters = normalizeTimeframeFilters(config)) => {
    const explicitId = String(config.selectedFilterId || "").trim();
    if (explicitId && filters.some((filter) => filter.id === explicitId)) return explicitId;
    const preset = String(config.selectedPreset || config.preset || "").trim();
    const presetMatch = preset ? filters.find((filter) => filter.type === preset || filter.id === preset || filter.id === `time-${preset}`) : null;
    return presetMatch?.id || "";
  };
  const monthRange = (today, offset = 0) => {
    const monthStart = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + offset + 1, 0);
    return { start: dateOnly(monthStart), end: dateOnly(monthEnd) };
  };
  const weekRange = (today, weekStartDay = 0, offsetWeeks = 0) => {
    const startDay = normalizeWeekStartDay(weekStartDay);
    const delta = (today.getDay() - startDay + 7) % 7;
    const start = shiftedDate(today, -delta + (offsetWeeks * 7));
    return { start: dateOnly(start), end: dateOnly(shiftedDate(start, 6)) };
  };
  const repeatingIntervalRange = (filter, today) => {
    const seedStart = parseDateOnly(filter.seedStart);
    const seedEnd = parseDateOnly(filter.seedEnd);
    if (!seedStart || !seedEnd) return null;
    const seedLengthDays = Math.max(1, daysBetween(seedStart, seedEnd) + 1);
    const repeatEvery = Math.max(1, Math.round(Number(filter.repeatEvery) || 1));
    const repeatUnit = String(filter.repeatUnit || "weeks");
    const occurrenceOffset = filter.occurrence === "previous" ? -1 : filter.occurrence === "next" ? 1 : 0;
    let start;
    if (repeatUnit === "monthly") {
      const monthDiff = ((today.getFullYear() - seedStart.getFullYear()) * 12) + (today.getMonth() - seedStart.getMonth());
      let cycles = Math.floor(monthDiff / repeatEvery);
      let candidate = addMonths(seedStart, cycles * repeatEvery);
      if (candidate > today) {
        cycles -= 1;
        candidate = addMonths(seedStart, cycles * repeatEvery);
      }
      start = addMonths(seedStart, (cycles + occurrenceOffset) * repeatEvery);
    } else {
      const stepDays = repeatUnit === "days" ? repeatEvery : repeatEvery * 7;
      let cycles = Math.floor(daysBetween(seedStart, today) / stepDays);
      let candidate = shiftedDate(seedStart, cycles * stepDays);
      if (candidate > today) {
        cycles -= 1;
        candidate = shiftedDate(seedStart, cycles * stepDays);
      }
      start = shiftedDate(seedStart, (cycles + occurrenceOffset) * stepDays);
    }
    const end = shiftedDate(start, seedLengthDays - 1);
    return { start: dateOnly(start), end: dateOnly(end) };
  };
  // Sub-day presets need true datetime precision (an hour, not a calendar day),
  // so they resolve to full ISO start/end relative to "now".
  const SUB_DAY_PRESET_HOURS = { last_1_hour: 1, last_6_hours: 6, last_1_day: 24, last_2_days: 48 };
  const subDayRange = (type, now = null) => {
    const hours = SUB_DAY_PRESET_HOURS[type];
    if (!hours) return null;
    const endMs = now ? new Date(now).getTime() : Date.now();
    return { start: new Date(endMs - hours * 3600000).toISOString(), end: new Date(endMs).toISOString() };
  };
  const resolveTimeframeFilter = (filter, config = {}, now = null) => {
    const normalized = normalizeTimeframeFilter(filter);
    const today = now ? localDateFrom(now) : localToday();
    const weekStartDay = normalized.weekStartDay ?? config.weekStartDay ?? 0;
    let range = subDayRange(normalized.type, now);
    if (normalized.type === "today") range = { start: dateOnly(today), end: dateOnly(today) };
    if (normalized.type === "yesterday") {
      const day = shiftedDate(today, -1);
      range = { start: dateOnly(day), end: dateOnly(day) };
    }
    if (normalized.type === "this_week") range = weekRange(today, weekStartDay, 0);
    if (normalized.type === "last_week") range = weekRange(today, weekStartDay, -1);
    if (normalized.type === "this_month") range = monthRange(today, 0);
    if (normalized.type === "last_month") range = monthRange(today, -1);
    if (normalized.type === "custom_fixed" || normalized.type === "custom") {
      range = { start: normalized.start || config.customStart || "", end: normalized.end || config.customEnd || "" };
    }
    if (normalized.type === "custom_repeating") range = repeatingIntervalRange(normalized, today);
    if (normalized.type === "last_7_days") range = { start: dateOnly(shiftedDate(today, -6)), end: dateOnly(today) };
    if (normalized.type === "last_14_days") range = { start: dateOnly(shiftedDate(today, -13)), end: dateOnly(today) };
    if (normalized.type === "last_30_days") range = { start: dateOnly(shiftedDate(today, -29)), end: dateOnly(today) };
    if (normalized.type === "last_60_days") range = { start: dateOnly(shiftedDate(today, -59)), end: dateOnly(today) };
    if (normalized.type === "last_180_days") range = { start: dateOnly(shiftedDate(today, -179)), end: dateOnly(today) };
    if (normalized.type === "last_365_days") range = { start: dateOnly(shiftedDate(today, -364)), end: dateOnly(today) };
    if (normalized.type === "month_to_date") range = { start: dateOnly(new Date(today.getFullYear(), today.getMonth(), 1)), end: dateOnly(today) };
    if (normalized.type === "year_to_date") range = { start: dateOnly(new Date(today.getFullYear(), 0, 1)), end: dateOnly(today) };
    if (!range?.start && !range?.end) return null;
    const field = String(config.field || "").trim();
    return {
      field: field || undefined,
      start: range.start || undefined,
      end: range.end || undefined,
      preset: normalized.type,
      filterId: normalized.id,
      label: ["custom", "custom_fixed"].includes(normalized.type)
        ? timeframeLabel(range, normalized.label || "Custom range")
        : normalized.label || timeframeLabel(range, "Time range"),
    };
  };
  const resolveTimeRangeConfig = (config = {}, now = null) => {
    const filters = normalizeTimeframeFilters(config);
    const selectedFilter = filters.find((filter) => filter.id === selectedTimeframeFilterId(config, filters));
    if (selectedFilter) return resolveTimeframeFilter(selectedFilter, config, now);
    // The built-in timeframe buttons carry the preset as their id (e.g.
    // "last_7_days"), so fall back to the selected id when no explicit preset is
    // stored — otherwise the default buttons never resolve a date range.
    const preset = String(config.selectedPreset || config.preset || config.selectedFilterId || "").trim();
    const explicit = config.timeRange && typeof config.timeRange === "object" ? config.timeRange : null;
    const field = String(config.field || explicit?.field || "").trim();
    const today = now ? localDateFrom(now) : localToday();
    let start = "";
    let end = "";
    let label = "";
    const subDayResolved = subDayRange(preset, now);
    if (subDayResolved) {
      start = subDayResolved.start;
      end = subDayResolved.end;
      label = timeframePresetById(preset)?.buttonLabel || "Recent";
    }
    if (!subDayResolved && (preset === "custom" || explicit?.preset === "custom")) {
      start = config.customStart || explicit?.start || "";
      end = config.customEnd || explicit?.end || "";
      label = start || end ? timeframeLabel({ start, end }, "Custom range") : "Custom range";
    } else if (preset === "today") {
      start = dateOnly(today);
      end = dateOnly(today);
      label = "Today";
    } else if (preset === "yesterday") {
      const day = shiftedDate(today, -1);
      start = dateOnly(day);
      end = dateOnly(day);
      label = "Yesterday";
    } else if (preset === "last_7_days") {
      start = dateOnly(shiftedDate(today, -6));
      end = dateOnly(today);
      label = "1w";
    } else if (preset === "last_14_days") {
      start = dateOnly(shiftedDate(today, -13));
      end = dateOnly(today);
      label = "2w";
    } else if (preset === "last_30_days") {
      start = dateOnly(shiftedDate(today, -29));
      end = dateOnly(today);
      label = "1m";
    } else if (preset === "last_60_days") {
      start = dateOnly(shiftedDate(today, -59));
      end = dateOnly(today);
      label = "2m";
    } else if (preset === "last_180_days") {
      start = dateOnly(shiftedDate(today, -179));
      end = dateOnly(today);
      label = "6m";
    } else if (preset === "last_365_days") {
      start = dateOnly(shiftedDate(today, -364));
      end = dateOnly(today);
      label = "1yr";
    } else if (preset === "month_to_date") {
      start = dateOnly(new Date(today.getFullYear(), today.getMonth(), 1));
      end = dateOnly(today);
      label = "Month to date";
    } else if (preset === "year_to_date") {
      start = dateOnly(new Date(today.getFullYear(), 0, 1));
      end = dateOnly(today);
      label = "Year to date";
    } else if (explicit?.start || explicit?.end) {
      start = explicit.start || "";
      end = explicit.end || "";
      label = timeframeLabel(explicit, config.activeLabel || "Custom range");
    }
    if (!start && !end) return null;
    return {
      field: field || undefined,
      start: start || undefined,
      end: end || undefined,
      preset: preset || explicit?.preset || "custom",
      label,
    };
  };

  const chartDefinitions = new Map();
  const CHART_AGGREGATIONS = ["count", "sum", "avg", "min", "max"];
  const chartTypeAliases = {
    horizontalBar: "horizontal-bar",
    groupedBar: "grouped-bar",
    stackedBar: "stacked-bar",
    stackedArea: "stacked-area",
    multiLine: "multi-line",
    radialProgress: "radial-progress",
    kpiTrend: "kpi-trend",
  };

  const chartDensityFor = (instance) => {
    const cols = Number(instance?.cols) || 1;
    const rows = Number(instance?.rows) || 1;
    if (cols <= 2 && rows <= 1) return "tiny";
    const tier = normalizeDensity(instance?.density, resolveWidgetDensity(instance));
    return chartVisualDensity(tier);
  };

  const chartField = (config, key) => {
    const explicit = String(config?.[key] || "").trim();
    return explicit;
  };
  const chartValueField = (config) => chartField(config, "yField");
  const chartXField = (config) => chartField(config, "xField");
  const chartSeriesField = (config) => chartField(config, "seriesField");
  const chartConfiguredAggregation = (config) => CHART_AGGREGATIONS.includes(config?.aggregation) ? config.aggregation : "count";
  const chartDisplayConfig = (config) => ({
    showLegend: config?.display?.showLegend !== false,
    showAxes: config?.display?.showAxes !== false,
    showGrid: Boolean(config?.display?.showGrid),
    showLabels: config?.display?.showLabels !== false,
  });
  const chartLimit = (config, fallback = 60) => {
    const value = Number(config?.limit);
    return Number.isFinite(value) ? Math.max(1, value) : fallback;
  };
  const chartEscapeLabel = (value) => String(value ?? "").trim() || "Unlabeled";
  const chartSort = (points, config, defaultSort = "x") => {
    const direction = config?.sortDirection === "desc" ? -1 : 1;
    const sortBy = config?.sortBy || defaultSort;
    return [...points].sort((a, b) => {
      const av = sortBy === "value" || sortBy === "y" ? a.value ?? a.y : a.x;
      const bv = sortBy === "value" || sortBy === "y" ? b.value ?? b.y : b.x;
      if (av === bv) return 0;
      return av > bv ? direction : -direction;
    });
  };
  const widgetDataRows = (data) => Array.isArray(data?.rows) ? data.rows : [];
  const dataSchemaFields = (data) => (
    Array.isArray(data?.schema?.fields)
      ? data.schema.fields.map((field) => typeof field === "string" ? field : field?.key || field?.name).filter(Boolean)
      : []
  );
  const aggregateValues = (values, aggregation) => {
    const numeric = values.map(numberValue).filter((value) => value != null);
    if (aggregation === "count") return values.length;
    if (!numeric.length) return null;
    if (aggregation === "sum") return numeric.reduce((sum, value) => sum + value, 0);
    if (aggregation === "avg") return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
    if (aggregation === "min") return Math.min(...numeric);
    if (aggregation === "max") return Math.max(...numeric);
    return values.length;
  };
  const groupedChartData = (rows, config, options = {}) => {
    const xField = chartXField(config);
    const yField = chartValueField(config);
    const seriesField = options.series ? chartSeriesField(config) : "";
    const aggregation = chartConfiguredAggregation(config);
    const groups = new Map();
    rows.forEach((row, index) => {
      const x = chartEscapeLabel(xField ? row?.[xField] : index + 1);
      const series = seriesField ? chartEscapeLabel(row?.[seriesField]) : "Value";
      const key = `${x}\u0000${series}`;
      if (!groups.has(key)) groups.set(key, { x, series, raw: [] });
      groups.get(key).raw.push(aggregation === "count" ? 1 : row?.[yField]);
    });
    return chartSort([...groups.values()].map((entry) => ({
      ...entry,
      value: aggregateValues(entry.raw, aggregation),
    })).filter((entry) => entry.value != null), config, "x").slice(0, chartLimit(config, 24));
  };
  const numericRowsFor = (rows, field) => rows.map((row) => ({
    row,
    value: numberValue(row?.[field]),
  })).filter((entry) => entry.value != null);
  const VISUAL_WELL_TONES = Object.freeze([
    {
      value: "white",
      label: "Near-white",
      swatch: "linear-gradient(180deg, rgba(255, 255, 255, .98), rgba(248, 250, 252, .96))",
    },
    {
      value: "dark",
      label: "Dark grey",
      swatch: "linear-gradient(180deg, rgba(31, 41, 55, .98), rgba(17, 24, 39, .96))",
    },
  ]);
  const normalizeVisualWellTone = (value) => (
    VISUAL_WELL_TONES.some((tone) => tone.value === value) ? value : "dark"
  );
  const visualWellTone = (config = {}) => normalizeVisualWellTone(config.wellTone);
  const wellToneAttribute = (config = {}) => `data-well-tone="${escapeHtml(visualWellTone(config))}"`;
  // PROTOTYPE (liquid-glass wells): wells always render as translucent glass,
  // so the well-tone pickers are hidden — these helpers strip the option from
  // the color menu and the widget settings instead of injecting it. Restore
  // the originals alongside reverting the glass-well CSS block in themes.css.
  const withWellToneSetting = (settings = []) => (
    settings.filter((setting) => setting !== "wellTone")
  );
  const withWellToneFields = (fields = []) => (
    fields.filter((field) => field?.key !== "wellTone")
  );
  const withWellToneDefault = (config = {}) => ({ ...config, wellTone: "dark" });
  const visualWellToneField = () => ({
    key: "wellTone",
    label: "Well",
    type: "select",
    defaultValue: "white",
    required: true,
    surface: "visual",
    options: VISUAL_WELL_TONES.map(({ value, label }) => ({ value, label })),
  });
  const chartFrame = ({ instance, definition, density, body, legend = "" }) => {
    const densityTier = normalizeDensity(instance?.density, resolveWidgetDensity(instance));
    return `
      <div class="runtime-chart-widget runtime-visualization-widget runtime-well-widget runtime-chart-density-${density} widget-density-${densityTier}" data-density="${escapeHtml(densityTier)}" data-chart-type="${escapeHtml(definition.chartType)}" data-chart-category="${escapeHtml(definition.category || "general")}" ${wellToneAttribute(instance?.config)}>
        <div class="runtime-chart-stage">${body}</div>
        ${legend}
      </div>`;
  };
  const renderEchartsChartFrame = ({ instance, definition }) => {
    const config = instance.config || {};
    const density = chartDensityFor(instance);
    const title = config.title || definition.displayName || "Chart";
    return chartFrame({
      instance,
      definition,
      density,
      body: `<div class="widget-content-well widget-library-surface runtime-chart-library-surface"><div class="runtime-chart-echarts" data-chart-renderer="echarts" data-chart-type="${escapeHtml(definition.chartType)}" role="img" aria-label="${escapeHtml(title)}"></div></div>`,
      legend: "",
    });
  };
  const chartCssValue = (element, name, fallback) => {
    const value = element ? getComputedStyle(element).getPropertyValue(name).trim() : "";
    return value || fallback;
  };
  const chartLegacyColor = (value) => {
    const match = String(value || "").match(/^color\(\s*srgb\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)(?:\s*\/\s*([0-9.]+))?\s*\)$/i);
    if (!match) return value;
    const channels = match.slice(1, 4).map((channel) => Math.round(Math.max(0, Math.min(1, Number(channel))) * 255));
    const alpha = match[4] == null ? 1 : Math.max(0, Math.min(1, Number(match[4])));
    return alpha >= 1 ? `rgb(${channels.join(", ")})` : `rgba(${channels.join(", ")}, ${alpha})`;
  };
  const chartResolvedColor = (element, name, fallback) => {
    const raw = chartCssValue(element, name, fallback);
    if (!element || !raw) return fallback;
    const probe = document.createElement("span");
    probe.style.position = "absolute";
    probe.style.opacity = "0";
    probe.style.pointerEvents = "none";
    probe.style.color = raw;
    element.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return chartLegacyColor(resolved || raw || fallback);
  };
  const chartPaletteForElement = (element) => [
    "--widget-data-primary",
    "--widget-data-secondary",
    "--widget-data-tertiary",
    "--widget-data-quaternary",
    "--widget-data-positive",
    "--widget-data-quiet",
  ].map((name, index) => chartResolvedColor(element, name, ["#2563eb", "#60a5fa", "#93c5fd", "#fca5a5", "#86efac", "#c4b5fd"][index]));
  const chartAxisStyle = (element) => ({
    text: chartResolvedColor(element, "--widget-library-muted", "#4b5563"),
    line: chartResolvedColor(element, "--widget-library-grid", "rgba(100, 116, 139, .24)"),
    strong: chartResolvedColor(element, "--widget-library-fg", "#1f2937"),
  });
  let echartsLoadPromise = null;
  const loadEcharts = () => {
    if (window.echarts?.init) return Promise.resolve(window.echarts);
    if (!echartsLoadPromise) {
      echartsLoadPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector("script[data-dashboard-echarts]");
        if (existing) {
          existing.addEventListener("load", () => window.echarts?.init ? resolve(window.echarts) : reject(new Error("ECharts failed to initialize")), { once: true });
          existing.addEventListener("error", () => reject(new Error("ECharts failed to load")), { once: true });
          return;
        }
        const script = document.createElement("script");
        script.src = VENDOR_BASE + "echarts.min.js";
        script.async = true;
        script.dataset.dashboardEcharts = "true";
        script.onload = () => window.echarts?.init ? resolve(window.echarts) : reject(new Error("ECharts failed to initialize"));
        script.onerror = () => reject(new Error("ECharts failed to load"));
        document.head.appendChild(script);
      });
    }
    return echartsLoadPromise;
  };
  const chartSeriesData = (rows, config, options = {}) => {
    const xField = chartXField(config);
    const yField = chartValueField(config);
    const seriesField = options.series ? chartSeriesField(config) : "";
    const groups = groupedChartData(rows, config, { series: Boolean(seriesField) });
    const categories = unique(groups.map((point) => point.x));
    const seriesNames = unique(groups.map((point) => point.series));
    return {
      categories,
      seriesNames,
      groups,
      xField,
      yField,
      series: seriesNames.map((name) => ({
        name,
        data: categories.map((category) => groups.find((point) => point.x === category && point.series === name)?.value ?? 0),
      })),
    };
  };
  const chartEchartsOption = ({ instance, definition, rows, element }) => {
    let config = instance.config || {};
    const chartType = definition.chartType;
    const colors = chartPaletteForElement(element);
    const axis = chartAxisStyle(element);
    const display = chartDisplayConfig(config);
    const base = {
      backgroundColor: "transparent",
      color: colors,
      animation: true,
      // Entrance: bars cascade in left-to-right; updates (drill in/out, level
      // switches, timeframe filters) morph via universal transitions instead
      // of redrawing cold.
      animationDuration: 480,
      animationEasing: "cubicOut",
      animationDurationUpdate: 650,
      animationEasingUpdate: "cubicInOut",
      textStyle: { color: axis.text, fontFamily: "inherit" },
      tooltip: { trigger: "item", confine: true },
      grid: { left: 28, right: 12, top: 14, bottom: 24, containLabel: true },
    };
    // When a chart plots the 0–100 health score, colour each value by tier
    // (red <50 / amber 50–80 / green ≥80) so the graph reflects the condition
    // rather than a flat green.
    const healthTierColor = (v) => (v >= 80 ? "#6fc99a" : v >= 50 ? "#d4ab63" : "#e1857c");
    const healthTierVisualMap = () => (chartValueField(config) === "health" ? {
      visualMap: { show: false, type: "piecewise", pieces: [
        { lt: 50, color: "#e1857c" },
        { gte: 50, lt: 80, color: "#d4ab63" },
        { gte: 80, color: "#6fc99a" },
      ] },
    } : null);
    // Status timeline: a drill-down strip. Granularity comes from the drill
    // state stored on the widget card or, at the top level, the span of the
    // filtered rows — month → day → hour → individual ping. Buckets of an hour
    // or larger get the 3-tier colour (green all-ok / amber partial / red none);
    // an individual ping is binary (green = succeeded, red = not).
    if (config.adaptiveBucket && Array.isArray(rows)) {
      const pad = (n) => String(n).padStart(2, "0");
      const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const card = element?.closest?.(".widget-card") || element;
      const ds = card?.dataset || {};
      const drilled = !!(ds.drillStart && ds.drillEnd);
      // Granularity tracks the size of the window in view — the drill range when
      // drilled in, otherwise the SELECTED timeframe (not how much data happens
      // to exist), so a week always buckets by day and a year by month even with
      // only a few days of history. ≤1.5h shows individual pings, then hour /
      // day / month. Clicking a bucket narrows the range and drops a level.
      let scoped = rows;
      let spanH;
      let windowStartMs = NaN;
      let windowEndMs = NaN;
      if (drilled) {
        const a = Date.parse(ds.drillStart), b = Date.parse(ds.drillEnd);
        scoped = rows.filter((r) => { const t = Date.parse(r?.checkedAt || r?.date); return Number.isFinite(t) && t >= a && t <= b; });
        spanH = (b - a) / 3600000;
        windowStartMs = a;
        windowEndMs = b;
      } else {
        const layoutKey = element?.closest?.("[data-widget-layout-key]")?.dataset?.widgetLayoutKey;
        const tf = (typeof window !== "undefined" && window.dashboardTimeframeRuntime?.activeRange?.(layoutKey)) || null;
        const bound = (v, end) => (!v ? NaN : (String(v).includes("T") ? Date.parse(v) : Date.parse(`${v}T${end ? "23:59:59" : "00:00:00"}`)));
        const a = bound(tf?.start, false), b = bound(tf?.end, true);
        if (Number.isFinite(a) && Number.isFinite(b)) {
          spanH = (b - a) / 3600000;
          windowStartMs = a;
          windowEndMs = b;
        } else {
          const times = scoped.map((r) => Date.parse(r?.checkedAt || r?.date)).filter(Number.isFinite);
          spanH = times.length ? (Math.max(...times) - Math.min(...times)) / 3600000 : 0;
        }
      }
      // Granularity: auto-derived from the window span, unless the user picked
      // an explicit level from the chart's level strip (data-bucket-level).
      const autoLevel = spanH <= 1.5 ? "ping" : spanH <= 50 ? "hour" : spanH <= 24 * 70 ? "day" : "month";
      // "week" is intentionally NOT a selectable level: it was never wired into the
      // ping→hour→day→month depth ordering (autoLevel never yields it, and drill-up
      // treated it as a dead-end). Excluding it here makes any stale persisted
      // bucketLevel="week" fall back to autoLevel, so the leftover week branches
      // below are dead code.
      const level = ["month", "day", "hour", "ping"].includes(ds.bucketLevel) ? ds.bucketLevel : autoLevel;
      // Every depth renders ONE natural container with a fixed bar count:
      // pings = the 60 minutes of one clock hour, hours = the 24 hours of one
      // day, days = the 28–31 days of one month, weeks = the rolling 52
      // weeks, months = the rolling 12 months. A drill window IS its
      // container; top-level views anchor on the end of the timeframe
      // (clamped to now). Data outside the container is not drawn, and slots
      // without data render grey — so the bar count never wobbles.
      const nowMs = Date.now();
      let cStartMs;
      let cEndMs;
      if (drilled && Number.isFinite(windowStartMs) && Number.isFinite(windowEndMs)) {
        cStartMs = windowStartMs;
        cEndMs = windowEndMs;
      } else {
        const anchor = new Date(Math.min(Number.isFinite(windowEndMs) ? windowEndMs : nowMs, nowMs));
        if (level === "ping") {
          const h = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), anchor.getHours());
          cStartMs = h.getTime();
          cEndMs = h.getTime() + 3600000 - 1;
        } else if (level === "hour") {
          const d0 = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
          cStartMs = d0.getTime();
          cEndMs = d0.getTime() + 86400000 - 1;
        } else if (level === "day") {
          cStartMs = new Date(anchor.getFullYear(), anchor.getMonth(), 1).getTime();
          cEndMs = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1).getTime() - 1;
        } else if (level === "week") {
          const day0 = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
          const weekStart = day0.getTime() - (day0.getDay() * 86400000);
          cStartMs = weekStart - (51 * 604800000);
          cEndMs = weekStart + 604800000 - 1;
        } else {
          cStartMs = new Date(anchor.getFullYear(), anchor.getMonth() - 11, 1).getTime();
          cEndMs = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1).getTime() - 1;
        }
      }
      scoped = scoped.filter((r) => {
        const t = Date.parse(r?.checkedAt || r?.date);
        return Number.isFinite(t) && t >= cStartMs && t <= cEndMs;
      });
      const bucketInfo = (iso) => {
        const d = new Date(iso);
        // Ping buckets key on the MINUTE so real pings and the fixed minute
        // slots line up one-to-one.
        if (level === "ping") { const m = Math.floor(d.getTime() / 60000) * 60000; const md = new Date(m); return { key: `p${m}`, label: `${pad(md.getHours())}:${pad(md.getMinutes())}`, start: "", end: "" }; }
        if (level === "hour") { const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()); return { key: `h${s.getTime()}`, label: `${pad(d.getHours())}:00`, start: s.toISOString(), end: new Date(s.getTime() + 3600000 - 1).toISOString() }; }
        if (level === "day") { const s = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return { key: `d${s.getTime()}`, label: `${MONTHS[d.getMonth()]} ${d.getDate()}`, start: s.toISOString(), end: new Date(s.getTime() + 86400000 - 1).toISOString() }; }
        if (level === "week") { const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const s = new Date(day.getTime() - day.getDay() * 86400000); return { key: `w${s.getTime()}`, label: `${MONTHS[s.getMonth()]} ${s.getDate()}`, start: s.toISOString(), end: new Date(s.getTime() + (7 * 86400000) - 1).toISOString() }; }
        const s = new Date(d.getFullYear(), d.getMonth(), 1);
        return { key: `m${s.getTime()}`, label: MONTHS[d.getMonth()], start: s.toISOString(), end: new Date(new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() - 1).toISOString() };
      };
      // Three-level row condition: red is reserved for downtime (a failed
      // ping); yellow flags a degraded ping (packet loss, or a latency spike
      // judged against the broader baseline — the feed stamps rows with
      // `level`); anything else is green.
      const rowLevel = (r) => r?.level || (r?.status === "red" ? "red" : r?.status === "yellow" ? "yellow" : "green");
      const buckets = new Map();
      for (const r of scoped) {
        const t = Date.parse(r?.checkedAt || r?.date); if (!Number.isFinite(t)) continue;
        const info = bucketInfo(r.checkedAt || r.date);
        let bk = buckets.get(info.key);
        if (!bk) { bk = { key: info.key, label: info.label, start: info.start, end: info.end, success: 0, down: 0, degraded: 0, total: 0, order: t, checkedAt: r.checkedAt || r.date, detail: r.detail || "" }; buckets.set(info.key, bk); }
        const lvl = rowLevel(r);
        if (lvl === "red") bk.down += 1; else if (lvl === "yellow") bk.degraded += 1; else bk.success += 1;
        bk.total += 1;
        if (t < bk.order) bk.order = t;
      }
      // Fold hourly ROLLUPS (data older than the raw 7-day window) into the same
      // buckets. Each rollup hour carries consensus green/yellow/down MINUTE counts
      // (g/y/d) — identical in meaning to the per-minute rows above — and is
      // time-disjoint from the raw rows (raw = last 7 days, rollups = older), so
      // there is no double-counting. Skipped at ping (minute) zoom, which only ever
      // shows recent raw data. This is what reproduces the bars for old ranges.
      if (level !== "ping") {
        const rollups = (window.dashboardRollups && window.dashboardRollups.forActive && window.dashboardRollups.forActive()) || [];
        for (const ru of rollups) {
          if (!ru || !Number.isFinite(ru.h) || ru.h < cStartMs || ru.h > cEndMs) continue;
          const info = bucketInfo(new Date(ru.h).toISOString());
          let bk = buckets.get(info.key);
          if (!bk) { bk = { key: info.key, label: info.label, start: info.start, end: info.end, success: 0, down: 0, degraded: 0, total: 0, order: ru.h, checkedAt: new Date(ru.h).toISOString(), detail: "" }; buckets.set(info.key, bk); }
          bk.success += ru.g || 0; bk.degraded += ru.y || 0; bk.down += ru.d || 0;
          bk.total += (ru.g || 0) + (ru.y || 0) + (ru.d || 0);
          if (ru.h < bk.order) bk.order = ru.h;
        }
      }
      // Fill the container with one slot per period — every minute / hour /
      // day / week / month gets a bar, and slots without data render grey.
      {
        const STEPS = { ping: 60000, hour: 3600000, day: 86400000, week: 604800000 };
        const SAFETY = 70; // never render an unbounded number of slots
        const slotTimes = [];
        if (level === "month") {
          const start = new Date(cStartMs);
          let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
          while (cursor.getTime() <= cEndMs && slotTimes.length < SAFETY) {
            slotTimes.push(cursor.getTime());
            cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
          }
        } else {
          const step = STEPS[level];
          for (let t = cStartMs; t <= cEndMs && slotTimes.length < SAFETY; t += step) slotTimes.push(t);
        }
        slotTimes.forEach((slotMs) => {
          const info = bucketInfo(new Date(slotMs).toISOString());
          if (buckets.has(info.key)) return;
          buckets.set(info.key, {
            key: info.key,
            label: info.label,
            start: info.start,
            end: info.end,
            success: 0,
            down: 0,
            degraded: 0,
            total: 0,
            order: info.start ? Date.parse(info.start) : slotMs,
            checkedAt: "",
            detail: "",
            empty: true,
          });
        });
      }
      const ordered = [...buckets.values()].sort((a, b) => a.order - b.order);
      const isPing = level === "ping";
      // A ping bar is a single condition: red only when that ping was down,
      // amber when degraded, green otherwise. Buckets render as an HP bar
      // instead — stacked green/amber/red segments proportional to the healthy,
      // degraded, and down share of the bucket (97% healthy = 97% green with a
      // 3% amber cap), so one bad ping no longer paints the whole bar.
      const pingColour = (bk) => (bk.down ? "#e1857c" : bk.degraded ? "#d4ab63" : "#6fc99a");
      // Surface the effective view for the chart's level strip.
      if (card?.dataset) card.dataset.chartLevel = level;
      // Breadcrumb of the period currently in view (only while drilled in).
      const ctx = drilled ? new Date(ds.drillStart) : null;
      const contextLabel = ctx
        ? (isPing ? `Pings · ${MONTHS[ctx.getMonth()]} ${ctx.getDate()}, ${pad(ctx.getHours())}:00`
          : level === "hour" ? `${MONTHS[ctx.getMonth()]} ${ctx.getDate()}`
          : MONTHS[ctx.getMonth()])
        : "";
      if (card?.dataset) card.dataset.chartContext = contextLabel;
      return {
        ...base,
        // Symmetric fixed padding — containLabel expands the grid by however
        // much the EDGE labels overhang, which is asymmetric and shoved the
        // bars off-centre. Fixed margins keep the strip perfectly centred.
        grid: { left: 22, right: 22, top: 14, bottom: 26, containLabel: false },
        graphic: [],
        tooltip: {
          trigger: "item",
          confine: true,
          // Keep it terse: a ping is just its time + pass/fail; a bucket its health.
          formatter: (params) => {
            const d = params?.data; if (!d) return "";
            if (d._empty) return `${d._label} · no data`;
            if (d._ping) return `${d._label} · ${d._down ? "Down" : d._degraded ? "Degraded" : "Pass"}`;
            const pct = d._total ? Math.round((d._success / d._total) * 100) : 0;
            const bits = [`${pct}% healthy`];
            if (d._degraded) bits.push(`${d._degraded} degraded`);
            if (d._down) bits.push(`${d._down} down`);
            return `${d._label} · ${bits.join(" · ")}`;
          },
        },
        // No x-axis chrome on the timeline: the baseline (axisLine) underlined the
        // strip and the default category ticks (axisTick) drew a grey separator
        // under every bar — both pointless here. Keep only the time labels.
        xAxis: { type: "category", data: ordered.map((bk) => bk.label), axisLabel: { color: axis.text }, axisLine: { show: false }, axisTick: { show: false } },
        yAxis: { type: "value", show: false, min: 0, max: 100 },
        series: (() => {
          const emphasis = { itemStyle: { shadowBlur: 16, shadowColor: "rgba(255, 255, 255, 0.85)", borderColor: "#ffffff", borderWidth: 2 } };
          const bucketMeta = (bk) => ({ groupId: bk.key, _groupId: bk.key, _ping: isPing, _empty: !!bk.empty, _start: bk.start, _end: bk.end, _checkedAt: bk.checkedAt, _detail: bk.detail, _success: bk.success, _down: bk.down, _degraded: bk.degraded, _total: bk.total, _label: bk.label });
          const EMPTY_GREY = "rgba(148, 163, 184, 0.26)";
          // No entrance stagger here — drill navigation is choreographed by
          // hand in the chart mount (directional exits, then a fan-out from
          // the centred bar), so bars must never "wave in from the left".
          const transitionProps = {
            id: "",
          };
          if (isPing) {
            return [{
              ...transitionProps,
              id: "pings",
              type: "bar",
              barCategoryGap: "16%",
              barMaxWidth: 40,
              cursor: "pointer",
              emphasis,
              data: ordered.map((bk) => ({ value: 100, itemStyle: { color: bk.empty ? EMPTY_GREY : pingColour(bk), borderRadius: 3 }, ...bucketMeta(bk) })),
            }];
          }
          // HP-bar segments stack bottom-up: healthy green, degraded amber, down red.
          // Empty (no-data) slots render as a full-height translucent grey bar.
          //
          // Sizing the bad bands:
          //  1. Each present severity is sized DIRECTLY by sqrt(its own COUNT): more of
          //     a severity reads BIGGER at a glance (6 down clearly beats 1 down; 25
          //     degraded clearly beats 3 down), and sqrt compresses so it's never
          //     HUGELY bigger. A lone event clears a small visibility floor (PER_EVENT).
          //     This is what makes 1-vs-6 distinct even in a SINGLE-severity bar — the
          //     old flat MIN_TOTAL/MIN_EACH floors clamped 1 and 6 to the same size.
          //  2. If the bucket's bad SHARE is higher than the count-based band, scale the
          //     band up to the share (keeping the down:degraded ratio) so a genuinely
          //     bad low-traffic day still reads bad — green stays large on a healthy day.
          const PER_EVENT = 4; // % a single bad event occupies (visibility floor)
          const hpShares = (bk) => {
            if (!bk.total) return { ok: 0, degraded: 0, down: 0 };
            const badCount = bk.down + bk.degraded;
            if (!badCount) return { ok: 100, degraded: 0, down: 0 };
            const sized = (c) => (c > 0 ? PER_EVENT * Math.sqrt(c) : 0);
            let down = sized(bk.down);
            let degraded = sized(bk.degraded);
            const shareBand = (badCount / bk.total) * 100;
            const band = down + degraded;
            if (band > 0 && shareBand > band) { const s = shareBand / band; down *= s; degraded *= s; }
            if (down + degraded > 100) { const s = 100 / (down + degraded); down *= s; degraded *= s; }
            const r = (n) => Math.round(n * 10) / 10;
            return { ok: r(Math.max(0, 100 - down - degraded)), degraded: r(degraded), down: r(down) };
          };
          const hpSegment = (id, color, pct) => ({
            ...transitionProps,
            id,
            type: "bar",
            stack: "hp",
            barCategoryGap: "16%",
            barMaxWidth: 40,
            cursor: "pointer",
            emphasis,
            data: ordered.map((bk) => ({
              value: pct(bk),
              itemStyle: { color, borderRadius: 2 },
              ...bucketMeta(bk),
            })),
          });
          const emptySegment = {
            ...transitionProps,
            id: "hp-empty",
            type: "bar",
            stack: "hp",
            barCategoryGap: "16%",
            barMaxWidth: 40,
            cursor: "pointer",
            emphasis,
            data: ordered.map((bk) => ({
              value: bk.empty ? 100 : 0,
              itemStyle: { color: EMPTY_GREY, borderRadius: 2 },
              ...bucketMeta(bk),
            })),
          };
          return [
            hpSegment("hp-ok", "#6fc99a", (bk) => hpShares(bk).ok),
            hpSegment("hp-degraded", "#d4ab63", (bk) => hpShares(bk).degraded),
            hpSegment("hp-down", "#e1857c", (bk) => hpShares(bk).down),
            emptySegment,
          ];
        })(),
      };
    }
    if (["bar", "horizontal-bar", "grouped-bar", "stacked-bar", "lollipop"].includes(chartType)) {
      const usesSeries = ["grouped-bar", "stacked-bar"].includes(chartType);
      const model = chartSeriesData(rows, config, { series: usesSeries });
      const horizontal = chartType === "horizontal-bar";
      // Uniform mode: every bar is the same full height and only its colour
      // (health tier) varies — an equal-sized status node per bucket across the
      // selected timeframe.
      const uniform = !!config.uniformBars && !horizontal && chartValueField(config) === "health";
      return {
        ...base,
        ...(uniform ? null : healthTierVisualMap()),
        tooltip: { trigger: "axis", confine: true },
        legend: display.showLegend && usesSeries ? { bottom: 0, textStyle: { color: axis.text, fontSize: 10 } } : undefined,
        xAxis: horizontal ? { type: "value", axisLabel: { color: axis.text }, splitLine: { lineStyle: { color: axis.line } } } : { type: "category", data: model.categories, axisLabel: { color: axis.text }, axisLine: { lineStyle: { color: axis.line } } },
        yAxis: horizontal ? { type: "category", data: model.categories, axisLabel: { color: axis.text }, axisLine: { lineStyle: { color: axis.line } } } : (uniform ? { type: "value", show: false, min: 0, max: 100 } : { type: "value", axisLabel: { color: axis.text }, splitLine: { show: display.showGrid, lineStyle: { color: axis.line } } }),
        series: model.series.map((series) => ({
          name: series.name,
          type: "bar",
          stack: chartType === "stacked-bar" ? "total" : undefined,
          barMaxWidth: uniform ? 40 : (chartType === "lollipop" ? 8 : 18),
          barCategoryGap: uniform ? "16%" : undefined,
          data: uniform
            ? series.data.map((v) => ({ value: 100, itemStyle: { color: healthTierColor(Number(v) || 0), borderRadius: 3 } }))
            : series.data,
          itemStyle: { borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] },
        })),
      };
    }
    if (["line", "multi-line", "area", "stacked-area", "sparkline"].includes(chartType)) {
      const usesSeries = ["multi-line", "stacked-area"].includes(chartType);
      const model = chartSeriesData(rows, config, { series: usesSeries });
      return {
        ...base,
        ...healthTierVisualMap(),
        tooltip: { trigger: "axis", confine: true },
        grid: chartType === "sparkline" ? { left: 4, right: 4, top: 4, bottom: 4 } : base.grid,
        legend: display.showLegend && usesSeries && chartType !== "sparkline" ? { bottom: 0, textStyle: { color: axis.text, fontSize: 10 } } : undefined,
        xAxis: { type: "category", show: chartType !== "sparkline" && display.showAxes, data: model.categories, axisLabel: { color: axis.text }, axisLine: { lineStyle: { color: axis.line } } },
        yAxis: { type: "value", show: chartType !== "sparkline" && display.showAxes, axisLabel: { color: axis.text }, splitLine: { show: display.showGrid, lineStyle: { color: axis.line } } },
        series: model.series.map((series) => ({
          name: series.name,
          type: "line",
          smooth: true,
          showSymbol: chartType !== "sparkline",
          areaStyle: ["area", "stacked-area"].includes(chartType) ? { opacity: .22 } : undefined,
          stack: chartType === "stacked-area" ? "total" : undefined,
          data: series.data,
        })),
      };
    }
    if (["pie", "donut"].includes(chartType)) {
      const points = groupedChartData(rows, config).filter((point) => point.value > 0).slice(0, chartLimit(config, 8));
      return {
        ...base,
        legend: display.showLegend ? { bottom: 0, textStyle: { color: axis.text, fontSize: 10 } } : undefined,
        series: [{
          type: "pie",
          radius: chartType === "donut" ? ["44%", "72%"] : "72%",
          center: ["50%", display.showLegend ? "44%" : "50%"],
          label: { show: display.showLabels, color: axis.text, fontSize: 10 },
          data: points.map((point) => ({ name: point.x, value: point.value })),
        }],
      };
    }
    if (["scatter", "bubble"].includes(chartType)) {
      const xField = chartXField(config);
      const yField = chartValueField(config);
      const sizeField = chartField(config, "sizeField");
      const points = rows.map((row) => ({
        x: numberValue(row?.[xField]),
        y: numberValue(row?.[yField]),
        size: numberValue(row?.[sizeField]),
      })).filter((point) => point.x != null && point.y != null).slice(0, chartLimit(config, 80));
      return {
        ...base,
        ...healthTierVisualMap(),
        xAxis: { type: "value", axisLabel: { color: axis.text }, splitLine: { lineStyle: { color: axis.line } } },
        yAxis: { type: "value", axisLabel: { color: axis.text }, splitLine: { lineStyle: { color: axis.line } } },
        series: [{
          type: "scatter",
          symbolSize: (value) => chartType === "bubble" ? Math.max(7, Math.min(24, Number(value?.[2]) || 8)) : 8,
          data: points.map((point) => [point.x, point.y, point.size || 8]),
        }],
      };
    }
    if (["histogram", "box-plot"].includes(chartType)) {
      const values = numericRowsFor(rows, chartValueField(config)).map((entry) => entry.value);
      const min = Math.min(...values);
      const max = Math.max(...values, min + 1);
      const binCount = chartDensityFor(instance) === "large" ? 8 : 6;
      const bins = Array.from({ length: binCount }, (_, index) => ({ name: `${index + 1}`, value: 0 }));
      values.forEach((value) => {
        const index = Math.min(binCount - 1, Math.floor(((value - min) / Math.max(1, max - min)) * binCount));
        bins[index].value += 1;
      });
      return {
        ...base,
        tooltip: { trigger: "axis", confine: true },
        xAxis: { type: "category", data: bins.map((bin) => bin.name), axisLabel: { color: axis.text }, axisLine: { lineStyle: { color: axis.line } } },
        yAxis: { type: "value", axisLabel: { color: axis.text }, splitLine: { show: display.showGrid, lineStyle: { color: axis.line } } },
        series: [{ type: "bar", data: bins.map((bin) => bin.value), barMaxWidth: 18, itemStyle: { borderRadius: [4, 4, 0, 0] } }],
      };
    }
    if (chartType === "heatmap") {
      const xField = chartXField(config);
      const yField = chartSeriesField(config);
      const valueField = chartValueField(config);
      const xValues = unique(rows.map((row) => chartEscapeLabel(row?.[xField]))).slice(0, 8);
      const yValues = unique(rows.map((row) => chartEscapeLabel(row?.[yField]))).slice(0, 6);
      const cells = [];
      xValues.forEach((x, xIndex) => yValues.forEach((y, yIndex) => {
        const matching = rows.filter((row) => chartEscapeLabel(row?.[xField]) === x && chartEscapeLabel(row?.[yField]) === y);
        cells.push([xIndex, yIndex, aggregateValues(matching.map((row) => chartConfiguredAggregation(config) === "count" ? 1 : row?.[valueField]), chartConfiguredAggregation(config)) || 0]);
      }));
      return {
        ...base,
        tooltip: { position: "top", confine: true },
        grid: { left: 34, right: 12, top: 12, bottom: 28 },
        xAxis: { type: "category", data: xValues, axisLabel: { color: axis.text }, splitArea: { show: true } },
        yAxis: { type: "category", data: yValues, axisLabel: { color: axis.text }, splitArea: { show: true } },
        visualMap: { show: false, min: 0, max: Math.max(...cells.map((cell) => cell[2]), 1), inRange: { color: [colors[2], colors[0]] } },
        series: [{ type: "heatmap", data: cells, label: { show: false } }],
      };
    }
    if (["gauge", "radial-progress", "progress-bar"].includes(chartType)) {
      const values = numericRowsFor(rows, chartValueField(config)).map((entry) => entry.value);
      const value = aggregateValues(values, chartConfiguredAggregation(config)) || 0;
      const max = Number(config.max) || Math.max(value, ...values, 100);
      if (chartType === "progress-bar") {
        return {
          ...base,
          grid: { left: 8, right: 8, top: 26, bottom: 20 },
          xAxis: { type: "value", show: false, max },
          yAxis: { type: "category", show: false, data: [config.title || definition.displayName] },
          series: [{ type: "bar", data: [value], barWidth: 18, itemStyle: { borderRadius: 9 }, label: { show: true, position: "inside", color: axis.strong, formatter: () => formatMetricValue(value, config.format) } }],
        };
      }
      // A gauge reads as a condition: low = bad. Colour the arc in three tiers
      // (red / amber / green by fraction of max) and let the needle + value pick
      // up the zone colour, so e.g. a health of 0 is red, not green.
      const isGauge = chartType === "gauge";
      return {
        ...base,
        series: [{
          type: "gauge",
          min: 0,
          max,
          progress: { show: !isGauge, roundCap: true },
          axisLine: isGauge
            ? { roundCap: true, lineStyle: { width: 10, color: [[0.5, "#e1857c"], [0.8, "#d4ab63"], [1, "#6fc99a"]] } }
            : { roundCap: true, lineStyle: { width: 9 } },
          pointer: { show: isGauge, itemStyle: { color: "auto" } },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          detail: { color: isGauge ? "auto" : axis.strong, fontSize: 16, formatter: () => chartType === "radial-progress" ? `${Math.round((value / Math.max(1, max)) * 100)}%` : formatMetricValue(value, config.format) },
          data: [{ value }],
        }],
      };
    }
    if (chartType === "kpi-trend") {
      const values = numericRowsFor(rows, chartValueField(config)).map((entry) => entry.value).slice(0, chartLimit(config, 60));
      return {
        ...base,
        grid: { left: 8, right: 8, top: 18, bottom: 8 },
        title: { text: values.length ? formatMetricValue(values.at(-1), config.format) : "", textStyle: { color: axis.strong, fontSize: 18, fontWeight: 800 }, left: 4, top: 0 },
        xAxis: { type: "category", show: false, data: values.map((_, index) => index + 1) },
        yAxis: { type: "value", show: false },
        series: [{ type: "line", smooth: true, showSymbol: false, data: values, areaStyle: { opacity: .18 } }],
      };
    }
    return { ...base, series: [] };
  };
  let tanstackTableLoadPromise = null;
  const loadTanstackTable = () => {
    if (window.TableCore?.createTable) return Promise.resolve(window.TableCore);
    if (!tanstackTableLoadPromise) {
      tanstackTableLoadPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector("script[data-dashboard-tanstack-table]");
        if (existing) {
          existing.addEventListener("load", () => window.TableCore?.createTable ? resolve(window.TableCore) : reject(new Error("TanStack Table failed to initialize")), { once: true });
          existing.addEventListener("error", () => reject(new Error("TanStack Table failed to load")), { once: true });
          return;
        }
        const script = document.createElement("script");
        script.src = VENDOR_BASE + "tanstack-table-core.js";
        script.async = true;
        script.dataset.dashboardTanstackTable = "true";
        script.onload = () => window.TableCore?.createTable ? resolve(window.TableCore) : reject(new Error("TanStack Table failed to initialize"));
        script.onerror = () => reject(new Error("TanStack Table failed to load"));
        document.head.appendChild(script);
      });
    }
    return tanstackTableLoadPromise;
  };

  // Remembers each table widget's scroll offset across re-renders. Status data
  // ingests on every ping, which tears the whole table down and rebuilds it —
  // without this the well would snap back to the top each time, yanking the user
  // out of wherever they'd scrolled. Module-scoped so it survives the rebuild.
  const tableScrollMemory = new Map();
  const findTableScroller = (el) => {
    let node = el;
    while (node && node !== document.body) {
      const cs = getComputedStyle(node);
      if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && node.scrollHeight > node.clientHeight + 1) return node;
      node = node.parentElement;
    }
    return null;
  };
  // Above this many rows a table is WINDOWED: only the visible rows (+ overscan)
  // are built into the DOM, so a 24h ping buffer no longer rebuilds thousands of
  // <tr> on every ingest. Smaller tables render fully (no behaviour change).
  const TABLE_VIRTUALIZE_THRESHOLD = 120;
  const TABLE_VIRTUALIZE_OVERSCAN = 10;
  const mountTableBodyRenderer = ({ contentRoot, instance }) => {
    const target = contentRoot?.querySelector?.(".runtime-table-tanstack");
    if (!target) return null;
    // Scroll-preservation bookkeeping (see tableScrollMemory above). memKey is
    // read now (target is live); scroller/handler are wired once the table is
    // built and read back in dispose so teardown can save the offset and detach
    // BEFORE clearing — clearing collapses the scroll height and would otherwise
    // fire a scroll-to-0 that clobbers the saved position.
    const memWidgetEl = target.closest(".widget-card");
    const memKey = memWidgetEl?.getAttribute("data-widget-key") || "";
    let scroller = null;
    let scrollHandler = null;
    const config = instance?.config || {};
    const rows = [...widgetDataRows(instance?.data)];
    // Honour the configured sort (e.g. sortBy "checkedAt" desc so the newest
    // ping renders at the top) — rows otherwise arrive in ingest order.
    const sortBy = String(config.sortBy || "").trim();
    if (sortBy) {
      const direction = String(config.sortDirection || "asc").toLowerCase() === "desc" ? -1 : 1;
      const sortValue = (row) => {
        const raw = row?.[sortBy];
        if (raw == null || raw === "") return null;
        if (typeof raw === "number") return raw;
        const text = String(raw);
        const timestamp = /^\d{4}-\d{2}-\d{2}/.test(text) ? Date.parse(text) : NaN;
        if (Number.isFinite(timestamp)) return timestamp;
        const numeric = Number(text);
        return Number.isFinite(numeric) ? numeric : text;
      };
      rows.sort((a, b) => {
        const av = sortValue(a);
        const bv = sortValue(b);
        if (av == null && bv == null) return 0;
        if (av == null) return 1; // empty values sink to the bottom either way
        if (bv == null) return -1;
        if (av < bv) return -direction;
        if (av > bv) return direction;
        return 0;
      });
    }
    const configuredColumns = tableConfiguredColumns(config);
    const schemaFields = rows.length ? Object.keys(rows[0] || {}) : dataSchemaFields(instance?.data);
    const allFields = unique(configuredColumns.length ? configuredColumns : schemaFields.length ? schemaFields : [""]);
    const visibleFields = allFields.slice(0, tableVisibleColumnCount(instance.cols));
    const dataRows = rows.slice(0, tableVisibleRowCount(instance.rows, config.limit));

    // Build one data <tr> with the hooks the table has always had: result/level
    // dataset for hover tinting, checkedAt for the timeline link, and a click that
    // focuses that ping on the chart and flashes the row.
    const makeRow = (rowData) => {
      const tr = document.createElement("tr");
      const rowResult = rowData?.result;
      if (rowResult) tr.dataset.result = rowResult;
      const rowLevel = rowData?.level || (rowData?.status === "red" ? "red" : rowData?.status === "yellow" ? "yellow" : rowResult ? "green" : "");
      if (rowLevel) tr.dataset.level = rowLevel;
      if (rowData?.checkedAt) {
        tr.dataset.checkedAt = rowData.checkedAt;
        tr.style.cursor = "pointer";
        tr.addEventListener("click", (event) => {
          if (wasDragGesture(event)) return;
          focusChartPing(tr.dataset.checkedAt);
          // Persistent highlight (same minute lights up across every viewer
          // table); stays until a click-away. setPingFocus repaints all tables.
          setPingFocus(tr.dataset.checkedAt);
        });
      }
      for (const field of visibleFields) {
        const td = document.createElement("td");
        const value = String(rowData?.[field] ?? "");
        td.textContent = value;
        td.title = value;
        tr.appendChild(td);
      }
      return tr;
    };

    try {
      const tableEl = document.createElement("table");
      tableEl.className = "runtime-table";
      tableEl.setAttribute("role", "grid");
      tableEl.setAttribute("aria-label", config.title || "Table");
      const thead = document.createElement("thead");
      const headerTr = document.createElement("tr");
      // Friendlier labels for the value+delta columns — the parenthetical in each
      // cell ("25 (-7)") is the delta vs the link's average, so the header carries a
      // Δ to denote it. Data keys are untouched (saved column configs still match).
      const HEADER_LABELS = { "ping (ms)": "Ping ms (Δ)", "loss (%)": "Loss % (Δ)" };
      for (const field of visibleFields) {
        const th = document.createElement("th");
        const label = HEADER_LABELS[field] || String(field);
        th.textContent = label;
        th.title = label;
        headerTr.appendChild(th);
      }
      thead.appendChild(headerTr);
      tableEl.appendChild(thead);
      const tbody = document.createElement("tbody");
      tableEl.appendChild(tbody);

      // The well is the scroll container for these table widgets.
      scroller = target.closest(".widget-content-well") || findTableScroller(target);
      const virtualize = !!scroller && dataRows.length > TABLE_VIRTUALIZE_THRESHOLD;

      if (!virtualize) {
        for (const rowData of dataRows) tbody.appendChild(makeRow(rowData));
        target.appendChild(tableEl);
        if (scroller) delete scroller.__vtable;
      } else {
        // Windowed: only the visible rows (+ overscan) live in the DOM, between two
        // spacer rows whose heights stand in for the off-screen rows — so the DOM
        // and the per-ping rebuild stay ~constant no matter how many pings pile up.
        tableEl.classList.add("runtime-table-virtual");
        const makeSpacer = () => {
          const tr = document.createElement("tr");
          tr.className = "vt-spacer";
          tr.setAttribute("aria-hidden", "true");
          const td = document.createElement("td");
          td.colSpan = visibleFields.length || 1;
          tr.appendChild(td);
          return tr;
        };
        const topSpacer = makeSpacer();
        const botSpacer = makeSpacer();
        tbody.appendChild(topSpacer);
        tbody.appendChild(botSpacer);
        // Probe a real row in the DOM to measure the density-aware row height.
        const probe = makeRow(dataRows[0]);
        tbody.insertBefore(probe, botSpacer);
        target.appendChild(tableEl);
        const rowH = Math.max(1, Math.round(probe.getBoundingClientRect().height) || 24);
        probe.remove();

        // The ping-focus highlight must SURVIVE re-renders. Scrolling a row into
        // view changes scrollTop, which fires the scroll handler → renderWindow,
        // rebuilding the rows. If the highlight lived only on the original <tr> it
        // was wiped by that very re-render. It now reads the shared persistent
        // pingFocusMinute, so every render re-applies (or drops) it to match.
        const applyFocus = () => {
          for (const tr of tbody.querySelectorAll("tr[data-checked-at]")) {
            const t = Date.parse(tr.dataset.checkedAt);
            tr.classList.toggle("ping-focus", pingFocusMinute != null && Number.isFinite(t) && Math.floor(t / 60000) === pingFocusMinute);
          }
        };
        const renderWindow = () => {
          const total = dataRows.length;
          const first = Math.max(0, Math.floor(scroller.scrollTop / rowH) - TABLE_VIRTUALIZE_OVERSCAN);
          const last = Math.min(total, first + Math.ceil((scroller.clientHeight || 1) / rowH) + TABLE_VIRTUALIZE_OVERSCAN * 2);
          topSpacer.firstChild.style.height = (first * rowH) + "px";
          botSpacer.firstChild.style.height = (Math.max(0, total - last) * rowH) + "px";
          for (let n = topSpacer.nextSibling; n && n !== botSpacer; ) { const next = n.nextSibling; n.remove(); n = next; }
          const frag = document.createDocumentFragment();
          for (let i = first; i < last; i++) frag.appendChild(makeRow(dataRows[i]));
          tbody.insertBefore(frag, botSpacer);
          applyFocus();
        };

        // Let the chart-ping click (focusHistoryRow) reach a row outside the window:
        // find it in the data, scroll it in, render, and hand back the live <tr>.
        const matchIndex = (checkedAt) => {
          const t0 = Date.parse(checkedAt);
          const minute = Number.isFinite(t0) ? Math.floor(t0 / 60000) : null;
          return dataRows.findIndex((r) => r.checkedAt === checkedAt ||
            (minute != null && Number.isFinite(Date.parse(r.checkedAt)) && Math.floor(Date.parse(r.checkedAt) / 60000) === minute));
        };
        scroller.__vtable = {
          rowH,
          render: renderWindow,
          locate: (checkedAt) => {
            const idx = matchIndex(checkedAt);
            if (idx < 0) return null;
            // focusHistoryRow already set the shared pingFocusMinute; set it here
            // too for any direct caller, then scroll the match in and paint it. The
            // highlight is persistent — it clears on a click-away, not a timer.
            const t0 = Date.parse(checkedAt);
            if (Number.isFinite(t0)) pingFocusMinute = Math.floor(t0 / 60000);
            scroller.scrollTop = Math.max(0, idx * rowH - (scroller.clientHeight - rowH) / 2);
            renderWindow(); // applies .ping-focus; the scroll-triggered re-render re-applies it too
            return tbody.querySelector("tr.ping-focus") || null;
          },
        };
        renderWindow();
      }

      // A persistent ping-focus must survive this re-render (live data refreshes
      // rebuild the rows). Re-apply it to the freshly built rows; windowed tables
      // also re-apply on every scroll render via applyFocus.
      if (pingFocusMinute != null) paintPingFocus(target);

      // Restore the saved scroll position and keep tracking it (both paths).
      if (scroller && memKey) {
        const saved = tableScrollMemory.get(memKey);
        if (saved) { scroller.scrollTop = saved; if (scroller.__vtable) scroller.__vtable.render(); }
        scrollHandler = () => {
          tableScrollMemory.set(memKey, scroller.scrollTop);
          if (scroller.__vtable) scroller.__vtable.render();
        };
        scroller.addEventListener("scroll", scrollHandler, { passive: true });
      }
    } catch (error) {
      if (target.isConnected) target.innerHTML = defaultWidgetVisual("table");
    }

    return () => {
      // Save the latest offset and detach BEFORE clearing, so the teardown's
      // scroll-to-0 can't overwrite the remembered position.
      if (memKey && scroller) {
        tableScrollMemory.set(memKey, scroller.scrollTop);
        if (scrollHandler) scroller.removeEventListener("scroll", scrollHandler);
        scrollHandler = null;
        delete scroller.__vtable;
      }
      if (target.isConnected) target.innerHTML = "";
    };
  };

  let monacoLoadPromise = null;
  const loadMonaco = () => {
    if (window.monaco?.editor?.create) return Promise.resolve(window.monaco);
    if (!monacoLoadPromise) {
      monacoLoadPromise = new Promise((resolve, reject) => {
        if (!window.MonacoEnvironment) {
          window.MonacoEnvironment = {
            getWorkerUrl: () => URL.createObjectURL(new Blob([""], { type: "text/javascript" })),
          };
        }
        const existing = document.querySelector("script[data-dashboard-monaco]");
        const afterLoad = () => {
          window.require.config({ paths: { vs: VENDOR_BASE + "monaco/vs" } });
          window.require(["vs/editor/editor.main"], () =>
            window.monaco?.editor ? resolve(window.monaco) : reject(new Error("Monaco failed to initialize"))
          );
        };
        if (existing) {
          existing.addEventListener("load", afterLoad, { once: true });
          existing.addEventListener("error", () => reject(new Error("Monaco failed to load")), { once: true });
          return;
        }
        const script = document.createElement("script");
        script.src = VENDOR_BASE + "monaco/vs/loader.js";
        script.async = true;
        script.dataset.dashboardMonaco = "true";
        script.onload = afterLoad;
        script.onerror = () => reject(new Error("Monaco failed to load"));
        document.head.appendChild(script);
      });
    }
    return monacoLoadPromise;
  };

  const mountMonacoBodyRenderer = ({ contentRoot, content, language }) => {
    const target = contentRoot?.querySelector?.(".runtime-monaco-editor");
    if (!target) return null;
    let disposed = false;
    let editor = null;
    let resizeObserver = null;
    loadMonaco()
      .then((monaco) => {
        if (disposed || !target.isConnected) return;
        const wellTone = target.closest("[data-well-tone]")?.dataset?.wellTone === "dark" ? "dark" : "white";
        editor = monaco.editor.create(target, {
          value: content,
          language,
          readOnly: true,
          theme: wellTone === "dark" ? "vs-dark" : "vs",
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: false,
          wordWrap: "on",
          fontSize: 12,
          lineNumbers: "off",
          folding: false,
          renderLineHighlight: "none",
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
          contextmenu: false,
          links: false,
        });
        resizeObserver = new ResizeObserver(() => editor?.layout());
        resizeObserver.observe(target);
        requestAnimationFrame(() => editor?.layout());
      })
      .catch((error) => {
        if (disposed || !target.isConnected) return;
        target.innerHTML = defaultWidgetVisual("document");
      });
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      editor?.dispose();
      editor = null;
    };
  };

  const mountChartBodyRenderer = ({ contentRoot, instance, definition }) => {
    const target = contentRoot?.querySelector?.(".runtime-chart-echarts");
    if (!target) return null;
    const config = instance?.config || {};
    const chartDefinition = getChartDefinition(config.chartType || "bar") || definition;
    let disposed = false;
    let chart = null;
    let resizeObserver = null;
    loadEcharts()
      .then((echarts) => {
        if (disposed || !target.isConnected) return;
        const rows = widgetDataRows(instance?.data);
        chart = echarts.init(target, null, { renderer: "svg" });
        // Adaptive (status timeline) charts repaint with replaceMerge so the
        // universal transition can morph the old bars into the new view —
        // notMerge would tear the scene down and lose the animation.
        let paint = () => chart.setOption(
          chartEchartsOption({ instance, definition: chartDefinition, rows, element: target }),
          config.adaptiveBucket ? { replaceMerge: ["series", "graphic"] } : true
        );
        paint();
        // Fractal drill-down for the status timeline: clicking a bucket zooms in
        // one level (narrower range, finer granularity); clicking empty space
        // pops back up a level. Drill state lives on the widget card so it
        // survives data-driven re-renders but is cleared when the timeframe
        // changes.
        if (config.adaptiveBucket) {
          const card = target.closest(".widget-card") || target;
          // Granularity strip under the plot: the current viewable range on the
          // right, explicit level selectors (months → pings) on the left. An
          // explicit pick pins the bucket level; drilling re-enters auto mode.
          const LEVELS = [
            ["month", "Months"], ["day", "Days"], ["hour", "Hours"], ["ping", "Pings"],
          ];
          const strip = document.createElement("div");
          strip.className = "chart-level-strip";
          strip.innerHTML = `<div class="chart-level-buttons">`
            + `<button type="button" class="chart-level-btn chart-level-back" data-action="back">‹ Back</button>`
            + LEVELS.map(([key, label]) => (
              `<button type="button" class="chart-level-btn" data-level="${key}">${label}</button>`
            )).join("")
            + `</div>`;
          target.insertAdjacentElement("afterend", strip);
          const updateStrip = () => {
            const effective = card.dataset.chartLevel || "";
            strip.querySelectorAll(".chart-level-btn[data-level]").forEach((btn) => {
              btn.classList.toggle("is-active", btn.dataset.level === effective);
            });
          };
          const basePaint = paint;
          paint = () => { basePaint(); updateStrip(); };
          updateStrip();
          strip.addEventListener("click", (event) => {
            const btn = event.target?.closest?.(".chart-level-btn");
            if (!btn) return;
            event.preventDefault();
            event.stopPropagation();
            if (btn.dataset.action === "back") {
              // Pure layer-up: pings → hours → days → months. Never a history
              // pop — any drill scope clears and the broad view paints at the
              // parent depth. At months there is nowhere further up to go.
              const PARENTS = { ping: "hour", hour: "day", day: "month", week: "month" };
              const parent = PARENTS[card.dataset.chartLevel || ""];
              if (!parent) return;
              card.dataset.bucketLevel = parent;
              delete card.dataset.drillStart;
              delete card.dataset.drillEnd;
              delete card.dataset.drillGroupId;
              // The expanded bars sweep back in toward centre before the
              // parent depth paints.
              fanBackThen(paint);
              return;
            }
            if (card.dataset.bucketLevel === btn.dataset.level) {
              delete card.dataset.bucketLevel; // toggle back to auto
            } else {
              card.dataset.bucketLevel = btn.dataset.level;
            }
            // An explicit level resets any drill — the view returns to the
            // selected timeframe at that granularity.
            delete card.dataset.drillStart;
            delete card.dataset.drillEnd;
            delete card.dataset.drillGroupId;
            paint();
          });
          // Walk every rendered bar element of every series and apply fn(el, barX, j).
          const eachBarElement = (fn) => {
            const model = chart.getModel?.();
            if (!model) return false;
            const seriesArr = chart.getOption()?.series || [];
            for (let s = 0; s < seriesArr.length; s += 1) {
              const data = model.getSeriesByIndex(s)?.getData?.();
              if (!data?.getItemGraphicEl) continue;
              const count = seriesArr[s].data?.length || 0;
              for (let j = 0; j < count; j += 1) {
                const el = data.getItemGraphicEl(j);
                if (!el || typeof el.animateTo !== "function") continue;
                const barX = chart.convertToPixel({ seriesIndex: s, dataIndex: j }, [j, 0])?.[0];
                if (!Number.isFinite(barX)) continue;
                fn(el, barX, j);
              }
            }
            return true;
          };
          // Phase 2 of the drill: the freshly painted child bars start stacked
          // at centre stage (where the clicked bar landed) and fan outward to
          // their slots — inner bars settle first, the outermost last.
          const fanChildrenFromCenter = () => {
            try {
              const cx = chart.getWidth() / 2;
              eachBarElement((el, barX) => {
                const fromDx = cx - barX;
                el.x = fromDx;
                el.animateTo(
                  { x: 0 },
                  { duration: 460, delay: Math.min(Math.abs(fromDx) * 0.35, 220), easing: "cubicOut" }
                );
              });
            } catch {}
          };
          // Drill-in choreography, all animated by hand on the rendered bars:
          // neighbours LEFT of the clicked bar slide off to the left, those on
          // the RIGHT slide off to the right, the clicked bar glides to centre
          // stage — then the drilled view paints with its child bars splitting
          // out of that centre point, fanning left and right into place.
          const fanOutInto = (groupId) => {
            const finishPaint = () => {
              if (disposed || !chart || chart.isDisposed?.()) return;
              paint();
              requestAnimationFrame(fanChildrenFromCenter);
            };
            try {
              const seriesArr = chart.getOption()?.series || [];
              const firstData = seriesArr[0]?.data || [];
              const idx = firstData.findIndex((item) => item && item._groupId === groupId);
              if (idx >= 0 && firstData.length > 1) {
                const plotWidth = chart.getWidth();
                const clickedX = chart.convertToPixel({ seriesIndex: 0, dataIndex: idx }, [idx, 0])?.[0] ?? plotWidth / 2;
                const centerDx = (plotWidth / 2) - clickedX;
                const moved = eachBarElement((el, barX, j) => {
                  const dx = j === idx
                    ? centerDx
                    : j < idx
                      ? -(barX + 90)            // exit stage left
                      : (plotWidth - barX) + 90; // exit stage right
                  el.animateTo({ x: (el.x || 0) + dx }, { duration: 320, easing: "cubicInOut" });
                });
                if (moved) {
                  window.setTimeout(finishPaint, 340);
                  return;
                }
              }
            } catch {}
            finishPaint();
          };
          // Going back up a level reverses the motion: the expanded bars sweep
          // back IN toward centre stage, then the parent view paints.
          const fanBackThen = (after) => {
            try {
              const cx = chart.getWidth() / 2;
              const moved = eachBarElement((el, barX) => {
                el.animateTo(
                  { x: (el.x || 0) + (cx - barX) },
                  { duration: 300, delay: Math.max(0, 120 - Math.abs(cx - barX) * 0.18), easing: "cubicIn" }
                );
              });
              if (moved) {
                window.setTimeout(() => { if (!disposed && chart && !chart.isDisposed?.()) after(); }, 330);
                return;
              }
            } catch {}
            after();
          };
          chart.on("click", (params) => {
            const d = params?.data;
            if (!d) return;
            if (d._ping) {
              // Clicking a ping jumps to it in the table: scroll it into the
              // centre and flash a highlight.
              focusHistoryRow(d._checkedAt);
              return;
            }
            if (!d._start || !d._end) return; // a single ping with no range — nothing to drill
            card.dataset.drillStart = d._start;
            card.dataset.drillEnd = d._end;
            // The new view descends from the clicked bucket: the universal
            // transition splits that bar into its children.
            if (d._groupId) card.dataset.drillGroupId = d._groupId; else delete card.dataset.drillGroupId;
            delete card.dataset.bucketLevel; // drilling resumes auto granularity
            fanOutInto(d._groupId);
          });
          // (Background clicks intentionally do nothing — stepping back up a
          // level lives on the strip's "‹ Back" control.)
          // Only one bar is ever lit — a new focus extinguishes the previous
          // one immediately.
          let activeFlash = null;
          const clearFlash = () => {
            if (!activeFlash) return;
            window.clearTimeout(activeFlash.timer);
            if (chart && !chart.isDisposed?.()) {
              chart.dispatchAction({ type: "downplay", seriesIndex: 0 });
              chart.dispatchAction({ type: "hideTip" });
            }
            activeFlash = null;
          };
          const flashTarget = (targetMs, delay = 700) => {
            const flash = { timer: 0 };
            activeFlash = flash;
            const targetMinute = Math.floor(targetMs / 60000);
            flash.timer = window.setTimeout(() => {
              if (disposed || !chart || chart.isDisposed?.() || activeFlash !== flash) return;
              const seriesData = chart.getOption()?.series?.[0]?.data || [];
              const dataIndex = seriesData.findIndex((d) => d && d._checkedAt && Math.floor(Date.parse(d._checkedAt) / 60000) === targetMinute);
              if (dataIndex < 0) return;
              chart.dispatchAction({ type: "downplay", seriesIndex: 0 });
              chart.dispatchAction({ type: "highlight", seriesIndex: 0, dataIndex });
              chart.dispatchAction({ type: "showTip", seriesIndex: 0, dataIndex });
              flash.timer = window.setTimeout(() => {
                if (disposed || !chart || chart.isDisposed?.() || activeFlash !== flash) return;
                chart.dispatchAction({ type: "downplay", seriesIndex: 0, dataIndex });
                chart.dispatchAction({ type: "hideTip" });
                activeFlash = null;
              }, 2400);
            }, delay);
          };
          // Navigate-and-highlight for one ping (used by the stat cards and
          // the table rows). The ping depth always shows the CLOCK HOUR
          // containing the target — 60 fixed minute slots. If that hour is
          // already on stage, nothing repaints (just the flash). If a
          // different hour is showing, the strip sweeps back up one depth,
          // paints the target day's hours, then fans into the right hour.
          card.__focusChartPing = (checkedAt) => {
            if (disposed || !chart || chart.isDisposed?.()) return;
            const targetMs = Date.parse(checkedAt);
            if (!Number.isFinite(targetMs)) return;
            clearFlash();
            const t = new Date(targetMs);
            const hourStart = new Date(t.getFullYear(), t.getMonth(), t.getDate(), t.getHours());
            const dayStart = new Date(t.getFullYear(), t.getMonth(), t.getDate());
            const hourGroup = `h${hourStart.getTime()}`;
            const minuteKey = `p${Math.floor(targetMs / 60000) * 60000}`;
            const applyHourDrill = () => {
              card.dataset.drillStart = hourStart.toISOString();
              card.dataset.drillEnd = new Date(hourStart.getTime() + 3600000 - 1).toISOString();
              card.dataset.drillGroupId = hourGroup;
              delete card.dataset.bucketLevel;
            };
            const stageData = chart.getOption()?.series?.[0]?.data || [];
            const onStage = (groupId) => stageData.some((d) => d && d._groupId === groupId);
            if (card.dataset.chartLevel === "ping") {
              if (onStage(minuteKey)) {
                // The right hour is already showing — just flash the bar.
                flashTarget(targetMs, 80);
                return;
              }
              // A different hour is showing: sweep back up a depth, paint the
              // target day's hours, then fan into the correct hour.
              fanBackThen(() => {
                card.dataset.drillStart = dayStart.toISOString();
                card.dataset.drillEnd = new Date(dayStart.getTime() + 86400000 - 1).toISOString();
                delete card.dataset.drillGroupId;
                delete card.dataset.bucketLevel;
                paint();
                window.setTimeout(() => {
                  if (disposed || !chart || chart.isDisposed?.()) return;
                  applyHourDrill();
                  fanOutInto(hourGroup);
                  flashTarget(targetMs, 1500);
                }, 520);
              });
              return;
            }
            // Coarser depth: the bucket holding the target splits open into
            // the target hour's ping strip.
            const fromLevel = card.dataset.chartLevel || "";
            const parentGroup = fromLevel === "hour" ? hourGroup
              : fromLevel === "day" ? `d${dayStart.getTime()}`
                : fromLevel === "week" ? `w${dayStart.getTime() - (dayStart.getDay() * 86400000)}`
                  : fromLevel === "month" ? `m${new Date(t.getFullYear(), t.getMonth(), 1).getTime()}`
                    : "";
            applyHourDrill();
            if (parentGroup && onStage(parentGroup)) {
              fanOutInto(parentGroup);
              flashTarget(targetMs, 1100);
            } else {
              paint();
              flashTarget(targetMs, 700);
            }
          };
        }
        resizeObserver = new ResizeObserver(() => chart?.resize());
        resizeObserver.observe(target);
        requestAnimationFrame(() => chart?.resize());
      })
      .catch((error) => {
        if (disposed || !target.isConnected) return;
        target.innerHTML = defaultWidgetVisual("chart");
      });
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      const card = target.closest(".widget-card");
      if (card && card.__focusChartPing) delete card.__focusChartPing;
      if (chart && !chart.isDisposed?.()) chart.dispose();
      chart = null;
    };
  };
  const registerChartDefinition = (definition) => {
    const chartType = String(definition?.chartType || "").trim();
    if (!chartType) return false;
    chartDefinitions.set(chartType, {
      category: "general",
      supportedAggregations: CHART_AGGREGATIONS,
      defaultConfig: {},
      valueRequiredForAggregation: true,
      render: renderEchartsChartFrame,
      ...definition,
      chartType,
      displayName: definition.displayName || chartType,
    });
    return true;
  };
  const getChartDefinition = (chartType) => chartDefinitions.get(chartTypeAliases[chartType] || chartType) || null;
  const listChartDefinitions = () => [...chartDefinitions.values()].map((definition) => ({
    chartType: definition.chartType,
    displayName: definition.displayName,
    category: definition.category,
    supportedAggregations: definition.supportedAggregations,
    defaultConfig: definition.defaultConfig,
  }));
  [
    ["bar", "Bar", "basic-comparison"],
    ["horizontal-bar", "Horizontal Bar", "basic-comparison"],
    ["grouped-bar", "Grouped Bar", "basic-comparison"],
    ["stacked-bar", "Stacked Bar", "basic-comparison"],
    ["lollipop", "Lollipop", "basic-comparison"],
    ["line", "Line", "time-series"],
    ["multi-line", "Multi-line", "time-series"],
    ["area", "Area", "time-series"],
    ["stacked-area", "Stacked Area", "time-series"],
    ["sparkline", "Sparkline", "time-series"],
    ["histogram", "Histogram", "distribution"],
    ["box-plot", "Box Plot", "distribution"],
    ["scatter", "Scatter", "relationship"],
    ["bubble", "Bubble", "relationship"],
    ["heatmap", "Heatmap", "relationship"],
    ["pie", "Pie", "composition"],
    ["donut", "Donut", "composition"],
    ["gauge", "Gauge", "ranking-progress"],
    ["radial-progress", "Radial Progress", "ranking-progress"],
    ["progress-bar", "Progress Bar", "ranking-progress"],
    ["kpi-trend", "KPI Trend Card", "ranking-progress"],
  ].forEach(([chartType, displayName, category, render]) => registerChartDefinition({
    chartType,
    displayName,
    category,
    render: render || renderEchartsChartFrame,
    defaultConfig: { chartType },
    valueRequiredForAggregation: !["bar", "horizontal-bar", "grouped-bar", "stacked-bar", "lollipop", "pie", "donut", "heatmap"].includes(chartType),
  }));

  const defaultWidgetVisual = (kind = "widget", label = "") => {
    const normalized = String(kind || "widget").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase() || "widget";
    const title = String(label || normalized.replace(/[-_]+/g, " ")).trim();
    return `
      <div class="widget-default-visual widget-default-visual-${escapeHtml(normalized)}" data-widget-default-visual="${escapeHtml(normalized)}" aria-label="${escapeHtml(title || "Widget")}">
        <span></span><span></span><span></span>
      </div>`;
  };

  const defaultMediaVisual = (kind, title, caption = "", config = {}) => {
    const normalized = String(kind || "media").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase() || "media";
    return `
      <div class="media-widget runtime-well-widget media-widget-${escapeHtml(normalized)}-wrap" data-media-kind="${escapeHtml(normalized)}" data-media-status="default" ${wellToneAttribute(config)}>
        <figure class="widget-content-well widget-library-surface media-widget-stage media-widget-default-stage media-widget-default-${escapeHtml(normalized)}" aria-label="${escapeHtml(title || normalized)}">
          <span class="media-default-mark media-default-mark-${escapeHtml(normalized)}"></span>
        </figure>
        ${mediaCaptionMarkup(caption)}
      </div>`;
  };

  const runtimeMeta = (primary, data = null, options = {}) => {
    const parts = [primary].filter(Boolean);
    if (options.filtered) parts.push("filtered");
    if (options.stale) parts.push("stale");
    return parts.join(" / ");
  };

  const safeMediaUrl = (value, kind = "generic") => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const lower = raw.toLowerCase();
    const dataPrefixes = {
      image: ["data:image/"],
      video: ["data:video/"],
      document: ["data:application/pdf", "data:text/"],
    };
    if (lower.startsWith("data:")) {
      return (dataPrefixes[kind] || []).some((prefix) => lower.startsWith(prefix)) ? raw : null;
    }
    if (raw.includes("\\")) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw.startsWith("//") ? null : raw;
    try {
      const parsed = new URL(raw, window.location.origin);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? raw : null;
    } catch {
      return null;
    }
  };

  const safeMediaFit = (value) => ["contain", "cover", "fill", "center"].includes(value) ? value : "contain";
  const mediaTitle = (config, fallback) => String(config?.title || fallback || "").trim();
  const mediaCaptionMarkup = (caption) => caption
    ? `<div class="media-widget-caption">${escapeHtml(caption)}</div>`
    : "";

  const widgetShellText = (value = "") => String(value ?? "").trim();
  const widgetShellTitle = (definition, instance, props = {}) => {
    if (typeof definition.getTitle === "function") {
      return widgetShellText(definition.getTitle({ ...props, definition, instance }));
    }
    return widgetShellText(instance?.config?.title || instance?.config?.label || definition.displayName || definition.label || definition.type || "Widget");
  };
  const widgetShellMetadata = (definition, instance, props = {}) => {
    if (typeof definition.getMetadata === "function") {
      const metadata = definition.getMetadata({ ...props, definition, instance });
      if (Array.isArray(metadata)) return metadata.map(widgetShellText).filter(Boolean);
      return widgetShellText(metadata) ? [widgetShellText(metadata)] : [];
    }
    return [];
  };
  const widgetShellFooter = (definition, instance, props = {}) => {
    if (typeof definition.getFooter === "function") {
      return widgetShellText(definition.getFooter({ ...props, definition, instance }));
    }
    return "";
  };
  const renderWidgetShell = (definition, props = {}, content = "") => {
    const instance = props.instance || {};
    const shellConfig = definition.shell && typeof definition.shell === "object" ? definition.shell : {};
    const density = normalizeDensity(props.density || instance.density || "standard");
    const title = widgetShellTitle(definition, instance, props);
    const metadata = widgetShellMetadata(definition, instance, props);
    const footer = widgetShellFooter(definition, instance, props);
    const hideHeaderDensities = new Set(Array.isArray(shellConfig.hideHeaderDensities) ? shellConfig.hideHeaderDensities : []);
    const showHeader = false;
    const titleClass = ["widget-shell-title", shellConfig.titleClass].filter(Boolean).join(" ");
    const metadataClass = ["widget-shell-meta", shellConfig.metadataClass].filter(Boolean).join(" ");
    const className = [
      "widget-shell",
      `widget-shell-${escapeHtml(definition.type || "widget")}`,
      `widget-shell-density-${escapeHtml(density)}`,
      showHeader ? "widget-shell-has-header" : "",
      footer ? "widget-shell-has-footer" : "",
      shellConfig.mode === "content" ? "widget-shell-content-owned" : "widget-shell-compat",
    ].filter(Boolean).join(" ");
    return `
      <section class="${className}" data-widget-shell="true" data-shell-version="1" data-shell-density="${escapeHtml(density)}">
        ${showHeader ? `<header class="widget-shell-header">
          <div class="widget-shell-title-zone">
            <span class="${escapeHtml(titleClass)}">${escapeHtml(title)}</span>
            ${metadata.length ? `<span class="${escapeHtml(metadataClass)}">${metadata.map(escapeHtml).join(" / ")}</span>` : ""}
          </div>
        </header>` : ""}
        <div class="widget-shell-content" data-widget-shell-content="true">
          ${content || defaultWidgetVisual(definition.type || "widget", title)}
        </div>
        ${footer ? `<footer class="widget-shell-footer">${footer}</footer>` : ""}
      </section>`;
  };

  const youtubeEmbedUrl = (src) => {
    const safe = safeMediaUrl(src, "video");
    if (!safe) return safe;
    try {
      const url = new URL(safe, window.location.origin);
      const host = url.hostname.replace(/^www\./, "");
      let id = "";
      if (host === "youtu.be") {
        id = url.pathname.split("/").filter(Boolean)[0] || "";
      } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
        if (url.pathname.startsWith("/embed/")) id = url.pathname.split("/").filter(Boolean)[1] || "";
        else if (url.pathname.startsWith("/shorts/")) id = url.pathname.split("/").filter(Boolean)[1] || "";
        else id = url.searchParams.get("v") || "";
      }
      if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) return null;
      return `https://www.youtube-nocookie.com/embed/${id}`;
    } catch {
      return null;
    }
  };

  const vimeoEmbedUrl = (src) => {
    const safe = safeMediaUrl(src, "video");
    if (!safe) return safe;
    try {
      const url = new URL(safe, window.location.origin);
      const host = url.hostname.replace(/^www\./, "");
      if (host !== "vimeo.com" && host !== "player.vimeo.com") return null;
      const id = url.pathname.split("/").filter(Boolean).pop() || "";
      if (!/^\d+$/.test(id)) return null;
      return `https://player.vimeo.com/video/${id}`;
    } catch {
      return null;
    }
  };

  const documentPreviewKind = (config = {}) => {
    const explicit = String(config.documentType || "unknown").toLowerCase();
    if (["pdf", "markdown", "text", "html"].includes(explicit)) return explicit;
    const src = String(config.src || "").toLowerCase();
    if (src.includes(".pdf") || src.startsWith("data:application/pdf")) return "pdf";
    if (src.startsWith("data:text/")) return "text";
    return "unknown";
  };

  const metaDensity = (instance) => {
    const cols = Number(instance?.cols) || 2;
    const rows = Number(instance?.rows) || 2;
    if (rows <= 1 || cols <= 2) return "compact";
    if (rows >= 3 || cols >= 3) return "expanded";
    return "standard";
  };
  const activityTypeLabel = (type) => String(type || "workspace-update")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
  const runtimeEventSeverity = (event = {}) => {
    const severity = String(event.severity || event.payload?.severity || "").toLowerCase();
    if (["critical", "error", "warning", "active", "info"].includes(severity)) return severity;
    const type = String(event.type || "").toLowerCase();
    if (/(error|failed|deleted|removed|breach)/.test(type)) return "critical";
    if (/(warn|risk|blocked|collision|stale)/.test(type)) return "warning";
    if (/(created|saved|loaded|signal|scenario|ai)/.test(type)) return "active";
    return "info";
  };
  const runtimeEventFreshness = (event = {}) => {
    if (event.freshness) return String(event.freshness);
    const timestamp = Number(event.timestamp) || Date.parse(event.time || "");
    if (!Number.isFinite(timestamp)) return "recent";
    const age = Date.now() - timestamp;
    if (age <= 2 * 60 * 1000) return "recent";
    if (age <= 24 * 60 * 60 * 1000) return "fresh";
    return "stale";
  };
  const shortEventTime = (iso) => {
    const timestamp = Date.parse(iso);
    if (!Number.isFinite(timestamp)) return "Now";
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 45) return "Now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.round(hours / 24)}d`;
  };
  const timeRangeDisplay = (timeRange) => {
    if (!timeRange) return "";
    if (timeRange.label) return timeRange.label;
    if (timeRange.start && timeRange.end) return `${timeRange.start} - ${timeRange.end}`;
    if (timeRange.start) return `Since ${timeRange.start}`;
    if (timeRange.end) return `Until ${timeRange.end}`;
    return "";
  };
  const unsupportedDefinition = (type = "unknown") => ({
    type: "unsupported",
    displayName: "Unsupported Widget",
    aliases: [],
    defaultSize: { cols: 1, rows: 1 },
    minSize: { cols: 1, rows: 1 },
    widgetType: String(type || "unknown"),
    dashboardObjectKind: "unsupported-widget",
    regionRole: "content",
    htmlTag: "div",
    className: "stat-card widget-card widget-card-custom unsupported-widget-card",
    capabilities: {
      readsContext: false,
      writesContext: false,
      supportsFilters: false,
      supportsTimeRange: false,
      supportsResize: true,
    },
    supportedSettings: ["title", "color", "pin", "delete"],
    getDefaultConfig: () => ({ title: `Unsupported: ${type || "unknown"}` }),
    render: ({ instance }) => defaultWidgetVisual("unsupported", instance.type || type || "unknown"),
  });

  const statMetricContext = ({ instance } = {}) => {
    const config = instance?.config || {};
    const metric = ["count", "sum", "avg", "min", "max"].includes(config.metric) ? config.metric : "count";
    const valueField = config.valueField || "";
    const rows = widgetDataRows(instance?.data);
    const rawValues = rows.map((row) => (metric === "count" ? 1 : row?.[valueField] ?? row?.value));
    const aggregate = aggregateValues(rawValues, metric);
    const fallback = Number.isFinite(Number(config.value)) ? Number(config.value) : 0;
    const total = aggregate == null ? fallback : aggregate;
    // min/max aggregates correspond to one concrete ping — surface that row so
    // the card can deep-link to it in the history table.
    const matchedRow = (metric === "min" || metric === "max") && aggregate != null
      ? rows.find((row) => numberValue(row?.[valueField] ?? row?.value) === aggregate) || null
      : null;
    return {
      metric,
      valueField,
      rows,
      total,
      matchedRow,
      metricContext: metric === "count" ? `${total} records` : `${metric} ${valueField || "value"}`,
    };
  };

  const schemaFieldsForDefinition = (definition, config = {}, predicate = () => true) => (
    (definition?.settingsSchema?.sections || []).flatMap((section) => (
      (section?.fields || [])
        .filter(predicate)
        .map((field) => ({
          key: field.key,
          label: field.label || field.key,
          type: field.type || "text",
          valueType: field.valueType || "",
          affectsQuery: Boolean(field.affectsQuery),
          value: config[field.key],
        }))
    ))
  );

  const queryFieldsForDefinition = (definition, config = {}) => (
    schemaFieldsForDefinition(definition, config, (field) => field?.affectsQuery)
  );

  const configFieldsForDefinition = (definition, config = {}) => (
    schemaFieldsForDefinition(definition, config, (field) => field?.key)
  );

  const dataRequestForWidget = (definition, instance = {}) => {
    const resolvedDefinition = typeof definition === "string" ? getWidgetDefinition(definition) : definition;
    const config = instance.config || {};
    const queryFields = queryFieldsForDefinition(resolvedDefinition, config);
    const configFields = configFieldsForDefinition(resolvedDefinition, config);
    const fieldValues = queryFields
      .map((field) => field.value)
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    return {
      widgetId: instance.id || "",
      type: resolvedDefinition.type,
      category: resolvedDefinition.category,
      subcategory: resolvedDefinition.subcategory || "",
      capabilities: { ...(resolvedDefinition.capabilities || {}) },
      config: { ...config },
      configFields,
      queryFields,
      fields: unique(fieldValues),
      timeRange: instance.timeRange || instance.displayState?.timeRange || null,
      expectsRows: Boolean(
        resolvedDefinition.capabilities?.supportsFilters ||
        resolvedDefinition.capabilities?.supportsTimeRange ||
        queryFields.length
      ),
      expectsConfig: Boolean(configFields.length),
    };
  };

  const normalizeDefinition = (definition) => {
    const type = String(definition?.type || "").trim();
    if (!type) return null;
    const defaultSize = normalizedSize(definition.defaultSize, definition.defaultSpan || 1, definition.defaultRows || 1);
    const minSize = normalizedSize(definition.minSize, definition.minSpan || defaultSize.cols, definition.minRows || defaultSize.rows);
    const getDefaultConfig = typeof definition.getDefaultConfig === "function"
      ? definition.getDefaultConfig
      : () => ({});
    return {
      ...definition,
      type,
      displayName: definition.displayName || type,
      label: definition.label || definition.displayName || type,
      category: definition.category || "data",
      subcategory: definition.subcategory || "",
      layer: normalizeWidgetLayer(definition.layer),
      backendOnly: Boolean(definition.backendOnly),
      icon: definition.icon || "",
      aliases: Array.isArray(definition.aliases) ? definition.aliases : [],
      defaultSize,
      minSize,
      capabilities: {
        readsContext: false,
        writesContext: false,
        supportsFilters: false,
        supportsTimeRange: false,
        supportsResize: true,
        ...(definition.capabilities || {}),
      },
      supportedSettings: Array.isArray(definition.supportedSettings)
        ? definition.supportedSettings
        : ["title", "color", "pin", "delete"],
      settingsSchema: normalizedSettingsSchema(definition.settingsSchema, definition.supportedSettings || ["title"]),
      densityBehavior: definition.densityBehavior || {},
      getDefaultConfig,
      shell: definition.shell === false ? false : {
        mode: definition.renderContent ? "content" : "compat",
        showHeader: false,
        ...(definition.shell && typeof definition.shell === "object" ? definition.shell : {}),
      },
      getTitle: typeof definition.getTitle === "function" ? definition.getTitle : null,
      getMetadata: typeof definition.getMetadata === "function" ? definition.getMetadata : null,
      getFooter: typeof definition.getFooter === "function" ? definition.getFooter : null,
      densityRules: definition.densityRules || definition.densityBehavior || {},
      mountBodyRenderer: typeof definition.mountBodyRenderer === "function" ? definition.mountBodyRenderer : null,
      unmountBodyRenderer: typeof definition.unmountBodyRenderer === "function" ? definition.unmountBodyRenderer : null,
      renderContent: typeof definition.renderContent === "function" ? definition.renderContent : null,
      render: typeof definition.render === "function"
        ? definition.render
        : ({ definition: resolved = definition }) => defaultWidgetVisual(resolved.type || "widget", resolved.displayName || resolved.label || "Widget"),
    };
  };

  const registerWidgetDefinition = (definition) => {
    const normalized = normalizeDefinition(definition);
    if (!normalized) return false;
    definitions.set(normalized.type, normalized);
    normalized.aliases.forEach((alias) => aliases.set(alias, normalized.type));
    return true;
  };

  const getWidgetDefinition = (type) => {
    const key = String(type || "").trim();
    const canonical = aliases.get(key) || key;
    return definitions.get(canonical) || unsupportedDefinition(key);
  };

  const createWidgetInstance = (definition, overrides = {}) => {
    const resolvedDefinition = typeof definition === "string" ? getWidgetDefinition(definition) : definition;
    const config = {
      ...resolvedDefinition.getDefaultConfig(),
      ...parseConfig(overrides.config),
    };
    const cols = Number(overrides.cols) || Number(overrides.span) || resolvedDefinition.defaultSize.cols;
    const rows = Number(overrides.rows) || Number(overrides.rowSpan) || resolvedDefinition.defaultSize.rows;
    const density = normalizeDensity(overrides.density, resolveWidgetDensity({
      cols,
      rows,
      parentPanelId: overrides.parentPanelId || null,
    }, overrides.availableSize || {}, resolvedDefinition));
    return {
      id: overrides.id || overrides.key || "",
      type: resolvedDefinition.type,
      x: Number(overrides.x) || Number(overrides.gridCol) || 1,
      y: Number(overrides.y) || Number(overrides.gridRow) || 1,
      cols,
      rows,
      config,
      data: overrides.data && typeof overrides.data === "object" ? overrides.data : { rows: [] },
      displayState: overrides.displayState || null,
      timeRange: overrides.displayState?.timeRange || null,
      layer: normalizeWidgetLayer(overrides.layer, resolvedDefinition.layer || "presentation"),
      density,
      availableSize: overrides.availableSize || null,
      parentPanelId: overrides.parentPanelId || null,
      contextOverrideId: overrides.contextOverrideId || null,
    };
  };

  const renderWidget = (definition, props = {}) => {
    const resolvedDefinition = typeof definition === "string" ? getWidgetDefinition(definition) : definition;
    const instance = props.instance || createWidgetInstance(resolvedDefinition, {});
    const density = normalizeDensity(props.density || instance.density, resolveWidgetDensity(instance, instance.availableSize || {}, resolvedDefinition));
    try {
      const renderProps = {
        ...props,
        density,
        data: props.data || instance.data || { rows: [] },
        instance: { ...instance, density, data: props.data || instance.data || { rows: [] } },
        definition: resolvedDefinition,
      };
      const content = typeof resolvedDefinition.renderContent === "function"
        ? resolvedDefinition.renderContent(renderProps)
        : resolvedDefinition.render(renderProps);
      return resolvedDefinition.shell === false
        ? content
        : renderWidgetShell(resolvedDefinition, renderProps, content);
    } catch (error) {
      const fallback = defaultWidgetVisual(resolvedDefinition.type || "widget", resolvedDefinition.displayName || "Widget");
      return resolvedDefinition.shell === false
        ? fallback
        : renderWidgetShell(resolvedDefinition, { ...props, density, instance: { ...instance, density }, definition: resolvedDefinition }, fallback);
    }
  };

  registerWidgetDefinition({
    type: "stat",
    displayName: "Stat",
    category: "data",
    aliases: ["tracker", "widget"],
    defaultSize: { cols: 1, rows: 1 },
    minSize: { cols: 1, rows: 1 },
    widgetType: "tracker",
    dashboardObjectKind: "stat",
    regionRole: "content",
    htmlTag: "a",
    className: "stat-card widget-card widget-card-custom",
    capabilities: {
      readsContext: true,
      supportsFilters: true,
      supportsTimeRange: true,
      supportsResize: true,
    },
    supportedSettings: ["title", "value", "color", "pin", "duplicate", "delete"],
    settingsSchema: {
      sections: [{
        id: "metric",
        label: "Metric",
        fields: [
          { key: "label", label: "Label", type: "text", defaultValue: "Widget" },
          { key: "metric", label: "Metric", type: "metricPicker", defaultValue: "count", options: ["count", "sum", "avg", "min", "max"], affectsQuery: true },
          { key: "valueField", label: "Value field", type: "fieldPicker", affectsQuery: true },
          { key: "calculatedFields", label: "Calculated fields", type: "json", defaultValue: [], affectsQuery: true },
          { key: "equationFilters", label: "Equation filters", type: "json", defaultValue: [], affectsQuery: true },
          { key: "format", label: "Format", type: "select", defaultValue: "number", options: ["number", "currency", "percent", "since"] },
        ],
      }],
    },
    getDefaultConfig: () => ({ label: "Widget", title: "Widget", metric: "count", format: "number" }),
    shell: {
      mode: "content",
      showHeader: true,
      titleClass: "stat-lbl",
      metadataClass: "stat-runtime-meta",
      hideHeaderDensities: ["tiny"],
    },
    getTitle: ({ instance }) => statLabelFor(instance?.config || {}),
    getMetadata: (props) => {
      const { metricContext } = statMetricContext(props);
      return metricContext ? [metricContext] : [];
    },
    renderContent: ({ instance }) => {
      const config = instance.config || {};
      const { metric, valueField, rows, total, matchedRow } = statMetricContext({ instance });
      let focusAttr = matchedRow?.checkedAt
        ? ` data-focus-checked-at="${escapeHtml(matchedRow.checkedAt)}" title="Jump to this ping in the table"`
        : "";
      if (!focusAttr && metric === "count" && rows.length) {
        // Count cards (Fails) cycle through their events newest-first on click.
        const stamps = rows.map((row) => row?.checkedAt).filter(Boolean).slice(-50).reverse();
        if (stamps.length) {
          focusAttr = ` data-focus-cycle="${escapeHtml(JSON.stringify(stamps))}" title="Click to step through these events, newest first"`;
        }
      }
      // Average cards show a muted delta against the broader trend the feed
      // supplies (e.g. "Δ+13" = thirteen over the all-history average); min and
      // max cards show their distance from this window's own average ("+198 avg").
      let deltaHtml = "";
      const baseline = instance.data?.meta?.baselines?.[valueField];
      const roundDelta = (delta) => (Math.abs(delta) >= 10 ? Math.round(delta) : Math.round(delta * 10) / 10);
      if (metric === "avg" && rows.length && Number.isFinite(Number(baseline))) {
        const rounded = roundDelta(total - Number(baseline));
        const text = `Δ${rounded > 0 ? "+" : ""}${rounded}`;
        deltaHtml = `<span class="stat-delta" title="vs the broader average (${escapeHtml(formatMetricValue(Number(baseline), config.format))})">${escapeHtml(text)}</span>`;
      } else if ((metric === "min" || metric === "max") && rows.length && config.format !== "since") {
        const values = rows.map((row) => numberValue(row?.[valueField] ?? row?.value)).filter((v) => v != null);
        const windowAvg = values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
        if (windowAvg != null) {
          const rounded = roundDelta(total - windowAvg);
          const text = `${rounded > 0 ? "+" : ""}${rounded} avg`;
          deltaHtml = `<span class="stat-delta" title="vs this window's average (${escapeHtml(formatMetricValue(windowAvg, config.format))})">${escapeHtml(text)}</span>`;
        }
      }
      // Always include the label in the body: these cards render at "tiny"
      // density, which hides the shell header — without this they were bare
      // numbers with no indication of what they measure.
      return `<span class="stat-val"${focusAttr}>${escapeHtml(formatMetricValue(total, config.format))}${deltaHtml}</span>`
        + `<span class="stat-lbl">${escapeHtml(statLabelFor(config))}</span>`;
    },
  });

  registerWidgetDefinition({
    type: "timeframe",
    displayName: "Timeframe",
    category: "controls",
    aliases: ["controls", "time-range"],
    defaultSize: { cols: 4, rows: 1 },
    minSize: { cols: 2, rows: 1 },
    widgetType: "timeframe",
    dashboardObjectKind: "timeframe",
    regionRole: "timeframe-control",
    htmlTag: "div",
    className: "stat-card widget-card widget-card-custom timeframe-widget-card",
    ariaLabel: "Time filter controls",
    capabilities: {
      readsContext: true,
      writesContext: true,
      supportsTimeRange: true,
      supportsResize: true,
    },
    supportedSettings: ["color", "pin", "delete"],
    settingsSchema: { sections: [] },
    getDefaultConfig: () => ({
      title: "Timeframe",
      activeLabel: "Any time",
      selectedFilterId: "",
      weekStartDay: 0,
      selectedPreset: "",
      customStart: "",
      customEnd: "",
      filters: [],
    }),
    render: ({ instance }) => {
      const config = instance.config || {};
      const filters = normalizeTimeframeFilters(config);

      const displayFilters = filters.length ? filters : TIMEFRAME_DEFAULT_OPTIONS.map((preset) => ({
        id: preset.id,
        label: preset.buttonLabel || preset.label,
      }));

      // Resolve the active id against the buttons actually shown (which fall
      // back to the default options when no custom filters are configured), so
      // the selection persists in both cases. With no selection yet, default to
      // the first button.
      const selectedFilterId = selectedTimeframeFilterId(config, displayFilters);

      const buttons = displayFilters.map((filter, index) => {
        const active = selectedFilterId ? filter.id === selectedFilterId : index === 0;
        return `<button class="timeframe-filter-btn${active ? " is-active" : ""}" type="button" data-filter-id="${escapeHtml(filter.id)}" aria-pressed="${active ? "true" : "false"}">${escapeHtml(filter.label)}</button>`;
      }).join("");

      return `<div class="timeframe-body" role="group" aria-label="${escapeHtml(config.title || "Time filters")}">${buttons}</div>`;
    },
  });

  registerWidgetDefinition({
    type: "text",
    displayName: "Text / Notes",
    category: "content",
    aliases: ["note", "notes"],
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 2, rows: 1 },
    widgetType: "text",
    dashboardObjectKind: "text",
    regionRole: "annotation",
    htmlTag: "div",
    className: "stat-card widget-card widget-card-custom text-widget-card",
    capabilities: {
      readsContext: false,
      writesContext: false,
      supportsResize: true,
    },
    supportedSettings: ["text", "color", "pin", "duplicate", "delete"],
    settingsSchema: {
      sections: [{
        id: "note",
        label: "Note",
        fields: [
          { key: "title", label: "Title", type: "text", defaultValue: "Note" },
          { key: "body", label: "Body", type: "textarea", defaultValue: "" },
          { key: "placeholder", label: "Placeholder", type: "text", defaultValue: "Write a note" },
        ],
      }],
    },
    getDefaultConfig: () => ({ title: "Note", body: "", placeholder: "Write a note" }),
    render: ({ instance }) => {
      const config = instance.config || {};
      const body = String(config.body || "");
      const placeholder = String(config.placeholder || "Note");
      const cols = Number(instance.cols) || 2;
      const rows = Number(instance.rows) || 2;
      const density = rows <= 1
        ? "small"
        : rows >= 3 || cols >= 3
          ? "large"
          : "medium";
      return `
        <div class="text-widget-content text-widget-density-${density}">
          <div class="text-widget-editor inline-text-editing-surface" role="textbox" aria-multiline="true" contenteditable="true" spellcheck="true" aria-label="${escapeHtml(config.title || "Note")}" data-placeholder="${escapeHtml(placeholder)}">${escapeHtml(body)}</div>
        </div>`;
    },
  });

  registerWidgetDefinition({
    type: "region-summary",
    displayName: "Region Summary",
    category: "content",
    aliases: ["region", "spatial-summary", "summary"],
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 2, rows: 1 },
    widgetType: "region-summary",
    dashboardObjectKind: "region-summary",
    regionRole: "region-summary",
    htmlTag: "div",
    className: "stat-card widget-card widget-card-custom region-summary-widget-card",
    capabilities: {
      readsContext: true,
      writesContext: false,
      supportsFilters: false,
      supportsTimeRange: false,
      supportsResize: true,
    },
    supportedSettings: ["title", "color", "pin", "duplicate", "delete"],
    settingsSchema: {
      sections: [{
        id: "region",
        label: "Region",
        fields: [
          { key: "title", label: "Title", type: "text", defaultValue: "Region Summary" },
        ],
      }],
    },
    getDefaultConfig: () => ({ title: "Region Summary" }),
    render: ({ instance }) => {
      const dataRows = widgetDataRows(instance?.data);
      const summary = instance?.data?.summary || dataRows[0] || window.dashboardSpatialRuntime?.regionSummaryForWidget?.(instance.id) || {};
      const cols = Number(instance.cols) || 2;
      const rows = Number(instance.rows) || 2;
      const density = rows <= 1 ? "compact" : rows >= 3 || cols >= 3 ? "rich" : "standard";
      const regionLabel = summary.label || "Current region";
      const source = "";
      const rowRange = summary.endRow
        ? `Rows ${summary.startRow || 1}-${summary.endRow}`
        : `Rows ${summary.startRow || 1}+`;
      return `
        <div class="region-summary-widget region-summary-density-${density}" data-region-id="${escapeHtml(summary.id || "")}">
          <strong class="region-summary-title">${escapeHtml(regionLabel)}</strong>
          <div class="region-summary-metrics" aria-label="Region object counts">
            <span><b>${Number(summary.widgets) || 0}</b> Widgets</span>
            <span><b>${Number(summary.panels) || 0}</b> Panels</span>
          </div>
          ${density === "compact" || !source ? "" : `<div class="region-summary-context">${escapeHtml(source)}</div>`}
        </div>`;
    },
  });

  registerWidgetDefinition({
    type: "image",
    displayName: "Image",
    category: "media",
    aliases: ["picture", "media-image"],
    defaultSize: { cols: 3, rows: 2 },
    minSize: { cols: 2, rows: 1 },
    widgetType: "image",
    dashboardObjectKind: "image",
    regionRole: "reference",
    htmlTag: "div",
    className: "stat-card widget-card widget-card-custom media-widget-card image-widget-card",
    capabilities: {
      readsContext: false,
      writesContext: false,
      supportsResize: true,
    },
    supportedSettings: withWellToneSetting(["source", "fit", "caption", "color", "pin", "duplicate", "delete"]),
    settingsSchema: {
      sections: [{
        id: "image",
        label: "Image",
        fields: withWellToneFields([
          { key: "title", label: "Title", type: "text", defaultValue: "Image" },
          { key: "src", label: "Source URL", type: "text", defaultValue: "" },
          { key: "alt", label: "Alt text", type: "text", defaultValue: "" },
          { key: "fit", label: "Fit", type: "select", defaultValue: "contain", options: ["contain", "cover", "fill", "center"] },
          { key: "caption", label: "Caption", type: "text", defaultValue: "" },
        ]),
      }],
    },
    getDefaultConfig: () => withWellToneDefault({ title: "Image", assetId: "", alt: "", fit: "contain", caption: "" }),
    render: ({ instance }) => {
      const config = instance.config || {};
      const title = mediaTitle(config, "Image");
      const src = safeMediaUrl(config.src, "image");
      const caption = String(config.caption || "").trim();
      if (config.assetMissing || !String(config.src || "").trim() || src == null) return defaultMediaVisual("image", title, caption, config);
      const fit = safeMediaFit(config.fit);
      const alt = String(config.alt || caption || title || "Image").trim();
      return `
        <div class="media-widget runtime-well-widget media-widget-image-wrap media-fit-${escapeHtml(fit)}" data-media-kind="image" data-media-status="ready" ${wellToneAttribute(config)}>
          <figure class="widget-content-well widget-library-surface media-widget-stage image-widget-stage">
            <img class="media-widget-image" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" draggable="false">
          </figure>
          ${mediaCaptionMarkup(caption)}
        </div>`;
    },
  });

  registerWidgetDefinition({
    type: "video",
    displayName: "Video",
    category: "media",
    aliases: ["media-video"],
    defaultSize: { cols: 3, rows: 2 },
    minSize: { cols: 2, rows: 1 },
    widgetType: "video",
    dashboardObjectKind: "video",
    regionRole: "reference",
    htmlTag: "div",
    className: "stat-card widget-card widget-card-custom media-widget-card video-widget-card",
    capabilities: {
      readsContext: false,
      writesContext: false,
      supportsResize: true,
    },
    supportedSettings: withWellToneSetting(["source", "caption", "color", "pin", "duplicate", "delete"]),
    settingsSchema: {
      sections: [{
        id: "video",
        label: "Video",
        fields: withWellToneFields([
          { key: "title", label: "Title", type: "text", defaultValue: "Video" },
          { key: "src", label: "Source URL", type: "text", defaultValue: "" },
          { key: "embedType", label: "Embed", type: "select", defaultValue: "url", options: ["url", "youtube", "vimeo"] },
          { key: "autoplay", label: "Autoplay", type: "toggle", defaultValue: false },
          { key: "muted", label: "Muted", type: "toggle", defaultValue: true },
          { key: "caption", label: "Caption", type: "text", defaultValue: "" },
        ]),
      }],
    },
    getDefaultConfig: () => withWellToneDefault({ title: "Video", assetId: "", embedType: "url", autoplay: false, muted: true, caption: "" }),
    render: ({ instance }) => {
      const config = instance.config || {};
      const title = mediaTitle(config, "Video");
      const caption = String(config.caption || "").trim();
      const embedType = String(config.embedType || "url").toLowerCase();
      if (config.assetMissing || !String(config.src || "").trim()) return defaultMediaVisual("video", title, caption, config);
      let stage = "";
      if (embedType === "youtube") {
        const embed = youtubeEmbedUrl(config.src);
        if (!embed) return defaultMediaVisual("video", title, caption, config);
        stage = `<iframe class="media-widget-frame media-widget-video-frame" src="${escapeHtml(embed)}" title="${escapeHtml(title)}" loading="lazy" sandbox="allow-scripts allow-same-origin allow-presentation" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
      } else if (embedType === "vimeo") {
        const embed = vimeoEmbedUrl(config.src);
        if (!embed) return defaultMediaVisual("video", title, caption, config);
        stage = `<iframe class="media-widget-frame media-widget-video-frame" src="${escapeHtml(embed)}" title="${escapeHtml(title)}" loading="lazy" sandbox="allow-scripts allow-same-origin allow-presentation" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
      } else {
        const src = safeMediaUrl(config.src, "video");
        if (src == null) return defaultMediaVisual("video", title, caption, config);
        stage = `<video class="media-widget-video" src="${escapeHtml(src)}" controls preload="metadata"${config.autoplay ? " autoplay" : ""}${config.muted !== false ? " muted" : ""} playsinline></video>`;
      }
      return `
        <div class="media-widget runtime-well-widget media-widget-video-wrap" data-media-kind="video" data-media-status="ready" ${wellToneAttribute(config)}>
          <div class="widget-content-well widget-library-surface media-widget-stage video-widget-stage">${stage}</div>
          ${mediaCaptionMarkup(caption)}
        </div>`;
    },
  });

  registerWidgetDefinition({
    type: "document",
    displayName: "PDF / Document",
    category: "media",
    aliases: ["pdf", "doc", "document-preview"],
    defaultSize: { cols: 3, rows: 3 },
    minSize: { cols: 2, rows: 1 },
    widgetType: "document",
    dashboardObjectKind: "document",
    regionRole: "reference",
    htmlTag: "div",
    className: "stat-card widget-card widget-card-custom media-widget-card document-widget-card",
    capabilities: {
      readsContext: false,
      writesContext: false,
      supportsResize: true,
    },
    supportedSettings: withWellToneSetting(["source", "page", "caption", "color", "pin", "duplicate", "delete"]),
    settingsSchema: {
      sections: [{
        id: "document",
        label: "Document",
        fields: withWellToneFields([
          { key: "title", label: "Title", type: "text", defaultValue: "Document" },
          { key: "src", label: "Source URL", type: "text", defaultValue: "" },
          { key: "documentType", label: "Type", type: "select", defaultValue: "unknown", options: ["unknown", "pdf", "text", "markdown", "html"] },
          { key: "currentPage", label: "Page", type: "number", defaultValue: 1, min: 1, max: 999, step: 1 },
          { key: "content", label: "Text content", type: "textarea", defaultValue: "" },
          { key: "caption", label: "Caption", type: "text", defaultValue: "" },
        ]),
      }],
    },
    getDefaultConfig: () => withWellToneDefault({ title: "Document", assetId: "", documentType: "unknown", currentPage: 1, caption: "", content: "" }),
    render: ({ instance }) => {
      const config = instance.config || {};
      const title = mediaTitle(config, "Document");
      const caption = String(config.caption || "").trim();
      const content = String(config.content || "").trim();
      const kind = documentPreviewKind(config);
      if (content && (kind === "text" || kind === "markdown" || kind === "unknown")) {
        return `
          <div class="media-widget runtime-well-widget document-widget document-widget-text-mode" data-media-kind="document" data-document-type="${escapeHtml(kind)}" data-media-status="ready" ${wellToneAttribute(config)}>
            <div class="widget-content-well widget-library-surface runtime-monaco-library-surface">
              <div class="runtime-monaco-editor" data-editor-language="${escapeHtml(kind)}" role="region" aria-label="${escapeHtml(title)}"></div>
            </div>
            ${mediaCaptionMarkup(caption)}
          </div>`;
      }
      if (config.assetMissing || !String(config.src || "").trim()) return defaultMediaVisual("document", title, caption, config);
      const src = safeMediaUrl(config.src, "document");
      if (src == null) return defaultMediaVisual("document", title, caption, config);
      const page = Math.max(1, Number(config.currentPage) || 1);
      const frameSrc = kind === "pdf" && !String(src).startsWith("data:")
        ? `${src}#page=${page}`
        : src;
      const previewLabel = kind === "pdf" ? `Page ${page}` : kind === "html" ? "Sandboxed preview" : "Document preview";
      return `
        <div class="media-widget runtime-well-widget document-widget" data-media-kind="document" data-document-type="${escapeHtml(kind)}" data-media-status="ready" ${wellToneAttribute(config)}>
          <div class="widget-content-well widget-library-surface media-widget-stage document-widget-stage">
            <iframe class="media-widget-frame document-widget-frame" src="${escapeHtml(frameSrc)}" title="${escapeHtml(title)}" loading="lazy" sandbox=""></iframe>
          </div>
          ${mediaCaptionMarkup(caption)}
        </div>`;
    },
    mountBodyRenderer: ({ contentRoot, instance }) => {
      const config = instance?.config || {};
      const content = String(config.content || "").trim();
      const kind = documentPreviewKind(config);
      if (!content || !["text", "markdown", "unknown"].includes(kind)) return null;
      const language = kind === "markdown" ? "markdown" : "plaintext";
      return mountMonacoBodyRenderer({ contentRoot, content, language });
    },
  });

  registerWidgetDefinition({
    type: "table",
    displayName: "Table",
    category: "data",
    defaultSize: { cols: 3, rows: 2 },
    minSize: { cols: 2, rows: 1 },
    widgetType: "table",
    dashboardObjectKind: "table",
    regionRole: "content",
    htmlTag: "div",
    className: "stat-card widget-card widget-card-custom table-widget-card",
    capabilities: {
      readsContext: true,
      supportsFilters: true,
      supportsTimeRange: true,
      supportsResize: true,
    },
    supportedSettings: withWellToneSetting(["columns", "limit", "color", "pin", "delete"]),
    settingsSchema: {
      sections: [{
        id: "table",
        label: "Rows",
        fields: withWellToneFields([
          { key: "title", label: "Title", type: "text", defaultValue: "Table" },
          { key: "columns", label: "Columns", type: "textarea", valueType: "array", placeholder: "name, amount, category", affectsQuery: true },
          { key: "calculatedFields", label: "Calculated fields", type: "json", defaultValue: [], affectsQuery: true },
          { key: "equationFilters", label: "Equation filters", type: "json", defaultValue: [], affectsQuery: true },
          { key: "limit", label: "Limit", type: "number", defaultValue: 50, min: 1, max: 200, step: 1, affectsQuery: true },
          { key: "sortBy", label: "Sort field", type: "fieldPicker", affectsQuery: true },
          { key: "sortDirection", label: "Sort direction", type: "select", defaultValue: "asc", options: ["asc", "desc"], affectsQuery: true },
        ]),
      }],
    },
    getDefaultConfig: () => withWellToneDefault({ title: "Table", columns: [], limit: 50, sortBy: "", sortDirection: "asc" }),
    mountBodyRenderer: mountTableBodyRenderer,
    render: ({ instance, density = instance.density || "standard" }) => {
      const config = instance.config || {};
      const densityTier = normalizeDensity(density);
      const title = config.title || "Table";
      const configuredColumns = tableConfiguredColumns(config);
      const dataRows = widgetDataRows(instance.data);
      const schemaFields = dataRows.length ? Object.keys(dataRows[0] || {}) : dataSchemaFields(instance.data);
      const allFields = unique(configuredColumns.length ? configuredColumns : schemaFields.length ? schemaFields : [""]);
      const visibleFields = allFields.slice(0, tableVisibleColumnCount(instance.cols));
      const tableDensity = Number(instance.rows) <= 2 || Number(instance.cols) <= 2
        ? "compact"
        : Number(instance.rows) >= 4 || Number(instance.cols) >= 4 || densityTier === "rich"
          ? "rich"
          : "comfortable";
      return `
        <div class="runtime-table-widget runtime-well-widget runtime-table-density-${tableDensity} widget-density-${densityTier}" data-density="${escapeHtml(densityTier)}" data-visible-columns="${visibleFields.length}" ${wellToneAttribute(config)}>
          <div class="widget-content-well widget-library-surface runtime-table-library-surface">
            <div class="runtime-table-tanstack" data-table-renderer="tanstack" role="region" aria-label="${escapeHtml(title)}"></div>
          </div>
        </div>`;
    },
  });

  registerWidgetDefinition({
    type: "chart",
    displayName: "Chart",
    category: "visualization",
    subcategory: "Charts",
    aliases: ["graph"],
    defaultSize: { cols: 3, rows: 2 },
    minSize: { cols: 2, rows: 1 },
    widgetType: "graph",
    dashboardObjectKind: "chart",
    regionRole: "content",
    htmlTag: "div",
    className: "stat-card widget-card widget-card-custom chart-widget-card",
    capabilities: {
      readsContext: true,
      supportsFilters: true,
      supportsTimeRange: true,
      supportsResize: true,
    },
    supportedSettings: withWellToneSetting(["chartType", "xField", "yField", "series", "aggregation", "color", "pin", "delete"]),
    settingsSchema: {
      sections: [{
        id: "chart",
        label: "Chart",
        fields: withWellToneFields([
          { key: "title", label: "Title", type: "text", defaultValue: "Chart" },
          { key: "chartType", label: "Type", type: "select", defaultValue: "bar", options: ["bar", "line", "area", "pie", "donut", "scatter", "histogram", "heatmap", "gauge", "sparkline"], affectsQuery: true },
          { key: "xField", label: "X field", type: "fieldPicker", affectsQuery: true },
          { key: "yField", label: "Y field", type: "fieldPicker", affectsQuery: true },
          { key: "seriesField", label: "Series field", type: "fieldPicker", affectsQuery: true },
          { key: "aggregation", label: "Aggregation", type: "select", defaultValue: "count", options: CHART_AGGREGATIONS, affectsQuery: true },
          { key: "calculatedFields", label: "Calculated fields", type: "json", defaultValue: [], affectsQuery: true },
          { key: "equationFilters", label: "Equation filters", type: "json", defaultValue: [], affectsQuery: true },
          { key: "timeBucket", label: "Time bucket", type: "json", defaultValue: null, affectsQuery: true },
          { key: "limit", label: "Limit", type: "number", defaultValue: 60, min: 1, max: 200, step: 1, affectsQuery: true },
        ]),
      }],
    },
    getDefaultConfig: () => withWellToneDefault({
      title: "Chart",
      chartType: "bar",
      aggregation: "count",
      groupBy: [],
      sortBy: "",
      sortDirection: "asc",
      limit: 60,
      display: {
        showLegend: true,
        showAxes: true,
        showGrid: false,
        showLabels: true,
      },
    }),
    mountBodyRenderer: mountChartBodyRenderer,
    render: ({ instance }) => {
      const config = instance.config || {};
      const chartType = config.chartType || "bar";
      const definition = getChartDefinition(chartType) || getChartDefinition("bar");
      return definition.render({
        instance,
        definition,
        rows: widgetDataRows(instance.data),
        display: chartDisplayConfig(config),
      });
    },
  });

  let leafletLoadPromise = null;
  const loadLeaflet = () => {
    if (window.L?.map) return Promise.resolve(window.L);
    if (!leafletLoadPromise) {
      leafletLoadPromise = new Promise((resolve, reject) => {
        if (!document.querySelector("link[data-dashboard-leaflet]")) {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = VENDOR_BASE + "leaflet/leaflet.css";
          link.dataset.dashboardLeaflet = "true";
          document.head.appendChild(link);
        }
        const existing = document.querySelector("script[data-dashboard-leaflet]");
        const afterLoad = () => window.L?.map ? resolve(window.L) : reject(new Error("Leaflet failed to initialize"));
        if (existing) {
          existing.addEventListener("load", afterLoad, { once: true });
          existing.addEventListener("error", () => reject(new Error("Leaflet failed to load")), { once: true });
          return;
        }
        const script = document.createElement("script");
        script.src = VENDOR_BASE + "leaflet/leaflet.js";
        script.async = true;
        script.dataset.dashboardLeaflet = "true";
        script.onload = afterLoad;
        script.onerror = () => reject(new Error("Leaflet failed to load"));
        document.head.appendChild(script);
      });
    }
    return leafletLoadPromise;
  };

  const mapExtractPoints = (data, config, mapping) => {
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const latitudeField = String(config.latitudeField || mapping.latitudeField || "").trim();
    const longitudeField = String(config.longitudeField || mapping.longitudeField || "").trim();
    const locationField = String(config.locationField || mapping.locationField || "").trim();
    return rows.map((row) => ({
      label: String(row?.[locationField] || row?.[mapping.labelField] || row?.label || "Point"),
      category: String(row?.[mapping.categoryField] || row?.category || ""),
      latitude: numberValue(row?.[latitudeField]),
      longitude: numberValue(row?.[longitudeField]),
      value: numberValue(row?.[mapping.valueField] ?? row?.value),
    })).filter((point) => point.latitude != null && point.longitude != null)
      .slice(0, Math.max(1, Number(config.limit) || 250));
  };

  registerWidgetDefinition({
    type: "map",
    displayName: "Map",
    category: "visualization",
    subcategory: "Geospatial",
    aliases: ["geospatial-map", "geo-map"],
    defaultSize: { cols: 3, rows: 2 },
    minSize: { cols: 2, rows: 1 },
    widgetType: "map",
    dashboardObjectKind: "map",
    regionRole: "content",
    htmlTag: "div",
    className: "stat-card widget-card widget-card-custom map-widget-card",
    capabilities: {
      readsContext: true,
      supportsFilters: true,
      supportsTimeRange: true,
      supportsResize: true,
    },
    supportedSettings: withWellToneSetting(["location", "layerType", "limit", "color", "pin", "duplicate", "delete"]),
    settingsSchema: {
      sections: [{
        id: "map",
        label: "Geospatial",
        fields: withWellToneFields([
          { key: "title", label: "Title", type: "text", defaultValue: "Map" },
          { key: "latitudeField", label: "Latitude field", type: "fieldPicker", affectsQuery: true },
          { key: "longitudeField", label: "Longitude field", type: "fieldPicker", affectsQuery: true },
          { key: "locationField", label: "Location field", type: "fieldPicker", affectsQuery: true },
          { key: "layerType", label: "Layer", type: "select", defaultValue: "points", options: ["points", "regions", "routes", "heatmap"], affectsQuery: true },
          { key: "limit", label: "Limit", type: "number", defaultValue: 250, min: 1, max: 1000, step: 1, affectsQuery: true },
        ]),
      }],
    },
    getDefaultConfig: () => withWellToneDefault({
      title: "Map",
      latitudeField: "",
      longitudeField: "",
      locationField: "",
      layerType: "points",
      limit: 250,
    }),
    render: ({ instance }) => {
      const config = instance.config || {};
      const title = config.title || "Map";
      const points = mapExtractPoints(instance.data, config, {});
      const density = chartVisualDensity(instance.density || "standard");
      const labels = points.slice(0, density === "large" ? 4 : 2).map((point) => `<span>${escapeHtml(point.label)}</span>`).join("");
      return `
        <div class="runtime-map-widget runtime-visualization-widget runtime-well-widget runtime-map-density-${escapeHtml(density)}" data-map-layer="${escapeHtml(config.layerType || "points")}" ${wellToneAttribute(config)}>
          <div class="widget-content-well widget-library-surface runtime-map-leaflet-surface">
            <div class="runtime-map-leaflet" role="region" aria-label="${escapeHtml(title)}"></div>
          </div>
          <div class="runtime-map-legend">${labels}</div>
        </div>`;
    },
    mountBodyRenderer: ({ contentRoot, instance }) => {
      const target = contentRoot?.querySelector?.(".runtime-map-leaflet");
      if (!target) return null;
      const config = instance?.config || {};
      const points = mapExtractPoints(instance?.data, config, {});
      let disposed = false;
      let map = null;
      let resizeObserver = null;
      loadLeaflet()
        .then((L) => {
          if (disposed || !target.isConnected) return;
          map = L.map(target, {
            zoomControl: false,
            attributionControl: false,
            scrollWheelZoom: false,
          });
          L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            opacity: 0.85,
          }).addTo(map);
          const colors = chartPaletteForElement(target);
          const markerStyle = { radius: 6, fillColor: colors[0], color: colors[1], weight: 1.2, opacity: 1, fillOpacity: 0.82 };
          points.forEach((point) => {
            L.circleMarker([point.latitude, point.longitude], markerStyle)
              .bindTooltip(point.label, { sticky: false, offset: [0, -4] })
              .addTo(map);
          });
          if (!points.length) {
            map.setView([20, 0], 2);
          } else if (points.length === 1) {
            map.setView([points[0].latitude, points[0].longitude], 12);
          } else {
            map.fitBounds(
              L.latLngBounds(points.map((p) => [p.latitude, p.longitude])),
              { padding: [16, 16], maxZoom: 14 }
            );
          }
          resizeObserver = new ResizeObserver(() => map?.invalidateSize());
          resizeObserver.observe(target);
          requestAnimationFrame(() => map?.invalidateSize());
        })
        .catch((error) => {
          if (disposed || !target.isConnected) return;
          target.innerHTML = defaultWidgetVisual("map");
        });
      return () => {
        disposed = true;
        resizeObserver?.disconnect();
        map?.remove();
        map = null;
      };
    },
  });

  let fullCalendarLoadPromise = null;
  const loadFullCalendar = () => {
    if (window.FullCalendar?.Calendar) return Promise.resolve(window.FullCalendar);
    if (!fullCalendarLoadPromise) {
      fullCalendarLoadPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector("script[data-dashboard-fullcalendar]");
        const afterLoad = () => window.FullCalendar?.Calendar ? resolve(window.FullCalendar) : reject(new Error("FullCalendar failed to initialize"));
        if (existing) {
          existing.addEventListener("load", afterLoad, { once: true });
          existing.addEventListener("error", () => reject(new Error("FullCalendar failed to load")), { once: true });
          return;
        }
        const script = document.createElement("script");
        script.src = VENDOR_BASE + "fullcalendar.global.min.js";
        script.async = true;
        script.dataset.dashboardFullcalendar = "true";
        script.onload = afterLoad;
        script.onerror = () => reject(new Error("FullCalendar failed to load"));
        document.head.appendChild(script);
      });
    }
    return fullCalendarLoadPromise;
  };

  const calendarExtractEvents = (data, config, mapping) => {
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const dateField = String(config.dateField || mapping.dateField || "").trim();
    const labelField = String(config.labelField || mapping.labelField || "").trim();
    return rows.map((row) => {
      const timestamp = Date.parse(row?.[dateField]);
      return Number.isFinite(timestamp)
        ? { date: new Date(timestamp), label: String(row?.[labelField] || row?.label || "Item"), state: String(row?.[mapping.statusField] || row?.state || "") }
        : null;
    }).filter(Boolean).sort((a, b) => a.date - b.date).slice(0, Number(config.limit) || 12);
  };
  const staticCalendarMonthMarkup = (initialDate = new Date()) => {
    const date = initialDate instanceof Date && Number.isFinite(initialDate.getTime()) ? initialDate : new Date();
    const year = date.getFullYear();
    const month = date.getMonth();
    const first = new Date(year, month, 1);
    const dayCount = new Date(year, month + 1, 0).getDate();
    const offset = first.getDay();
    const cells = [];
    for (let index = 0; index < offset; index += 1) cells.push(`<span class="runtime-calendar-static-cell is-muted"></span>`);
    for (let day = 1; day <= dayCount; day += 1) {
      const isToday = year === new Date().getFullYear() && month === new Date().getMonth() && day === new Date().getDate();
      cells.push(`<span class="runtime-calendar-static-cell${isToday ? " is-today" : ""}">${day}</span>`);
    }
    const monthLabel = date.toLocaleString(undefined, { month: "long", year: "numeric" });
    return `
      <div class="runtime-calendar-static" data-calendar-static-month="${escapeHtml(`${year}-${String(month + 1).padStart(2, "0")}`)}" aria-label="${escapeHtml(monthLabel)}">
        <div class="runtime-calendar-static-title">${escapeHtml(monthLabel)}</div>
        <div class="runtime-calendar-static-weekdays" aria-hidden="true">${["S", "M", "T", "W", "T", "F", "S"].map((day) => `<span>${day}</span>`).join("")}</div>
        <div class="runtime-calendar-static-grid">${cells.join("")}</div>
      </div>`;
  };

  registerWidgetDefinition({
    type: "calendar",
    displayName: "Calendar",
    category: "controls",
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 2, rows: 1 },
    widgetType: "calendar",
    dashboardObjectKind: "calendar",
    regionRole: "content",
    htmlTag: "div",
    className: "stat-card widget-card widget-card-custom calendar-widget-card",
    capabilities: {
      readsContext: true,
      supportsTimeRange: true,
      supportsResize: true,
    },
    supportedSettings: withWellToneSetting(["dateField", "labelField", "color", "pin", "delete"]),
    settingsSchema: {
      sections: [{
        id: "calendar",
        label: "Calendar",
        fields: withWellToneFields([
          { key: "title", label: "Title", type: "text", defaultValue: "Calendar" },
          { key: "dateField", label: "Date field", type: "fieldPicker", affectsQuery: true },
          { key: "labelField", label: "Label field", type: "fieldPicker", affectsQuery: true },
          { key: "limit", label: "Limit", type: "number", defaultValue: 12, min: 1, max: 100, step: 1, affectsQuery: true },
        ]),
      }],
    },
    getDefaultConfig: () => withWellToneDefault({ title: "Calendar", dateField: "", labelField: "", limit: 12 }),
    render: ({ instance }) => {
      const title = instance.config.title || "Calendar";
      const config = instance.config || {};
      const monthName = config.title || "Calendar";
      const initialDate = new Date().toISOString().split("T")[0];
      return `
        <div class="runtime-calendar-widget runtime-well-widget" ${wellToneAttribute(config)}>
          <div class="widget-content-well widget-library-surface runtime-calendar-fullcalendar-surface">
            <div class="runtime-calendar-fullcalendar" data-calendar-initial="${escapeHtml(initialDate)}" role="region" aria-label="${escapeHtml(monthName)}">${staticCalendarMonthMarkup(new Date(initialDate))}</div>
          </div>
        </div>`;
    },
    mountBodyRenderer: ({ contentRoot, instance }) => {
      const target = contentRoot?.querySelector?.(".runtime-calendar-fullcalendar");
      if (!target) return null;
      const config = instance?.config || {};
      const events = calendarExtractEvents(instance?.data, config, {});
      const initialDate = target.dataset.calendarInitial || events[0]?.date?.toISOString?.().split("T")[0] || new Date().toISOString().split("T")[0];
      const fcEvents = events.map((event) => ({
        title: event.label,
        start: event.date,
        allDay: true,
        extendedProps: { state: event.state },
      }));
      let disposed = false;
      let calendar = null;
      let resizeObserver = null;
      loadFullCalendar()
        .then((FC) => {
          if (disposed || !target.isConnected) return;
          calendar = new FC.Calendar(target, {
            initialView: "dayGridMonth",
            initialDate,
            events: fcEvents,
            headerToolbar: false,
            height: "100%",
            editable: false,
            selectable: false,
            eventDisplay: "block",
            dayMaxEvents: 2,
            fixedWeekCount: false,
          });
          calendar.render();
          resizeObserver = new ResizeObserver(() => calendar?.updateSize());
          resizeObserver.observe(target);
          requestAnimationFrame(() => calendar?.updateSize());
        })
        .catch((error) => {
          if (disposed || !target.isConnected) return;
          target.innerHTML = defaultWidgetVisual("calendar");
        });
      return () => {
        disposed = true;
        resizeObserver?.disconnect();
        calendar?.destroy();
        calendar = null;
      };
    },
  });

  let flatpickrLoadPromise = null;
  const loadFlatpickr = () => {
    if (window.flatpickr) return Promise.resolve(window.flatpickr);
    if (!flatpickrLoadPromise) {
      flatpickrLoadPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector("script[data-dashboard-flatpickr]");
        if (existing) {
          existing.addEventListener("load", () => window.flatpickr ? resolve(window.flatpickr) : reject(new Error("Flatpickr failed to initialize")), { once: true });
          existing.addEventListener("error", () => reject(new Error("Flatpickr failed to load")), { once: true });
          return;
        }
        if (!document.querySelector("link[data-dashboard-flatpickr-css]")) {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = VENDOR_BASE + "flatpickr/flatpickr.min.css";
          link.dataset.dashboardFlatpickrCss = "true";
          document.head.appendChild(link);
        }
        const script = document.createElement("script");
        script.src = VENDOR_BASE + "flatpickr/flatpickr.min.js";
        script.async = true;
        script.dataset.dashboardFlatpickr = "true";
        script.onload = () => window.flatpickr ? resolve(window.flatpickr) : reject(new Error("Flatpickr failed to initialize"));
        script.onerror = () => { flatpickrLoadPromise = null; reject(new Error("Flatpickr failed to load")); };
        document.head.appendChild(script);
      });
    }
    return flatpickrLoadPromise;
  };
  const timeframeFlatpickrInstances = new WeakMap();
  const mountTimeframeFlatpickr = (container) => {
    const dateInputs = container.querySelectorAll("input[type='date'][data-timeframe-filter-part]");
    if (!dateInputs.length) return;
    loadFlatpickr().then((fp) => {
      dateInputs.forEach((input) => {
        if (timeframeFlatpickrInstances.has(input) || !input.isConnected) return;
        const instance = fp(input, { dateFormat: "Y-m-d", allowInput: true, disableMobile: true });
        timeframeFlatpickrInstances.set(input, instance);
      });
    }).catch(() => { /* fallback: native date inputs remain */ });
  };
  const destroyTimeframeFlatpickr = (container) => {
    container.querySelectorAll("input[type='date'][data-timeframe-filter-part]").forEach((input) => {
      const instance = timeframeFlatpickrInstances.get(input);
      if (instance) { try { instance.destroy(); } catch (_) {} timeframeFlatpickrInstances.delete(input); }
    });
  };

  window.dashboardWidgetRuntime = {
    registerWidgetDefinition,
    getWidgetDefinition,
    createWidgetInstance,
    renderWidget,
    dataRequestForWidget,
    resolveWidgetDensity,
    resolveTimeRangeConfig,
    resolveTimeframeFilter,
    normalizeTimeframeFilters,
    mountTimeframeFlatpickr,
    destroyTimeframeFlatpickr,
    timeframeFilterTypes: () => TIMEFRAME_OPTIONS.map((type) => ({ ...type })),
    timeframeOptions: () => TIMEFRAME_OPTIONS.map((option) => ({ ...option })),
    weekStartOptions: () => WEEKDAY_OPTIONS.map((option) => ({ ...option })),
    densityTiers: () => [...DENSITY_TIERS],
    listWidgetDefinitions: () => [...definitions.values()].map((definition) => ({
      type: definition.type,
      label: definition.label || definition.displayName || definition.type,
      displayName: definition.displayName,
      defaultSize: definition.defaultSize,
      minSize: definition.minSize,
      capabilities: definition.capabilities,
      supportedSettings: definition.supportedSettings,
      settingsSchema: definition.settingsSchema,
      densityBehavior: definition.densityBehavior,
      category: definition.category,
      subcategory: definition.subcategory,
      layer: definition.layer,
      backendOnly: definition.backendOnly,
      icon: definition.icon,
      aliases: definition.aliases,
      shell: definition.shell === false ? { enabled: false } : {
        enabled: true,
        mode: definition.shell?.mode || "compat",
        showHeader: Boolean(definition.shell?.showHeader),
      },
    })),
    dataRequestForInstance: (definitionOrType, instance = {}) => dataRequestForWidget(definitionOrType, instance),
    parseConfig,
  };
  window.dashboardChartRuntime = {
    registerChartDefinition,
    getChartDefinition,
    listChartDefinitions,
  };
  window.dashboardVisualizationWellToneRuntime = {
    normalize: normalizeVisualWellTone,
    tones: () => VISUAL_WELL_TONES.map((tone) => ({ ...tone })),
  };
})();
