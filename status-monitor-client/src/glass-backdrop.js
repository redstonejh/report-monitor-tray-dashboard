// Supplies the liquid-glass WebGL module with the same backdrop environment
// the dashboard refracts: --bg/--bg-end tone variables plus an optional
// .workspace-photo-panel element carrying the dashboard's photo background.
// The background choice is read from the shared layout store through the
// main process (the dashboard mirrors its localStorage choice there), so the
// popover glass always matches the dashboard's current environment.

let appliedKey = null;

function applyBackdrop(info) {
  if (!info || info.key === appliedKey) return;
  appliedKey = info.key;

  const root = document.documentElement;
  root.style.setProperty('--bg', info.bgStart);
  root.style.setProperty('--bg-end', info.bgEnd);

  let photoPanel = document.querySelector('.workspace-photo-panel');
  if (info.photoDataUrl) {
    if (!photoPanel) {
      photoPanel = document.createElement('div');
      photoPanel.className = 'workspace-photo-panel';
      // Texture source only — never painted. The WebGL module reads the
      // inline background-image; display:none keeps it out of layout.
      photoPanel.style.display = 'none';
      photoPanel.setAttribute('aria-hidden', 'true');
      document.body.appendChild(photoPanel);
    }
    photoPanel.style.backgroundImage = `url("${info.photoDataUrl}")`;
  } else if (photoPanel) {
    photoPanel.remove();
  }

  window.LiquidGlassWebGL?.markDirty?.();
}

async function refreshBackdrop() {
  try {
    const info = await window.electron?.getDashboardBackground?.();
    if (info) applyBackdrop(info);
  } catch {}
}

refreshBackdrop();

// The popover window is hidden/shown around tray interactions; re-check the
// dashboard background each time it becomes visible so a background changed
// in the dashboard carries over without restarting the tray.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshBackdrop();
});
