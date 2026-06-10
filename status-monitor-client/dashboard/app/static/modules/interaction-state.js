const createTimerSlot = () => {
  let timer = null;
  return {
    clear() {
      window.clearTimeout(timer);
      timer = null;
    },
    set(value) {
      window.clearTimeout(timer);
      timer = value || null;
      return timer;
    },
  };
};

export const createWidgetToolSession = () => {
  const closeTimer = createTimerSlot();
  let suppressToolOpenUntil = 0;
  let suppressWidgetClickUntil = 0;
  let suppressSettingsClickUntil = 0;

  return Object.freeze({
    clearCloseTimer: closeTimer.clear,
    getSuppressSettingsClickUntil: () => suppressSettingsClickUntil,
    getSuppressToolOpenUntil: () => suppressToolOpenUntil,
    getSuppressWidgetClickUntil: () => suppressWidgetClickUntil,
    setCloseTimer: closeTimer.set,
    setSuppressSettingsClickUntil(value) {
      suppressSettingsClickUntil = Number(value) || 0;
    },
    setSuppressToolOpenUntil(value) {
      suppressToolOpenUntil = Number(value) || 0;
    },
    setSuppressWidgetClickUntil(value) {
      suppressWidgetClickUntil = Number(value) || 0;
    },
  });
};

export const createPanelToolSession = () => {
  const toolsCloseTimer = createTimerSlot();
  let movedDuringPointer = false;
  let suppressToolOpenUntil = 0;
  let suppressHeaderToggleUntil = 0;
  let toolPointerCapture = false;

  const setMovedDuringPointer = (value) => {
    movedDuringPointer = Boolean(value);
  };
  const getMovedDuringPointer = () => movedDuringPointer;
  const setSuppressToolOpenUntil = (value) => {
    suppressToolOpenUntil = Number(value) || 0;
  };
  const getSuppressToolOpenUntil = () => suppressToolOpenUntil;
  const setSuppressHeaderToggleUntil = (value) => {
    suppressHeaderToggleUntil = Number(value) || 0;
  };
  const getSuppressHeaderToggleUntil = () => suppressHeaderToggleUntil;
  const setToolPointerCapture = (value) => {
    toolPointerCapture = Boolean(value);
  };

  return Object.freeze({
    clearToolsCloseTimer: toolsCloseTimer.clear,
    getMovedDuringPointer,
    getSuppressHeaderToggleUntil,
    getSuppressToolOpenUntil,
    setMovedDuringPointer,
    setSuppressHeaderToggleUntil,
    setSuppressToolOpenUntil,
    setToolPointerCapture,
  });
};

export const createResizeSessionGeometry = ({
  groupBox,
  initialPreviewEntries = [],
  initialReflowItems = [],
  initialRuntime = {},
  resizeParentPanelLayoutSnapshot = null,
  resizeStartSnapshot,
  startBounds,
  startHeight,
  startRects,
  startWidth,
} = {}) => {
  let previewCols = startWidth;
  let previewRows = startHeight;
  let previewEntries = initialPreviewEntries;
  let reflowItems = initialReflowItems;
  let runtime = initialRuntime;

  const previewMembers = () => previewEntries.map((entry) => entry.preview);
  const previewStartBounds = () => new Map(previewEntries.map((entry) => [entry.preview, startBounds.get(entry.member)]));
  const sourceForPreview = () => new Map(previewEntries.map((entry) => [entry.preview, entry.member]));
  const metricsForPreview = () => new Map(previewEntries.map((entry) => [entry.preview, entry.memberMetrics]));

  return Object.freeze({
    groupBox,
    resizeParentPanelLayoutSnapshot,
    resizeStartSnapshot,
    startBounds,
    startHeight,
    startRects,
    startWidth,
    getPreviewEntries: () => previewEntries,
    getPreviewCols: () => previewCols,
    getPreviewMembers: previewMembers,
    getPreviewRows: () => previewRows,
    getPreviewStartBounds: previewStartBounds,
    getReflowItems: () => reflowItems,
    getRuntime: () => runtime,
    getSourceForPreview: sourceForPreview,
    getMetricsForPreview: metricsForPreview,
    setPreviewEntries(entries) {
      previewEntries = entries || [];
    },
    setPreviewSize(cols, rows) {
      previewCols = cols;
      previewRows = rows;
    },
    setReflowItems(items) {
      reflowItems = items || [];
    },
    setRuntime(nextRuntime) {
      runtime = nextRuntime || {};
    },
  });
};
