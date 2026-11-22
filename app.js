(() => {
  'use strict';

  const API_BASE = 'https://egmail.me/';
  const DOMAINS = ['otpgmail.me', 'ogmail.tech', 'egmail.me'];
  const STORAGE = {
    saved: 'egmail_saved_addresses_v1',
    active: 'egmail_active_address_v1',
    theme: 'egmail_theme_v1',
    autoRefresh: 'egmail_auto_refresh_v1'
  };
  const REFRESH_MS = 30000;
  const MAX_IMPORT_BYTES = 100000;
  const $ = (selector) => document.querySelector(selector);
  const els = {
    addressForm: $('#addressForm'), prefixInput: $('#prefixInput'), domainSelect: $('#domainSelect'), domainField: $('#domainField'),
    randomButton: $('#randomButton'), openButton: $('#openButton'), activeAddress: $('#activeAddress'), inboxState: $('#inboxState'),
    copyAddressButton: $('#copyAddressButton'), saveAddressButton: $('#saveAddressButton'), savedList: $('#savedList'), savedCount: $('#savedCount'),
    exportButton: $('#exportButton'), importButton: $('#importButton'), importFile: $('#importFile'), messageCount: $('#messageCount'),
    updatedLabel: $('#updatedLabel'), refreshButton: $('#refreshButton'), autoRefreshToggle: $('#autoRefreshToggle'),
    searchInput: $('#searchInput'), sortSelect: $('#sortSelect'), messageList: $('#messageList'), listSummary: $('#listSummary'),
    listPageNote: $('#listPageNote'), listFooter: $('#listFooter'), messageLayout: $('#messageLayout'), detailPanel: $('#detailPanel'),
    detailPlaceholder: $('#detailPlaceholder'), detailContent: $('#detailContent'), detailSubject: $('#detailSubject'), detailFrom: $('#detailFrom'),
    detailDate: $('#detailDate'), senderAvatar: $('#senderAvatar'), messageBody: $('#messageBody'), inboxStatus: $('#inboxStatus'),
    themeToggle: $('#themeToggle'), privacyButton: $('#privacyButton'), noticeMore: $('#noticeMore'), footerPrivacy: $('#footerPrivacy'),
    privacyDialog: $('#privacyDialog'), closePrivacy: $('#closePrivacy'), privacyDone: $('#privacyDone'), backToList: $('#backToList'), toast: $('#toast')
  };

  const state = {
    address: '', messages: [], stats: null, selectedKey: '', lastFetchedAt: null,
    busy: false, abortController: null, refreshTimer: null, toastTimer: null, searchTimer: null
  };

  function readSaved() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE.saved) || '[]');
      return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string').map(normalizeAddress).filter(Boolean).slice(0, 100) : [];
    } catch (_) { return []; }
  }

  function writeSaved(addresses) {
    const unique = [...new Set(addresses.map(normalizeAddress).filter(Boolean))].slice(0, 100);
    try { localStorage.setItem(STORAGE.saved, JSON.stringify(unique)); }
    catch (_) { showToast('This browser could not save the address list.'); }
    renderSaved();
    updateSaveButton();
  }

  function normalizeAddress(value) {
    const address = String(value || '').trim().toLowerCase();
    const match = address.match(/^([a-z0-9._-]{1,64})@([a-z0-9.-]+)$/);
    if (!match || !DOMAINS.includes(match[2])) return '';
    return `${match[1]}@${match[2]}`;
  }

  function normalizePrefix(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 64);
  }

  function normalizeAddressField(value) {
    const input = String(value || '').trim().toLowerCase();
    if (!input.includes('@')) return normalizePrefix(input);
    const address = input.slice(0, 130);
    const normalized = normalizeAddress(address);
    if (normalized) els.domainSelect.value = normalized.split('@')[1];
    return address;
  }

  function buildAddressFromForm() {
    const raw = String(els.prefixInput.value || '').trim().toLowerCase();
    if (raw.includes('@')) {
      const address = normalizeAddress(raw);
      if (!address) {
        els.prefixInput.setCustomValidity('Use one of the supported domains: otpgmail.me, ogmail.tech, or egmail.me.');
        els.prefixInput.reportValidity();
        return '';
      }
      const [prefix, domain] = address.split('@');
      els.prefixInput.value = prefix;
      els.domainSelect.value = domain;
      els.prefixInput.setCustomValidity('');
      return address;
    }
    const prefix = normalizePrefix(raw);
    els.prefixInput.value = prefix;
    const domain = DOMAINS.includes(els.domainSelect.value) ? els.domainSelect.value : 'egmail.me';
    if (!prefix || !/^[a-z0-9._-]{1,64}$/.test(prefix)) {
      els.prefixInput.setCustomValidity('Enter a prefix using lowercase letters, numbers, dots, underscores, or hyphens.');
      els.prefixInput.reportValidity();
      return '';
    }
    els.prefixInput.setCustomValidity('');
    return `${prefix}@${domain}`;
  }

  function randomPrefix(length = 10) {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    const bytes = new Uint8Array(length);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
  }

  function randomDomain() {
    const bytes = new Uint8Array(1);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else bytes[0] = Math.floor(Math.random() * 256);
    return DOMAINS[bytes[0] % DOMAINS.length];
  }

  function escapeHTML(text) {
    return String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function messageKey(message) {
    return [message.from || '', message.subject || '', message.date || ''].join('|').toLowerCase();
  }

  function dateValue(message) {
    const date = Date.parse(message.date || '');
    return Number.isFinite(date) ? date : 0;
  }

  function prettyDate(value, withTime = true) {
    const date = new Date(value || '');
    if (!Number.isFinite(date.getTime())) return 'Date unavailable';
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    if (sameDay && withTime) return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
    return new Intl.DateTimeFormat(undefined, withTime ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function shortTime(value) {
    const date = new Date(value || '');
    if (!Number.isFinite(date.getTime())) return '';
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff >= 0 && diff < 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / 60000))}m`;
    if (date.toDateString() === now.toDateString()) return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('is-visible');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), 2600);
  }

  function setStatus(message, isError = false) {
    els.inboxStatus.textContent = message;
    els.inboxStatus.classList.toggle('is-error', isError);
  }

  function setBusy(busy) {
    state.busy = busy;
    els.refreshButton.classList.toggle('is-loading', busy);
    els.refreshButton.disabled = busy || !state.address;
    els.openButton.disabled = false;
    els.randomButton.disabled = false;
  }

  function updateAddressUI() {
    const isOpen = Boolean(state.address);
    els.activeAddress.textContent = isOpen ? state.address : 'Choose or generate an address';
    els.activeAddress.classList.toggle('has-address', isOpen);
    els.inboxState.textContent = isOpen ? 'INBOX OPEN' : 'NOT OPEN';
    els.inboxState.classList.toggle('is-open', isOpen);
    els.copyAddressButton.disabled = !isOpen;
    els.saveAddressButton.disabled = !isOpen;
    els.refreshButton.disabled = !isOpen || state.busy;
    els.searchInput.disabled = !isOpen;
    updateSaveButton();
  }

  function updateSaveButton() {
    const isSaved = Boolean(state.address && readSaved().includes(state.address));
    const label = els.saveAddressButton.querySelector('span');
    if (label) label.textContent = isSaved ? 'Saved' : 'Save';
    els.saveAddressButton.classList.toggle('is-saved', isSaved);
    const path = els.saveAddressButton.querySelector('svg path');
    if (path) path.setAttribute('fill', isSaved ? 'currentColor' : 'none');
  }

  function renderSaved() {
    const saved = readSaved();
    els.savedCount.textContent = String(saved.length);
    els.exportButton.disabled = saved.length === 0;
    els.savedList.replaceChildren();
    if (!saved.length) {
      const empty = document.createElement('li');
      empty.className = 'saved-empty';
      empty.textContent = 'Saved addresses will appear here.';
      els.savedList.append(empty);
      return;
    }
    saved.forEach((address) => {
      const item = document.createElement('li');
      item.className = 'saved-item';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'saved-open';
      open.title = `Open ${address}`;
      const full = document.createElement('strong');
      full.textContent = address;
      const detail = document.createElement('span');
      detail.textContent = address === state.address ? 'Currently open' : 'Reopen inbox';
      open.append(full, detail);
      open.addEventListener('click', () => openInbox(address));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'saved-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${address} from saved addresses`);
      remove.addEventListener('click', () => {
        writeSaved(readSaved().filter((savedAddress) => savedAddress !== address));
        showToast('Address removed from this device.');
      });
      item.append(open, remove);
      els.savedList.append(item);
    });
  }

  function currentMessages() {
    const term = els.searchInput.value.trim().toLowerCase();
    let list = state.messages.slice();
    if (term) list = list.filter((message) => `${message.from || ''} ${message.subject || ''} ${contentAsText(message.content || '')}`.toLowerCase().includes(term));
    list.sort((a, b) => els.sortSelect.value === 'oldest' ? dateValue(a) - dateValue(b) : dateValue(b) - dateValue(a));
    return list;
  }

  function renderMessages() {
    const list = currentMessages();
    els.messageList.replaceChildren();
    els.messageCount.textContent = state.address ? String(state.messages.length) : '—';
    els.listSummary.textContent = !state.address ? 'Waiting for an inbox' : `${list.length} ${list.length === 1 ? 'message' : 'messages'}${els.searchInput.value.trim() ? ' found' : ''}`;
    els.listPageNote.textContent = state.messages.length ? 'Received' : '';
    els.listFooter.hidden = true;
    if (!list.length) {
      const item = document.createElement('li');
      item.className = 'empty-list';
      const graphic = document.createElement('div');
      graphic.className = 'empty-graphic';
      graphic.setAttribute('aria-hidden', 'true');
      graphic.innerHTML = '<svg viewBox="0 0 64 64" fill="none"><path d="M12 20h40v30H12zM12 21l20 16 20-16" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="48" cy="14" r="7" fill="#B8F36A"/><path d="M48 10.5v7m-3.5-3.5h7" stroke="#19211A" stroke-width="1.7" stroke-linecap="round"/></svg>';
      const strong = document.createElement('strong');
      strong.textContent = state.address ? (els.searchInput.value.trim() ? 'No matching messages' : 'Nothing here yet') : 'Your inbox is waiting';
      const span = document.createElement('span');
      span.textContent = state.address ? (els.searchInput.value.trim() ? 'Try another search term.' : 'Messages sent to this address will appear when the inbox service has them.') : 'Open an address above to load its messages.';
      item.append(graphic, strong, span);
      els.messageList.append(item);
      if (state.selectedKey) clearDetail();
      return;
    }
    list.forEach((message) => {
      const key = messageKey(message);
      const row = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `message-row${key === state.selectedKey ? ' is-active' : ''}`;
      button.setAttribute('aria-label', `${message.from || 'Unknown sender'}: ${message.subject || '(no subject)'}, ${prettyDate(message.date)}`);
      const avatar = document.createElement('span');
      avatar.className = 'sender-avatar';
      avatar.textContent = initials(message.from || '?');
      const main = document.createElement('span');
      main.className = 'message-main';
      const from = document.createElement('span');
      from.className = 'message-from';
      from.textContent = message.from || 'Unknown sender';
      const subject = document.createElement('span');
      subject.className = 'message-subject';
      subject.textContent = message.subject || '(no subject)';
      const preview = document.createElement('span');
      preview.className = 'message-preview';
      preview.textContent = contentAsText(message.content || '').replace(/\s+/g, ' ').trim().slice(0, 115) || 'No preview available';
      main.append(from, subject, preview);
      const time = document.createElement('time');
      time.className = 'message-time';
      time.textContent = shortTime(message.date);
      if (message.date && Number.isFinite(Date.parse(message.date))) time.dateTime = new Date(message.date).toISOString();
      button.append(avatar, main, time);
      button.addEventListener('click', () => selectMessage(message));
      row.append(button);
      els.messageList.append(row);
    });
  }

  function initials(value) {
    const cleaned = String(value).trim().replace(/[<>]/g, '');
    const first = (cleaned.split(/[@\s._-]/).filter(Boolean)[0] || '?').slice(0, 1);
    return first.toUpperCase();
  }

  function clearDetail() {
    state.selectedKey = '';
    els.detailContent.hidden = true;
    els.detailPlaceholder.hidden = false;
    els.messageLayout.classList.remove('mobile-detail');
    renderMessages();
  }

  function selectMessage(message) {
    const key = messageKey(message);
    state.selectedKey = key;
    els.detailPlaceholder.hidden = true;
    els.detailContent.hidden = false;
    els.detailSubject.textContent = message.subject || '(no subject)';
    els.detailFrom.textContent = message.from || 'Unknown sender';
    els.detailDate.textContent = prettyDate(message.date, false);
    els.senderAvatar.textContent = initials(message.from || '?');
    renderBody(els.messageBody, message.content || 'No message body was provided.');
    els.messageLayout.classList.add('mobile-detail');
    renderMessages();
  }

  function decodeQuotedPrintable(input) {
    let text = String(input || '').replace(/=\r?\n/g, '');
    text = text.replace(/(?:=[0-9a-f]{2})+/gi, (sequence) => {
      const bytes = sequence.match(/=[0-9a-f]{2}/gi).map((part) => parseInt(part.slice(1), 16));
      try { return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes)); }
      catch (_) { return bytes.map((byte) => String.fromCharCode(byte)).join(''); }
    });
    // Some provider-transformed HTML bodies arrive with the quoted-printable '=' missing before 3D.
    if (/doctype|border-collapse|font-family|line-height/i.test(text) && (text.match(/3D["']/g) || []).length > 3) {
      text = text.replace(/(^|[^a-z0-9=])3D(?=["'])/gi, '$1=');
    }
    return text.replace(/\b039;/g, "'");
  }

  function looksLikeHTML(value) {
    return /<(?:!doctype|html|head|body|table|div|p|span|br|section|article|h[1-6])\b/i.test(value) || /^\s*!doctype\s+html/i.test(value);
  }

  function sanitizeEmailDocument(raw) {
    const normalized = decodeQuotedPrintable(raw);
    const doc = new DOMParser().parseFromString(normalized, 'text/html');
    doc.querySelectorAll('script,style,iframe,frame,frameset,object,embed,form,input,button,textarea,select,link,meta,base,svg,math,canvas,video,audio,img,picture,source,head,title').forEach((node) => node.remove());
    const allowed = new Set(['DIV','SPAN','P','BR','HR','H1','H2','H3','H4','H5','H6','STRONG','B','EM','I','U','S','SMALL','SUB','SUP','UL','OL','LI','BLOCKQUOTE','PRE','CODE','TABLE','THEAD','TBODY','TFOOT','TR','TD','TH','A']);
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
    const elements = [];
    while (walker.nextNode()) elements.push(walker.currentNode);
    elements.reverse().forEach((element) => {
      if (!allowed.has(element.tagName)) {
        element.replaceWith(...Array.from(element.childNodes));
        return;
      }
      Array.from(element.attributes).forEach((attribute) => element.removeAttribute(attribute.name));
      if (element.tagName === 'A') element.removeAttribute('href');
      if (['TD','TH'].includes(element.tagName)) {
        element.removeAttribute('colspan');
        element.removeAttribute('rowspan');
      }
    });
    return doc.body;
  }

  function renderBody(container, raw) {
    container.replaceChildren();
    const source = String(raw || '');
    const truncated = source.length > 300000;
    const limited = truncated ? source.slice(0, 300000) : source;
    if (looksLikeHTML(limited)) {
      const docBody = sanitizeEmailDocument(limited);
      const visibleText = (docBody.textContent || '').replace(/\s+/g, ' ').trim();
      if (visibleText.length > 2) {
        const wrap = document.createElement('div');
        wrap.innerHTML = docBody.innerHTML;
        container.append(wrap);
      } else {
        const fallback = document.createElement('pre');
        fallback.className = 'plain-mail';
        fallback.textContent = decodeQuotedPrintable(limited.replace(/<[^>]*>/g, ' ')).replace(/\s{3,}/g, '\n\n');
        container.append(fallback);
      }
    } else {
      const pre = document.createElement('pre');
      pre.className = 'plain-mail';
      pre.textContent = decodeQuotedPrintable(limited);
      container.append(pre);
    }
    if (truncated) {
      const notice = document.createElement('span');
      notice.className = 'body-notice';
      notice.textContent = 'This long message has been shortened for safe display.';
      container.prepend(notice);
    }
  }

  function contentAsText(raw) {
    const text = String(raw || '');
    if (!looksLikeHTML(text)) return decodeQuotedPrintable(text);
    const body = sanitizeEmailDocument(text.length > 300000 ? text.slice(0, 300000) : text);
    return (body.textContent || '').replace(/\s+/g, ' ').trim() || decodeQuotedPrintable(text.replace(/<[^>]*>/g, ' '));
  }

  async function openInbox(address, options = {}) {
    const normalized = normalizeAddress(address);
    if (!normalized) {
      showToast('Use a prefix with one of the three supported domains.');
      return;
    }
    if (state.abortController) state.abortController.abort();
    state.abortController = null;
    state.busy = false;
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
    state.address = normalized;
    state.messages = [];
    state.stats = null;
    state.selectedKey = '';
    state.lastFetchedAt = null;
    els.searchInput.value = '';
    els.detailContent.hidden = true;
    els.detailPlaceholder.hidden = false;
    els.messageLayout.classList.remove('mobile-detail');
    const [prefix, domain] = normalized.split('@');
    els.prefixInput.value = prefix;
    els.domainSelect.value = domain;
    updateAddressUI();
    renderMessages();
    renderSaved();
    setStatus('Connecting to inbox service…');
    els.updatedLabel.textContent = 'Loading messages…';
    try { localStorage.setItem(STORAGE.active, normalized); } catch (_) { /* local storage may be blocked */ }
    await fetchInbox(options.quiet === true);
    startAutoRefresh();
  }

  async function fetchInbox(quiet = false) {
    if (!state.address || state.busy) return;
    const addressAtStart = state.address;
    setBusy(true);
    if (!quiet) setStatus('Loading messages…');
    const controller = new AbortController();
    state.abortController = controller;
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(`${API_BASE}${addressAtStart}`, {
        method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store',
        headers: { Accept: 'application/json' }, signal: controller.signal
      });
      if (!response.ok) throw new Error(`Inbox service returned HTTP ${response.status}.`);
      const payload = await response.json();
      if (addressAtStart !== state.address) return;
      if (payload && typeof payload === 'object' && Array.isArray(payload.received_emails)) {
        state.messages = payload.received_emails.filter((message) => message && typeof message === 'object').map((message) => ({
          from: typeof message.from === 'string' ? message.from : '',
          subject: typeof message.subject === 'string' ? message.subject : '',
          date: typeof message.date === 'string' ? message.date : '',
          content: typeof message.content === 'string' ? message.content : ''
        }));
        state.stats = payload.stats && typeof payload.stats === 'object' ? payload.stats : null;
        const returnedAddress = normalizeAddress(payload.address || addressAtStart);
        if (returnedAddress && returnedAddress !== addressAtStart) {
          state.address = returnedAddress;
          try { localStorage.setItem(STORAGE.active, returnedAddress); } catch (_) { /* optional */ }
          updateAddressUI();
        }
        state.lastFetchedAt = new Date();
        const total = state.messages.length;
        els.updatedLabel.textContent = `Updated ${prettyDate(state.lastFetchedAt, true)}`;
        setStatus(total ? `${total} received ${total === 1 ? 'message' : 'messages'} loaded.` : 'No messages have arrived for this address yet.');
        if (total && state.stats && Number.isFinite(Number(state.stats.total)) && Number(state.stats.total) > total) {
          setStatus(`${total} received messages loaded. The API reports ${Number(state.stats.total)} total message(s).`);
        }
      } else if (payload && typeof payload === 'object' && typeof payload.message === 'string') {
        state.messages = [];
        state.stats = payload.stats || null;
        state.lastFetchedAt = new Date();
        els.updatedLabel.textContent = `Checked ${prettyDate(state.lastFetchedAt, true)}`;
        setStatus('No messages have arrived for this address yet.');
      } else {
        throw new Error('The inbox API response format was not recognized.');
      }
      renderMessages();
      if (state.selectedKey) {
        const selected = state.messages.find((message) => messageKey(message) === state.selectedKey);
        if (selected) selectMessage(selected);
        else clearDetail();
      }
    } catch (error) {
      if (addressAtStart !== state.address) return;
      const message = error && error.name === 'AbortError' ? 'The inbox request timed out. Please try again.' : 'Could not reach the inbox API. Check your connection and try again.';
      if (!quiet) setStatus(message, true);
      els.updatedLabel.textContent = 'Inbox could not be refreshed';
      if (!quiet) showToast(message);
    } finally {
      clearTimeout(timeout);
      if (state.abortController === controller) {
        state.abortController = null;
        setBusy(false);
      }
    }
  }

  function startAutoRefresh() {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
    if (!els.autoRefreshToggle.checked || !state.address) return;
    state.refreshTimer = setInterval(() => {
      if (!document.hidden) fetchInbox(true);
    }, REFRESH_MS);
  }

  function openPrivacy() {
    if (typeof els.privacyDialog.showModal === 'function') els.privacyDialog.showModal();
    else alert('Public inboxes are readable by anyone who knows the address. Saved addresses stay only in this browser; there is no account or cross-browser sync.');
  }

  function updateTheme(theme) {
    const next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(STORAGE.theme, next); } catch (_) { /* optional */ }
    els.themeToggle.setAttribute('aria-label', next === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    els.themeToggle.title = next === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    els.themeToggle.innerHTML = next === 'dark'
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 15.3A8.5 8.5 0 0 1 8.7 3.8 8.5 8.5 0 1 0 20.2 15.3Z"/></svg>';
  }

  function toggleSavedAddress() {
    if (!state.address) return;
    const saved = readSaved();
    if (saved.includes(state.address)) {
      writeSaved(saved.filter((address) => address !== state.address));
      showToast('Removed from saved addresses on this device.');
    } else {
      writeSaved([state.address, ...saved]);
      showToast('Address saved on this device.');
    }
  }

  async function copyAddress() {
    if (!state.address) return;
    try {
      await navigator.clipboard.writeText(state.address);
      showToast('Address copied.');
    } catch (_) {
      const temporary = document.createElement('textarea');
      temporary.value = state.address;
      temporary.setAttribute('readonly', '');
      temporary.style.position = 'fixed';
      temporary.style.opacity = '0';
      document.body.append(temporary);
      temporary.select();
      const copied = document.execCommand('copy');
      temporary.remove();
      showToast(copied ? 'Address copied.' : 'Copy was blocked by this browser.');
    }
  }

  function exportAddresses() {
    const saved = readSaved();
    if (!saved.length) return;
    const blob = new Blob([JSON.stringify({ app: 'EgMail', schemaVersion: 1, exportedAt: new Date().toISOString(), addresses: saved }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'egmail-addresses.json';
    link.click();
    URL.revokeObjectURL(url);
    showToast('Address backup downloaded. Keep it private.');
  }

  async function importAddresses(file) {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      showToast('Backup file is too large.');
      return;
    }
    try {
      const parsed = JSON.parse(await file.text());
      const values = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.addresses) ? parsed.addresses : [];
      const valid = values.map(normalizeAddress).filter(Boolean);
      if (!valid.length) throw new Error('No supported addresses were found.');
      writeSaved([...valid, ...readSaved()]);
      showToast(`${new Set(valid).size} address(es) imported to this browser.`);
    } catch (_) {
      showToast('That backup could not be read. Choose an EgMail JSON backup.');
    } finally {
      els.importFile.value = '';
    }
  }

  function handleRandom() {
    const prefix = randomPrefix(10);
    const domain = randomDomain();
    els.prefixInput.value = prefix;
    els.domainSelect.value = domain;
    openInbox(`${prefix}@${domain}`);
  }

  els.addressForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const address = buildAddressFromForm();
    if (address) openInbox(address);
  });
  els.prefixInput.addEventListener('input', () => {
    const normalized = normalizeAddressField(els.prefixInput.value);
    if (normalized !== els.prefixInput.value) {
      const selection = els.prefixInput.selectionStart;
      els.prefixInput.value = normalized;
      try { els.prefixInput.setSelectionRange(selection, selection); } catch (_) { /* input mode may vary */ }
    }
    els.prefixInput.setCustomValidity('');
  });
  els.prefixInput.addEventListener('paste', () => setTimeout(() => {
    const normalized = normalizeAddressField(els.prefixInput.value);
    els.prefixInput.value = normalized;
  }, 0));
  els.randomButton.addEventListener('click', handleRandom);
  els.refreshButton.addEventListener('click', () => fetchInbox(false));
  els.copyAddressButton.addEventListener('click', copyAddress);
  els.saveAddressButton.addEventListener('click', toggleSavedAddress);
  els.exportButton.addEventListener('click', exportAddresses);
  els.importButton.addEventListener('click', () => els.importFile.click());
  els.importFile.addEventListener('change', () => importAddresses(els.importFile.files && els.importFile.files[0]));
  els.autoRefreshToggle.addEventListener('change', () => {
    try { localStorage.setItem(STORAGE.autoRefresh, els.autoRefreshToggle.checked ? 'true' : 'false'); } catch (_) { /* optional */ }
    startAutoRefresh();
    showToast(els.autoRefreshToggle.checked ? 'Auto refresh is on (every 30 seconds).' : 'Auto refresh is off.');
  });
  els.searchInput.addEventListener('input', () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(renderMessages, 120);
  });
  els.sortSelect.addEventListener('change', renderMessages);
  els.themeToggle.addEventListener('click', () => updateTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  [els.privacyButton, els.noticeMore, els.footerPrivacy].forEach((button) => button.addEventListener('click', openPrivacy));
  [els.closePrivacy, els.privacyDone].forEach((button) => button.addEventListener('click', () => els.privacyDialog.close()));
  els.privacyDialog.addEventListener('click', (event) => {
    if (event.target === els.privacyDialog) els.privacyDialog.close();
  });
  els.backToList.addEventListener('click', () => els.messageLayout.classList.remove('mobile-detail'));
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName) && state.address) {
      event.preventDefault();
      els.searchInput.focus();
    }
    if (event.key === 'Escape' && els.privacyDialog.open) els.privacyDialog.close();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE.saved) renderSaved();
  });

  try {
    const savedTheme = localStorage.getItem(STORAGE.theme);
    updateTheme(savedTheme || (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
    els.autoRefreshToggle.checked = localStorage.getItem(STORAGE.autoRefresh) === 'true';
  } catch (_) { updateTheme('dark'); }
  renderSaved();
  updateAddressUI();
  renderMessages();
  const initialAddress = normalizeAddress(new URLSearchParams(window.location.search).get('address') || (() => {
    try { return localStorage.getItem(STORAGE.active) || ''; } catch (_) { return ''; }
  })());
  if (initialAddress) openInbox(initialAddress);
})();
