(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const API_BASE = (document.querySelector('meta[name="egmail-api-origin"]')?.content || '').replace(/\/+$/, '');
  const els = {
    button: $('#accountButton'), buttonLabel: $('#accountButtonLabel'), storageStatus: $('#accountStorageStatus'),
    dialog: $('#accountDialog'), close: $('#closeAccount'), title: $('#accountTitle'), lead: $('#accountLead'),
    authForms: $('#authForms'), panel: $('#accountPanel'), loginTab: $('#loginTab'), registerTab: $('#registerTab'),
    loginForm: $('#loginForm'), registerForm: $('#registerForm'), loginIdentifier: $('#loginIdentifier'), loginPassword: $('#loginPassword'),
    registerPhone: $('#registerPhone'), registerUsername: $('#registerUsername'), registerPassword: $('#registerPassword'), registerPasswordConfirm: $('#registerPasswordConfirm'),
    showRegister: $('#showRegisterLink'), authMessage: $('#authMessage'), username: $('#accountUsername'), avatar: $('#accountAvatar'), phone: $('#accountPhone'),
    changePasswordForm: $('#changePasswordForm'), currentPassword: $('#currentPassword'), newPassword: $('#newPassword'), confirmNewPassword: $('#confirmNewPassword'),
    accountMessage: $('#accountMessage'), logout: $('#logoutButton')
  };
  const state = {
    authenticated: false,
    user: null,
    csrfToken: '',
    addresses: [],
    settings: { theme: 'light', autoRefresh: false },
    onChange: null,
    mode: 'login'
  };

  function setMessage(element, message, kind = '') {
    element.textContent = message || '';
    element.classList.toggle('is-error', kind === 'error');
    element.classList.toggle('is-success', kind === 'success');
  }

  function updateHeader() {
    const dot = els.storageStatus.querySelector('.status-dot') || document.createElement('span');
    dot.className = 'status-dot';
    els.storageStatus.replaceChildren(dot, document.createTextNode(state.authenticated ? ' Account sync on' : ' Local saves'));
    els.buttonLabel.textContent = state.authenticated ? 'Account' : 'Sign in';
  }

  function setMode(mode) {
    state.mode = mode === 'register' ? 'register' : 'login';
    els.loginForm.hidden = state.mode !== 'login';
    els.registerForm.hidden = state.mode !== 'register';
    els.loginTab.setAttribute('aria-selected', String(state.mode === 'login'));
    els.registerTab.setAttribute('aria-selected', String(state.mode === 'register'));
    els.title.textContent = state.mode === 'login' ? 'Sign in to sync' : 'Create your account';
    els.lead.textContent = state.mode === 'login'
      ? 'Open your saved addresses and preferences on another browser.'
      : 'Use an unverified phone number, a username, and a password. No SMS code is sent.';
    setMessage(els.authMessage, '');
  }

  function renderView() {
    els.authForms.hidden = state.authenticated;
    els.panel.hidden = !state.authenticated;
    if (state.authenticated && state.user) {
      els.title.textContent = 'Your EgMail account';
      els.lead.textContent = 'Manage account security and see what follows your sign-in.';
      els.username.textContent = `@${state.user.username}`;
      els.avatar.textContent = String(state.user.username || 'E').slice(0, 1).toUpperCase();
      els.phone.textContent = state.user.phoneMasked || 'Unverified number';
      setMessage(els.authMessage, '');
    } else {
      setMode(state.mode);
    }
    updateHeader();
  }

  async function request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    const init = { method, headers, credentials: API_BASE ? 'include' : 'same-origin', cache: 'no-store' };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      if (!state.csrfToken) throw new Error('Security token is unavailable. Refresh and try again.');
      headers['X-CSRF-Token'] = state.csrfToken;
    }
    const response = await fetch(`${API_BASE}${path}`, init);
    let data = {};
    try { data = await response.json(); } catch (_) { /* use a generic response below */ }
    if (!response.ok) throw new Error(data && data.error || 'The account request could not be completed.');
    return data;
  }

  async function loadAccountData() {
    const [addressData, settingsData] = await Promise.all([
      request('/api/account/addresses'),
      request('/api/account/settings')
    ]);
    state.addresses = Array.isArray(addressData.addresses) ? addressData.addresses : [];
    state.settings = settingsData.settings || { theme: 'light', autoRefresh: false };
  }

  async function notify(detail = {}) {
    if (typeof state.onChange === 'function') {
      await state.onChange({
        authenticated: state.authenticated,
        justAuthenticated: Boolean(detail.justAuthenticated),
        settings: { ...state.settings },
        user: state.user
      });
    }
  }

  async function init() {
    try {
      const data = await request('/api/auth/session');
      state.csrfToken = typeof data.csrfToken === 'string' ? data.csrfToken : '';
      state.authenticated = Boolean(data.authenticated && data.user);
      state.user = state.authenticated ? data.user : null;
      if (state.authenticated) await loadAccountData();
      else {
        state.addresses = [];
        state.settings = { theme: 'light', autoRefresh: false };
      }
      renderView();
      await notify({ justAuthenticated: false });
      return true;
    } catch (_) {
      renderView();
      setMessage(els.authMessage, 'Account service is unavailable right now. You can still use local inbox features.', 'error');
      return false;
    }
  }

  function openDialog() {
    if (!state.authenticated) {
      const currentRoute = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const loginUrl = new URL('/login.html', window.location.origin);
      if (!['/login.html', '/create-account.html'].includes(window.location.pathname)) {
        loginUrl.searchParams.set('returnTo', currentRoute);
      }
      window.location.assign(`${loginUrl.pathname}${loginUrl.search}`);
      return;
    }
    renderView();
    if (typeof els.dialog.showModal === 'function') els.dialog.showModal();
    else els.dialog.setAttribute('open', '');
  }

  async function finishAuthentication(data) {
    state.authenticated = true;
    state.user = data.user;
    setMessage(els.authMessage, '');
    try { await loadAccountData(); }
    catch (_) {
      state.addresses = [];
      state.settings = { theme: 'light', autoRefresh: false };
    }
    renderView();
    if (typeof els.dialog.close === 'function') els.dialog.close();
    await notify({ justAuthenticated: true });
  }

  async function runForm(form, action) {
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try { await action(); }
    catch (error) { setMessage(els.authMessage, error.message || 'Please try again.', 'error'); }
    finally { if (button) button.disabled = false; }
  }

  async function saveAddress(address) {
    if (!state.authenticated) return null;
    const data = await request('/api/account/addresses', { method: 'POST', body: { address } });
    const entry = data.address;
    if (entry && !state.addresses.some((saved) => saved.address === entry.address)) state.addresses.unshift(entry);
    await notify();
    return entry || null;
  }

  async function removeAddress(id) {
    if (!state.authenticated) return;
    await request(`/api/account/addresses/${encodeURIComponent(id)}`, { method: 'DELETE' });
    state.addresses = state.addresses.filter((entry) => String(entry.id) !== String(id));
    await notify();
  }

  async function updateAddress(entry) {
    if (!state.authenticated || !entry || !entry.id) return;
    await request(`/api/account/addresses/${encodeURIComponent(entry.id)}`, {
      method: 'PATCH',
      body: { label: String(entry.label || ''), isFavorite: Boolean(entry.isFavorite) }
    });
    const index = state.addresses.findIndex((saved) => String(saved.id) === String(entry.id));
    if (index >= 0) state.addresses[index] = { ...state.addresses[index], ...entry };
    await notify();
  }

  async function saveSettings(settings) {
    if (!state.authenticated) return;
    const data = await request('/api/account/settings', { method: 'PUT', body: settings });
    state.settings = data.settings || settings;
  }

  els.button.addEventListener('click', openDialog);
  els.close.addEventListener('click', () => els.dialog.close());
  els.dialog.addEventListener('click', (event) => { if (event.target === els.dialog) els.dialog.close(); });
  els.loginTab.addEventListener('click', () => setMode('login'));
  els.registerTab.addEventListener('click', () => setMode('register'));
  els.showRegister.addEventListener('click', () => setMode('register'));
  els.registerUsername.addEventListener('input', () => { els.registerUsername.value = els.registerUsername.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''); });

  els.loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runForm(els.loginForm, async () => {
      const data = await request('/api/auth/login', {
        method: 'POST', body: { identifier: els.loginIdentifier.value.trim(), password: els.loginPassword.value }
      });
      els.loginPassword.value = '';
      await finishAuthentication(data);
    });
  });

  els.registerForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runForm(els.registerForm, async () => {
      if (els.registerPassword.value !== els.registerPasswordConfirm.value) throw new Error('The passwords do not match.');
      const data = await request('/api/auth/register', {
        method: 'POST',
        body: { phone: els.registerPhone.value.trim(), username: els.registerUsername.value.trim(), password: els.registerPassword.value }
      });
      els.registerPassword.value = '';
      els.registerPasswordConfirm.value = '';
      await finishAuthentication(data);
    });
  });

  els.changePasswordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = els.changePasswordForm.querySelector('button[type="submit"]');
    button.disabled = true;
    setMessage(els.accountMessage, '');
    try {
      if (els.newPassword.value !== els.confirmNewPassword.value) throw new Error('The new passwords do not match.');
      await request('/api/auth/password', {
        method: 'POST', body: { currentPassword: els.currentPassword.value, newPassword: els.newPassword.value }
      });
      els.changePasswordForm.reset();
      setMessage(els.accountMessage, 'Password updated. Other signed-in sessions have been signed out.', 'success');
    } catch (error) { setMessage(els.accountMessage, error.message || 'Password could not be changed.', 'error'); }
    finally { button.disabled = false; }
  });

  els.logout.addEventListener('click', async () => {
    els.logout.disabled = true;
    setMessage(els.accountMessage, '');
    try {
      await request('/api/auth/logout', { method: 'POST', body: {} });
      state.authenticated = false;
      state.user = null;
      state.addresses = [];
      state.settings = { theme: 'light', autoRefresh: false };
      renderView();
      await notify();
      els.dialog.close();
    } catch (error) { setMessage(els.accountMessage, error.message || 'Could not sign out right now.', 'error'); }
    finally { els.logout.disabled = false; }
  });

  window.EgMailAccount = Object.freeze({
    init,
    setChangeHandler(handler) { state.onChange = handler; },
    isAuthenticated() { return state.authenticated; },
    getUser() { return state.user ? { ...state.user } : null; },
    getAddresses() { return state.addresses.map((entry) => ({ ...entry })); },
    getSettings() { return { ...state.settings }; },
    saveAddress,
    removeAddress,
    updateAddress,
    saveSettings
  });
})();
