import React, { useEffect, useState } from 'react';
import { useSettingsStore } from '../store';

export default function Settings({ onSaved }) {
  const store = useSettingsStore();
  const setStoreSettings = useSettingsStore((s) => s.setSettings);

  const [shareCode, setShareCode] = useState('');
  const [busy, setBusy] = useState(''); // '' | 'apply' | 'save'
  const [done, setDone] = useState(''); // '' | 'apply' | 'save'  (brief success state)
  const [error, setError] = useState('');

  const [fields, setFields] = useState({
    mqttHost: '', mqttPort: 1883, apiPort: 3847, projectId: '', systemId: '',
  });

  // Keep the manual fields in sync with whatever the store currently holds.
  useEffect(() => {
    setFields({
      mqttHost: store.mqttHost || '',
      mqttPort: store.mqttPort || 1883,
      apiPort: store.apiPort || 3847,
      projectId: store.projectId || '',
      systemId: store.systemId || '',
    });
  }, [store.mqttHost, store.mqttPort, store.apiPort, store.projectId, store.systemId]);

  const set = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));

  // Expanding "Manual setup" grows the panel; report the new content height so
  // the popover window resizes to reveal the fields (the ResizeObserver can
  // miss the flex-constrained growth, so we report it explicitly on toggle).
  const reportPanelSize = () => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const panel = document.querySelector('.panel');
      if (panel) {
        window.electron?.resizeContent?.({
          width: Math.ceil(panel.scrollWidth),
          height: Math.ceil(panel.scrollHeight),
        });
      }
    }));
  };

  async function applyShareCode() {
    if (!shareCode.trim()) return;
    setBusy('apply');
    setError('');
    try {
      const result = await window.electron.saveSettings({ shareCode: shareCode.trim() });
      if (result?.ok) {
        const updated = await window.electron.getSettings();
        if (updated) setStoreSettings(updated);
        setShareCode('');
        setDone('apply');
        setTimeout(() => onSaved?.(), 900);
      } else {
        setError(result?.error || 'Invalid share code');
      }
    } finally {
      setBusy('');
    }
  }

  async function saveManual() {
    setBusy('save');
    setError('');
    try {
      const payload = {
        mqttHost: fields.mqttHost.trim(),
        mqttPort: Number(fields.mqttPort) || 1883,
        apiPort: Number(fields.apiPort) || 3847,
        projectId: fields.projectId.trim(),
        systemId: fields.systemId.trim(),
      };
      const result = await window.electron.saveSettings(payload);
      if (result?.ok) {
        setStoreSettings(payload);
        setDone('save');
        setTimeout(() => onSaved?.(), 900);
      } else {
        setError(result?.error || 'Could not save');
      }
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="settings">
      <div className="settings-lead">
        Paste the share code from your monitor server to connect.
      </div>

      <div className="input-row">
        <input
          className="field"
          placeholder="Share code"
          value={shareCode}
          onChange={(e) => setShareCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') applyShareCode(); }}
        />
        <button className="btn-ghost" onClick={applyShareCode} disabled={!!busy || !!done || !shareCode.trim()}>
          {done === 'apply' ? '✓ Connected' : busy === 'apply' ? 'Applying…' : 'Apply'}
        </button>
      </div>

      {error && <div className="settings-error">{error}</div>}

      <div className="settings-divider" />

      <details className="settings-advanced" onToggle={reportPanelSize}>
        <summary>Manual setup</summary>
        <div className="settings-grid">
          <label className="settings-field full">
            <span className="settings-label">Broker host</span>
            <input className="field" placeholder="127.0.0.1" value={fields.mqttHost} onChange={set('mqttHost')} />
          </label>
          <label className="settings-field">
            <span className="settings-label">MQTT port</span>
            <input className="field" type="number" value={fields.mqttPort} onChange={set('mqttPort')} />
          </label>
          <label className="settings-field">
            <span className="settings-label">API port</span>
            <input className="field" type="number" value={fields.apiPort} onChange={set('apiPort')} />
          </label>
          <label className="settings-field full">
            <span className="settings-label">Project ID</span>
            <input className="field mono" placeholder="UUID" value={fields.projectId} onChange={set('projectId')} />
          </label>
          <label className="settings-field full">
            <span className="settings-label">System ID</span>
            <input className="field mono" placeholder="UUID" value={fields.systemId} onChange={set('systemId')} />
          </label>
        </div>
      </details>

      <button className="btn-primary" onClick={saveManual} disabled={!!busy || !!done}>
        {done === 'save' ? '✓ Connected' : busy === 'save' ? 'Connecting…' : 'Save & Connect'}
      </button>
    </div>
  );
}
