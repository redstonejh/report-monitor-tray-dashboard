export const createWidgetWorkbenchRuntime = ({
  escapeHtml,
  widgetConfigFromElement,
  widgetDefinitionForElement,
  widgetSettingsSchemaForSurface,
  uniqueValues,
  resolveWidgetDisplayState,
  widgetDisplayStateForWidget,
}) => {
  const settingFieldOptionRecord = (option) => {
    if (option && typeof option === "object") {
      const value = String(option.value ?? option.id ?? option.key ?? option.label ?? "");
      return { value, label: String(option.label ?? option.name ?? value) };
    }
    return { value: String(option ?? ""), label: String(option ?? "") };
  };

  const fieldPickerOptionsForWidget = (widget, config = widgetConfigFromElement(widget)) => {
    return uniqueValues([
      ...(Array.isArray(config.columns) ? config.columns : []),
      config.valueField,
      config.xField,
      config.yField,
      config.seriesField,
      config.latitudeField,
      config.longitudeField,
      config.locationField,
      config.sortBy,
      config.dateField,
      config.labelField,
    ]).map((field) => ({ value: field, label: field }));
  };

  const settingRawValue = (config, field) => {
    if (config[field.key] !== undefined) return config[field.key];
    if (field.defaultValue !== undefined) return field.defaultValue;
    return field.type === "toggle" ? false : field.valueType === "array" ? [] : "";
  };

  const settingInputValue = (config, field) => {
    const value = settingRawValue(config, field);
    if (field.valueType === "array") return Array.isArray(value) ? value.join(", ") : String(value || "");
    if (typeof value === "object" && value !== null) return JSON.stringify(value, null, 2);
    return String(value ?? "");
  };

  const renderWidgetSettingField = (widget, field, config, surface = "settings") => {
    const id = `${widget.dataset.widgetKey || "widget"}-${field.key}`;
    const value = settingInputValue(config, field);
    const common = `class="widget-setting-input" data-widget-setting-key="${escapeHtml(field.key)}" data-widget-setting-type="${escapeHtml(field.type)}" data-widget-setting-surface="${escapeHtml(surface)}" aria-label="${escapeHtml(field.label)}"`;
    const placeholder = field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : "";
    if (field.type === "select" || field.type === "metricPicker" || field.type === "fieldPicker") {
      const options = field.type === "fieldPicker"
        ? fieldPickerOptionsForWidget(widget, config)
        : (field.options || []).map(settingFieldOptionRecord);
      const optionMarkup = [
        field.required ? "" : `<option value="">${field.type === "fieldPicker" ? "Auto" : "Default"}</option>`,
        ...options.map((option) => `<option value="${escapeHtml(option.value)}"${String(value) === option.value ? " selected" : ""}>${escapeHtml(option.label)}</option>`),
      ].join("");
      return `<label class="widget-setting-field widget-setting-field-${escapeHtml(field.type)}" for="${escapeHtml(id)}">
        <span>${escapeHtml(field.label)}</span>
        <select id="${escapeHtml(id)}" ${common}>${optionMarkup}</select>
      </label>`;
    }
    if (field.type === "toggle") {
      return `<label class="widget-setting-field widget-setting-field-toggle" for="${escapeHtml(id)}">
        <span>${escapeHtml(field.label)}</span>
        <input id="${escapeHtml(id)}" ${common} type="checkbox"${settingRawValue(config, field) ? " checked" : ""}>
      </label>`;
    }
    if (field.type === "textarea" || field.type === "json") {
      return `<label class="widget-setting-field widget-setting-field-${escapeHtml(field.type)}" for="${escapeHtml(id)}">
        <span>${escapeHtml(field.label)}</span>
        <textarea id="${escapeHtml(id)}" ${common}${placeholder}>${escapeHtml(value)}</textarea>
      </label>`;
    }
    const inputType = field.type === "number" ? "number" : field.type === "dateRange" ? "date" : "text";
    const numeric = field.type === "number"
      ? `${field.min != null ? ` min="${escapeHtml(field.min)}"` : ""}${field.max != null ? ` max="${escapeHtml(field.max)}"` : ""}${field.step != null ? ` step="${escapeHtml(field.step)}"` : ""}`
      : "";
    return `<label class="widget-setting-field widget-setting-field-${escapeHtml(field.type)}" for="${escapeHtml(id)}">
      <span>${escapeHtml(field.label)}</span>
      <input id="${escapeHtml(id)}" ${common} type="${inputType}" value="${escapeHtml(value)}"${placeholder}${numeric}>
    </label>`;
  };

  const widgetSchemaEmptyState = (definition, surface) => {
    if (surface === "logic") {
      return `<div class="widget-settings-empty-state">
        <span>${escapeHtml(definition.displayName || "Widget")}</span>
        <small>No display controls</small>
      </div>`;
    }
    return `<div class="widget-settings-empty-state">
      <span>${escapeHtml(definition.displayName || "Widget")}</span>
      <small>Appearance uses title, color, and layout controls</small>
    </div>`;
  };

  const renderWidgetSettingsSchemaPanel = (widget, surface = "appearance") => {
    const definition = widgetDefinitionForElement(widget);
    const isTimeframeCustomization = surface === "appearance" && (
      definition.type === "timeframe" || widget?.dataset?.widgetDefinition === "timeframe"
    );
    const schema = widgetSettingsSchemaForSurface(definition, surface);
    const config = widgetConfigFromElement(widget, definition);
    const sections = schema.sections || [];
    const renderableSections = sections
      .map((section) => {
        const fields = (section.fields || []).filter(Boolean);
        return fields.length ? { ...section, fields } : null;
      })
      .filter(Boolean);
    if (surface === "appearance" && (isTimeframeCustomization || renderableSections.length === 0)) {
      return "";
    }
    return `<div class="widget-settings-schema-head">
      <span>${escapeHtml(definition.displayName || "Widget")} ${surface === "logic" ? "settings" : "appearance"}</span>
    </div>
    ${renderableSections.length ? renderableSections.map((section) => `<fieldset class="widget-settings-section" data-widget-settings-section="${escapeHtml(section.id)}" data-widget-settings-surface="${escapeHtml(surface)}">
      <legend>${escapeHtml(section.label || "Settings")}</legend>
      ${section.fields.map((field) => renderWidgetSettingField(widget, field, config, surface)).join("")}
    </fieldset>`).join("") : widgetSchemaEmptyState(definition, surface)}`;
  };

  const timeframeWorkbenchOptions = (options = [], selected = "") => options.map((option) => {
    const value = String(option.value ?? option.id ?? "");
    const label = String(option.label ?? value);
    return `<option value="${escapeHtml(value)}"${String(selected) === value ? " selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");

  const timeframeFilterValue = (filter, key, fallback = "") => String(filter?.[key] ?? fallback ?? "");

  const renderTimeframeWorkbenchFilterFields = (filter) => {
    const type = String(filter?.type || "today");
    const fixedFields = type === "custom_fixed" || type === "custom"
      ? `<div class="timeframe-workbench-inline">
          <label class="widget-setting-field">Start<input class="timeframe-filter-config-input" type="date" data-timeframe-filter-id="${escapeHtml(filter.id)}" data-timeframe-filter-part="start" value="${escapeHtml(timeframeFilterValue(filter, "start"))}"></label>
          <label class="widget-setting-field">End<input class="timeframe-filter-config-input" type="date" data-timeframe-filter-id="${escapeHtml(filter.id)}" data-timeframe-filter-part="end" value="${escapeHtml(timeframeFilterValue(filter, "end"))}"></label>
        </div>`
      : "";
    const repeatingFields = type === "custom_repeating"
      ? `<div class="timeframe-workbench-inline">
          <label class="widget-setting-field">Seed start<input class="timeframe-filter-config-input" type="date" data-timeframe-filter-id="${escapeHtml(filter.id)}" data-timeframe-filter-part="seedStart" value="${escapeHtml(timeframeFilterValue(filter, "seedStart"))}"></label>
          <label class="widget-setting-field">Seed end<input class="timeframe-filter-config-input" type="date" data-timeframe-filter-id="${escapeHtml(filter.id)}" data-timeframe-filter-part="seedEnd" value="${escapeHtml(timeframeFilterValue(filter, "seedEnd"))}"></label>
        </div>
        <div class="timeframe-workbench-inline">
          <label class="widget-setting-field">Repeat every<input class="timeframe-filter-config-input" type="number" min="1" step="1" data-timeframe-filter-id="${escapeHtml(filter.id)}" data-timeframe-filter-part="repeatEvery" value="${escapeHtml(timeframeFilterValue(filter, "repeatEvery", 2))}"></label>
          <label class="widget-setting-field">Unit<select class="timeframe-filter-config-input" data-timeframe-filter-id="${escapeHtml(filter.id)}" data-timeframe-filter-part="repeatUnit">
            ${timeframeWorkbenchOptions([{ value: "days", label: "Days" }, { value: "weeks", label: "Weeks" }, { value: "monthly", label: "Monthly" }], filter.repeatUnit || "weeks")}
          </select></label>
          <label class="widget-setting-field">Occurrence<select class="timeframe-filter-config-input" data-timeframe-filter-id="${escapeHtml(filter.id)}" data-timeframe-filter-part="occurrence">
            ${timeframeWorkbenchOptions([{ value: "current", label: "Current" }, { value: "previous", label: "Previous" }, { value: "next", label: "Next" }], filter.occurrence || "current")}
          </select></label>
        </div>`
      : "";
    return `${fixedFields}${repeatingFields}`;
  };

  const renderTimeframeWorkbenchPanel = (widget) => {
    const runtime = window.dashboardWidgetRuntime;
    const config = widgetConfigFromElement(widget);
    const filters = runtime?.normalizeTimeframeFilters?.(config) || [];
    const selectedFilterId = config.selectedFilterId || "";
    const filterTypes = runtime?.timeframeFilterTypes?.() || [];
    const weekOptions = runtime?.weekStartOptions?.() || [];
    return `<div class="widget-settings-schema-head">
      <span>Time filter settings</span>
    </div>
    <fieldset class="widget-settings-section timeframe-workbench-section" data-widget-settings-section="timeframe-global" data-widget-settings-surface="logic">
      <legend>Calendar logic</legend>
      <label class="widget-setting-field" for="${escapeHtml(widget.dataset.widgetKey || "timeframe")}-week-start">
        <span>Week starts on</span>
        <select id="${escapeHtml(widget.dataset.widgetKey || "timeframe")}-week-start" class="timeframe-config-input" data-timeframe-config-part="weekStartDay">
          ${timeframeWorkbenchOptions(weekOptions, config.weekStartDay ?? 0)}
        </select>
      </label>
    </fieldset>
    <fieldset class="widget-settings-section timeframe-workbench-section" data-widget-settings-section="timeframe-filters" data-widget-settings-surface="logic">
      <legend>Filter buttons</legend>
      <div class="timeframe-filter-editor-list">
        ${filters.map((filter, index) => `<div class="timeframe-filter-editor" data-timeframe-filter-id="${escapeHtml(filter.id)}">
          <div class="timeframe-filter-editor-head">
            <label class="widget-setting-field timeframe-filter-label-field">Label<input class="timeframe-filter-config-input" type="text" data-timeframe-filter-id="${escapeHtml(filter.id)}" data-timeframe-filter-part="label" value="${escapeHtml(filter.label)}"></label>
            <button class="timeframe-remove-filter widget-workbench-action widget-workbench-action-danger" type="button" data-timeframe-filter-id="${escapeHtml(filter.id)}" aria-label="Remove ${escapeHtml(filter.label)}">Remove</button>
          </div>
          <label class="widget-setting-field">
            <span>Filter type</span>
            <select class="timeframe-filter-config-input" data-timeframe-filter-id="${escapeHtml(filter.id)}" data-timeframe-filter-part="type">
              ${timeframeWorkbenchOptions(filterTypes, filter.type)}
            </select>
          </label>
          ${renderTimeframeWorkbenchFilterFields(filter)}
          <label class="timeframe-filter-selected-row">
            <input class="timeframe-filter-config-input" type="radio" name="${escapeHtml(widget.dataset.widgetKey || "timeframe")}-selected-filter" data-timeframe-filter-id="${escapeHtml(filter.id)}" data-timeframe-filter-part="selected" value="${escapeHtml(filter.id)}"${filter.id === selectedFilterId ? " checked" : ""}>
            <span>Use this filter now</span>
          </label>
        </div>`).join("")}
      </div>
      <button class="timeframe-add-filter widget-workbench-action" type="button">Add time filter</button>
    </fieldset>`;
  };

  const normalizeWidgetMenuFormControls = (panel) => {
    panel?.querySelectorAll?.("button:not([type])").forEach((button) => {
      button.type = "button";
    });
  };

  const renderWidgetWorkbenchPanel = (widget) => {
    const definition = widgetDefinitionForElement(widget);
    const logicMarkup = definition.type === "timeframe"
      ? renderTimeframeWorkbenchPanel(widget)
      : renderWidgetSettingsSchemaPanel(widget, "logic");
    return logicMarkup;
  };

  const ensureWidgetWorkbenchPanel = (widget) => {
    const tools = widget?.querySelector(":scope > .widget-tools");
    if (!tools) return null;
    let panel = tools.querySelector(":scope > .widget-workbench-panel") || widget.__widgetWorkbenchPanel || null;
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "widget-workbench-panel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", "Widget workbench");
      panel.hidden = true;
      tools.appendChild(panel);
    }
    widget.__widgetWorkbenchPanel = panel;
    const isOpen = widget.classList.contains("widget-workbench-open");
    if (isOpen) {
      window.dashboardWidgetRuntime?.destroyTimeframeFlatpickr?.(panel);
      panel.innerHTML = renderWidgetWorkbenchPanel(widget);
      normalizeWidgetMenuFormControls(panel);
      window.dashboardWidgetRuntime?.mountTimeframeFlatpickr?.(panel);
    }
    else {
      window.dashboardWidgetRuntime?.destroyTimeframeFlatpickr?.(panel);
      panel.replaceChildren();
    }
    panel.toggleAttribute("hidden", !isOpen);
    return panel;
  };

  return {
    renderWidgetSettingsSchemaPanel,
    renderWidgetWorkbenchPanel,
    ensureWidgetWorkbenchPanel,
    settingRawValue,
  };
};
