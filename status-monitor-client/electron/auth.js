// Local account system for the tray + dashboard. Accounts live in
// ~/.status-monitor/users.json with scrypt-hashed passwords; the signed-in
// user is remembered in session.json. A default admin (admin / admin1) is
// seeded on first run. Everyone may edit dashboards (move/resize/recolour) —
// there is no edit permission. The only account distinction is canManageUsers
// (an "admin"): admins manage accounts and see every monitored IP, while a
// viewer sees only the IPs explicitly granted to them (`visibleCompanies`). A
// new IP is therefore visible to admins automatically and to no viewer until an
// admin grants it.
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const DIR = path.join(os.homedir(), '.status-monitor');
const USERS_FILE = path.join(DIR, 'users.json');
const SESSION_FILE = path.join(DIR, 'session.json');

const DEFAULT_PERMISSIONS = { canManageUsers: false };

let currentUsername = null;

function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, user) {
  if (!user || !user.salt || !user.hash) return false;
  const { hash } = hashPassword(password, user.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(user.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readUsers() {
  try {
    const parsed = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    if (parsed && Array.isArray(parsed.users)) return parsed;
  } catch {}
  return null;
}

function writeUsers(store) {
  ensureDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(store, null, 2));
}

function seed() {
  let store = readUsers();
  if (!store || !store.users.length) {
    store = {
      users: [{
        username: 'admin',
        isAdmin: true,
        permissions: { canManageUsers: true },
        ...hashPassword('admin1'),
      }],
    };
    writeUsers(store);
  }
  return store;
}

function rawUser(username) {
  const store = seed();
  const key = String(username || '').trim().toLowerCase();
  return store.users.find((u) => u.username.toLowerCase() === key) || null;
}

// An admin (isAdmin) or anyone who can manage accounts sees every IP — their
// view is unrestricted. Everyone else is limited to an explicit allow-list.
function isUnrestricted(u) {
  return !!(u && (u.isAdmin || (u.permissions && u.permissions.canManageUsers)));
}

function publicUser(u) {
  if (!u) return null;
  return {
    username: u.username,
    isAdmin: !!u.isAdmin,
    permissions: { ...DEFAULT_PERMISSIONS, ...(u.permissions || {}) },
    // null = unrestricted (sees all IPs, incl. any newly introduced ones);
    // an array = the exact set of company ids this viewer may see.
    visibleCompanies: isUnrestricted(u) ? null : (Array.isArray(u.visibleCompanies) ? u.visibleCompanies : []),
    mustChangePassword: !!u.mustChangePassword,
  };
}

// The company-id allow-list for a username, or null when unrestricted (admin /
// manager / unknown). Consumed by the main process to filter the company list.
function visibleCompaniesFor(username) {
  const u = rawUser(username);
  if (!u || isUnrestricted(u)) return null;
  return Array.isArray(u.visibleCompanies) ? u.visibleCompanies : [];
}

function init() {
  seed();
  try {
    const s = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    if (s && s.username && rawUser(s.username)) currentUsername = rawUser(s.username).username;
  } catch {}
}

function session() {
  return { user: publicUser(currentUsername ? rawUser(currentUsername) : null) };
}

function currentUser() {
  return currentUsername;
}

function login(username, password) {
  const u = rawUser(username);
  if (!u || !verifyPassword(password, u)) return { ok: false, error: 'Incorrect username or password' };
  currentUsername = u.username;
  try { ensureDir(); fs.writeFileSync(SESSION_FILE, JSON.stringify({ username: u.username })); } catch {}
  return { ok: true, user: publicUser(u) };
}

function logout() {
  currentUsername = null;
  try { fs.unlinkSync(SESSION_FILE); } catch {}
  return { ok: true };
}

// ── Account management (caller must be an admin / canManageUsers) ──────────────

function listUsers() {
  return seed().users.map(publicUser);
}

function createUser({ username, password, canManageUsers, visibleCompanies } = {}) {
  const name = String(username || '').trim();
  if (!name) return { ok: false, error: 'Username is required' };
  if (!password) return { ok: false, error: 'Password is required' };
  const store = seed();
  if (store.users.some((u) => u.username.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: 'That username is already taken' };
  }
  // Admin-created accounts get a temporary password the user must replace on
  // their first sign-in. `visibleCompanies` is the admin's checkmark selection
  // of which IPs this viewer may see (ignored for managers, who see all).
  store.users.push({
    username: name,
    isAdmin: false,
    permissions: { canManageUsers: !!canManageUsers },
    visibleCompanies: Array.isArray(visibleCompanies) ? visibleCompanies : [],
    mustChangePassword: true,
    ...hashPassword(password),
  });
  writeUsers(store);
  return { ok: true };
}

// Self-service sign-up from the sign-in screen: creates a viewer account and
// signs them straight in (they chose their own password, so no forced reset).
function register({ username, password } = {}) {
  const name = String(username || '').trim();
  if (!name) return { ok: false, error: 'Username is required' };
  if (!password) return { ok: false, error: 'Password is required' };
  const store = seed();
  if (store.users.some((u) => u.username.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: 'That username is already taken' };
  }
  store.users.push({
    username: name,
    isAdmin: false,
    permissions: { ...DEFAULT_PERMISSIONS },
    // Self-registered viewers start with no visible IPs — an admin grants them.
    visibleCompanies: [],
    mustChangePassword: false,
    ...hashPassword(password),
  });
  writeUsers(store);
  return login(name, password);
}

// The signed-in user replaces their own password (used for the first-login
// reset prompt). Clears the must-change flag.
function setOwnPassword(newPassword) {
  if (!currentUsername) return { ok: false, error: 'Not signed in' };
  if (!newPassword) return { ok: false, error: 'Password is required' };
  const store = seed();
  const u = store.users.find((x) => x.username.toLowerCase() === currentUsername.toLowerCase());
  if (!u) return { ok: false, error: 'No such account' };
  Object.assign(u, hashPassword(newPassword));
  u.mustChangePassword = false;
  writeUsers(store);
  return { ok: true, user: publicUser(u) };
}

function updateUser(username, { canManageUsers, visibleCompanies, password } = {}) {
  const store = seed();
  const u = store.users.find((x) => x.username.toLowerCase() === String(username || '').toLowerCase());
  if (!u) return { ok: false, error: 'No such account' };
  if (u.isAdmin) {
    u.permissions = { canManageUsers: true }; // admin keeps full rights
  } else {
    if (canManageUsers !== undefined) u.permissions = { canManageUsers: !!canManageUsers };
    if (Array.isArray(visibleCompanies)) u.visibleCompanies = visibleCompanies;
  }
  if (password) Object.assign(u, hashPassword(password));
  writeUsers(store);
  return { ok: true };
}

function deleteUser(username) {
  const name = String(username || '').toLowerCase();
  if (name === 'admin') return { ok: false, error: 'The admin account cannot be deleted' };
  const store = seed();
  store.users = store.users.filter((u) => u.username.toLowerCase() !== name);
  writeUsers(store);
  if (currentUsername && currentUsername.toLowerCase() === name) logout();
  return { ok: true };
}

export default {
  init, session, currentUser, login, logout, register, setOwnPassword,
  listUsers, createUser, updateUser, deleteUser, publicUser, visibleCompaniesFor,
};
