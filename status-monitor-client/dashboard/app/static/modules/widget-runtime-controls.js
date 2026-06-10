export const createWidgetRuntimeControls = ({
  widgetConfigFromElement,
  setWidgetConfig,
  setWidgetConfigValue,
  normalizedFilterWidgetFilters,
  captureRuntimeControlBaselineForWidget,
  renderWidgetRuntimeContent,
  syncWidgetContextOutputs,
  ensureWidgetWorkbenchPanel,
  persistRuntimeControlChangeForWidget,
  publishTimeframeSelection,
}) => {
  const bindWidgetRuntimeControls = (widget) => {
    if (!widget || widget.dataset.widgetRuntimeControlsBound === "true") return;
    widget.dataset.widgetRuntimeControlsBound = "true";
    const persistRuntimeControlChange = (options = {}) => persistRuntimeControlChangeForWidget(widget, options);
    const updateFilterWidgetConfig = (target) => {
      const input = target?.closest?.(".filter-widget-input");
      const control = input?.closest?.(".filter-widget-control");
      if (!input || !control || !widget.contains(input)) return false;
      const config = widgetConfigFromElement(widget);
      const filters = Array.isArray(config.filters) ? [...config.filters] : [];
      const id = control.dataset.filterId;
      const index = Math.max(0, filters.findIndex((filter) => (filter.id || "") === id));
      const current = { ...(filters[index] || { id, type: control.dataset.filterType || "text" }) };
      current.id = current.id || id;
      current.type = current.type || control.dataset.filterType || "text";
      const part = input.dataset.filterPart || "value";
      if (part === "option") {
        const values = new Set(Array.isArray(current.values) ? current.values.map(String) : []);
        if (input.checked) values.add(input.value);
        else values.delete(input.value);
        current.values = [...values];
      } else if (part === "enabled") {
        current.enabled = input.checked;
      } else {
        current[part] = input.value;
      }
      filters[index] = current;
      const nextConfig = { ...config, filters };
      setWidgetConfig(widget, nextConfig);
      return true;
    };

    const updateTextWidgetConfig = (target, eventType = "input") => {
      const editor = target?.closest?.(".text-widget-editor");
      if (!editor || !widget.contains(editor) || widget.dataset.widgetDefinition !== "text") return false;
      if (!widget.__textWidgetEditBaselineCaptured) {
        captureRuntimeControlBaselineForWidget(widget);
        widget.__textWidgetEditBaselineCaptured = true;
      }
      const nextBody = "value" in editor
        ? editor.value
        : (editor.innerText ?? editor.textContent ?? "");
      setWidgetConfigValue(widget, "body", nextBody);
      if (eventType === "change" || eventType === "focusout") {
        widget.__textWidgetEditBaselineCaptured = false;
      }
      return true;
    };

    const updateTimeframeWidgetConfig = (target, eventType = "input") => {
      if (widget.dataset.widgetDefinition !== "timeframe") return false;
      const globalConfigInput = target?.closest?.(".timeframe-config-input");
      const filterConfigInput = target?.closest?.(".timeframe-filter-config-input");
      const addFilterButton = target?.closest?.(".timeframe-add-filter");
      const removeFilterButton = target?.closest?.(".timeframe-remove-filter");
      const runtime = window.dashboardWidgetRuntime;
      const normalizedFilters = (config) => runtime?.normalizeTimeframeFilters?.(config) || [];
      const setTimeframeConfig = (nextConfig, options = {}) => {
        setWidgetConfig(widget, nextConfig);
        renderWidgetRuntimeContent(widget);
        syncWidgetContextOutputs(widget);
        publishTimeframeSelection?.(widget);
        if (widget.classList.contains("widget-workbench-open") && options.refreshWorkbench !== false) {
          ensureWidgetWorkbenchPanel(widget);
        }
      };
      if (addFilterButton && widget.contains(addFilterButton)) {
        if (addFilterButton.dataset.timeframeAddHandled === "true") return true;
        addFilterButton.dataset.timeframeAddHandled = "true";
        const config = widgetConfigFromElement(widget);
        const filters = normalizedFilters(config);
        const id = `time-filter-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
        if (eventType !== "input") captureRuntimeControlBaselineForWidget(widget);
        setTimeframeConfig({
          ...config,
          filters: [...filters, { id, label: "New filter", type: "today" }],
          selectedFilterId: id,
          selectedPreset: "today",
          activeLabel: "New filter",
        });
        return true;
      }
      if (removeFilterButton && widget.contains(removeFilterButton)) {
        const config = widgetConfigFromElement(widget);
        const id = removeFilterButton.dataset.timeframeFilterId || "";
        const filters = normalizedFilters(config).filter((filter) => filter.id !== id);
        const selectedFilterId = config.selectedFilterId === id ? (filters[0]?.id || "") : config.selectedFilterId;
        const selectedFilter = filters.find((filter) => filter.id === selectedFilterId);
        if (eventType !== "input") captureRuntimeControlBaselineForWidget(widget);
        setTimeframeConfig({
          ...config,
          filters,
          selectedFilterId,
          selectedPreset: selectedFilter?.type || "",
          activeLabel: selectedFilter?.label || "",
        });
        return true;
      }
      if (globalConfigInput && widget.contains(globalConfigInput)) {
        const config = widgetConfigFromElement(widget);
        const part = globalConfigInput.dataset.timeframeConfigPart || "";
        if (!part) return false;
        if (eventType !== "input") captureRuntimeControlBaselineForWidget(widget);
        setTimeframeConfig({
          ...config,
          [part]: globalConfigInput.type === "number" ? Number(globalConfigInput.value) : globalConfigInput.value,
        }, { refreshWorkbench: eventType !== "input" });
        return true;
      }
      if (filterConfigInput && widget.contains(filterConfigInput)) {
        const config = widgetConfigFromElement(widget);
        const id = filterConfigInput.dataset.timeframeFilterId || "";
        const part = filterConfigInput.dataset.timeframeFilterPart || "";
        if (!id || !part) return false;
        const filters = normalizedFilters(config);
        const nextFilters = filters.map((filter) => {
          if (filter.id !== id) return filter;
          if (part === "selected") return filter;
          const value = filterConfigInput.type === "number"
            ? Math.max(1, Math.round(Number(filterConfigInput.value) || 1))
            : filterConfigInput.value;
          return { ...filter, [part]: value };
        });
        const selected = part === "selected" ? id : config.selectedFilterId;
        const selectedFilter = nextFilters.find((filter) => filter.id === selected);
        captureRuntimeControlBaselineForWidget(widget);
        setTimeframeConfig({
          ...config,
          filters: nextFilters,
          selectedFilterId: selected || "",
          selectedPreset: selectedFilter?.type || config.selectedPreset || "",
          activeLabel: selectedFilter?.label || config.activeLabel || "",
        }, { refreshWorkbench: eventType !== "input" });
        return true;
      }
      return false;
    };

    const handleRuntimeControlChange = (event) => {
      if (event.__widgetRuntimeHandledBy === widget) return;
      const searchInput = event.target?.closest?.(".search-widget-input");
      if (searchInput && widget.contains(searchInput)) {
        event.__widgetRuntimeHandledBy = widget;
        setWidgetConfig(widget, {
          ...widgetConfigFromElement(widget),
          query: searchInput.value,
        });
        persistRuntimeControlChange({ history: false });
        return;
      }
      if (updateFilterWidgetConfig(event.target)) {
        event.__widgetRuntimeHandledBy = widget;
        persistRuntimeControlChange({ history: event.type === "change" });
      }
      if (updateTextWidgetConfig(event.target, event.type)) {
        event.__widgetRuntimeHandledBy = widget;
        persistRuntimeControlChange({ history: event.type === "change" || event.type === "focusout" });
      }
      if (updateTimeframeWidgetConfig(event.target, event.type)) {
        event.__widgetRuntimeHandledBy = widget;
        persistRuntimeControlChange({ history: event.type === "change" || event.type === "focusout" });
      }
    };

    const handleRuntimeControlClick = (event) => {
      if (event.__widgetRuntimeHandledBy === widget) return;
      const filterBtn = event.target?.closest?.(".timeframe-filter-btn[data-filter-id]");
      if (filterBtn && widget.contains(filterBtn) && widget.dataset.widgetDefinition === "timeframe") {
        event.preventDefault();
        event.stopImmediatePropagation?.();
        event.stopPropagation();
        const filterId = filterBtn.dataset.filterId;
        const config = widgetConfigFromElement(widget);
        const filters = window.dashboardWidgetRuntime?.normalizeTimeframeFilters?.(config) || [];
        const selectedFilter = filters.find((f) => f.id === filterId);
        captureRuntimeControlBaselineForWidget(widget);
        setWidgetConfig(widget, {
          ...config,
          selectedFilterId: filterId,
          selectedPreset: selectedFilter?.type || "",
          activeLabel: selectedFilter?.label || "",
        });
        renderWidgetRuntimeContent(widget);
        syncWidgetContextOutputs(widget);
        publishTimeframeSelection?.(widget);
        event.__widgetRuntimeHandledBy = widget;
        persistRuntimeControlChange({ history: true });
        return;
      }
      const clickableTimeframeControl = event.target?.closest?.(
        ".timeframe-add-filter, .timeframe-remove-filter, .timeframe-filter-config-input[type='radio']"
      );
      if (!clickableTimeframeControl || !widget.contains(clickableTimeframeControl)) return;
      if (updateTimeframeWidgetConfig(event.target, event.type)) {
        event.preventDefault();
        event.stopImmediatePropagation?.();
        event.stopPropagation();
        persistRuntimeControlChange({ history: true });
      }
    };

    widget.addEventListener("click", handleRuntimeControlClick, true);
    widget.addEventListener("input", handleRuntimeControlChange, true);
    widget.addEventListener("input", handleRuntimeControlChange);
    widget.addEventListener("change", handleRuntimeControlChange, true);
    widget.addEventListener("change", handleRuntimeControlChange);
    widget.addEventListener("focusout", handleRuntimeControlChange);
  };

  return { bindWidgetRuntimeControls };
};
