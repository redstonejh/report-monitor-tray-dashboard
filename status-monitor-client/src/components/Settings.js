import React, { useEffect, useState } from 'react';
import { useSettingsStore } from '../store';

export default function Settings({ onSaved }) {
  const store = useSettingsStore();
  const setStoreSettings = useSettingsStore((s) => s.setSettings);

  const [shareCode, setShareCode] = useState('');
  const [saving, setSaving] = useState(false);
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

  async function applyShareCode() {
    if (!shareCode.trim()) return;
    setSaving(true);
    setError('');
    try {
      const result = await window.electron.saveSettings({ shareCode: shareCode.trim() });
      if (result?.ok) {
        const updated = await window.electron.getSettings();
        if (updated) setStoreSettings(updated);
        setShareCode('');
        onSaved?.();
      } else {
        setError(result?.error || 'Invalid share code');
      }
    } finally {
      setSaving(false);
    }
  }

  async function saveManual() {
    setSaving(true);
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
        onSaved?.();
      } else {
        setError(result?.error || 'Could not save');
      }
    } finally {
      setSaving(false);
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
        <button className="btn-ghost" onClick={applyShareCode} disabled={saving || !shareCode.trim()}>
          Apply
        </button>
      </div>

      {error && <div className="settings-error">{error}</div>}

      <div className="settings-divider" />

      <details className="settings-advanced">
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

      <button className="btn-primary" onClick={saveManual} disabled={saving}>
        Save &amp; Connect
      </button>
    </div>
  );
}
