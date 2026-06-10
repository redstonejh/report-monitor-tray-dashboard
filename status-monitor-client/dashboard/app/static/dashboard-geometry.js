(() => {
  const DEFAULT_GRID_COLUMNS = 6;
  const DEFAULT_GRID_ROW_HEIGHT = 81;

  const finiteNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };

  const positiveNumber = (value, fallback = 1) => Math.max(1, finiteNumber(value, fallback));

  const integerAtLeast = (value, minimum = 1, fallback = minimum) => (
    Math.max(minimum, Math.round(finiteNumber(value, fallback)))
  );

  const safeGridSpan = (span, columns = DEFAULT_GRID_COLUMNS) => {
    const rawSpan = finiteNumber(span, 1);
    return Math.max(1, Math.min(columns, Math.round(rawSpan > columns ? rawSpan / 2 : rawSpan)));
  };

  const gridHeightForRows = (rows, gap, rowHeight = DEFAULT_GRID_ROW_HEIGHT) => {
    const safeRows = Math.max(1, Math.round(Number(rows) || 1));
    const safeRowHeight = Math.max(1, Number(rowHeight) || DEFAULT_GRID_ROW_HEIGHT);
    return (safeRows * safeRowHeight) + (Math.max(0, safeRows - 1) * gap);
  };

  const gridRowsFromHeight = (height, gap, minRows = 1, rowHeight = DEFAULT_GRID_ROW_HEIGHT) => {
    const safeRowHeight = Math.max(1, Number(rowHeight) || DEFAULT_GRID_ROW_HEIGHT);
    const safeHeight = Math.max(1, Number(height) || safeRowHeight);
    return Math.max(minRows, Math.ceil((safeHeight + gap) / (safeRowHeight + gap)));
  };

  const rectFromPadding = (rect, padding = {}) => {
    if (!rect) return rect;
    const paddingLeft = finiteNumber(padding.paddingLeft, 0);
    const paddingRight = finiteNumber(padding.paddingRight, 0);
    const paddingTop = finiteNumber(padding.paddingTop, 0);
    const paddingBottom = finiteNumber(padding.paddingBottom, 0);
    const left = finiteNumber(rect.left, 0) + paddingLeft;
    const top = finiteNumber(rect.top, 0) + paddingTop;
    const width = Math.max(1, finiteNumber(rect.width, 1) - paddingLeft - paddingRight);
    const height = Math.max(1, finiteNumber(rect.height, 1) - paddingTop - paddingBottom);
    return {
      x: left,
      y: top,
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
    };
  };

  const gridItemPixelWidthForSpan = ({
    span,
    gap = 0,
    columnWidth,
    columns = DEFAULT_GRID_COLUMNS,
  } = {}) => {
    const safeSpan = Math.max(1, Math.min(columns, Number(span) || 1));
    return (columnWidth * safeSpan) + (gap * Math.max(0, safeSpan - 1));
  };

  const gridCellFromPoint = ({
    layoutRect,
    clientX,
    clientY,
    itemSpan = 1,
    itemRowSpan = 1,
    columnWidth,
    gap = 0,
    rowHeight = DEFAULT_GRID_ROW_HEIGHT,
    columns = DEFAULT_GRID_COLUMNS,
  } = {}) => {
    const rect = layoutRect || { left: 0, top: 0, width: 1 };
    const safeGap = finiteNumber(gap, 0);
    const safeColumnWidth = positiveNumber(columnWidth, 1);
    const safeSpan = safeGridSpan(itemSpan, columns);
    const safeRowSpan = integerAtLeast(itemRowSpan, 1, 1);
    const safeRowHeight = positiveNumber(rowHeight, DEFAULT_GRID_ROW_HEIGHT);
    const itemWidth = gridItemPixelWidthForSpan({
      span: safeSpan,
      gap: safeGap,
      columnWidth: safeColumnWidth,
      columns,
    });
    const itemHeight = gridHeightForRows(safeRowSpan, safeGap, safeRowHeight);
    const col = Math.round((finiteNumber(clientX, rect.left) - rect.left - (itemWidth / 2)) / (safeColumnWidth + safeGap)) + 1;
    const row = Math.round((finiteNumber(clientY, rect.top) - rect.top - (itemHeight / 2)) / (safeRowHeight + safeGap)) + 1;
    return {
      col: Math.max(1, Math.min(columns - safeSpan + 1, col)),
      row: Math.max(1, row),
    };
  };

  const gridCellFromDragPointer = ({
    layoutRect,
    clientX,
    clientY,
    offsetX,
    offsetY,
    sourceWidth,
    sourceHeight,
    itemSpan = 1,
    itemRowSpan = 1,
    columnWidth,
    gap = 0,
    rowHeight = DEFAULT_GRID_ROW_HEIGHT,
    columns = DEFAULT_GRID_COLUMNS,
  } = {}) => {
    if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
      return gridCellFromPoint({
        layoutRect,
        clientX,
        clientY,
        itemSpan,
        itemRowSpan,
        columnWidth,
        gap,
        rowHeight,
        columns,
      });
    }
    const safeGap = finiteNumber(gap, 0);
    const safeColumnWidth = positiveNumber(columnWidth, 1);
    const safeSpan = safeGridSpan(itemSpan, columns);
    const safeRowSpan = integerAtLeast(itemRowSpan, 1, 1);
    const safeRowHeight = positiveNumber(rowHeight, DEFAULT_GRID_ROW_HEIGHT);
    const itemWidth = gridItemPixelWidthForSpan({
      span: safeSpan,
      gap: safeGap,
      columnWidth: safeColumnWidth,
      columns,
    });
    const itemHeight = gridHeightForRows(safeRowSpan, safeGap, safeRowHeight);
    const safeSourceWidth = Math.max(1, sourceWidth || itemWidth);
    const safeSourceHeight = Math.max(1, sourceHeight || itemHeight);
    const localOffsetX = Math.max(0, Math.min(1, offsetX / safeSourceWidth)) * itemWidth;
    const localOffsetY = Math.max(0, Math.min(1, offsetY / safeSourceHeight)) * itemHeight;
    return gridCellFromPoint({
      layoutRect,
      clientX: (finiteNumber(clientX, 0) - localOffsetX) + (itemWidth / 2),
      clientY: (finiteNumber(clientY, 0) - localOffsetY) + (itemHeight / 2),
      itemSpan: safeSpan,
      itemRowSpan: safeRowSpan,
      columnWidth: safeColumnWidth,
      gap: safeGap,
      rowHeight: safeRowHeight,
      columns,
    });
  };

  const boundsAtGridSlot = ({
    col,
    row,
    span,
    rowSpan,
    columns = DEFAULT_GRID_COLUMNS,
  } = {}) => {
    const safeSpan = Math.max(1, Math.min(columns, Math.round(finiteNumber(span, 1))));
    const safeRowSpan = integerAtLeast(rowSpan, 1, 1);
    const safeCol = Math.max(1, Math.min(columns - safeSpan + 1, Math.round(finiteNumber(col, 1))));
    const safeRow = integerAtLeast(row, 1, 1);
    return {
      col: safeCol,
      row: safeRow,
      span: safeSpan,
      rowSpan: safeRowSpan,
      right: safeCol + safeSpan - 1,
      bottom: safeRow + safeRowSpan - 1,
    };
  };

  const gridBoundsOverlap = (a, b) => Boolean(
    a &&
    b &&
    a.col <= b.right &&
    a.right >= b.col &&
    a.row <= b.bottom &&
    a.bottom >= b.row
  );

  const gridBoundsShareColumns = (a, b) => Boolean(a && b && a.col <= b.right && a.right >= b.col);

  const boundsAtRow = (bounds, row) => {
    return {
      ...bounds,
      row,
      bottom: row + bounds.rowSpan - 1,
    };
  };

  const canPlaceBounds = (bounds, occupied = [], { columns = DEFAULT_GRID_COLUMNS } = {}) => {
    if (!bounds || bounds.col < 1 || bounds.right > columns) return false;
    return !(occupied || []).some((entry) => gridBoundsOverlap(bounds, entry?.bounds || entry));
  };

  const localVacancyCandidates = ({
    vacancy,
    span,
    rowSpan,
    columns = DEFAULT_GRID_COLUMNS,
  } = {}) => {
    if (!vacancy) return [];
    const itemBounds = boundsAtGridSlot({
      col: vacancy.col,
      row: vacancy.row,
      span,
      rowSpan,
      columns,
    });
    const maxCol = Math.min(columns - itemBounds.span + 1, vacancy.right - itemBounds.span + 1);
    const maxRow = Math.max(vacancy.row, vacancy.bottom - itemBounds.rowSpan + 1);
    const candidates = [];
    for (let row = vacancy.row; row <= maxRow; row += 1) {
      for (let col = vacancy.col; col <= maxCol; col += 1) {
        candidates.push(boundsAtGridSlot({
          col,
          row,
          span: itemBounds.span,
          rowSpan: itemBounds.rowSpan,
          columns,
        }));
      }
    }
    return candidates;
  };

  const pointInRect = (clientX, clientY, rect) => (
    rect &&
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );

  const expandRect = (rect, tolerance = 0) => rect
    ? {
      left: rect.left - tolerance,
      right: rect.right + tolerance,
      top: rect.top - tolerance,
      bottom: rect.bottom + tolerance,
    }
    : null;

  const resizeEdgeFromRect = ({ clientX, rect, threshold = 10 } = {}) => {
    if (!rect) return null;
    if (clientX <= rect.left + threshold) return "left";
    if (clientX >= rect.right - threshold) return "right";
    return null;
  };

  const groupGridBox = (boundsList) => ({
    col: Math.min(...boundsList.map((bounds) => bounds.col)),
    row: Math.min(...boundsList.map((bounds) => bounds.row)),
    right: Math.max(...boundsList.map((bounds) => bounds.right)),
    bottom: Math.max(...boundsList.map((bounds) => bounds.bottom)),
  });

  const groupBoxBounds = (groupBox, col = groupBox.col, row = groupBox.row) => ({
    col,
    row,
    span: Math.max(1, groupBox.right - groupBox.col + 1),
    rowSpan: Math.max(1, groupBox.bottom - groupBox.row + 1),
  });

  window.dashboardGeometry = Object.freeze({
    boundsAtGridSlot,
    boundsAtRow,
    canPlaceBounds,
    expandRect,
    gridBoundsOverlap,
    gridBoundsShareColumns,
    gridCellFromDragPointer,
    gridCellFromPoint,
    gridHeightForRows,
    gridItemPixelWidthForSpan,
    gridRowsFromHeight,
    groupBoxBounds,
    groupGridBox,
    localVacancyCandidates,
    pointInRect,
    rectFromPadding,
    resizeEdgeFromRect,
  });
})();
