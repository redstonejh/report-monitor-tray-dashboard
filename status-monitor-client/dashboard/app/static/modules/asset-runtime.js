export function createAssetRuntime({ getActivePanelProfile, readJsonStore, writeJsonStore, workspaceAssetsKey }) {
  const assetId = () => `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const mediaWidgetAssetTypes = new Set(["image", "video", "document"]);
  const mimeTypeFromSource = (source = "") => {
    const text = String(source || "");
    const dataMatch = text.match(/^data:([^;,]+)/i);
    if (dataMatch) return dataMatch[1].toLowerCase();
    const path = text.split(/[?#]/)[0].toLowerCase();
    if (path.endsWith(".svg")) return "image/svg+xml";
    if (path.endsWith(".png")) return "image/png";
    if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
    if (path.endsWith(".gif")) return "image/gif";
    if (path.endsWith(".webp")) return "image/webp";
    if (path.endsWith(".mp4")) return "video/mp4";
    if (path.endsWith(".webm")) return "video/webm";
    if (path.endsWith(".mov")) return "video/quicktime";
    if (path.endsWith(".pdf")) return "application/pdf";
    if (path.endsWith(".md") || path.endsWith(".markdown")) return "text/markdown";
    if (path.endsWith(".txt")) return "text/plain";
    if (path.endsWith(".html") || path.endsWith(".htm")) return "text/html";
    return "";
  };
  const assetTypeFromMime = (mimeType = "", fallback = "document") => {
    const mime = String(mimeType || "").toLowerCase();
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    return fallback || "document";
  };
  const assetSourceKind = (source = "") => {
    const text = String(source || "");
    if (text.startsWith("blob:")) return "blob-url";
    if (text.startsWith("data:")) return "data-url";
    if (/^https?:\/\//i.test(text) || text.startsWith("/") || text.startsWith("./") || text.startsWith("../")) return "url";
    return "reference";
  };
  const normalizeAssetRecord = (asset = {}) => {
    const source = typeof asset.source === "object" && asset.source
      ? asset.source
      : { kind: assetSourceKind(asset.src || asset.url || asset.ref || ""), ref: asset.src || asset.url || asset.ref || "" };
    const mimeType = String(asset.mimeType || mimeTypeFromSource(source.ref) || "").toLowerCase();
    const type = String(asset.type || asset.kind || assetTypeFromMime(mimeType, "document")).toLowerCase();
    return {
      id: String(asset.id || assetId()),
      name: String(asset.name || source.name || "Untitled asset"),
      type: mediaWidgetAssetTypes.has(type) ? type : "document",
      mimeType,
      size: Number(asset.size) || (source.ref ? String(source.ref).length : 0),
      createdAt: String(asset.createdAt || new Date().toISOString()),
      source: {
        kind: String(source.kind || assetSourceKind(source.ref)),
        ref: String(source.ref || ""),
      },
      thumbnailRef: asset.thumbnailRef || asset.thumbnail || "",
      previewRef: asset.previewRef || asset.preview || "",
    };
  };
  const loadAssets = (layoutKey = "builder", profile = getActivePanelProfile(layoutKey)) =>
    readJsonStore(workspaceAssetsKey(layoutKey, profile), []).map(normalizeAssetRecord).filter((asset) => asset.id);
  const saveAssets = (layoutKey = "builder", profile = getActivePanelProfile(layoutKey), assets = []) =>
    writeJsonStore(workspaceAssetsKey(layoutKey, profile), assets.map(normalizeAssetRecord).filter((asset) => asset.id));
  const assetById = (layoutKey, profile, id) => loadAssets(layoutKey, profile).find((asset) => asset.id === id) || null;
  const findAssetBySource = (layoutKey, profile, sourceRef) => {
    const ref = String(sourceRef || "");
    if (!ref) return null;
    return loadAssets(layoutKey, profile).find((asset) => asset.source?.ref === ref) || null;
  };
  const registerAsset = (layoutKey = "builder", asset = {}, profile = getActivePanelProfile(layoutKey)) => {
    const normalized = normalizeAssetRecord(asset);
    const assets = loadAssets(layoutKey, profile);
    const existingIndex = assets.findIndex((entry) => entry.id === normalized.id);
    const nextAssets = existingIndex >= 0
      ? assets.map((entry, index) => index === existingIndex ? { ...entry, ...normalized, id: entry.id } : entry)
      : [...assets, normalized];
    saveAssets(layoutKey, profile, nextAssets);
    return existingIndex >= 0 ? nextAssets[existingIndex] : normalized;
  };
  const createAssetFromSource = (layoutKey = "builder", sourceRef = "", options = {}, profile = getActivePanelProfile(layoutKey)) => {
    const ref = String(sourceRef || "").trim();
    if (!ref) return null;
    const existing = findAssetBySource(layoutKey, profile, ref);
    if (existing) return existing;
    const mimeType = options.mimeType || mimeTypeFromSource(ref);
    return registerAsset(layoutKey, {
      id: options.id || assetId(),
      name: options.name || ref.split(/[\\/]/).pop()?.split(/[?#]/)[0] || "Asset",
      type: options.type || assetTypeFromMime(mimeType, options.type || "document"),
      mimeType,
      size: options.size || ref.length,
      createdAt: options.createdAt,
      source: { kind: options.sourceKind || assetSourceKind(ref), ref },
      thumbnailRef: options.thumbnailRef || "",
      previewRef: options.previewRef || "",
    }, profile);
  };
  const assetSourceRef = (asset) => String(asset?.source?.ref || asset?.previewRef || asset?.thumbnailRef || "");
  const fileToDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
  return {
    assetId,
    mediaWidgetAssetTypes,
    mimeTypeFromSource,
    assetTypeFromMime,
    assetSourceKind,
    normalizeAssetRecord,
    loadAssets,
    saveAssets,
    assetById,
    findAssetBySource,
    registerAsset,
    createAssetFromSource,
    assetSourceRef,
    fileToDataUrl,
  };
}
