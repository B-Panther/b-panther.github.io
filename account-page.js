(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const API_BASE = (document.querySelector('meta[name="egmail-api-origin"]')?.content || '').replace(/\/+$/, '');
  const mode = document.body.dataset.accountMode === 'register' ? 'register' : 'login';
  const form = mode === 'login' ? $('#loginForm') : $('#registerForm');
  const message = $('#accountPageMessage');
  const submitButton = form && form.querySelector('button[type="submit"]');
  const alreadySignedIn = $('#alreadySignedIn');
  const continueLink = $('#continueLink');
  const otherPageLink = $('#otherAccountPageLink');
  let csrfToken = '';

  function safeReturnTo(candidate) {
    if (typeof candidate !== 'string' || !candidate.startsWith('/') || candidate.startsWith('//')) return '/';
    try {
      const url = new URL(candidate, window.location.origin);
      if (url.origin !== window.location.origin) return '/';
      if (['/login.html', '/create-account.html'].includes(url.pathname)) return '/';
      return `${url.pathname}${url.search}${url.hash}`;
    } catch (_) { return '/'; }
  }

  const params = new URLSearchParams(window.location.search);
  const returnTo = safeReturnTo(params.get('returnTo') || '/');

  function accountPageUrl(path) {
    const url = new URL(path, window.location.origin);
    if (returnTo !== '/') url.searchParams.set('returnTo', returnTo);
    return `${url.pathname}${url.search}`;
  }

  function setMessage(text, kind = '') {
    if (!message) return;
    message.textContent = text || '';
    message.classList.toggle('is-error', kind === 'error');
    message.classList.toggle('is-success', kind === 'success');
  }

  async function request(path, options = {}) {
    if (!API_BASE) throw new Error('Account service is not configured.');
    const method = String(options.method || 'GET').toUpperCase();
    const headers = { Accept: 'application/json' };
    const init = { method, headers, credentials: 'include', cache: 'no-store' };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      if (!csrfToken) throw new Error('Security token is unavailable. Reload this page and try again.');
      headers['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch(`${API_BASE}${path}`, init);
    let data = {};
    try { data = await response.json(); } catch (_) { /* use a generic message */ }
    if (!response.ok) throw new Error(data && data.error || 'The account request could not be completed.');
    return data;
  }

  async function init() {
    if (otherPageLink) {
      otherPageLink.href = accountPageUrl(mode === 'login' ? '/create-account.html' : '/login.html');
    }
    if (continueLink) continueLink.href = returnTo;
    if (submitButton) submitButton.disabled = true;
    try {
      const session = await request('/api/auth/session');
      csrfToken = typeof session.csrfToken === 'string' ? session.csrfToken : '';
      if (session.authenticated) {
        if (form) form.hidden = true;
        if (alreadySignedIn) alreadySignedIn.hidden = false;
        setMessage('Your account session is active.', 'success');
        return;
      }
      if (form) form.hidden = false;
      if (submitButton) submitButton.disabled = false;
      setMessage('');
    } catch (_) {
      if (form) form.hidden = false;
      if (submitButton) submitButton.disabled = true;
      setMessage('Account service is unavailable right now. Your public inbox and local saves are still available.', 'error');
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!form || !form.reportValidity()) return;
    const loginPassword = $('#loginPassword');
    const registerPassword = $('#registerPassword');
    const confirmPassword = $('#registerPasswordConfirm');
    if (mode === 'register' && registerPassword.value !== confirmPassword.value) {
      setMessage('The passwords do not match.', 'error');
      confirmPassword.focus();
      return;
    }

    if (submitButton) submitButton.disabled = true;
    setMessage(mode === 'login' ? 'Signing in securely…' : 'Creating your account…');
    try {
      if (mode === 'login') {
        await request('/api/auth/login', {
          method: 'POST',
          body: { identifier: $('#loginIdentifier').value.trim(), password: loginPassword.value }
        });
        loginPassword.value = '';
      } else {
        await request('/api/auth/register', {
          method: 'POST',
          body: {
            phone: $('#registerPhone').value.trim(),
            username: $('#registerUsername').value.trim().toLowerCase(),
            password: registerPassword.value
          }
        });
        registerPassword.value = '';
        confirmPassword.value = '';
      }
      setMessage(mode === 'login' ? 'Signed in. Returning to EgMail…' : 'Account created. Opening EgMail…', 'success');
      window.setTimeout(() => window.location.replace(returnTo), 300);
    } catch (error) {
      setMessage(error && error.message || 'Please try again.', 'error');
      if (submitButton) submitButton.disabled = false;
    }
  }

  if (form) form.addEventListener('submit', submit);
  const username = $('#registerUsername');
  if (username) username.addEventListener('input', () => {
    username.value = username.value.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 32);
  });

  try {
    const savedTheme = localStorage.getItem('egmail_theme_v1');
    if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.dataset.theme = savedTheme;
  } catch (_) { /* theme is optional */ }

  init();
})();
