import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SettingOutlined, ArrowLeftOutlined, UpOutlined, CloseOutlined } from '@ant-design/icons';
import StatusPanel from './components/StatusPanel';
import Settings from './components/Settings';
import { useStatusStore, useSettingsStore } from './store';

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
  const [revealing, setRevealing] = useState(false);
  const [anchorEdge, setAnchorEdge] = useState('bottom');
  const setStatus = useStatusStore((s) => s.setStatus);
  const setConnectionState = useStatusStore((s) => s.setConnectionState);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const setPopoverMode = useStatusStore((s) => s.setPopoverMode);
  const connectionState = useStatusStore((s) => s.connectionState);
  const status = useStatusStore((s) => s.status);
  const popoverMode = useStatusStore((s) => s.popoverMode);
  const panelRef = useRef(null);

  const accent = resolveAccent(connectionState, status);
  const isExpanded = popoverMode === 'expanded';

  const openDashboard = () => window.electron?.openDashboard?.();
  const handlePointerEnter = () => window.electron?.pointerEntered?.();
  const handlePointerLeave = () => window.electron?.pointerLeft?.();
  const pinPopover = () => window.electron?.pinPopover?.();
  const hidePopover = () => window.electron?.hidePopover?.();

  // Load initial state from main process
  useEffect(() => {
    window.electron?.getStatus().then(({ status, connectionState }) => {
      if (status) setStatus(status);
      setConnectionState(connectionState);
    });
    window.electron?.getSettings().then((s) => { if (s) setSettings(s); });
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

  return (
    <div
      ref={panelRef}
      className={`panel ${popoverMode} edge-${anchorEdge}${revealing ? ' revealing' : ''}`}
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
          <button
            className="icon-btn open-dash"
            onClick={openDashboard}
            title="Open dashboard"
            aria-label="Open dashboard"
          >
            <UpOutlined className="chev" />
          </button>
          <div className="topbar-spacer" />
          <button
            className="icon-btn"
            onClick={() => setView(view === 'status' ? 'settings' : 'status')}
            title={view === 'status' ? 'Settings' : 'Back'}
            aria-label={view === 'status' ? 'Settings' : 'Back'}
          >
            {view === 'status' ? <SettingOutlined /> : <ArrowLeftOutlined />}
          </button>
          <button className="icon-btn" onClick={hidePopover} title="Close" aria-label="Close">
            <CloseOutlined />
          </button>
        </header>
      )}

      <div className={`panel-scroll ${isExpanded ? 'content-reveal' : ''}`}>
        {view === 'status' || !isExpanded
          ? <StatusPanel mode={popoverMode} />
          : <Settings onSaved={() => setView('status')} />}
      </div>
    </div>
  );
}
