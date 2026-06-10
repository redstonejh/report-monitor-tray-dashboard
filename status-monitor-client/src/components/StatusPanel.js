import React from 'react';
import { useStatusStore, useSettingsStore } from '../store';

// One ring, one word. The status condition is the content — everything else is
// a single supporting line. No repeated banners, cards, or stage chips.
const STATUS_CONFIG = {
  green:  { accent: 'green', mark: '✓', title: 'All good' },
  yellow: { accent: 'amber', mark: '!', title: 'Needs attention' },
  red:    { accent: 'red',   mark: '✕', title: 'Source issue' },
};

function formatRelative(isoString) {
  if (!isoString) return 'never';
  const diff = Date.now() - new Date(isoString).getTime();
  const hours = Math.floor(diff / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  if (hours > 48) return `${Math.floor(hours / 24)} days ago`;
  if (hours > 0) return `${hours}h ${mins}m ago`;
  if (mins > 0) return `${mins}m ago`;
  return 'just now';
}

// Resolve the single visual identity for the current state.
function resolve(connectionState, status, projectId) {
  if (connectionState === 'live' && status) {
    return STATUS_CONFIG[status] || STATUS_CONFIG.yellow;
  }
  if (connectionState === 'black') return { accent: 'neutral', mark: '⧖', title: 'No updates' };
  if (!projectId) return { accent: 'neutral', mark: 'ℹ', title: 'Not configured' };
  return { accent: 'neutral', mark: '⋯', title: 'Connecting' };
}

export default function StatusPanel({ mode = 'expanded' }) {
  const { status, detail, checkedAt, connectionState } = useStatusStore();
  const { projectId } = useSettingsStore();

  const live = connectionState === 'live' && !!status;
  const { accent, mark, title } = resolve(connectionState, status, projectId);

  if (mode === 'peek') {
    const sub = live
      ? `Checked ${formatRelative(checkedAt)}`
      : connectionState === 'black'
        ? (checkedAt ? `Last seen ${formatRelative(checkedAt)}` : 'Broker unreachable')
        : projectId ? 'Waiting for status' : 'Open settings to begin';
    return (
      <div className={`peek ${accent}`}>
        <span className="peek-dot">{mark}</span>
        <span className="peek-copy">
          <span className="peek-title">{title}</span>
          <span className="peek-sub">{sub}</span>
        </span>
      </div>
    );
  }

  const detailText = live
    ? detail
    : connectionState === 'black'
      ? (status && checkedAt ? `Last known ${status} · ${formatRelative(checkedAt)}.` : 'Cannot reach the monitor broker.')
      : projectId ? 'Waiting for the first status update.' : 'Open settings and paste your share code.';

  return (
    <div className={`status-hero ${accent}`}>
      <div className="status-ring"><span className="status-mark">{mark}</span></div>
      <div className="status-title">{title}</div>
      {detailText && <div className="status-detail">{detailText}</div>}
      {live && <div className="status-time">Checked {formatRelative(checkedAt)}</div>}
    </div>
  );
}
