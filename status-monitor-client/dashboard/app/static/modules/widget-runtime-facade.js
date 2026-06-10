export const createWidgetRuntimeFacade = ({ widgetRuntimeController }) => {
  const widgetRuntime = widgetRuntimeController.registry;
  const widgetDefinitionFor = (type) => widgetRuntimeController.definitionFor(type);
  const widgetRuntimeTypeFromElement = (widget) => widgetRuntimeController.runtimeTypeFromElement(widget);
  const widgetDefinitionForElement = (widget) => widgetRuntimeController.definitionForElement(widget);
  const normalizeWorkspaceWidgetLayer = (value, fallback = "presentation") => (
    widgetRuntimeController.normalizeWorkspaceWidgetLayer(value, fallback)
  );
  const widgetLayerForElement = (widget, definition = widgetDefinitionForElement(widget)) => (
    widgetRuntimeController.layerForElement(widget, definition)
  );
  const applyWidgetLayerMetadata = (widget, definition = widgetDefinitionForElement(widget), explicitLayer = "") => (
    widgetRuntimeController.applyLayerMetadata(widget, definition, explicitLayer)
  );
  const parseWidgetConfig = (value) => widgetRuntimeController.parseConfig(value);
  const setWidgetConfig = (widget, config) => widgetRuntimeController.setConfig(widget, config);
  const setWidgetLinkNavigationSuspended = (widget, suspended) => (
    widgetRuntimeController.setLinkNavigationSuspended(widget, suspended)
  );
  const setWidgetConfigValue = (widget, key, value) => widgetRuntimeController.setConfigValue(widget, key, value);
  const widgetConfigFromElement = (widget, definition = widgetDefinitionForElement(widget)) => (
    widgetRuntimeController.configFromElement(widget, definition)
  );
  const widgetAvailableSizeForDensity = (widget) => widgetRuntimeController.availableSizeForDensity(widget);
  const applyWidgetDensityMetadata = (widget, density) => widgetRuntimeController.applyDensityMetadata(widget, density);
  const resolveWidgetDensityForElement = (widget, definition = widgetDefinitionForElement(widget), availableSize = widgetAvailableSizeForDensity(widget)) => (
    widgetRuntimeController.resolveDensityForElement(widget, definition, availableSize)
  );

  return {
    applyWidgetDensityMetadata,
    applyWidgetLayerMetadata,
    normalizeWorkspaceWidgetLayer,
    parseWidgetConfig,
    resolveWidgetDensityForElement,
    setWidgetConfig,
    setWidgetConfigValue,
    setWidgetLinkNavigationSuspended,
    widgetAvailableSizeForDensity,
    widgetConfigFromElement,
    widgetDefinitionFor,
    widgetDefinitionForElement,
    widgetLayerForElement,
    widgetRuntime,
    widgetRuntimeTypeFromElement,
  };
};
