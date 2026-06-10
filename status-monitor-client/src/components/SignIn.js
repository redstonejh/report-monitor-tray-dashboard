import React, { useState } from 'react';
import { useAuthStore } from '../store';

export default function SignIn({ onSignedIn }) {
  const setUser = useAuthStore((s) => s.setUser);
  const [mode, setMode] = useState('signin'); // 'signin' | 'create'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isCreate = mode === 'create';

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const action = isCreate ? window.auth?.register : window.auth?.login;
      const result = await action(username.trim(), password);
      if (result?.ok) {
        setUser(result.user);
        onSignedIn?.();
      } else {
        setError(result?.error || (isCreate ? 'Could not create account' : 'Sign in failed'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="settings" onSubmit={submit}>
      <div className="settings-lead">{isCreate ? 'Create your account.' : 'Sign in to your account.'}</div>
      <input
        className="field"
        placeholder="Username"
        value={username}
        autoFocus
        onChange={(e) => setUsername(e.target.value)}
      />
      <input
        className="field"
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <div className="settings-error">{error}</div>}
      <button className="btn-primary" type="submit" disabled={busy}>
        {busy ? (isCreate ? 'Creating…' : 'Signing in…') : (isCreate ? 'Create account' : 'Sign in')}
      </button>
      <button
        className="btn-link"
        type="button"
        onClick={() => { setMode(isCreate ? 'signin' : 'create'); setError(''); }}
      >
        {isCreate ? 'Back to sign in' : 'Create an account'}
      </button>
    </form>
  );
}
