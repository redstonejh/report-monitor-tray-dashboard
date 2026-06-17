import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SettingOutlined, ArrowLeftOutlined, CloseOutlined, UserOutlined } from '@ant-design/icons';

// The same account glyph the dashboard's profile button uses (auth-ui.js).
export const AccountGlyph = () => (
  <svg
    className="topbar-avatar-glyph"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);
import StatusPanel from './components/StatusPanel';

// Suppress native (OS) tooltips: strip `title` attributes (and SVG <title>)
// from whatever the cursor moves onto and its ancestors, before the hover delay
// can pop the Windows tooltip. Installed once for the popover window.
if (typeof document !== 'undefined' && !window.__nativeTooltipsSuppressed) {
  window.__nativeTooltipsSuppressed = true;
  document.addEventListener('pointerover', (event) => {
    let el = event.target;
    while (el && el.nodeType === 1) {
      if (typeof el.hasAttribute === 'function' && el.hasAttribute('title')) el.removeAttribute('title');
      if (el.namespaceURI === 'http://www.w3.org/2000/svg' && typeof el.querySelector === 'function') {
        el.querySelector(':scope > title')?.remove();
      }
      el = el.parentElement;
    }
  }, true);
}
import Settings from './components/Settings';
import SignIn from './components/SignIn';
import SetPassword from './components/SetPassword';
import Profile from './components/Profile';
import { useStatusStore, useSettingsStore, useAuthStore } from './store';

// Map live status + connection state → the accent used for the top wash.
export function resolveAccent(connectionState, status) {
  if (connectionState === 'black' || connectionState === 'grey') return 'neutral';
  if (status === 'green') return 'green';
  if (status === 'yellow') return 'amber';
  if (status === 'red') return 'red';
  return 'neutral';
}

export default function App() {
  const [view, setView] = useState('status'); // 'status' | 'settings'
  const [fleetQuery, setFleetQuery] = useState(''); // type-ahead filter for the fleet pie
  const [revealing, setRevealing] = useState(false);
  const [anchorEdge, setAnchorEdge] = useState('bottom');
  const setStatus = useStatusStore((s) => s.setStatus);
  const setConnectionState = useStatusStore((s) => s.setConnectionState);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const setPopoverMode = useStatusStore((s) => s.setPopoverMode);
  const connectionState = useStatusStore((s) => s.connectionState);
  const status = useStatusStore((s) => s.status);
  const popoverMode = useStatusStore((s) => s.popoverMode);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const panelRef = useRef(null);

  // A user mid first-login password reset isn't "fully" signed in yet — no
  // status, dashboard or settings until that's done.
  const fullyAuthed = !!user && !user.mustChangePassword;
  // No status is revealed until signed in (the glow stays neutral too).
  const accent = fullyAuthed ? resolveAccent(connectionState, status) : 'neutral';
  const isExpanded = popoverMode === 'expanded';

  const handlePointerEnter = () => window.electron?.pointerEntered?.();
  const handlePointerLeave = () => window.electron?.pointerLeft?.();
  const pinPopover = () => window.electron?.pinPopover?.();
  const hidePopover = () => window.electron?.hidePopover?.();

  // Windows paints a native OS acrylic backdrop (real blur of the apps behind
  // the popover). DWM rounds the window at its own radius, so square the panel
  // corners to match (no corner leak); the panel keeps the widget-well tint.
  useEffect(() => {
    if (window.electron?.platform === 'win32') document.body.classList.add('win-acrylic');
  }, []);

  // Load initial state from main process
  useEffect(() => {
    window.electron?.getStatus().then(({ status, connectionState }) => {
      if (status) setStatus(status);
      setConnectionState(connectionState);
    });
    window.electron?.getSettings().then((s) => { if (s) setSettings(s); });
    window.auth?.session().then((s) => setUser(s?.user)).catch(() => {});
    window.auth?.onChanged((s) => setUser(s?.user));
  }, []);

  // Subscribe to live MQTT pushes and connection state changes
  useEffect(() => {
    window.electron?.onStatus((payload) => setStatus(payload));
    window.electron?.onConnection((state) => setConnectionState(state));
    window.electron?.onPopoverMode((mode) => {
      setPopoverMode(mode);
      if (mode === 'peek') setView('status');
    });
    window.electron?.onAnchorEdge?.((edge) => setAnchorEdge(edge));
  }, []);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;
    const reportSize = () => {
      window.electron?.resizeContent?.({
        width: Math.ceil(panel.scrollWidth),
        height: Math.ceil(panel.scrollHeight),
      });
    };
    reportSize();
    const observer = new ResizeObserver(reportSize);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [popoverMode, view, status, connectionState]);

  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.electron?.rendererReady?.());
    });
  }, []);

  useEffect(() => {
    if (!isExpanded) { setRevealing(false); return undefined; }
    setRevealing(true);
    const fallback = setTimeout(() => setRevealing(false), 240);
    return () => clearTimeout(fallback);
  }, [isExpanded, anchorEdge]);

  // Escape: from Settings → back to status; from status → close the popover.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || !isExpanded) return;
      if (view !== 'status') setView('status');
      else hidePopover();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isExpanded, view]);

  return (
    <div
      ref={panelRef}
      className={`panel ${popoverMode} edge-${anchorEdge}${revealing ? ' revealing' : ''}${isExpanded ? ` view-${view}` : ''}`}
      onPointerEnter={handlePointerEnter}
      onPointerMove={popoverMode === 'peek' ? handlePointerEnter : undefined}
      onPointerLeave={handlePointerLeave}
      onPointerDownCapture={pinPopover}
      onAnimationEnd={() => setRevealing(false)}
      onTransitionEnd={() => setRevealing(false)}
    >
      <div className={`tint ${accent}`} />

      {isExpanded && (
        <header className="topbar">
          {fullyAuthed && view === 'status' && (
            <input
              className="fleet-search"
              type="text"
              value={fleetQuery}
              onChange={(e) => setFleetQuery(e.target.value)}
              placeholder="Search…"
              aria-label="Search companies"
              spellCheck={false}
              autoComplete="off"
            />
          )}
          {/* Back button always sits in the top-LEFT for every submenu (settings,
              profile) — consistent, never on the right. */}
          {fullyAuthed && view !== 'status' && (
            <button
              className="icon-btn"
              onClick={() => setView('status')}
              title="Back"
              aria-label="Back to status"
            >
              <ArrowLeftOutlined />
            </button>
          )}
          <div className="topbar-spacer" />
          {fullyAuthed && (
            <button
              className={`icon-btn profile-btn${view === 'profile' ? ' is-active' : ''}`}
              onClick={() => setView(view === 'profile' ? 'status' : 'profile')}
              title={`Account — ${user.username}`}
              aria-label="Account"
            >
              <span className="topbar-avatar"><AccountGlyph /></span>
            </button>
          )}
          {fullyAuthed && (
            <button
              className={`icon-btn${view === 'settings' ? ' is-active' : ''}`}
              onClick={() => setView(view === 'settings' ? 'status' : 'settings')}
              title="Settings"
              aria-label="Settings"
            >
              <SettingOutlined />
            </button>
          )}
          <button className="icon-btn" onClick={hidePopover} title="Close" aria-label="Close">
            <CloseOutlined />
          </button>
        </header>
      )}

      <div className={`panel-scroll ${isExpanded ? 'content-reveal' : ''}`}>
        {!fullyAuthed
          ? (!isExpanded
            ? (
              <div className="peek neutral">
                <span className="peek-dot"><UserOutlined /></span>
                <span className="peek-copy">
                  <span className="peek-title">{user ? 'Action needed' : 'Signed out'}</span>
                  <span className="peek-sub">{user ? 'Open to set password' : 'Open to sign in'}</span>
                </span>
              </div>
            )
            : user && user.mustChangePassword
              ? <SetPassword />
              : <SignIn onSignedIn={() => setView('status')} />)
          : !isExpanded || view === 'status'
            ? <StatusPanel mode={popoverMode} fleetQuery={fleetQuery} />
            : view === 'profile'
              ? <Profile onSignedOut={() => setView('status')} />
              : <Settings onSaved={() => setView('status')} />}
      </div>
    </div>
  );
}
