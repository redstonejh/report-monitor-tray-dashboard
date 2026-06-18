// Account layer for the dashboard: the default onboarding (a sign-in / create-
// account gate), a top-left account button that matches the other circular
// window controls, an account menu (+ a portaled Layout flyout), and admin
// account management with per-IP visibility + a manage-accounts checkbox.
//
// Every surface is dark glass via plain CSS backdrop-filter — NOT the WebGL
// shader. (These classes are NOT in liquid-glass-webgl.js OBJECT_SELECTOR; an
// older comment here claimed they were "registered in OBJECT_SELECTOR" — that was
// false. Don't rely on shader refraction for auth surfaces.) Because it's CSS
// backdrop-filter, nesting one inside another breaks it — see the big warning at
// the Layout flyout below. Darkness comes from the background, not a theme.
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
  const roleOf = (u) => ((u.isAdmin || u.permissions.canManageUsers) ? "Admin" : "Viewer");

  injectStyles();

  // ─── Sign-in / create-account / set-password gate ────────────────────────────
  let gateMode = "signin"; // 'signin' | 'create' | 'setpw'
  const gate = document.createElement("div");
  gate.className = "auth-gate";
  gate.innerHTML = `
    <form class="auth-card" autocomplete="off">
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
    <div class="auth-profile-menu" role="menu">
      <div class="auth-profile-head">
        <strong class="auth-profile-name"></strong>
      </div>
      <button class="auth-menu-item auth-manage" type="button" hidden>Manage accounts</button>
      <div class="auth-submenu-wrap">
        <button class="auth-menu-item auth-layout" type="button" aria-haspopup="true" aria-expanded="false">
          Layout<span class="auth-submenu-caret" aria-hidden="true">›</span>
        </button>
        <div class="auth-submenu" role="menu">
          <button class="auth-menu-item auth-layout-save" type="button">Save</button>
          <button class="auth-menu-item auth-layout-load" type="button">Load</button>
          <button class="auth-menu-item auth-layout-default" type="button">Default</button>
        </div>
      </div>
      <button class="auth-menu-item auth-signout" type="button">Sign out</button>
    </div>`;
  document.body.appendChild(profile);
  const nameEl = profile.querySelector(".auth-profile-name");
  const manageBtn = profile.querySelector(".auth-manage");
  // ┌─ READ THIS BEFORE TOUCHING ANY SUBMENU/FLYOUT GLASS ───────────────────────┐
  // │ A `backdrop-filter` element NESTED inside another `backdrop-filter` element │
  // │ is IGNORED by Chromium. So a flyout left as a child of .auth-profile-menu   │
  // │ (which is frosted) renders FLAT and can NEVER match the parent, no matter   │
  // │ how perfectly you copy the CSS. Things that DO NOT WORK (all tried, all     │
  // │ failed — do not "fix" it back to these):                                    │
  // │   • identical CSS while still nested        → flat, no frost                │
  // │   • a near-opaque solid background "to fake glass" → solid, still mismatched │
  // │ The ONLY fix is to PORTAL the flyout OUT of the filtered ancestor (onto     │
  // │ <body> here) and give it the parent's EXACT recipe, then position it in JS. │
  // │ VERIFY by reloading the dashboard + screenshotting over CDP — do NOT eyeball │
  // │ or assume (the dashboard is a static file, see note in electron/main.js).   │
  // └────────────────────────────────────────────────────────────────────────────┘
  const layoutBtn = profile.querySelector(".auth-layout");
  const layoutMenu = profile.querySelector(".auth-submenu");
  document.body.appendChild(layoutMenu);
  const closeLayoutMenu = () => {
    layoutMenu.classList.remove("open");
    layoutBtn.setAttribute("aria-expanded", "false");
  };
  // Collapse the menu (and its Layout flyout) together.
  const closeProfile = () => {
    profile.classList.remove("open");
    closeLayoutMenu();
  };
  profile.querySelector(".auth-profile-button").addEventListener("click", () => {
    if (profile.classList.contains("open")) closeProfile();
    else profile.classList.add("open");
  });
  profile.querySelector(".auth-signout").addEventListener("click", async () => {
    await bridge.logout();
    window.location.reload();
  });
  manageBtn.addEventListener("click", () => { closeProfile(); openManageUsers(); });
  document.addEventListener("click", (e) => {
    if (!profile.contains(e.target) && !layoutMenu.contains(e.target)) closeProfile();
  });

  // ─── Layout snapshots (per-account Save / Load / Default) ─────────────────────
  // The dashboard keeps its layout + panel colours in the per-account bridge
  // store and its background in localStorage. Save captures BOTH into one
  // snapshot (kept under its own key so a later reset never erases it); Load
  // restores them; Default wipes the customisation keys so the markup defaults
  // re-seed on reload. The saved snapshot survives Default, so the user can
  // always recover a layout they liked.
  const SNAPSHOT_KEY = "dashboard-saved-layout-snapshot";
  const store = window.dashboardPersistence || null;

  const localDashboardKeys = () => {
    const out = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith("dashboard-")) out.push(k);
    }
    return out;
  };
  // Remove every customisation key (layout, colours, background) but keep the
  // saved snapshot itself.
  const clearDashboardState = () => {
    if (store?.keys) {
      for (const k of store.keys()) {
        if (k !== SNAPSHOT_KEY) { try { store.removeItem(k); } catch {} }
      }
    }
    localDashboardKeys().forEach((k) => { try { localStorage.removeItem(k); } catch {} });
  };

  const layoutSave = () => {
    if (!store?.setItem) return false;
    const snap = { store: {}, local: {} };
    if (store.keys) {
      for (const k of store.keys()) {
        if (k === SNAPSHOT_KEY) continue;
        const v = store.getItem(k);
        if (v != null) snap.store[k] = v;
      }
    }
    localDashboardKeys().forEach((k) => { snap.local[k] = localStorage.getItem(k); });
    try { store.setItem(SNAPSHOT_KEY, JSON.stringify(snap)); return true; } catch { return false; }
  };

  const layoutLoad = () => {
    const raw = store?.getItem?.(SNAPSHOT_KEY);
    if (!raw) return false;
    let snap;
    try { snap = JSON.parse(raw); } catch { return false; }
    clearDashboardState();
    for (const [k, v] of Object.entries(snap.store || {})) { if (v != null) try { store.setItem(k, v); } catch {} }
    for (const [k, v] of Object.entries(snap.local || {})) { if (v != null) try { localStorage.setItem(k, v); } catch {} }
    window.location.reload();
    return true;
  };

  const layoutDefault = () => {
    clearDashboardState();
    window.location.reload();
  };

  // Transient label feedback for the actions that don't reload the page.
  const flashLabel = (btn, text) => {
    if (!btn || btn.dataset.flashing) return;
    const original = btn.textContent;
    btn.dataset.flashing = "1";
    btn.textContent = text;
    window.setTimeout(() => { btn.textContent = original; delete btn.dataset.flashing; }, 1200);
  };

  // Place the portaled flyout immediately to the right of the Layout item.
  const positionLayoutMenu = () => {
    const r = layoutBtn.getBoundingClientRect();
    layoutMenu.style.left = `${Math.round(r.right + 6)}px`;
    layoutMenu.style.top = `${Math.round(r.top - 8)}px`;
  };
  layoutBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = !layoutMenu.classList.contains("open");
    if (open) positionLayoutMenu();
    layoutMenu.classList.toggle("open", open);
    layoutBtn.setAttribute("aria-expanded", String(open));
  });
  layoutMenu.querySelector(".auth-layout-save").addEventListener("click", (e) => {
    e.stopPropagation();
    flashLabel(e.currentTarget, layoutSave() ? "Saved ✓" : "Unavailable");
  });
  layoutMenu.querySelector(".auth-layout-load").addEventListener("click", (e) => {
    e.stopPropagation();
    if (!layoutLoad()) flashLabel(e.currentTarget, "Nothing saved");
  });
  layoutMenu.querySelector(".auth-layout-default").addEventListener("click", (e) => {
    e.stopPropagation();
    layoutDefault();
  });

  // ─── Session application ─────────────────────────────────────────────────────
  function applySession(s) {
    const user = s && s.user ? s.user : null;
    if (!user) {
      if (gateMode === "setpw") gateMode = "signin";
      gate.style.display = "flex";
      profile.style.display = "none";
      document.body.classList.add("auth-gated");
      renderGateMode();
      return;
    }
    if (user.mustChangePassword) {
      gateMode = "setpw";
      gate.style.display = "flex";
      profile.style.display = "none";
      document.body.classList.add("auth-gated");
      renderGateMode();
      return;
    }
    gate.style.display = "none";
    profile.style.display = "block";
    document.body.classList.remove("auth-gated");
    nameEl.textContent = user.username;
    manageBtn.hidden = !(user.isAdmin || user.permissions.canManageUsers);
    // Everyone can edit dashboards (move/resize/recolour/backgrounds); there is
    // no viewer lockdown. IP visibility is enforced upstream by the company list.
  }
  bridge.session().then(applySession).catch(() => applySession(null));
  bridge.onChanged(applySession);

  // ─── Manage accounts (admin) ─────────────────────────────────────────────────
  // Every monitored IP, fetched from the live company list. The signed-in admin
  // is unrestricted, so this is the full set the admin can grant from — including
  // any IP introduced since the last viewer was created.
  async function fetchCompanies() {
    try {
      const list = await window.dashboard?.getCompanies?.();
      return Array.isArray(list) ? list : [];
    } catch { return []; }
  }

  // A scrollable checklist of IPs. `selected` is a Set of company ids that start
  // checked. Each row shows the circuit label and (when known) its IP address.
  function ipChecklistMarkup(companies, selected) {
    if (!companies.length) return `<div class="auth-ip-empty">No IPs available yet.</div>`;
    return companies.map((c) => `
      <label class="auth-ip-item">
        <input type="checkbox" value="${escapeHtml(c.id)}" ${selected.has(c.id) ? "checked" : ""}>
        <span class="auth-ip-name">${escapeHtml(c.label || c.id)}</span>
        ${c.host ? `<span class="auth-ip-addr">${escapeHtml(c.host)}</span>` : ""}
      </label>`).join("");
  }
  const checkedIds = (container) =>
    [...container.querySelectorAll('input[type="checkbox"]:checked')].map((c) => c.value);

  let manageEl = null;
  async function openManageUsers() {
    const [res, companies] = await Promise.all([bridge.listUsers(), fetchCompanies()]);
    if (!res?.ok) return;
    if (manageEl) manageEl.remove();
    manageEl = document.createElement("div");
    manageEl.className = "auth-modal-backdrop";
    manageEl.innerHTML = `
      <div class="auth-modal">
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
          <label class="auth-perm"><input type="checkbox" name="canManageUsers"> Can manage accounts (admin)</label>
          <div class="auth-ip-section" data-ip-section>
            <div class="auth-ip-head">Visible IPs</div>
            <div class="auth-ip-list auth-new-ip-list"></div>
          </div>
          <button class="auth-submit auth-add" type="submit">Add account</button>
          <div class="auth-modal-hint">They'll set their own password on first sign-in. Only the IPs ticked here are visible to them; new IPs stay hidden until granted.</div>
          <div class="auth-error auth-new-error" hidden></div>
        </form>
      </div>`;
    document.body.appendChild(manageEl);
    manageEl.querySelector(".auth-modal-close").addEventListener("click", () => manageEl.remove());
    manageEl.addEventListener("click", (e) => { if (e.target === manageEl) manageEl.remove(); });
    renderUserList(res.users, companies);

    const form = manageEl.querySelector(".auth-new-user");
    const newError = manageEl.querySelector(".auth-new-error");
    const newIpList = form.querySelector(".auth-new-ip-list");
    const ipSection = form.querySelector("[data-ip-section]");
    newIpList.innerHTML = ipChecklistMarkup(companies, new Set());
    // An admin (manage = on) sees every IP, so the per-IP picker is moot for them.
    const manageToggle = form.canManageUsers;
    const syncIpSectionForNew = () => { ipSection.hidden = manageToggle.checked; };
    manageToggle.addEventListener("change", syncIpSectionForNew);
    syncIpSectionForNew();

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      newError.hidden = true;
      const r = await bridge.createUser({
        username: form.username.value.trim(),
        password: form.password.value,
        canManageUsers: manageToggle.checked,
        visibleCompanies: manageToggle.checked ? [] : checkedIds(newIpList),
      });
      if (r?.ok) { openManageUsers(); }
      else { newError.textContent = r?.error || "Could not add account"; newError.hidden = false; }
    });
  }

  function renderUserList(users, companies) {
    const list = manageEl.querySelector(".auth-user-list");
    list.innerHTML = users.map((u) => {
      const admin = u.isAdmin || u.permissions.canManageUsers; // unrestricted → no IP picker
      return `
      <div class="auth-user-block">
        <div class="auth-user-row" data-username="${escapeHtml(u.username)}">
          <span class="auth-user-name">${escapeHtml(u.username)}<span class="auth-role-badge">${roleOf(u)}</span></span>
          ${admin ? "" : `<button class="auth-ip-toggle" type="button" aria-expanded="false">IPs</button>`}
          <label class="auth-perm-inline" title="Can manage accounts">
            <input type="checkbox" data-perm="canManageUsers" ${u.permissions.canManageUsers ? "checked" : ""} ${u.isAdmin ? "disabled" : ""}> Admin</label>
          <button class="auth-user-delete" type="button" ${u.isAdmin ? "disabled" : ""} aria-label="Delete account">✕</button>
        </div>
        ${admin ? "" : `<div class="auth-ip-list auth-user-ip-list" hidden>${ipChecklistMarkup(companies, new Set(u.visibleCompanies || []))}</div>`}
      </div>`;
    }).join("");

    list.querySelectorAll(".auth-user-block").forEach((block) => {
      const row = block.querySelector(".auth-user-row");
      const username = row.dataset.username;
      const ipList = block.querySelector(".auth-user-ip-list");

      block.querySelector(".auth-ip-toggle")?.addEventListener("click", (e) => {
        const open = ipList.hidden;
        ipList.hidden = !open;
        e.currentTarget.setAttribute("aria-expanded", String(open));
      });
      ipList?.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.addEventListener("change", () => {
          bridge.updateUser(username, { visibleCompanies: checkedIds(ipList) });
        });
      });
      row.querySelector('input[data-perm="canManageUsers"]')?.addEventListener("change", async (e) => {
        await bridge.updateUser(username, { canManageUsers: e.target.checked });
        openManageUsers(); // promotion to admin removes the IP picker — re-render
      });
      row.querySelector(".auth-user-delete").addEventListener("click", async () => {
        await bridge.deleteUser(username);
        openManageUsers();
      });
    });
  }

  // ─── Styles: liquid glass (white text, clear dark glass) ─────────────────────
  function injectStyles() {
    const USER_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'/%3E%3Ccircle cx='12' cy='7' r='4'/%3E%3C/svg%3E";
    const style = document.createElement("style");
    style.id = "auth-ui-styles";
    style.textContent = `
      .auth-gate {
        position: fixed; inset: 0; z-index: 100000;
        display: flex; align-items: center; justify-content: center;
        background: rgba(8, 10, 14, 0.32);
      }
      /* While the gate is up, status is withheld by hiding the status elements
         themselves — not by burying the dashboard under an opaque sheet, so the
         sign-in card stays true liquid glass over the workspace. */
      body.auth-gated .status-indicator-cluster,
      body.auth-gated .stat-band,
      body.auth-gated .widget-card .stat-val { visibility: hidden; }

      /* Shared liquid-glass material — a clear (translucent) tint over a heavy
         blur so the workspace shows through it, white text. Lightness/darkness
         comes from whatever is behind it. */
      .auth-card,
      .auth-profile-menu,
      .auth-modal {
        color: #ffffff;
        background: rgba(17, 19, 25, 0.34);
        -webkit-backdrop-filter: blur(34px) saturate(150%);
        backdrop-filter: blur(34px) saturate(150%);
        border: 1px solid rgba(255, 255, 255, 0.18);
        box-shadow: 0 18px 42px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.22);
      }

      /* The dashboard styles every <button> as a blue pill with a blue drop
         shadow. Strip that from the account buttons (the glass profile button,
         a .window-glass-control, styles itself and is excluded). Each button is
         restyled explicitly below. */
      :where(.auth-gate, .auth-profile-menu, .auth-submenu, .auth-modal) button {
        min-height: 0; padding: 0; border: 0; border-radius: 0;
        background: transparent; box-shadow: none;
      }
      :where(.auth-gate, .auth-profile-menu, .auth-submenu, .auth-modal) button:hover,
      :where(.auth-gate, .auth-profile-menu, .auth-submenu, .auth-modal) button:active {
        background: transparent; box-shadow: none; transform: none;
      }

      .auth-card {
        width: 320px; max-width: calc(100vw - 36px);
        display: flex; flex-direction: column; gap: 12px;
        padding: 24px 22px; border-radius: 16px;
      }
      .auth-brand { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }
      .auth-sub { font-size: 12.5px; color: rgba(255, 255, 255, 0.62); margin-bottom: 6px; }
      .auth-field { display: flex; flex-direction: column; gap: 5px; }
      .auth-field[hidden] { display: none; }
      .auth-field > span { font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: rgba(255, 255, 255, 0.55); }
      .auth-input {
        height: 38px; padding: 0 12px; border-radius: 10px;
        background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.18);
        color: #ffffff; font: inherit; font-size: 13px; outline: none;
        transition: border-color 0.15s ease, background 0.15s ease;
      }
      .auth-input::placeholder { color: rgba(255, 255, 255, 0.42); }
      .auth-input:focus { border-color: rgba(255, 255, 255, 0.5); background: rgba(255, 255, 255, 0.1); }
      .auth-submit {
        height: 40px; margin-top: 4px; border: 1px solid rgba(255, 255, 255, 0.24); border-radius: 10px; cursor: pointer;
        background: rgba(255, 255, 255, 0.16); color: #ffffff;
        font: inherit; font-size: 13.5px; font-weight: 600;
        transition: background 0.15s ease, transform 0.1s ease;
      }
      .auth-submit:hover { background: rgba(255, 255, 255, 0.26); }
      .auth-submit:active { transform: translateY(1px); }
      .auth-switch {
        align-self: center; padding: 4px 8px; background: transparent; border: 0; cursor: pointer;
        font: inherit; font-size: 12px; color: rgba(255, 255, 255, 0.64);
      }
      .auth-switch:hover { color: #ffffff; text-decoration: underline; }
      .auth-error { font-size: 12px; color: #ff9b9b; }

      .auth-profile-cluster {
        position: fixed; inset: 12px auto auto 14px;
        z-index: calc(var(--z-menu-overlay, 2600) + 21);
        -webkit-app-region: no-drag;
      }
      .auth-profile-button::before {
        content: ""; width: 17px; height: 17px; background: currentColor;
        -webkit-mask: url("${USER_ICON}") center / contain no-repeat;
        mask: url("${USER_ICON}") center / contain no-repeat;
      }
      /* Account menu mirrors the "…" / search / background dropdowns EXACTLY:
         the same translucent popover shell + colour-only item hover (transparent
         background, text rgba .62 → white). Never a filled/blue hover. */
      .auth-profile-menu {
        position: absolute; top: calc(100% + 8px); left: 0; width: 220px;
        display: none; flex-direction: column; gap: 1px; padding: 8px 6px; border-radius: 14px;
        background: linear-gradient(180deg, rgba(22, 26, 36, 0.62), rgba(12, 16, 24, 0.55));
        -webkit-backdrop-filter: blur(26px) saturate(140%);
        backdrop-filter: blur(26px) saturate(140%);
        border: 1px solid rgba(255, 255, 255, 0.22);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.24), 0 18px 42px rgba(0, 0, 0, 0.4);
      }
      .auth-profile-cluster.open .auth-profile-menu { display: flex; }
      .auth-profile-head { display: flex; flex-direction: column; padding: 4px 12px 8px; }
      .auth-profile-name { font-size: 14px; font-weight: 700; color: #ffffff; }
      .auth-role-badge {
        align-self: flex-start; font-size: 10px; font-weight: 700; letter-spacing: 0.03em;
        text-transform: uppercase; padding: 1px 8px; border-radius: 999px;
        background: rgba(255, 255, 255, 0.12); color: rgba(255, 255, 255, 0.74);
      }
      .auth-menu-item {
        appearance: none; -webkit-appearance: none;
        display: flex; align-items: center; justify-content: flex-start;
        text-align: left; border: 0; outline: 0; box-shadow: none;
        border-radius: 8px; padding: 7px 12px; margin: 0; width: 100%; cursor: pointer;
        background: transparent; color: rgba(255, 255, 255, 0.62);
        font: inherit; font-size: 0.95rem; font-weight: 600; white-space: nowrap;
        transition: color 0.14s ease;
      }
      .auth-menu-item:hover, .auth-menu-item:focus-visible { background: transparent; color: #ffffff; }

      /* Layout flyout — PORTALED onto <body> (see the big warning in the JS) and
         given the EXACT same shell as .auth-profile-menu above. These values MUST
         stay byte-for-byte identical to .auth-profile-menu. Do NOT make it opaque,
         do NOT change the gradient/blur/border/shadow to "fix" a mismatch — if it
         looks wrong it's a NESTING/reload problem, not a values problem. */
      .auth-submenu-wrap { position: relative; }
      .auth-layout { justify-content: space-between; }
      .auth-submenu-caret { color: rgba(255, 255, 255, 0.5); font-weight: 700; padding-left: 10px; }
      .auth-layout[aria-expanded="true"] .auth-submenu-caret { color: #ffffff; }
      .auth-submenu {
        position: fixed; top: 0; left: 0; min-width: 150px;
        display: none; flex-direction: column; gap: 1px; padding: 8px 6px; border-radius: 14px;
        background: linear-gradient(180deg, rgba(22, 26, 36, 0.62), rgba(12, 16, 24, 0.55));
        -webkit-backdrop-filter: blur(26px) saturate(140%);
        backdrop-filter: blur(26px) saturate(140%);
        border: 1px solid rgba(255, 255, 255, 0.22);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.24), 0 18px 42px rgba(0, 0, 0, 0.4);
        z-index: calc(var(--z-menu-overlay, 2600) + 22);
      }
      .auth-submenu.open { display: flex; }

      .auth-modal-backdrop {
        position: fixed; inset: 0; z-index: 100001;
        display: flex; align-items: center; justify-content: center;
        background: rgba(8, 10, 14, 0.4);
      }
      .auth-modal {
        width: 440px; max-width: calc(100vw - 36px); max-height: calc(100vh - 60px); overflow: auto;
        display: flex; flex-direction: column; gap: 12px; padding: 18px; border-radius: 16px;
      }
      .auth-modal-head { display: flex; align-items: center; justify-content: space-between; font-size: 15px; }
      .auth-modal-close { background: transparent; border: 0; color: rgba(255, 255, 255, 0.6); font-size: 14px; cursor: pointer; }
      .auth-modal-close:hover { color: #ffffff; }
      .auth-modal-divider { height: 1px; background: rgba(255, 255, 255, 0.14); }
      .auth-modal-hint { font-size: 11.5px; color: rgba(255, 255, 255, 0.55); }
      .auth-user-list { display: flex; flex-direction: column; gap: 4px; }
      .auth-user-row { display: flex; align-items: center; gap: 10px; padding: 6px 2px; }
      .auth-user-name { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: #ffffff; }
      .auth-perm-inline { display: flex; align-items: center; gap: 4px; font-size: 11px; color: rgba(255, 255, 255, 0.7); cursor: pointer; }
      .auth-user-delete { background: transparent; border: 0; color: rgba(255, 140, 140, 0.75); cursor: pointer; font-size: 12px; }
      .auth-user-delete:hover:not(:disabled) { color: #ff8f8f; }
      .auth-user-delete:disabled { opacity: 0.3; cursor: default; }
      .auth-new-user { display: flex; flex-direction: column; gap: 9px; }
      .auth-new-row { display: flex; gap: 8px; }
      .auth-new-row .auth-input { flex: 1; }
      .auth-perm { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: rgba(255, 255, 255, 0.82); cursor: pointer; }
      .auth-user-block { display: flex; flex-direction: column; }

      /* Per-account IP allow-list: a compact, scrollable checklist of circuits. */
      .auth-ip-section { display: flex; flex-direction: column; gap: 6px; }
      .auth-ip-section[hidden] { display: none; }
      .auth-ip-head { font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: rgba(255, 255, 255, 0.55); }
      .auth-ip-list {
        display: flex; flex-direction: column; gap: 1px;
        max-height: 168px; overflow: auto; padding: 6px 8px; border-radius: 10px;
        background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.16);
      }
      .auth-user-ip-list { margin: 2px 0 8px; }
      .auth-ip-item { display: flex; align-items: center; gap: 8px; padding: 3px 2px; font-size: 12px; color: rgba(255, 255, 255, 0.82); cursor: pointer; }
      .auth-ip-item input { flex: none; }
      .auth-ip-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .auth-ip-addr { margin-left: auto; padding-left: 10px; font-size: 11px; color: rgba(255, 255, 255, 0.5); font-variant-numeric: tabular-nums; }
      .auth-ip-empty { font-size: 11.5px; color: rgba(255, 255, 255, 0.5); padding: 4px 2px; }
      .auth-ip-toggle {
        flex: none; padding: 2px 8px; border-radius: 7px; cursor: pointer;
        background: rgba(255, 255, 255, 0.08); color: rgba(255, 255, 255, 0.7);
        font: inherit; font-size: 11px; font-weight: 600;
      }
      .auth-ip-toggle:hover { color: #ffffff; background: rgba(255, 255, 255, 0.14); }

      /* Deletion is withheld from everyone — the delete controls stay in the DOM
         and their handlers stay wired, they are simply never shown. Editing
         (move / resize / colours / backgrounds) remains open to all. */
      .panel-delete-handle { display: none !important; }

      @media (prefers-reduced-motion: reduce) {
        .auth-submit:active { transform: none; }
      }
    `;
    document.head.appendChild(style);
  }
})();
