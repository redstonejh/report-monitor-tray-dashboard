import React from 'react';
import { useAuthStore } from '../store';

const roleOf = (u) => (u.isAdmin ? 'Admin' : u.permissions.canEdit ? 'Editor' : 'Viewer');

export default function Profile({ onSignedOut }) {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  if (!user) return null;
  const role = roleOf(user);

  async function signOut() {
    await window.auth?.logout();
    setUser(null);
    onSignedOut?.();
  }

  return (
    <div className="settings profile-view">
      <div className="profile-card">
        <span className="profile-avatar">{(user.username[0] || '?').toUpperCase()}</span>
        <div className="profile-id">
          <strong>{user.username}</strong>
          <span className={`role-badge role-${role.toLowerCase()}`}>{role}</span>
        </div>
      </div>
      {(user.isAdmin || user.permissions.canManageUsers) && (
        <div className="profile-note">Manage accounts from the dashboard.</div>
      )}
      <button className="btn-ghost profile-signout" onClick={signOut}>Sign out</button>
    </div>
  );
}
