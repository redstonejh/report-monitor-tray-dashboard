export const createWidgetSettingsService = ({
  widgetSettingsFields,
  widgetDefinitionForElement,
  widgetConfigFromElement,
  parseJsonRecord,
  settingRawValue,
  normalizedTimeframeWidgetRange,
  normalizedFilterWidgetFilters,
  resolveWidgetDisplayState,
  activeLayoutKeyForItem,
  getActivePanelProfile,
  saveWidgetLayouts,
  refreshWidgetDisplayState,
  pushLiveLayoutUndo,
  setWidgetConfig,
  widgetDisplayStateForWidget,
  renderWidgetRuntimeContent,
  renderWidgetSettingsSchemaPanel,
  renderWidgetWorkbenchPanel,
}) => {
  const coerceWidgetSettingValue = (input, field) => {
    if (field.type === "toggle") return Boolean(input.checked);
    if (field.type === "number") {
      let value = Number(input.value);
      if (!Number.isFinite(value)) value = Number(field.defaultValue) || 0;
      if (field.min != null) value = Math.max(Number(field.min), value);
      if (field.max != null) value = Math.min(Number(field.max), value);
      return value;
    }
    if (field.type === "json") return parseJsonRecord(input.value, settingRawValue({}, field));
    if (field.valueType === "array") {
      return String(input.value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
    }
    return String(input.value || "").trim();
  };

  const widgetSettingFieldForInput = (widget, input) => {
    const key = input?.dataset?.widgetSettingKey;
    if (!key) return null;
    return widgetSettingsFields(widgetDefinitionForElement(widget)).find((field) => field.key === key) || null;
  };

  const syncWidgetContextOutputs = (widget) => {
    if (!widget?.classList?.contains("widget-card")) return;
    const definition = widgetDefinitionForElement(widget);
    if (definition.type === "timeframe") {
      const displayState = resolveWidgetDisplayState(widget);
      const timeRange = normalizedTimeframeWidgetRange(widget, displayState);
      if (timeRange) {
      widget.dataset.timeframePreset = timeRange.preset || "";
      widget.dataset.timeframeLabel = timeRange.label || "";
      } else {
        delete widget.dataset.timeframePreset;
        delete widget.dataset.timeframeLabel;
      }
    }
    if (definition.type === "filter") {
      normalizedFilterWidgetFilters(widget, resolveWidgetDisplayState(widget));
    }
  };

  const persistRuntimeControlChangeForWidget = (widget, options = {}) => {
    const layoutKey = activeLayoutKeyForItem(widget);
    const profile = getActivePanelProfile(layoutKey);
    const layout = widget.closest(".widget-layout");
    if (layout) saveWidgetLayouts(layout, profile, { history: false });
    refreshWidgetDisplayState(layoutKey, profile);
    if (options.history !== false) pushLiveLayoutUndo(layoutKey, profile);
  };

  const captureRuntimeControlBaselineForWidget = (widget) => {
    const layoutKey = activeLayoutKeyForItem(widget);
    const profile = getActivePanelProfile(layoutKey);
    pushLiveLayoutUndo(layoutKey, profile);
  };

  const applyWidgetSettingsSchemaChange = (widget, input, options = {}) => {
    const field = widgetSettingFieldForInput(widget, input);
    if (!field) return false;
    if (field.required && !String(input.type === "checkbox" ? input.checked : input.value || "").trim()) {
      input.setAttribute("aria-invalid", "true");
      return false;
    }
    input.removeAttribute("aria-invalid");
    const definition = widgetDefinitionForElement(widget);
    const config = widgetConfigFromElement(widget, definition);
    const nextValue = coerceWidgetSettingValue(input, field);
    const before = JSON.stringify(config[field.key] ?? null);
    const after = JSON.stringify(nextValue ?? null);
    if (before === after) return true;
    if (options.history !== false) captureRuntimeControlBaselineForWidget(widget);
    setWidgetConfig(widget, { ...config, [field.key]: nextValue });
    syncWidgetContextOutputs(widget);
    const affectsDisplay = Boolean(field.affectsQuery || field.affectsContext);
    persistRuntimeControlChangeForWidget(widget, { history: options.history !== false, invalidateQuery: affectsDisplay });
    renderWidgetRuntimeContent(widget);
    return true;
  };

  const installGlobalSettingsRuntime = () => {
    window.dashboardWidgetSettingsRuntime = {
      schemaForWidget: (widget) => {
        const node = typeof widget === "string" ? document.querySelector(widget) : widget;
        return node ? widgetDefinitionForElement(node).settingsSchema || { sections: [] } : { sections: [] };
      },
      fieldsForWidget: (widget) => {
        const node = typeof widget === "string" ? document.querySelector(widget) : widget;
        return node ? widgetSettingsFields(widgetDefinitionForElement(node)) : [];
      },
      renderPanel: (widget, options = {}) => {
        const node = typeof widget === "string" ? document.querySelector(widget) : widget;
        return node ? renderWidgetSettingsSchemaPanel(node, options.surface || "appearance") : "";
      },
      renderWorkbench: (widget) => {
        const node = typeof widget === "string" ? document.querySelector(widget) : widget;
        return node ? renderWidgetWorkbenchPanel(node) : "";
      },
      applySetting: (widget, key, value, options = {}) => {
        const node = typeof widget === "string" ? document.querySelector(widget) : widget;
        if (!node || !key) return false;
        const field = widgetSettingsFields(widgetDefinitionForElement(node)).find((entry) => entry.key === key);
        if (!field) return false;
        const input = {
          dataset: { widgetSettingKey: key },
          value: field.valueType === "array" && Array.isArray(value) ? value.join(", ") : String(value ?? ""),
          checked: Boolean(value),
          type: field.type === "toggle" ? "checkbox" : field.type,
          removeAttribute() {},
          setAttribute() {},
        };
        return applyWidgetSettingsSchemaChange(node, input, options);
      },
    };
  };

  installGlobalSettingsRuntime();

  return {
    syncWidgetContextOutputs,
    persistRuntimeControlChangeForWidget,
    captureRuntimeControlBaselineForWidget,
    applyWidgetSettingsSchemaChange,
  };
};
