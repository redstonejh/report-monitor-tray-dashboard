import React, { useState } from 'react';
import { useAuthStore } from '../store';

// Shown when an admin-created account signs in for the first time: they must
// replace the temporary password before reaching the status.
export default function SetPassword() {
  const setUser = useAuthStore((s) => s.setUser);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await window.auth?.setPassword(password);
      if (result?.ok) setUser(result.user);
      else setError(result?.error || 'Could not set password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="settings" onSubmit={submit}>
      <div className="settings-lead">Set a new password to continue.</div>
      <input
        className="field"
        type="password"
        placeholder="New password"
        value={password}
        autoFocus
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <div className="settings-error">{error}</div>}
      <button className="btn-primary" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Set password'}
      </button>
    </form>
  );
}
