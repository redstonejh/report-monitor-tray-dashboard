import React from 'react';
import { useAuthStore } from '../store';

export default function Profile({ onSignedOut }) {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  if (!user) return null;

  async function signOut() {
    await window.auth?.logout();
    setUser(null);
    onSignedOut?.();
  }

  return (
    <div className="settings profile-view">
      <div className="profile-card">
        {/* No avatar initial, no role subtitle — just the account name. */}
        <div className="profile-id">
          <strong>{user.username}</strong>
        </div>
      </div>
      {(user.isAdmin || user.permissions.canManageUsers) && (
        <div className="profile-note">Manage accounts from the dashboard.</div>
      )}
      <button className="btn-ghost profile-signout" onClick={signOut}>Sign out</button>
    </div>
  );
}
