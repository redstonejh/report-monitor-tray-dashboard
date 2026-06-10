export const createDashboardAssetApi = ({
  workspaceAssetsKey,
  getActivePanelProfile,
  loadAssets,
  assetById,
  registerAsset,
  createAssetFromSource,
  fileToDataUrl,
  mimeTypeFromSource,
  assetTypeFromMime,
  isMediaWidgetDefinition,
  widgetDefinitionForElement,
  captureRuntimeControlBaselineForWidget,
  widgetConfigFromElement,
  setWidgetConfig,
  renderWidgetRuntimeContent,
  persistRuntimeControlChangeForWidget,
  assetSourceRef,
}) => ({
  keyForLayout: workspaceAssetsKey,
  listAssets: (layoutKey = "builder", profile = getActivePanelProfile(layoutKey)) => loadAssets(layoutKey, profile),
  getAsset: (id, layoutKey = "builder", profile = getActivePanelProfile(layoutKey)) => assetById(layoutKey, profile, id),
  registerAsset: (asset, layoutKey = "builder", profile = getActivePanelProfile(layoutKey)) => registerAsset(layoutKey, asset, profile),
  createAssetFromUrl: (src, options = {}, layoutKey = "builder", profile = getActivePanelProfile(layoutKey)) =>
    createAssetFromSource(layoutKey, src, { ...options, sourceKind: options.sourceKind || "url" }, profile),
  createAssetFromDataUrl: (dataUrl, options = {}, layoutKey = "builder", profile = getActivePanelProfile(layoutKey)) =>
    createAssetFromSource(layoutKey, dataUrl, { ...options, sourceKind: "data-url" }, profile),
  registerAssetFromFile: async (file, options = {}, layoutKey = "builder", profile = getActivePanelProfile(layoutKey)) => {
    if (!file) return null;
    const dataUrl = await fileToDataUrl(file);
    return createAssetFromSource(layoutKey, dataUrl, {
      ...options,
      name: options.name || file.name || "Uploaded asset",
      mimeType: options.mimeType || file.type || mimeTypeFromSource(dataUrl),
      size: options.size || file.size || dataUrl.length,
      type: options.type || assetTypeFromMime(file.type || mimeTypeFromSource(dataUrl), "document"),
      sourceKind: "data-url",
    }, profile);
  },
  setWidgetAsset: (widget, assetIdValue, options = {}) => {
    const node = typeof widget === "string" ? document.querySelector(widget) : widget;
    if (!node || !isMediaWidgetDefinition(widgetDefinitionForElement(node))) return false;
    if (options.history !== false) captureRuntimeControlBaselineForWidget(node);
    const config = widgetConfigFromElement(node);
    const nextConfig = { ...config, assetId: assetIdValue || "" };
    delete nextConfig.src;
    setWidgetConfig(node, nextConfig);
    renderWidgetRuntimeContent(node);
    persistRuntimeControlChangeForWidget(node, { history: options.history !== false, invalidateQuery: false });
    return true;
  },
  sourceForAsset: assetSourceRef,
});
