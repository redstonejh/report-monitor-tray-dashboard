const WIDGET_LOGIC_SETTING_KEYS = new Set([
  "assetId",
  "aggregations",
  "calculatedFields",
  "chartType",
  "columns",
  "customEnd",
  "customStart",
  "dateField",
  "eventTypes",
  "filter",
  "filterMode",
  "filters",
  "equationFilters",
  "fallbackBehavior",
  "fallbackValue",
  "labelField",
  "latitudeField",
  "limit",
  "locationField",
  "longitudeField",
  "metric",
  "operator",
  "page",
  "promptTemplate",
  "scope",
  "selectedFilterId",
  "selectedPreset",
  "seriesField",
  "sortBy",
  "sortDirection",
  "source",
  "sourceType",
  "src",
  "stateAColor",
  "stateALabel",
  "stateAOpacity",
  "stateBColor",
  "stateBLabel",
  "stateBOpacity",
  "target",
  "targetType",
  "timeRange",
  "thresholds",
  "unitConversions",
  "staleRules",
  "valueField",
  "weekStartDay",
  "xField",
  "yField",
  "allowMultipleInputs",
  "conversionBehavior",
  "invertOutput",
]);

const WIDGET_APPEARANCE_SETTING_KEYS = new Set([
  "caption",
  "density",
  "display",
  "fit",
  "format",
  "label",
  "showAxes",
  "showGrid",
  "showLabels",
  "showLegend",
  "title",
]);

const INLINE_TEXT_SETTING_KEYS = new Set(["label", "title"]);

const isInlineTextSetting = (field = {}) => INLINE_TEXT_SETTING_KEYS.has(String(field.key || ""));

export const widgetSettingsFields = (definition) => (
  definition?.settingsSchema?.sections || []
).flatMap((section) => section.fields || []).filter((field) => !isInlineTextSetting(field));

export const widgetSettingSurface = (field = {}) => {
  if (field.surface === "appearance" || field.surface === "visual") return "appearance";
  if (field.surface === "logic" || field.surface === "data" || field.surface === "context") return "logic";
  const key = String(field.key || "");
  if (field.affectsQuery || field.affectsContext) return "logic";
  if (WIDGET_LOGIC_SETTING_KEYS.has(key)) return "logic";
  if (WIDGET_APPEARANCE_SETTING_KEYS.has(key)) return "appearance";
  return "appearance";
};

export const widgetSettingsSchemaForSurface = (definition, surface = "all") => {
  const schema = definition?.settingsSchema || { sections: [] };
  const sections = (schema.sections || []).map((section) => ({
    ...section,
    fields: (section.fields || []).filter((field) => (
      !isInlineTextSetting(field)
      && (!surface || surface === "all" || widgetSettingSurface(field) === surface)
    )),
  })).filter((section) => section.fields.length);
  return { ...schema, sections };
};

export const queryRelevantWidgetConfig = (definition, config = {}) => {
  const relevantKeys = widgetSettingsFields(definition)
    .filter((field) => field.affectsQuery || field.affectsContext)
    .map((field) => field.key);
  return relevantKeys.reduce((record, key) => {
    if (config[key] !== undefined) record[key] = config[key];
    return record;
  }, {});
};
