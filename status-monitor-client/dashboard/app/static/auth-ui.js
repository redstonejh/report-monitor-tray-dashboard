// Account layer for the dashboard: the default onboarding (a sign-in / create-
// account gate), a top-right account button that matches the other circular
// window controls, an account menu, admin account management with per-
// permission checkboxes, a forced first-login password reset for admin-created
// accounts, and a viewer-mode lockdown that hides editing controls.
//
// All chrome reuses the dashboard's existing liquid-glass system: the button is
// a `.window-glass-control` (already WebGL-refracted) and every floating panel
// uses `.nav-menu-shell.floating-glass-menu` with `--ink`/glass tokens. No new
// glass styling is invented here.
//
// Auth state lives in the main process (window.auth bridge); after a sign-in,
// sign-up or password reset the window reloads so the per-user layout store and
// permissions take effect.
(() => {
  const bridge = window.auth;
  if (!bridge) return;

  const escapeHtml = (v) => String(v ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  const roleOf = (u) => (u.isAdmin ? "Admin" : u.permissions.canEdit ? "Editor" : "Viewer");

  injectStyles();

  // ─── Sign-in / create-account / set-password gate ────────────────────────────
  let gateMode = "signin"; // 'signin' | 'create' | 'setpw'
  const gate = document.createElement("div");
  gate.className = "auth-gate";
  gate.innerHTML = `
    <form class="auth-card nav-menu-shell floating-glass-menu" autocomplete="off">
      <div class="auth-brand">Report Monitor</div>
      <div class="auth-sub"></div>
      <label class="auth-field auth-field-username"><span>Username</span>
        <input class="auth-input" name="username" autocomplete="username"></label>
      <label class="auth-field"><span class="auth-pw-label">Password</span>
        <input class="auth-input" name="password" type="password" autocomplete="current-password"></label>
      <div class="auth-error" hidden></div>
      <button class="auth-submit" type="submit"></button>
      <button class="auth-switch" type="button"></button>
    </form>`;
  document.body.appendChild(gate);
  const gateForm = gate.querySelector(".auth-card");
  const gateError = gate.querySelector(".auth-error");
  const gateSub = gate.querySelector(".auth-sub");
  const gateSubmit = gate.querySelector(".auth-submit");
  const gateSwitch = gate.querySelector(".auth-switch");
  const gateUserField = gate.querySelector(".auth-field-username");
  const gatePwLabel = gate.querySelector(".auth-pw-label");

  function renderGateMode() {
    gateError.hidden = true;
    if (gateMode === "setpw") {
      gateSub.textContent = "Set a new password to continue";
      gatePwLabel.textContent = "New password";
      gateSubmit.textContent = "Set password";
      gateUserField.hidden = true;
      gateSwitch.hidden = true;
    } else if (gateMode === "create") {
      gateSub.textContent = "Create your account";
      gatePwLabel.textContent = "Password";
      gateSubmit.textContent = "Create account";
      gateUserField.hidden = false;
      gateSwitch.hidden = false;
      gateSwitch.textContent = "Back to sign in";
    } else {
      gateSub.textContent = "Sign in to your dashboard";
      gatePwLabel.textContent = "Password";
      gateSubmit.textContent = "Sign in";
      gateUserField.hidden = false;
      gateSwitch.hidden = false;
      gateSwitch.textContent = "Create an account";
    }
  }

  gateSwitch.addEventListener("click", () => {
    gateMode = gateMode === "create" ? "signin" : "create";
    gateForm.reset();
    renderGateMode();
    gateForm.username.focus();
  });

  gateForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    gateError.hidden = true;
    const username = gateForm.username.value.trim();
    const password = gateForm.password.value;
    let result;
    if (gateMode === "setpw") result = await bridge.setPassword(password);
    else if (gateMode === "create") result = await bridge.register(username, password);
    else result = await bridge.login(username, password);
    if (result?.ok) { window.location.reload(); return; }
    gateError.textContent = result?.error || "Something went wrong";
    gateError.hidden = false;
  });

  // ─── Account button + menu (top-right, matches window controls) ───────────────
  const profile = document.createElement("div");
  profile.className = "auth-profile-cluster";
  profile.innerHTML = `
    <button class="window-glass-control auth-profile-button" type="button" aria-label="Account" aria-haspopup="true"></button>
    <div class="auth-profile-menu nav-menu-shell floating-glass-menu" role="menu">
      <div class="auth-profile-head">
        <strong class="auth-profile-name"></strong>
        <span class="auth-role-badge"></span>
      </div>
      <button class="auth-menu-item auth-manage" type="button" hidden>Manage accounts</button>
      <button class="auth-menu-item auth-signout" type="button">Sign out</button>
    </div>`;
  document.body.appendChild(profile);
  const nameEl = profile.querySelector(".auth-profile-name");
  const roleEl = profile.querySelector(".auth-role-badge");
  const manageBtn = profile.querySelector(".auth-manage");
  profile.querySelector(".auth-profile-button").addEventListener("click", () => profile.classList.toggle("open"));
  profile.querySelector(".auth-signout").addEventListener("click", async () => {
    await bridge.logout();
    window.location.reload();
  });
  manageBtn.addEventListener("click", () => { profile.classList.remove("open"); openManageUsers(); });
  document.addEventListener("click", (e) => { if (!profile.contains(e.target)) profile.classList.remove("open"); });

  // ─── Session application ─────────────────────────────────────────────────────
  function applySession(s) {
    const user = s && s.user ? s.user : null;
    if (!user) {
      if (gateMode === "setpw") gateMode = "signin";
      gate.style.display = "flex";
      profile.style.display = "none";
      document.body.classList.remove("dashboard-viewer");
      renderGateMode();
      return;
    }
    if (user.mustChangePassword) {
      gateMode = "setpw";
      gate.style.display = "flex";
      profile.style.display = "none";
      renderGateMode();
      return;
    }
    gate.style.display = "none";
    profile.style.display = "block";
    nameEl.textContent = user.username;
    roleEl.textContent = roleOf(user);
    manageBtn.hidden = !(user.isAdmin || user.permissions.canManageUsers);
    document.body.classList.toggle("dashboard-viewer", !user.permissions.canEdit);
  }
  bridge.session().then(applySession).catch(() => applySession(null));
  bridge.onChanged(applySession);

  // ─── Manage accounts (admin) ─────────────────────────────────────────────────
  let manageEl = null;
  async function openManageUsers() {
    const res = await bridge.listUsers();
    if (!res?.ok) return;
    if (manageEl) manageEl.remove();
    manageEl = document.createElement("div");
    manageEl.className = "auth-modal-backdrop";
    manageEl.innerHTML = `
      <div class="auth-modal nav-menu-shell floating-glass-menu">
        <div class="auth-modal-head">
          <strong>Accounts</strong>
          <button class="auth-modal-close" type="button" aria-label="Close">✕</button>
        </div>
        <div class="auth-user-list"></div>
        <div class="auth-modal-divider"></div>
        <form class="auth-new-user">
          <div class="auth-new-row">
            <input class="auth-input" name="username" placeholder="New username">
            <input class="auth-input" name="password" type="password" placeholder="Temporary password">
          </div>
          <label class="auth-perm"><input type="checkbox" name="canEdit"> Can edit dashboards</label>
          <label class="auth-perm"><input type="checkbox" name="canManageUsers"> Can manage accounts</label>
          <button class="auth-submit auth-add" type="submit">Add account</button>
          <div class="auth-modal-hint">They'll set their own password on first sign-in.</div>
          <div class="auth-error auth-new-error" hidden></div>
        </form>
      </div>`;
    document.body.appendChild(manageEl);
    manageEl.querySelector(".auth-modal-close").addEventListener("click", () => manageEl.remove());
    manageEl.addEventListener("click", (e) => { if (e.target === manageEl) manageEl.remove(); });
    renderUserList(res.users);

    const form = manageEl.querySelector(".auth-new-user");
    const newError = manageEl.querySelector(".auth-new-error");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      newError.hidden = true;
      const r = await bridge.createUser({
        username: form.username.value.trim(),
        password: form.password.value,
        permissions: { canEdit: form.canEdit.checked, canManageUsers: form.canManageUsers.checked },
      });
      if (r?.ok) { openManageUsers(); }
      else { newError.textContent = r?.error || "Could not add account"; newError.hidden = false; }
    });
  }

  function renderUserList(users) {
    const list = manageEl.querySelector(".auth-user-list");
    list.innerHTML = users.map((u) => `
      <div class="auth-user-row" data-username="${escapeHtml(u.username)}">
        <span class="auth-user-name">${escapeHtml(u.username)}<span class="auth-role-badge">${roleOf(u)}</span></span>
        <label class="auth-perm-inline" title="Can edit dashboards">
          <input type="checkbox" data-perm="canEdit" ${u.permissions.canEdit ? "checked" : ""} ${u.isAdmin ? "disabled" : ""}> Edit</label>
        <label class="auth-perm-inline" title="Can manage accounts">
          <input type="checkbox" data-perm="canManageUsers" ${u.permissions.canManageUsers ? "checked" : ""} ${u.isAdmin ? "disabled" : ""}> Manage</label>
        <button class="auth-user-delete" type="button" ${u.isAdmin ? "disabled" : ""} aria-label="Delete account">✕</button>
      </div>`).join("");

    list.querySelectorAll(".auth-user-row").forEach((row) => {
      const username = row.dataset.username;
      row.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.addEventListener("change", async () => {
          const perms = {};
          row.querySelectorAll('input[type="checkbox"]').forEach((c) => { perms[c.dataset.perm] = c.checked; });
          await bridge.updateUser(username, { permissions: perms });
        });
      });
      row.querySelector(".auth-user-delete").addEventListener("click", async () => {
        await bridge.deleteUser(username);
        openManageUsers();
      });
    });
  }

  // ─── Styles (tokens + existing glass classes only) ───────────────────────────
  function injectStyles() {
    const style = document.createElement("style");
    style.id = "auth-ui-styles";
    style.textContent = `
      .auth-gate {
        position: fixed; inset: 0; z-index: 100000;
        display: flex; align-items: center; justify-content: center;
        background: rgba(10, 12, 16, 0.5);
        -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px);
      }
      .auth-card {
        width: 320px; max-width: calc(100vw - 36px);
        display: flex; flex-direction: column; gap: 12px;
        padding: 24px 22px; color: var(--ink);
      }
      .auth-brand { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; color: var(--ink); }
      .auth-sub { font-size: 12.5px; color: color-mix(in srgb, var(--ink) 64%, transparent); margin-bottom: 6px; }
      .auth-field { display: flex; flex-direction: column; gap: 5px; }
      .auth-field[hidden] { display: none; }
      .auth-field > span { font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: color-mix(in srgb, var(--ink) 56%, transparent); }
      .auth-input {
        height: 38px; padding: 0 12px; border-radius: var(--radius-sm, 12px);
        background: color-mix(in srgb, var(--ink) 5%, transparent);
        border: 1px solid var(--glass-border); color: var(--ink);
        font: inherit; font-size: 13px; outline: none;
        transition: border-color 0.15s ease, background 0.15s ease;
      }
      .auth-input::placeholder { color: color-mix(in srgb, var(--ink) 40%, transparent); }
      .auth-input:focus { border-color: color-mix(in srgb, var(--ink) 42%, transparent); background: color-mix(in srgb, var(--ink) 8%, transparent); }
      .auth-submit {
        height: 40px; margin-top: 4px; border: 0; border-radius: var(--radius-sm, 12px); cursor: pointer;
        background: var(--ink); color: var(--glass-surface-strong, #fff);
        font: inherit; font-size: 13.5px; font-weight: 600;
        transition: opacity 0.15s ease, transform 0.1s ease;
      }
      .auth-submit:hover { opacity: 0.9; }
      .auth-submit:active { transform: translateY(1px); }
      .auth-switch {
        align-self: center; background: transparent; border: 0; cursor: pointer;
        font: inherit; font-size: 12px; color: color-mix(in srgb, var(--ink) 64%, transparent);
      }
      .auth-switch:hover { color: var(--ink); text-decoration: underline; }
      .auth-error { font-size: 12px; color: #e5484d; }

      .auth-profile-cluster {
        position: fixed; inset: 12px 54px auto auto;
        z-index: calc(var(--z-menu-overlay, 2600) + 21);
      }
      .auth-profile-button::before {
        content: ""; width: 17px; height: 17px; background: currentColor;
        -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'/%3E%3Ccircle cx='12' cy='7' r='4'/%3E%3C/svg%3E") center / contain no-repeat;
        mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'/%3E%3Ccircle cx='12' cy='7' r='4'/%3E%3C/svg%3E") center / contain no-repeat;
      }
      .auth-profile-menu {
        position: absolute; top: calc(100% + 8px); right: 0; width: 220px;
        display: none; flex-direction: column; gap: 2px; padding: 8px;
      }
      .auth-profile-cluster.open .auth-profile-menu { display: flex; }
      .auth-profile-head { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px 10px; }
      .auth-profile-name { font-size: 14px; font-weight: 600; color: var(--ink); }
      .auth-role-badge {
        align-self: flex-start; font-size: 10px; font-weight: 700; letter-spacing: 0.03em;
        text-transform: uppercase; padding: 1px 8px; border-radius: var(--radius-pill, 999px);
        background: color-mix(in srgb, var(--ink) 10%, transparent);
        color: color-mix(in srgb, var(--ink) 70%, transparent);
      }
      .auth-menu-item {
        text-align: left; border: 0; border-radius: var(--radius-sm, 10px); padding: 9px 10px; cursor: pointer;
        background: transparent; color: var(--ink); font: inherit; font-size: 13px;
        transition: background 0.12s ease;
      }
      .auth-menu-item:hover { background: color-mix(in srgb, var(--ink) 8%, transparent); }

      .auth-modal-backdrop {
        position: fixed; inset: 0; z-index: 100001;
        display: flex; align-items: center; justify-content: center;
        background: rgba(10, 12, 16, 0.46);
        -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
      }
      .auth-modal {
        width: 440px; max-width: calc(100vw - 36px); max-height: calc(100vh - 60px); overflow: auto;
        display: flex; flex-direction: column; gap: 12px; padding: 18px; color: var(--ink);
      }
      .auth-modal-head { display: flex; align-items: center; justify-content: space-between; font-size: 15px; }
      .auth-modal-close { background: transparent; border: 0; color: color-mix(in srgb, var(--ink) 60%, transparent); font-size: 14px; cursor: pointer; }
      .auth-modal-close:hover { color: var(--ink); }
      .auth-modal-divider { height: 1px; background: var(--glass-border); }
      .auth-modal-hint { font-size: 11.5px; color: color-mix(in srgb, var(--ink) 56%, transparent); }
      .auth-user-list { display: flex; flex-direction: column; gap: 4px; }
      .auth-user-row { display: flex; align-items: center; gap: 10px; padding: 6px 2px; }
      .auth-user-name { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: var(--ink); }
      .auth-perm-inline { display: flex; align-items: center; gap: 4px; font-size: 11px; color: color-mix(in srgb, var(--ink) 72%, transparent); cursor: pointer; }
      .auth-user-delete { background: transparent; border: 0; color: color-mix(in srgb, #e5484d 72%, transparent); cursor: pointer; font-size: 12px; }
      .auth-user-delete:hover:not(:disabled) { color: #e5484d; }
      .auth-user-delete:disabled { opacity: 0.3; cursor: default; }
      .auth-new-user { display: flex; flex-direction: column; gap: 9px; }
      .auth-new-row { display: flex; gap: 8px; }
      .auth-new-row .auth-input { flex: 1; }
      .auth-perm { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: color-mix(in srgb, var(--ink) 82%, transparent); cursor: pointer; }

      /* Viewer mode: hide editing affordances so the dashboard is read-only. */
      body.dashboard-viewer .control-bar-gear,
      body.dashboard-viewer .panel-tool-drawer,
      body.dashboard-viewer .panel-tools,
      body.dashboard-viewer .widget-tools,
      body.dashboard-viewer .panel-add-picker,
      body.dashboard-viewer [data-floating-control-bar] { display: none !important; }
      body.dashboard-viewer .panel-move-handle,
      body.dashboard-viewer .panel-resize-handle { pointer-events: none !important; }

      @media (prefers-reduced-motion: reduce) {
        .auth-submit:active { transform: none; }
      }
    `;
    document.head.appendChild(style);
  }
})();
