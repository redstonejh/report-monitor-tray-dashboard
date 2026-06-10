import { positionObjectMenuSurface } from "./object-menu-positioning.js";

export const hexToRgb = (hex) => {
  const clean = String(hex || "").replace("#", "").trim();
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null;
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
};

export const readableTextFor = ({ r, g, b }) => {
  const luminance = ((0.299 * r) + (0.587 * g) + (0.114 * b)) / 255;
  return luminance > 0.62 ? "#102033" : "#ffffff";
};

export const panelThemePresets = [
  "#ffffff",
  "#2563eb", "#0ea5e9", "#0891b2", "#14b8a6", "#16a34a", "#65a30d", "#ca8a04", "#d97706",
  "#dc2626", "#e11d48", "#db2777", "#9333ea", "#7c3aed", "#4f46e5", "#64748b", "#111827",
];

export const panelToolButtonsMarkup = (theme = "", includeDelete = true, options = {}) => `
      <button class="panel-tool-button panel-move-handle" type="button" aria-label="Move panel" title="Move panel"><span class="move-icon" aria-hidden="true"></span></button>
      ${options.includeResize === false ? "" : '<button class="panel-tool-button panel-resize-handle" type="button" aria-label="Resize panel" title="Resize panel"><span class="resize-icon" aria-hidden="true"></span></button>'}
      ${options.includePin === false ? "" : '<button class="panel-tool-button panel-pin-toggle" type="button" aria-label="Pin panel" aria-pressed="false" title="Pin panel"><span class="pin-icon" aria-hidden="true"></span></button>'}
      ${options.includeTitle === false ? "" : '<button class="panel-tool-button panel-title-handle" type="button" aria-label="Rename panel" title="Rename panel"><span class="text-icon" aria-hidden="true"></span></button>'}
      <button class="panel-tool-button panel-color-toggle" type="button" aria-label="Panel colors" aria-expanded="false" title="Panel colors" data-default-theme="${theme}"><span class="color-icon" aria-hidden="true"></span></button>
      ${options.extraButtons || ""}
      ${includeDelete ? '<button class="panel-tool-button panel-delete-handle" type="button" aria-label="Delete panel" title="Delete panel"><span class="trash-icon" aria-hidden="true"></span></button>' : ""}`;

export const syncPanelThemeVars = (panel, target) => {
  if (!panel || !target) return;
  const rgb = hexToRgb(panel.dataset.panelColor);
  if (!rgb) {
    target.style.removeProperty("--panel-accent");
    target.style.removeProperty("--panel-accent-rgb");
    target.style.removeProperty("--panel-accent-text");
    target.style.removeProperty("--panel-menu-fg");
    target.style.removeProperty("--panel-lock-fg");
    target.style.removeProperty("--panel-lock-border");
    target.style.removeProperty("--panel-lock-glow");
    return;
  }
  const textColor = readableTextFor(rgb);
  const menuTextColor = readableTextFor(rgb);
  target.style.setProperty("--panel-accent", panel.dataset.panelColor);
  target.style.setProperty("--panel-accent-rgb", `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  target.style.setProperty("--panel-accent-text", textColor);
  target.style.setProperty("--panel-menu-fg", menuTextColor);
  target.style.setProperty("--panel-lock-fg", menuTextColor);
  target.style.setProperty("--panel-lock-border", `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, .46)`);
  target.style.setProperty("--panel-lock-glow", `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, .24)`);
};

export const applyPanelColor = (panel, color) => {
  const rgb = hexToRgb(color);
  if (!rgb) {
    panel.classList.remove("db-panel-custom-color");
    panel.style.removeProperty("--panel-accent");
    panel.style.removeProperty("--panel-accent-rgb");
    panel.style.removeProperty("--panel-accent-text");
    panel.style.removeProperty("--panel-header-control-fg");
    panel.style.removeProperty("--panel-lock-fg");
    panel.style.removeProperty("--panel-custom-control-bg");
    panel.style.removeProperty("--panel-custom-control-border");
    panel.style.removeProperty("--panel-custom-control-hover-border");
    panel.style.removeProperty("--panel-custom-control-shadow");
    if (panel.classList.contains("widget-card")) {
      panel.style.removeProperty("border");
      panel.style.removeProperty("border-color");
    }
    delete panel.dataset.panelColor;
    panel.dataset.panelColorCleared = "true";
    delete panel.dataset.panelColorUser;
    return;
  }
  const textColor = readableTextFor(rgb);
  const isWhite = String(color).replace("#", "").toLowerCase() === "ffffff";
  delete panel.dataset.panelColorCleared;
  panel.dataset.panelColor = `#${String(color).replace("#", "")}`;
  panel.classList.add("db-panel-custom-color");
  panel.style.setProperty("--panel-accent", panel.dataset.panelColor);
  panel.style.setProperty("--panel-accent-rgb", `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  panel.style.setProperty("--panel-accent-text", textColor, "important");
  panel.style.setProperty("--panel-header-control-fg", textColor, "important");
  panel.style.setProperty("--panel-lock-fg", textColor, "important");
  if (isWhite) {
    panel.style.setProperty("--panel-custom-control-bg", "color-mix(in srgb, var(--surface-raised) 74%, #ffffff 26%)", "important");
    panel.style.setProperty("--panel-custom-control-border", "rgba(15, 23, 42, .32)", "important");
    panel.style.setProperty("--panel-custom-control-hover-border", "rgba(15, 23, 42, .44)", "important");
    panel.style.setProperty("--panel-custom-control-shadow", "rgba(15, 23, 42, .14)", "important");
  } else {
    panel.style.removeProperty("--panel-custom-control-bg");
    panel.style.removeProperty("--panel-custom-control-border");
    panel.style.removeProperty("--panel-custom-control-hover-border");
    panel.style.removeProperty("--panel-custom-control-shadow");
  }
};

export const applyPanelTitleColor = (panel, color) => {
  delete panel.dataset.panelTitleColor;
  panel.classList.remove("db-panel-custom-title");
  const panelRgb = hexToRgb(panel.dataset.panelColor);
  if (panelRgb) {
    panel.style.setProperty("--panel-accent-text", readableTextFor(panelRgb));
  } else {
    panel.style.removeProperty("--panel-accent-text");
  }
};

const positionPanelColorMenuForOwner = (owner, menu) => {
  if (!menu) return false;
  menu.__panelColorAnchor = owner;
  return positionObjectMenuSurface(owner, menu, {
    gutter: 12,
    gap: 12,
    fallbackWidth: 278,
  });
};

export const positionPanelColorMenu = (anchor, menu) => {
  if (!menu) return false;
  menu.__panelColorAnchor = anchor;
  return positionObjectMenuSurface(anchor, menu, {
    gutter: 12,
    gap: 12,
    fallbackWidth: 278,
  });
};

export const createPanelColorMenuFactory = ({
  selectedGroupItems,
  groupItemLayoutKey,
  groupItemLayout,
  saveWidgetLayouts,
  savePanelLayouts,
  menuOverlayLayer,
  widgetConfigFromElement,
  setWidgetConfig,
  renderWidgetRuntimeContent,
}) => {
  const cleanColor = (color) => {
    const value = String(color || "").replace("#", "").toLowerCase();
    return value ? `#${value}` : "";
  };
  const swatchDisplayColor = (color) => {
    const normalized = cleanColor(color);
    if (!normalized) return "rgba(255, 255, 255, .16)";
    if (normalized === "#ffffff") return "#d1d5db";
    return normalized;
  };
  const parseSupportedSettings = (panel) => {
    try {
      const settings = JSON.parse(panel?.dataset?.widgetSupportedSettings || "[]");
      return Array.isArray(settings) ? settings : [];
    } catch {
      return [];
    }
  };
  const supportsWellTone = (panel) => (
    panel?.classList?.contains("widget-card") &&
    parseSupportedSettings(panel).includes("wellTone") &&
    typeof widgetConfigFromElement === "function" &&
    typeof setWidgetConfig === "function" &&
    typeof renderWidgetRuntimeContent === "function"
  );
  const visualizationWellToneRuntime = () => window.dashboardVisualizationWellToneRuntime || null;
  const wellToneOptions = () => visualizationWellToneRuntime()?.tones?.() || [];
  const normalizeWellTone = (tone) => visualizationWellToneRuntime()?.normalize?.(tone) || "white";

  const buildPanelColorMenu = (panel, layout, colorToggle) => {
    if (!colorToggle) return null;
    if (panel.__panelColorMenu) {
      colorToggle.__panelColorMenu = panel.__panelColorMenu;
      colorToggle.__refreshPanelColorMenu = panel.__panelColorMenu.__refreshPanelColorMenu;
      panel.__panelColorMenu.__updatePanelColorTrigger?.(colorToggle);
      return panel.__panelColorMenu;
    }
    const menu = document.createElement("div");
    menu.className = "panel-color-menu";
    menu.setAttribute("role", "menu");
    let anchorToggle = colorToggle;
    menu.__panelColorAnchor = panel;
    const updateTrigger = (nextTrigger = anchorToggle) => {
      if (!nextTrigger) return;
      anchorToggle = nextTrigger;
      anchorToggle.__panelColorMenu = menu;
      anchorToggle.__refreshPanelColorMenu = refreshSwatchSelection;
    };
    const saveOwnerLayout = () => {
      if (typeof panel.__saveWidgetLayout === "function") {
        panel.__saveWidgetLayout();
      } else {
        savePanelLayouts(layout);
      }
    };
    const refreshSwatchSelection = () => {
      const activeTheme = panel.dataset.panelColor ? cleanColor(panel.dataset.panelColor) : "";
      menu.querySelectorAll(".panel-color-swatch").forEach((swatch) => {
        if (swatch.dataset.colorGroup !== "theme") return;
        const selected = cleanColor(swatch.dataset.color) === activeTheme;
        swatch.classList.toggle("is-selected", selected);
        swatch.setAttribute("aria-pressed", selected.toString());
      });
      if (supportsWellTone(panel)) {
        const activeTone = normalizeWellTone(widgetConfigFromElement(panel)?.wellTone);
        menu.querySelectorAll(".panel-color-swatch[data-well-tone]").forEach((swatch) => {
          const selected = normalizeWellTone(swatch.dataset.wellTone) === activeTone;
          swatch.classList.toggle("is-selected", selected);
          swatch.setAttribute("aria-pressed", selected.toString());
        });
      }
    };
    const keepMenuOpen = () => {
      refreshSwatchSelection();
      menu.classList.add("panel-color-menu-open");
      anchorToggle?.setAttribute("aria-expanded", "true");
    };
    const openMenu = (nextTrigger = anchorToggle) => {
      updateTrigger(nextTrigger);
      refreshSwatchSelection();
      if (!positionPanelColorMenuForOwner(panel, menu)) {
        closeMenu();
        return false;
      }
      menu.classList.add("panel-color-menu-open");
      anchorToggle?.setAttribute("aria-expanded", "true");
      return true;
    };
    const closeMenu = () => {
      menu.classList.remove("panel-color-menu-open");
      anchorToggle?.setAttribute("aria-expanded", "false");
    };
    menu.__refreshPanelColorMenu = refreshSwatchSelection;
    menu.__openPanelColorMenu = openMenu;
    menu.__closePanelColorMenu = closeMenu;
    menu.__updatePanelColorTrigger = updateTrigger;

    const addGroup = (label, colors, onSelect, colorGroup) => {
      const group = document.createElement("div");
      group.className = "panel-color-group";
      const groupLabel = document.createElement("span");
      groupLabel.className = "panel-color-label";
      groupLabel.textContent = label;
      const swatches = document.createElement("div");
      swatches.className = "panel-color-swatches";
      colors.forEach((color) => {
        const isClear = color === null;
        const swatch = document.createElement("button");
        swatch.className = "panel-color-swatch";
        swatch.type = "button";
        swatch.title = isClear ? "No color" : color;
        swatch.dataset.color = isClear ? "" : color;
        swatch.dataset.colorGroup = colorGroup;
        if (isClear) swatch.dataset.colorAction = "clear";
        swatch.setAttribute("aria-label", isClear ? "No color" : color);
        swatch.setAttribute("aria-pressed", "false");
        swatch.style.setProperty("--swatch", swatchDisplayColor(color));
        swatch.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          onSelect(color);
          if (isClear) {
            delete panel.dataset.panelColorUser;
          } else {
            panel.dataset.panelColorUser = "true";
          }
          if (panel.classList.contains("group-selected")) {
            const peers = selectedGroupItems(null, groupItemLayoutKey(panel)).filter((item) => item !== panel);
            peers.forEach((item) => {
              applyPanelColor(item, color);
              if (isClear) {
                delete item.dataset.panelColorUser;
              } else {
                item.dataset.panelColorUser = "true";
              }
            });
            [...new Set(peers.map(groupItemLayout).filter(Boolean))].forEach((peerLayout) => {
              if (peerLayout.classList.contains("widget-layout")) {
                saveWidgetLayouts(peerLayout);
              } else {
                savePanelLayouts(peerLayout);
              }
            });
          }
          if (typeof panel.__saveWidgetLayout === "function") {
            panel.__saveWidgetLayout();
          } else {
            savePanelLayouts(layout);
          }
          keepMenuOpen();
        });
        swatches.appendChild(swatch);
      });
      group.append(groupLabel, swatches);
      menu.appendChild(group);
    };

    const addWellToneGroup = () => {
      const tones = wellToneOptions();
      if (!supportsWellTone(panel) || !tones.length) return;
      const group = document.createElement("div");
      group.className = "panel-color-group";
      const groupLabel = document.createElement("span");
      groupLabel.className = "panel-color-label";
      groupLabel.textContent = "Well tone";
      const swatches = document.createElement("div");
      swatches.className = "panel-color-swatches";
      tones.forEach((tone) => {
        const swatch = document.createElement("button");
        swatch.className = "panel-color-swatch";
        swatch.type = "button";
        swatch.title = tone.label;
        swatch.dataset.colorGroup = "well-tone";
        swatch.dataset.wellTone = tone.value;
        swatch.setAttribute("aria-label", tone.label);
        swatch.setAttribute("aria-pressed", "false");
        swatch.style.setProperty("--swatch", tone.swatch || swatchDisplayColor(null));
        swatch.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const wellTone = normalizeWellTone(tone.value);
          setWidgetConfig(panel, { ...widgetConfigFromElement(panel), wellTone });
          renderWidgetRuntimeContent(panel);
          saveOwnerLayout();
          keepMenuOpen();
        });
        swatches.appendChild(swatch);
      });
      group.append(groupLabel, swatches);
      menu.appendChild(group);
    };

    addWellToneGroup();
    addGroup("Theme color", [null, ...panelThemePresets], (color) => applyPanelColor(panel, color), "theme");
    menu.addEventListener("click", (event) => event.stopPropagation());
    menu.addEventListener("keydown", (event) => event.stopPropagation());
    menuOverlayLayer().appendChild(menu);
    panel.__panelColorMenu = menu;
    updateTrigger(colorToggle);
    refreshSwatchSelection();
    return menu;
  };

  return { buildPanelColorMenu };
};
