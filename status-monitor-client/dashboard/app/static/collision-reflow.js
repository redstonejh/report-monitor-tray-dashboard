(() => {
  const DEFAULT_COLUMNS = 6;
  const SPATIAL_INDEX_MIN_ENTRIES = 18;
  const geometry = window.dashboardGeometry;
  const occupancyIndexCache = new WeakMap();

  const indexedCollisionEntries = (bounds, occupied) => {
    if (!Array.isArray(occupied) || occupied.length < SPATIAL_INDEX_MIN_ENTRIES) return occupied || [];
    const cached = occupancyIndexCache.get(occupied);
    let index = cached?.length === occupied.length ? cached : null;
    if (!index) {
      const rowBuckets = new Map();
      occupied.forEach((entry) => {
        if (!entry?.bounds) return;
        for (let row = entry.bounds.row; row <= entry.bounds.bottom; row += 1) {
          if (!rowBuckets.has(row)) rowBuckets.set(row, []);
          rowBuckets.get(row).push(entry);
        }
      });
      index = { length: occupied.length, rowBuckets };
      occupancyIndexCache.set(occupied, index);
    }
    const candidates = [];
    const seen = new Set();
    for (let row = bounds.row; row <= bounds.bottom; row += 1) {
      (index.rowBuckets.get(row) || []).forEach((entry) => {
        if (seen.has(entry)) return;
        seen.add(entry);
        candidates.push(entry);
      });
    }
    return candidates;
  };

  const createRuntime = (deps = {}) => {
    const columns = deps.columns || DEFAULT_COLUMNS;
    const canPlaceBounds = (bounds, occupied) => geometry.canPlaceBounds(
      bounds,
      indexedCollisionEntries(bounds, occupied),
      { columns }
    );
    const boundsAtGridSlot = (item, col, row, metrics = null) => deps.boundsAtGridSlot(item, col, row, metrics);
    const gridBoundsForItem = (item, metrics = null) => deps.gridBoundsForItem(item, metrics);
    const applyGridItemPosition = (item, col, row) => deps.applyGridItemPosition(item, col, row);
    const gridItemSpan = (item) => deps.gridItemSpan(item);
    const gridItemRowSpan = (item, metrics = null) => deps.gridItemRowSpan(item, metrics);
    const gridHostForLayout = (layout) => deps.gridHostForLayout(layout);
    const globalGridItems = (layout, options = {}) => deps.globalGridItems(layout, options);
    const visualGridOrder = (items, metrics = null) => deps.visualGridOrder(items, metrics);
    const viewportRowFloorForLayout = (layout, metrics = null) => deps.viewportRowFloorForLayout?.(layout, metrics) || null;
    const rowLimitForOptions = (layout, metrics = null, options = {}) => {
      if (Number.isFinite(options.rowLimit) && options.rowLimit > 0) return options.rowLimit;
      return options.enforceViewportFloor === false ? null : viewportRowFloorForLayout(layout, metrics);
    };

    const boundsWithinRowFloor = (bounds, rowFloor = null) => (
      !Number.isFinite(rowFloor) || rowFloor < 1 || bounds.bottom <= rowFloor
    );

    const canPlaceWithinFloor = (bounds, occupied, rowFloor = null) => (
      boundsWithinRowFloor(bounds, rowFloor) && canPlaceBounds(bounds, occupied)
    );

    const clampBoundsToRowFloor = (bounds, rowFloor = null) => {
      if (!bounds || !Number.isFinite(rowFloor) || rowFloor < 1 || bounds.bottom <= rowFloor) return bounds;
      const maxRow = Math.max(1, Math.round(rowFloor) - Math.max(1, Math.round(bounds.rowSpan || 1)) + 1);
      return geometry.boundsAtRow(bounds, maxRow);
    };

    const nearestSparseSlot = (item, preferred, occupied, rowLimit = null, metrics = null) => {
      const base = boundsAtGridSlot(item, preferred?.col || 1, preferred?.row || 1, metrics);
      const maxCol = columns - base.span + 1;
      const hardLimit = Number.isFinite(rowLimit) && rowLimit > 0 ? rowLimit : null;
      const maxOccupiedRow = occupied.reduce((max, entry) => Math.max(max, entry.bounds.bottom), base.row);
      const limit = hardLimit || Math.max(base.row + 48, maxOccupiedRow + 24);
      let best = null;
      for (let row = 1; row <= limit; row += 1) {
        for (let col = 1; col <= maxCol; col += 1) {
          const candidate = boundsAtGridSlot(item, col, row, metrics);
          if (!canPlaceWithinFloor(candidate, occupied, hardLimit)) continue;
          const upwardPenalty = row < base.row ? .65 : 0;
          const leftPenalty = row === base.row && col < base.col ? .15 : 0;
          const score = (Math.abs(row - base.row) * columns) + Math.abs(col - base.col) + upwardPenalty + leftPenalty;
          if (!best || score < best.score || (score === best.score && row < best.bounds.row) || (score === best.score && row === best.bounds.row && col < best.bounds.col)) {
            best = { bounds: candidate, score };
          }
        }
      }
      return best?.bounds || null;
    };

    const nearestSparseSlotAtOrAfter = (item, preferred, occupied, rowLimit = null, metrics = null) => {
      const base = boundsAtGridSlot(item, preferred?.col || 1, preferred?.row || 1, metrics);
      const maxCol = columns - base.span + 1;
      const hardLimit = Number.isFinite(rowLimit) && rowLimit > 0 ? rowLimit : null;
      const maxOccupiedRow = occupied.reduce((max, entry) => Math.max(max, entry.bounds.bottom), base.row);
      const limit = hardLimit || Math.max(base.row + 80, maxOccupiedRow + 40);
      for (let row = base.row; row <= limit; row += 1) {
        const startCol = row === base.row ? base.col : 1;
        for (let col = startCol; col <= maxCol; col += 1) {
          const candidate = boundsAtGridSlot(item, col, row, metrics);
          if (canPlaceWithinFloor(candidate, occupied, hardLimit)) return candidate;
        }
      }
      return nearestSparseSlot(item, base, occupied, hardLimit, metrics);
    };

    const localVacancyCandidates = (item, vacancy, metrics = null) => {
      if (!vacancy) return [];
      const itemBounds = boundsAtGridSlot(item, vacancy.col, vacancy.row, metrics);
      return geometry.localVacancyCandidates({
        vacancy,
        span: itemBounds.span,
        rowSpan: itemBounds.rowSpan,
        columns,
      });
    };

    const canPlaceLocalDisplacementBounds = (bounds, occupied, reserved = []) => (
      canPlaceBounds(bounds, occupied) && canPlaceBounds(bounds, reserved)
    );

    const localBelowDisplacementSlot = (item, base, occupied, reserved = [], metrics = null, rowLimit = null) => {
      const conflicts = indexedCollisionEntries(base, occupied)
        .map((entry) => entry?.bounds)
        .filter((bounds) => bounds && geometry.gridBoundsOverlap(base, bounds));
      const candidateRows = [
        base.row + 1,
        ...conflicts.map((bounds) => bounds.bottom + 1),
      ]
        .filter((row) => Number.isFinite(row) && row > base.row)
        .sort((a, b) => a - b)
        .filter((row, index, rows) => index === 0 || row !== rows[index - 1]);
      for (const row of candidateRows) {
        const candidate = boundsAtGridSlot(item, base.col, row, metrics);
        if (boundsWithinRowFloor(candidate, rowLimit) && canPlaceLocalDisplacementBounds(candidate, occupied, reserved)) return candidate;
      }
      return null;
    };

    const localLeftDisplacementSlot = (item, base, occupied, localVacancy = null, reserved = [], metrics = null, rowLimit = null) => {
      const explicitPrevious = base.col > 1
        ? boundsAtGridSlot(item, base.col - 1, base.row, metrics)
        : null;
      const leftVacancyCandidates = localVacancyCandidates(item, localVacancy, metrics)
        .filter((candidate) => candidate.row === base.row && candidate.col < base.col)
        .sort((a, b) => (
          Math.abs(a.col - base.col) - Math.abs(b.col - base.col) ||
          b.col - a.col
        ));
      return [explicitPrevious, ...leftVacancyCandidates]
        .filter((candidate) => candidate && boundsWithinRowFloor(candidate, rowLimit) && canPlaceLocalDisplacementBounds(candidate, occupied, reserved))[0] || null;
    };

    const verticalSlotAtOrAfter = (item, preferred, occupied, rowLimit = null, metrics = null) => {
      const base = boundsAtGridSlot(item, preferred?.col || 1, preferred?.row || 1, metrics);
      const hardLimit = Number.isFinite(rowLimit) && rowLimit > 0 ? rowLimit : null;
      const maxOccupiedRow = occupied.reduce((max, entry) => Math.max(max, entry.bounds.bottom), base.row);
      const limit = hardLimit || Math.max(base.row + 80, maxOccupiedRow + 40);
      for (let row = base.row; row <= limit; row += 1) {
        const candidate = boundsAtGridSlot(item, base.col, row, metrics);
        if (canPlaceWithinFloor(candidate, occupied, hardLimit)) return candidate;
      }
      return null;
    };

    const nearestLocalDisplacementSlot = (item, preferred, occupied, options = {}) => {
      const metrics = options.metrics || null;
      const base = boundsAtGridSlot(item, preferred?.col || 1, preferred?.row || 1, metrics);
      const reserved = options.reserved || [];
      const rowLimit = Number.isFinite(options.rowLimit) && options.rowLimit > 0 ? options.rowLimit : null;
      const left = localLeftDisplacementSlot(item, base, occupied, options.localVacancy, reserved, metrics, rowLimit);
      if (left) return left;
      const below = localBelowDisplacementSlot(item, base, occupied, reserved, metrics, rowLimit);
      if (below) return below;
      const fallback = options.fallback || nearestSparseSlotAtOrAfter(item, base, occupied, rowLimit, metrics);
      return fallback && canPlaceWithinFloor(fallback, occupied, rowLimit)
        ? fallback
        : nearestSparseSlotAtOrAfter(item, base, occupied, rowLimit, metrics);
    };

    const firstVerticalOpenRow = (bounds, occupied) => {
      let nextBounds = { ...bounds };
      for (let attempts = 0; attempts < 120; attempts += 1) {
        const conflicts = indexedCollisionEntries(nextBounds, occupied).filter((entry) => (
          geometry.gridBoundsShareColumns(nextBounds, entry.bounds) &&
          geometry.gridBoundsOverlap(nextBounds, entry.bounds)
        ));
        if (!conflicts.length) return nextBounds;
        const nextRow = Math.max(nextBounds.row, ...conflicts.map((entry) => entry.bounds.bottom + 1));
        nextBounds = geometry.boundsAtRow(nextBounds, nextRow);
      }
      return nextBounds;
    };

    const applyVerticalPanelExpansion = (layout, panel) => {
      if (!panel?.isConnected) return;
      deps.ensureRenderedGridPosition(layout, panel);
      const items = globalGridItems(layout, { includePlaceholders: false, exclude: [panel] });
      const movableItems = visualGridOrder(items);
      const occupied = [{ item: panel, bounds: gridBoundsForItem(panel) }];
      movableItems.forEach((item) => {
        const current = gridBoundsForItem(item);
        const next = firstVerticalOpenRow(current, occupied);
        if (next.row !== current.row) applyGridItemPosition(item, current.col, next.row);
        occupied.push({ item, bounds: next });
      });
    };

    const createGridGeometryRecords = (items, metrics = null) => {
      const records = new Map();
      items.forEach((item) => {
        if (!item?.isConnected || records.has(item)) return;
        records.set(item, { item, bounds: gridBoundsForItem(item, metrics) });
      });
      return records;
    };
    const gridGeometryEntry = (item, records, metrics = null) => {
      if (!item?.isConnected) return null;
      if (!records.has(item)) records.set(item, { item, bounds: gridBoundsForItem(item, metrics) });
      return records.get(item);
    };
    const gridGeometryEntriesForItems = (items, records, metrics = null, exclude = []) => {
      const excluded = new Set([].concat(exclude || []).filter(Boolean));
      return items
        .filter((item) => item?.isConnected && !excluded.has(item))
        .map((item) => gridGeometryEntry(item, records, metrics))
        .filter(Boolean);
    };

    const resolveSparseGridLayout = (layout, activeItem = null, preferredTarget = null, options = {}) => {
      const metrics = options.metrics || null;
      const localVacancy = options.localVacancy || null;
      const rowLimit = rowLimitForOptions(layout, metrics, options);
      const items = deps.layoutItemsForLogicalResolution(layout, {
        includePlaceholders: true,
        items: options.items,
      });
      if (activeItem?.isConnected && !items.includes(activeItem)) items.push(activeItem);
      const records = createGridGeometryRecords(items, metrics);
      const placements = new Map();
      const occupied = [];
      const pinned = items.filter((item) => item !== activeItem && item.classList.contains("db-panel-pinned"));
      pinned.forEach((item) => {
        const bounds = gridGeometryEntry(item, records, metrics).bounds;
        placements.set(item, bounds);
        occupied.push({ item, bounds });
      });

      if (activeItem?.isConnected) {
        const target = preferredTarget || gridGeometryEntry(activeItem, records, metrics).bounds;
        let activeBounds = clampBoundsToRowFloor(boundsAtGridSlot(activeItem, target.col, target.row, metrics), rowLimit);
        if (!canPlaceWithinFloor(activeBounds, occupied, rowLimit)) {
          activeBounds = options.afterOnly
            ? nearestSparseSlotAtOrAfter(activeItem, activeBounds, occupied, rowLimit, metrics)
            : nearestSparseSlot(activeItem, activeBounds, occupied, rowLimit, metrics);
        }
        if (!activeBounds) activeBounds = gridGeometryEntry(activeItem, records, metrics).bounds;
        placements.set(activeItem, activeBounds);
        occupied.push({ item: activeItem, bounds: activeBounds });
      }

      visualGridOrder(items, metrics)
        .filter((item) => item !== activeItem && !item.classList.contains("db-panel-pinned"))
        .forEach((item) => {
          const current = gridGeometryEntry(item, records, metrics).bounds;
          const reserved = gridGeometryEntriesForItems(
            items.filter((other) => other !== activeItem && other !== item),
            records,
            metrics
          );
          const verticalFallback = options.verticalDisplacement
            ? verticalSlotAtOrAfter(item, current, occupied, rowLimit, metrics) || nearestSparseSlotAtOrAfter(item, current, occupied, rowLimit, metrics)
            : null;
          const bounds = canPlaceWithinFloor(current, occupied, rowLimit)
            ? current
            : options.afterOnly
              ? nearestLocalDisplacementSlot(item, current, occupied, { localVacancy, metrics, reserved, fallback: verticalFallback, rowLimit })
              : nearestSparseSlot(item, current, occupied, rowLimit, metrics);
          if (!bounds) return;
          placements.set(item, bounds);
          occupied.push({ item, bounds });
        });

      placements.forEach((bounds, item) => applyGridItemPosition(item, bounds.col, bounds.row));
      return placements;
    };

    const resolveSparseGridLayoutForActiveItems = (layout, activeItems = [], options = {}) => {
      const metrics = options.metrics || null;
      const rowLimit = rowLimitForOptions(layout, metrics, options);
      const activeList = visualGridOrder([].concat(activeItems || []).filter((item) => item?.isConnected), metrics);
      if (!activeList.length) return new Map();
      const activeSet = new Set(activeList);
      const excluded = new Set([].concat(options.exclude || []).filter(Boolean));
      const items = deps.layoutItemsForLogicalResolution(layout, {
        includePlaceholders: true,
        items: options.items,
        exclude: [...excluded, ...activeList],
      });
      const allItems = [...activeList, ...items];
      const records = createGridGeometryRecords(allItems, metrics);
      const placements = new Map();
      const occupied = [];
      items
        .filter((item) => item.classList.contains("db-panel-pinned"))
        .forEach((item) => {
          const bounds = gridGeometryEntry(item, records, metrics).bounds;
          placements.set(item, bounds);
          occupied.push({ item, bounds });
        });

      activeList.forEach((item) => {
        const target = gridGeometryEntry(item, records, metrics).bounds;
        let bounds = clampBoundsToRowFloor(boundsAtGridSlot(item, target.col, target.row, metrics), rowLimit);
        if (!canPlaceWithinFloor(bounds, occupied, rowLimit)) {
          bounds = options.afterOnly
            ? nearestSparseSlotAtOrAfter(item, bounds, occupied, rowLimit, metrics)
            : nearestSparseSlot(item, bounds, occupied, rowLimit, metrics);
        }
        if (!bounds) bounds = gridGeometryEntry(item, records, metrics).bounds;
        placements.set(item, bounds);
        occupied.push({ item, bounds });
      });

      visualGridOrder(items, metrics)
        .filter((item) => !activeSet.has(item) && !item.classList.contains("db-panel-pinned"))
        .forEach((item) => {
          const current = gridGeometryEntry(item, records, metrics).bounds;
          const reserved = gridGeometryEntriesForItems(
            allItems.filter((other) => other !== item && !excluded.has(other)),
            records,
            metrics
          );
          const bounds = canPlaceWithinFloor(current, occupied, rowLimit)
            ? current
            : options.afterOnly
              ? nearestLocalDisplacementSlot(item, current, occupied, {
                metrics,
                reserved,
                rowLimit,
                fallback: verticalSlotAtOrAfter(item, current, occupied, rowLimit, metrics) || nearestSparseSlotAtOrAfter(item, current, occupied, rowLimit, metrics),
              })
              : nearestSparseSlot(item, current, occupied, rowLimit, metrics);
          if (!bounds) return;
          placements.set(item, bounds);
          occupied.push({ item, bounds });
        });

      placements.forEach((bounds, item) => applyGridItemPosition(item, bounds.col, bounds.row));
      return placements;
    };

    const resolveActiveDropSlot = (layout, item, preferredTarget) => {
      const rowLimit = viewportRowFloorForLayout(layout);
      const occupied = globalGridItems(layout, { includePlaceholders: false, exclude: [item] })
        .map((other) => ({ item: other, bounds: gridBoundsForItem(other) }));
      const target = preferredTarget || gridBoundsForItem(item);
      let bounds = clampBoundsToRowFloor(boundsAtGridSlot(item, target.col, target.row), rowLimit);
      if (!canPlaceWithinFloor(bounds, occupied, rowLimit)) bounds = nearestSparseSlotAtOrAfter(item, bounds, occupied, rowLimit);
      return bounds || gridBoundsForItem(item);
    };

    const commitActiveDropSlot = (layout, item, preferredTarget, options = {}) => {
      const localVacancy = options.localVacancy || null;
      const metrics = options.metrics || null;
      const rowLimit = rowLimitForOptions(layout, metrics, options);
      const fallbackToNearestOpenSlot = Boolean(options.fallbackToNearestOpenSlot);
      const originalActiveBounds = gridBoundsForItem(item, metrics);
      const target = preferredTarget || gridBoundsForItem(item);
      let activeBounds = clampBoundsToRowFloor(boundsAtGridSlot(item, target.col, target.row, metrics), rowLimit);
      if (!boundsWithinRowFloor(activeBounds, rowLimit)) activeBounds = nearestSparseSlotAtOrAfter(item, activeBounds, [], rowLimit, metrics) || originalActiveBounds;
      const items = globalGridItems(layout, { includePlaceholders: false, exclude: [item] });
      const pinned = items
        .filter((other) => other.classList.contains("db-panel-pinned"))
        .map((other) => ({ item: other, bounds: gridBoundsForItem(other, metrics) }));

      if (!canPlaceWithinFloor(activeBounds, pinned, rowLimit)) {
        activeBounds = nearestSparseSlotAtOrAfter(item, activeBounds, pinned, rowLimit, metrics) || originalActiveBounds;
        applyGridItemPosition(item, activeBounds.col, activeBounds.row);
        return { bounds: activeBounds, movedItems: 0 };
      }

      const movableItems = items.filter((other) => !other.classList.contains("db-panel-pinned"));
      const targetCollides = movableItems.some((other) => geometry.gridBoundsOverlap(activeBounds, gridBoundsForItem(other, metrics)));
      if (!targetCollides) {
        applyGridItemPosition(item, activeBounds.col, activeBounds.row);
        return { bounds: activeBounds, movedItems: 0 };
      }

      const occupied = [...pinned, { item, bounds: activeBounds }];
      applyGridItemPosition(item, activeBounds.col, activeBounds.row);
      let movedItems = 0;
      const movedOriginals = new Map();
      let rejected = false;
      visualGridOrder(movableItems).forEach((other) => {
        if (rejected) return;
        const current = gridBoundsForItem(other, metrics);
        const reserved = items
          .filter((item) => item !== other)
          .map((item) => ({ item, bounds: gridBoundsForItem(item, metrics) }));
        const next = canPlaceWithinFloor(current, occupied, rowLimit)
          ? current
          : nearestLocalDisplacementSlot(other, current, occupied, {
            localVacancy,
            reserved,
            rowLimit,
            metrics,
            fallback: nearestSparseSlotAtOrAfter(other, current, occupied, rowLimit, metrics),
          });
        if (!next) {
          rejected = true;
          return;
        }
        if (next.col !== current.col || next.row !== current.row) movedItems += 1;
        movedOriginals.set(other, current);
        applyGridItemPosition(other, next.col, next.row);
        occupied.push({ item: other, bounds: next });
      });
      if (rejected) {
        movedOriginals.forEach((bounds, movedItem) => applyGridItemPosition(movedItem, bounds.col, bounds.row));
        if (fallbackToNearestOpenSlot) {
          const occupiedByOthers = items.map((other) => ({ item: other, bounds: gridBoundsForItem(other, metrics) }));
          const fallbackBounds = nearestSparseSlotAtOrAfter(item, activeBounds, occupiedByOthers, rowLimit, metrics) ||
            nearestSparseSlot(item, activeBounds, occupiedByOthers, rowLimit, metrics);
          if (fallbackBounds) {
            applyGridItemPosition(item, fallbackBounds.col, fallbackBounds.row);
            return { bounds: fallbackBounds, movedItems: 0, fallback: true };
          }
        }
        applyGridItemPosition(item, originalActiveBounds.col, originalActiveBounds.row);
        return { bounds: originalActiveBounds, movedItems: 0 };
      }
      if (Number.isFinite(rowLimit) && occupied.some((entry) => !boundsWithinRowFloor(entry.bounds, rowLimit))) {
        movedOriginals.forEach((bounds, movedItem) => applyGridItemPosition(movedItem, bounds.col, bounds.row));
        if (fallbackToNearestOpenSlot) {
          const occupiedByOthers = items.map((other) => ({ item: other, bounds: gridBoundsForItem(other, metrics) }));
          const fallbackBounds = nearestSparseSlotAtOrAfter(item, activeBounds, occupiedByOthers, rowLimit, metrics) ||
            nearestSparseSlot(item, activeBounds, occupiedByOthers, rowLimit, metrics);
          if (fallbackBounds) {
            applyGridItemPosition(item, fallbackBounds.col, fallbackBounds.row);
            return { bounds: fallbackBounds, movedItems: 0, fallback: true };
          }
        }
        applyGridItemPosition(item, originalActiveBounds.col, originalActiveBounds.row);
        return { bounds: originalActiveBounds, movedItems: 0 };
      }
      return { bounds: activeBounds, movedItems };
    };

    const commitExpandedPanelDropSlot = (layout, item, preferredTarget, options = {}) => {
      const localVacancy = options.localVacancy || null;
      const rowLimit = rowLimitForOptions(layout, null, options);
      const originalActiveBounds = gridBoundsForItem(item);
      const target = preferredTarget || gridBoundsForItem(item);
      let activeBounds = clampBoundsToRowFloor(boundsAtGridSlot(item, target.col, target.row), rowLimit);
      if (!boundsWithinRowFloor(activeBounds, rowLimit)) activeBounds = nearestSparseSlotAtOrAfter(item, activeBounds, [], rowLimit) || originalActiveBounds;
      const items = globalGridItems(layout, { includePlaceholders: false, exclude: [item] });
      const pinned = items
        .filter((other) => other.classList.contains("db-panel-pinned"))
        .map((other) => ({ item: other, bounds: gridBoundsForItem(other) }));
      if (!canPlaceWithinFloor(activeBounds, pinned, rowLimit)) activeBounds = nearestSparseSlotAtOrAfter(item, activeBounds, pinned, rowLimit) || originalActiveBounds;
      applyGridItemPosition(item, activeBounds.col, activeBounds.row);
      const occupied = [...pinned, { item, bounds: activeBounds }];
      let movedItems = 0;
      const movedOriginals = new Map();
      let rejected = false;
      visualGridOrder(items.filter((other) => !other.classList.contains("db-panel-pinned"))).forEach((other) => {
        if (rejected) return;
        const current = gridBoundsForItem(other);
        const reserved = items
          .filter((item) => item !== other)
          .map((item) => ({ item, bounds: gridBoundsForItem(item) }));
        const next = canPlaceWithinFloor(current, occupied, rowLimit)
          ? current
          : nearestLocalDisplacementSlot(other, current, occupied, {
            localVacancy,
            reserved,
            rowLimit,
            fallback: verticalSlotAtOrAfter(other, current, occupied, rowLimit) || nearestSparseSlotAtOrAfter(other, current, occupied, rowLimit),
          });
        if (!next) {
          rejected = true;
          return;
        }
        if (next.col !== current.col || next.row !== current.row) movedItems += 1;
        movedOriginals.set(other, current);
        applyGridItemPosition(other, next.col, next.row);
        occupied.push({ item: other, bounds: next });
      });
      if (rejected) {
        movedOriginals.forEach((bounds, movedItem) => applyGridItemPosition(movedItem, bounds.col, bounds.row));
        applyGridItemPosition(item, originalActiveBounds.col, originalActiveBounds.row);
        return { bounds: originalActiveBounds, movedItems: 0 };
      }
      if (Number.isFinite(rowLimit) && occupied.some((entry) => !boundsWithinRowFloor(entry.bounds, rowLimit))) {
        movedOriginals.forEach((bounds, movedItem) => applyGridItemPosition(movedItem, bounds.col, bounds.row));
        applyGridItemPosition(item, originalActiveBounds.col, originalActiveBounds.row);
        return { bounds: originalActiveBounds, movedItems: 0 };
      }
      return { bounds: activeBounds, movedItems };
    };

    const commitInsertedGridItemWithVerticalPushdown = (layout, item, preferredTarget = null) => {
      const allItems = globalGridItems(layout, { includePlaceholders: false, exclude: [item] });
      const pinnedItems = allItems.filter((other) => other.classList.contains("db-panel-pinned"));
      let fixedEntries = allItems.map((other) => ({ item: other, bounds: gridBoundsForItem(other) }));
      const pinnedEntries = fixedEntries.filter((entry) => pinnedItems.includes(entry.item));
      const target = preferredTarget || gridBoundsForItem(item);
      let activeBounds = boundsAtGridSlot(item, target.col, target.row);
      if (!canPlaceBounds(activeBounds, pinnedEntries)) activeBounds = nearestSparseSlotAtOrAfter(item, activeBounds, pinnedEntries);
      applyGridItemPosition(item, activeBounds.col, activeBounds.row);

      let movedItems = 0;
      const movedEntries = [];
      visualGridOrder(allItems.filter((other) => !pinnedItems.includes(other))).forEach((other) => {
        const currentEntry = fixedEntries.find((entry) => entry.item === other);
        if (!currentEntry || !geometry.gridBoundsOverlap(activeBounds, currentEntry.bounds)) return;
        fixedEntries = fixedEntries.filter((entry) => entry.item !== other);
        const occupied = [{ item, bounds: activeBounds }, ...fixedEntries, ...movedEntries];
        const next = verticalSlotAtOrAfter(other, currentEntry.bounds, occupied) ||
          nearestSparseSlotAtOrAfter(other, currentEntry.bounds, occupied);
        if (next.col !== currentEntry.bounds.col || next.row !== currentEntry.bounds.row) movedItems += 1;
        applyGridItemPosition(other, next.col, next.row);
        movedEntries.push({ item: other, bounds: next });
      });
      return { bounds: activeBounds, movedItems };
    };

    const groupEntriesFit = (entries, deltaCol, deltaRow, occupied) => {
      const nextBounds = entries.map((entry) => {
        const col = entry.startBounds.col + deltaCol;
        const row = entry.startBounds.row + deltaRow;
        return {
          item: entry.item,
          bounds: {
            ...entry.startBounds,
            col,
            row,
            right: col + entry.startBounds.span - 1,
            bottom: row + entry.startBounds.rowSpan - 1,
          },
        };
      });
      return nextBounds.every(({ bounds }) => bounds.col >= 1 && bounds.row >= 1 && bounds.right <= columns) &&
        nextBounds.every(({ bounds }, index) => (
          !occupied.some((entry) => geometry.gridBoundsOverlap(bounds, entry.bounds)) &&
          !nextBounds.slice(index + 1).some((other) => geometry.gridBoundsOverlap(bounds, other.bounds))
        ));
    };

    const clampGroupDelta = (entries, deltaCol, deltaRow) => {
      const minCol = Math.min(...entries.map((entry) => entry.startBounds.col));
      const maxRight = Math.max(...entries.map((entry) => entry.startBounds.right));
      const minRow = Math.min(...entries.map((entry) => entry.startBounds.row));
      const minDeltaCol = 1 - minCol;
      const maxDeltaCol = columns - maxRight;
      const minDeltaRow = 1 - minRow;
      return {
        deltaCol: Math.max(minDeltaCol, Math.min(maxDeltaCol, Math.round(deltaCol))),
        deltaRow: Math.max(minDeltaRow, Math.round(deltaRow)),
      };
    };

    const findGroupDelta = (entries, preferredDelta, occupied) => {
      const preferred = clampGroupDelta(entries, preferredDelta.deltaCol, preferredDelta.deltaRow);
      if (groupEntriesFit(entries, preferred.deltaCol, preferred.deltaRow, occupied)) return preferred;
      let best = null;
      const maxRadius = 24;
      for (let radius = 1; radius <= maxRadius; radius += 1) {
        for (let rowDelta = preferred.deltaRow - radius; rowDelta <= preferred.deltaRow + radius; rowDelta += 1) {
          for (let colDelta = preferred.deltaCol - radius; colDelta <= preferred.deltaCol + radius; colDelta += 1) {
            if (Math.abs(rowDelta - preferred.deltaRow) !== radius && Math.abs(colDelta - preferred.deltaCol) !== radius) continue;
            const candidate = clampGroupDelta(entries, colDelta, rowDelta);
            if (!groupEntriesFit(entries, candidate.deltaCol, candidate.deltaRow, occupied)) continue;
            const upwardPenalty = candidate.deltaRow < preferred.deltaRow ? .7 : 0;
            const leftPenalty = candidate.deltaRow === preferred.deltaRow && candidate.deltaCol < preferred.deltaCol ? .2 : 0;
            const score = (Math.abs(candidate.deltaRow - preferred.deltaRow) * columns) +
              Math.abs(candidate.deltaCol - preferred.deltaCol) + upwardPenalty + leftPenalty;
            if (!best || score < best.score) best = { ...candidate, score };
          }
        }
        if (best) return best;
      }
      return { deltaCol: 0, deltaRow: 0 };
    };

    const applyGroupDelta = (entries, delta) => {
      entries.forEach((entry) => {
        applyGridItemPosition(entry.item, entry.startBounds.col + delta.deltaCol, entry.startBounds.row + delta.deltaRow);
      });
    };

    const groupDragEntries = (activeItem, placeholder, groupItems, startBounds) => groupItems
      .map((groupItem) => ({
        item: groupItem === activeItem ? placeholder : groupItem,
        sourceItem: groupItem,
        startBounds: startBounds.get(groupItem),
      }))
      .filter((entry) => entry.item && entry.startBounds);

    const externalOccupiedForGroup = (layout, excludedItems) => {
      const excluded = new Set(excludedItems.filter(Boolean));
      return globalGridItems(layout, { includePlaceholders: true })
        .filter((other) => !excluded.has(other))
        .map((other) => ({ item: other, bounds: gridBoundsForItem(other) }));
    };

    const commitGroupDropSlot = (layout, activeItem, groupItems, preferredTarget, startBounds) => {
      const entries = groupItems
        .map((groupItem) => ({ item: groupItem, sourceItem: groupItem, startBounds: startBounds.get(groupItem) }))
        .filter((entry) => entry.startBounds);
      if (entries.length < 2) return commitActiveDropSlot(layout, activeItem, preferredTarget);
      const activeStart = startBounds.get(activeItem) || gridBoundsForItem(activeItem);
      const preferred = preferredTarget || activeStart;
      const occupied = externalOccupiedForGroup(layout, entries.map((entry) => entry.item));
      const delta = findGroupDelta(entries, {
        deltaCol: preferred.col - activeStart.col,
        deltaRow: preferred.row - activeStart.row,
      }, occupied);
      applyGroupDelta(entries, delta);
      return {
        bounds: boundsAtGridSlot(activeItem, activeStart.col + delta.deltaCol, activeStart.row + delta.deltaRow),
        movedItems: entries.length - 1,
      };
    };

    const packOrderedGridItems = (layout, items) => {
      const placements = new Map();
      const occupied = new Set();
      const startRow = deps.orderedLayoutStartRow(layout);
      let cursorRow = startRow;
      let cursorCol = 1;
      const canOccupy = (row, col, span, rowSpan) => {
        if (col < 1 || col + span - 1 > columns) return false;
        for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
          for (let colOffset = 0; colOffset < span; colOffset += 1) {
            if (occupied.has(`${row + rowOffset}:${col + colOffset}`)) return false;
          }
        }
        return true;
      };
      const occupy = (row, col, span, rowSpan) => {
        for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
          for (let colOffset = 0; colOffset < span; colOffset += 1) {
            occupied.add(`${row + rowOffset}:${col + colOffset}`);
          }
        }
      };
      const findSlot = (span, rowSpan) => {
        for (let row = cursorRow; row < cursorRow + 160; row += 1) {
          const startCol = row === cursorRow ? cursorCol : 1;
          for (let col = startCol; col <= columns - span + 1; col += 1) {
            if (canOccupy(row, col, span, rowSpan)) return { row, col };
          }
        }
        return { row: cursorRow, col: 1 };
      };
      items.forEach((item) => {
        const span = gridItemSpan(item);
        const rowSpan = gridItemRowSpan(item);
        const slot = findSlot(span, rowSpan);
        placements.set(item, { ...slot, span, rowSpan });
        occupy(slot.row, slot.col, span, rowSpan);
        cursorRow = slot.row;
        cursorCol = slot.col + span;
        if (cursorCol > columns) {
          cursorRow += 1;
          cursorCol = 1;
        }
      });
      return placements;
    };

    const applyOrderedGridLayout = (layout, items = deps.orderedGridItems(layout, { includePlaceholders: true })) => {
      if (gridHostForLayout(layout) !== layout) return resolveSparseGridLayout(layout);
      const placements = packOrderedGridItems(layout, items.filter((item) => item.isConnected));
      placements.forEach((placement, item) => applyGridItemPosition(item, placement.col, placement.row));
      return placements;
    };

    return Object.freeze({
      indexedCollisionEntries,
      canPlaceBounds,
      nearestSparseSlot,
      nearestSparseSlotAtOrAfter,
      localVacancyCandidates,
      canPlaceLocalDisplacementBounds,
      localBelowDisplacementSlot,
      localLeftDisplacementSlot,
      nearestLocalDisplacementSlot,
      verticalSlotAtOrAfter,
      firstVerticalOpenRow,
      applyVerticalPanelExpansion,
      resolveSparseGridLayout,
      resolveSparseGridLayoutForActiveItems,
      resolveActiveDropSlot,
      commitActiveDropSlot,
      commitExpandedPanelDropSlot,
      commitInsertedGridItemWithVerticalPushdown,
      groupEntriesFit,
      clampGroupDelta,
      findGroupDelta,
      applyGroupDelta,
      groupDragEntries,
      externalOccupiedForGroup,
      commitGroupDropSlot,
      packOrderedGridItems,
      applyOrderedGridLayout,
    });
  };

  window.dashboardCollisionReflowRuntime = Object.freeze({
    createRuntime,
    indexedCollisionEntries,
  });
})();
