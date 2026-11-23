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
    savedHeadingLabel: $('#savedHeadingLabel'), savedStorageNote: $('#savedStorageNote'),
    exportButton: $('#exportButton'), importButton: $('#importButton'), importFile: $('#importFile'), messageCount: $('#messageCount'),
    updatedLabel: $('#updatedLabel'), refreshButton: $('#refreshButton'), autoRefreshToggle: $('#autoRefreshToggle'),
    searchInput: $('#searchInput'), sortSelect: $('#sortSelect'), messageList: $('#messageList'), listSummary: $('#listSummary'),
    listPageNote: $('#listPageNote'), listFooter: $('#listFooter'), messageLayout: $('#messageLayout'), detailPanel: $('#detailPanel'),
    detailPlaceholder: $('#detailPlaceholder'), detailContent: $('#detailContent'), detailSubject: $('#detailSubject'), detailFrom: $('#detailFrom'),
    detailDate: $('#detailDate'), senderAvatar: $('#senderAvatar'), messageBody: $('#messageBody'), inboxStatus: $('#inboxStatus'),
    themeToggle: $('#themeToggle'), privacyButton: $('#privacyButton'), noticeMore: $('#noticeMore'), footerPrivacy: $('#footerPrivacy'), footerShare: $('#footerShare'),
    privacyDialog: $('#privacyDialog'), closePrivacy: $('#closePrivacy'), privacyDone: $('#privacyDone'), backToList: $('#backToList'), toast: $('#toast')
  };

  const state = {
    address: '', messages: [], stats: null, selectedKey: '', lastFetchedAt: null,
    busy: false, abortController: null, refreshTimer: null, toastTimer: null, searchTimer: null, settingsTimer: null
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
    const account = window.EgMailAccount;
    const isSaved = Boolean(state.address && (account.isAuthenticated()
      ? account.getAddresses().some((entry) => entry.address === state.address)
      : readSaved().includes(state.address)));
    const label = els.saveAddressButton.querySelector('span');
    if (label) label.textContent = isSaved ? 'Saved' : 'Save';
    els.saveAddressButton.classList.toggle('is-saved', isSaved);
    const path = els.saveAddressButton.querySelector('svg path');
    if (path) path.setAttribute('fill', isSaved ? 'currentColor' : 'none');
  }

  function renderSaved() {
    const account = window.EgMailAccount;
    const isSynced = account.isAuthenticated();
    const saved = isSynced
      ? account.getAddresses()
      : readSaved().map((address) => ({ id: '', address, label: '', isFavorite: false }));
    els.savedHeadingLabel.textContent = isSynced ? 'SAVED TO ACCOUNT' : 'SAVED ON THIS DEVICE';
    els.savedStorageNote.textContent = isSynced
      ? 'Saved addresses sync across browsers. Inbox contents remain public.'
      : 'Sign in to sync saved addresses between browsers. Inbox contents remain public.';
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
    saved.forEach((entry) => {
      const address = entry.address;
      const item = document.createElement('li');
      item.className = `saved-item${entry.isFavorite ? ' is-favorite' : ''}`;
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'saved-open';
      open.title = `Open ${address}`;
      const full = document.createElement('strong');
      full.textContent = address;
      const detail = document.createElement('span');
      detail.textContent = entry.label || (address === state.address ? 'Currently open' : 'Reopen inbox');
      open.append(full, detail);
      open.addEventListener('click', () => openInbox(address));
      const favorite = document.createElement('button');
      favorite.type = 'button';
      favorite.className = `saved-star${entry.isFavorite ? ' is-favorite' : ''}`;
      favorite.textContent = entry.isFavorite ? '★' : '☆';
      favorite.title = entry.isFavorite ? 'Remove favorite' : 'Mark as favorite';
      favorite.setAttribute('aria-label', `${entry.isFavorite ? 'Unfavorite' : 'Favorite'} ${address}`);
      favorite.addEventListener('click', async () => {
        if (!isSynced) return;
        try { await account.updateAddress({ ...entry, isFavorite: !entry.isFavorite }); }
        catch (_) { showToast('Favorite setting could not be saved.'); }
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'saved-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${address} from saved addresses`);
      remove.addEventListener('click', async () => {
        try {
          if (isSynced) {
            await account.removeAddress(entry.id);
            showToast('Address removed from your account.');
          } else {
            writeSaved(readSaved().filter((savedAddress) => savedAddress !== address));
            showToast('Address removed from this device.');
          }
        } catch (_) { showToast('Saved address could not be removed.'); }
      });
      item.append(open, favorite, remove);
      els.savedList.append(item);
    });
  }

  function currentMessages() {
    const term = els.searchInput.value.trim().toLowerCase();
    let list = state.messages.slice();
    if (term) list = list.filter((message) => `${message.from || ''} ${message.subject || ''} ${contentAsText(message.content || '', message.charset)}`.toLowerCase().includes(term));
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
      const messageText = contentAsText(message.content || '', message.charset);
      const otp = window.EgMailOtp.analyze(message, messageText);
      // FIXED: Use only otp.protectedMessage (which now only triggers on recovery)
      const protectedMessage = otp.protectedMessage;
      preview.textContent = protectedMessage
        ? `${otp.provider} recovery message — code hidden`
        : otp.isOtp ? `${otp.provider} verification message` : messageText.replace(/\s+/g, ' ').trim().slice(0, 115) || 'No preview available';
      preview.classList.toggle('otp-list-preview', otp.isOtp || protectedMessage);
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
    renderMessageBody(els.messageBody, message);
    els.messageLayout.classList.add('mobile-detail');
    renderMessages();
  }

  function decodeQuotedPrintable(input, charset = 'utf-8') {
    return window.EgMailContent.decodeQuotedPrintable(input, charset);
  }

  function looksLikeHTML(value) {
    return window.EgMailContent.looksLikeHTML(value);
  }

  function sanitizeEmailDocument(raw) {
    const normalized = window.EgMailContent.decodeEscapedMarkup(raw);
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

  function renderBody(container, raw, charset = 'utf-8') {
    container.replaceChildren();
    const source = String(raw || '');
    const truncated = source.length > 300000;
    const limited = truncated ? source.slice(0, 300000) : source;
    const decoded = decodeQuotedPrintable(limited, charset);
    const flattenedMarkup = window.EgMailContent.hasFlattenedDocumentArtifacts(decoded);
    const strayDoctype = window.EgMailContent.hasDoctypeFragment(decoded) && !looksLikeHTML(decoded);
    if (flattenedMarkup || strayDoctype) {
      const notice = document.createElement('span');
      notice.className = 'body-notice';
      notice.textContent = 'Email layout markup was simplified for safe, readable display.';
      const fallback = document.createElement('pre');
      fallback.className = 'plain-mail';
      fallback.textContent = window.EgMailContent.cleanFlattenedDocumentForDisplay(decoded, charset)
        || 'This email contains layout markup but no readable message text.';
      container.append(notice, fallback);
    } else if (looksLikeHTML(decoded)) {
      const docBody = sanitizeEmailDocument(decoded);
      const visibleText = (docBody.textContent || '').replace(/\s+/g, ' ').trim();
      if (visibleText.length > 2) {
        const wrap = document.createElement('div');
        wrap.innerHTML = docBody.innerHTML;
        container.append(wrap);
      } else {
        const fallback = document.createElement('pre');
        fallback.className = 'plain-mail';
        fallback.textContent = window.EgMailContent.cleanFlattenedDocumentForDisplay(decoded.replace(/<[^>]*>/g, ' '), charset);
        container.append(fallback);
      }
    } else {
      const pre = document.createElement('pre');
      pre.className = 'plain-mail';
      pre.textContent = decoded;
      container.append(pre);
    }
    if (truncated) {
      const notice = document.createElement('span');
      notice.className = 'body-notice';
      notice.textContent = 'This long message has been shortened for safe display.';
      container.prepend(notice);
    }
  }

  function contentAsText(raw, charset = 'utf-8') {
    const text = decodeQuotedPrintable(raw, charset);
    if (window.EgMailContent.hasFlattenedDocumentArtifacts(text)) {
      return window.EgMailContent.cleanFlattenedDocumentText(text, charset);
    }
    if (!looksLikeHTML(text)) return text;
    const body = sanitizeEmailDocument(text.length > 300000 ? text.slice(0, 300000) : text);
    return (body.textContent || '').replace(/\s+/g, ' ').trim() || window.EgMailContent.cleanFlattenedDocumentText(text.replace(/<[^>]*>/g, ' '), charset);
  }

  function renderMessageBody(container, message) {
    const rawContent = window.EgMailContent.getMessageContent(message);
    const charset = message.charset || 'utf-8';
    const text = contentAsText(rawContent, charset);
    const otp = window.EgMailOtp.analyze(message, text);
    
    // FIXED: Only block if it's an explicit recovery message
    if (otp.protectedMessage) {
      container.replaceChildren();
      const card = document.createElement('section');
      card.className = 'otp-card';
      const header = document.createElement('div');
      header.className = 'otp-card-head';
      const badge = document.createElement('span');
      badge.className = 'otp-badge';
      badge.textContent = otp.provider;
      const context = document.createElement('span');
      context.className = 'otp-context';
      context.textContent = otp.recoveryIntent ? 'Account recovery notice' : 'Security code hidden';
      header.append(badge, context);
      const warning = document.createElement('p');
      warning.className = 'otp-no-code';
      warning.textContent = otp.recoveryIntent
        ? 'Recovery codes are hidden on this page, but this public mailbox service may still expose the original email. Use a private, verified email address to recover your account.'
        : 'Meta/Facebook security codes are hidden on this page, but this public mailbox service may still expose the original email. Use a private, verified email address for account access.';
      card.append(header, warning);
      container.append(card);
      return;
    }
    
    if (!otp.isOtp) {
      renderBody(container, rawContent || 'No message body was provided.', charset);
      return;
    }
    
    container.replaceChildren();
    const card = document.createElement('section');
    card.className = 'otp-card';
    const header = document.createElement('div');
    header.className = 'otp-card-head';
    const badge = document.createElement('span');
    badge.className = 'otp-badge';
    badge.textContent = otp.provider;
    const context = document.createElement('span');
    context.className = 'otp-context';
    context.textContent = 'Verification message';
    header.append(badge, context);
    card.append(header);
    
    if (otp.code) {
      const caption = document.createElement('span');
      caption.className = 'otp-caption';
      caption.textContent = 'Detected code';
      const row = document.createElement('div');
      row.className = 'otp-code-row';
      const code = document.createElement('strong');
      code.className = 'otp-code';
      code.textContent = otp.code;
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'otp-copy-button';
      copy.setAttribute('aria-label', 'Copy verification code');
      copy.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/></svg><span>Copy</span>';
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(otp.code);
          showToast('Verification code copied.');
        } catch (_) {
          const temporary = document.createElement('textarea');
          temporary.value = otp.code;
          temporary.setAttribute('readonly', '');
          temporary.style.position = 'fixed';
          temporary.style.opacity = '0';
          document.body.append(temporary);
          temporary.select();
          const copied = document.execCommand('copy');
          temporary.remove();
          showToast(copied ? 'Verification code copied.' : 'Copy was blocked by this browser.');
        }
      });
      row.append(code, copy);
      card.append(caption, row);
    } else {
      const note = document.createElement('p');
      note.className = 'otp-no-code';
      note.textContent = otp.ambiguous
        ? 'More than one possible code was found, so no code is shown.'
        : 'A single code could not be identified confidently, so the message text is hidden.';
      card.append(note);
    }
    const privacyNote = document.createElement('span');
    privacyNote.className = 'otp-caption';
    privacyNote.textContent = 'Other email text and unrelated numbers are not shown.';
    card.append(privacyNote);
    container.append(card);
  }

  async function openInbox(address, options = {}) {
    const normalized = normalizeAddress(address);
    if (!normalized) {
      showToast('Use a prefix with one of the three supported domains.');
      return;
    }
    try {
      if (window.location.pathname !== `/${normalized}` || window.location.search || window.location.hash) {
        window.history.replaceState(null, '', `/${normalized}`);
      }
    } catch (_) { /* browser may restrict history updates */ }
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
    if (window.EgMailAccount.isAuthenticated()) {
      window.EgMailAccount.saveAddress(normalized).catch(() => showToast('This inbox could not be synced to your account yet.'));
    }
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
        state.messages = payload.received_emails.filter((message) => message && typeof message === 'object').map((message) => {
          const normalized = {
            from: typeof message.from === 'string' ? window.EgMailOtp.decodeMimeHeader(message.from) : '',
            subject: typeof message.subject === 'string' ? window.EgMailOtp.decodeMimeHeader(message.subject) : '',
            date: typeof message.date === 'string' ? message.date : '',
            content: window.EgMailContent.getMessageContent(message),
            charset: window.EgMailContent.getMessageCharset(message)
          };
          const bodyText = contentAsText(normalized.content, normalized.charset);
          const analysis = window.EgMailOtp.analyze(normalized, bodyText);
          
          // FIXED: Only protect if recovery intent exists
          normalized.protectedMessage = analysis.protectedMessage;
          if (analysis.protectedMessage) normalized.subject = analysis.displaySubject;
          return normalized;
        });
        state.stats = payload.stats && typeof payload.stats === 'object' ? payload.stats : null;
        const returnedAddress = normalizeAddress(payload.address || addressAtStart);
        if (returnedAddress && returnedAddress !== addressAtStart) {
          state.address = returnedAddress;
          try { localStorage.setItem(STORAGE.active, returnedAddress); } catch (_) { /* optional */ }
          updateAddressUI();
          if (window.EgMailAccount.isAuthenticated()) {
            window.EgMailAccount.saveAddress(returnedAddress).catch(() => showToast('This inbox could not be synced to your account yet.'));
          }
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
    else alert('Public inboxes are readable by anyone who knows the address. Saved addresses stay in this browser unless you sign in to sync them. Account sync does not make inboxes private.');
  }

  function updateTheme(theme, sync = true) {
    const next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(STORAGE.theme, next); } catch (_) { /* optional */ }
    els.themeToggle.setAttribute('aria-label', next === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    els.themeToggle.title = next === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    els.themeToggle.innerHTML = next === 'dark'
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 15.3A8.5 8.5 0 0 1 8.7 3.8 8.5 8.5 0 1 0 20.2 15.3Z"/></svg>';
    if (sync) scheduleSettingsSync();
  }

  function scheduleSettingsSync() {
    if (!window.EgMailAccount.isAuthenticated()) return;
    clearTimeout(state.settingsTimer);
    state.settingsTimer = setTimeout(() => {
      window.EgMailAccount.saveSettings({
        theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
        autoRefresh: els.autoRefreshToggle.checked
      }).catch(() => showToast('Account preferences could not be synced yet.'));
    }, 400);
  }

  async function toggleSavedAddress() {
    if (!state.address) return;
    if (window.EgMailAccount.isAuthenticated()) {
      const existing = window.EgMailAccount.getAddresses().find((entry) => entry.address === state.address);
      try {
        if (existing) {
          await window.EgMailAccount.removeAddress(existing.id);
          showToast('Address removed from your account.');
        } else {
          await window.EgMailAccount.saveAddress(state.address);
          showToast('Address saved to your account.');
        }
      } catch (_) { showToast('Account address could not be updated.'); }
      return;
    }
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
    const saved = window.EgMailAccount.isAuthenticated()
      ? window.EgMailAccount.getAddresses().map((entry) => entry.address)
      : readSaved();
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
      if (window.EgMailAccount.isAuthenticated()) {
        await Promise.all([...new Set(valid)].map((address) => window.EgMailAccount.saveAddress(address)));
        showToast(`${new Set(valid).size} address(es) imported to your account.`);
      } else {
        writeSaved([...valid, ...readSaved()]);
        showToast(`${new Set(valid).size} address(es) imported to this browser.`);
      }
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
    scheduleSettingsSync();
    showToast(els.autoRefreshToggle.checked ? 'Auto refresh is on (every 30 seconds).' : 'Auto refresh is off.');
  });
  els.searchInput.addEventListener('input', () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(renderMessages, 120);
  });
  els.sortSelect.addEventListener('change', renderMessages);
  els.themeToggle.addEventListener('click', () => updateTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  [els.privacyButton, els.noticeMore, els.footerPrivacy].forEach((button) => button.addEventListener('click', openPrivacy));
  els.footerShare.addEventListener('click', async () => {
    const shareData = {
      title: 'EgMail — Disposable Email Inbox',
      text: 'Need a quick disposable inbox? Try EgMail. #EgMail #TempMail #DisposableEmail',
      url: 'https://www.egmail.me/'
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        showToast('Thanks for sharing EgMail!');
      } else {
        await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`);
        showToast('EgMail share message copied with hashtags.');
      }
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      window.prompt('Copy this EgMail share message:', `${shareData.text} ${shareData.url}`);
    }
  });
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
    updateTheme(savedTheme || 'light', false);
    els.autoRefreshToggle.checked = localStorage.getItem(STORAGE.autoRefresh) === 'true';
  } catch (_) { updateTheme('light'); }
  renderSaved();
  updateAddressUI();
  renderMessages();
  const pathSegment = window.location.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  let pathAddress = '';
  try { pathAddress = decodeURIComponent(pathSegment); } catch (_) { /* invalid encoded path */ }
  const initialAddress = normalizeAddress(new URLSearchParams(window.location.search).get('address') || pathAddress || (() => {
    try { return localStorage.getItem(STORAGE.active) || ''; } catch (_) { return ''; }
  })());
  window.EgMailAccount.setChangeHandler(async ({ authenticated, justAuthenticated, settings }) => {
    if (authenticated) {
      if (justAuthenticated) {
        const candidates = new Set([...readSaved(), ...(state.address ? [state.address] : [])]);
        for (const address of candidates) {
          try { await window.EgMailAccount.saveAddress(address); }
          catch (_) { showToast('Some local addresses could not be synced.'); break; }
        }
      }
      if (settings && ['dark', 'light'].includes(settings.theme)) updateTheme(settings.theme, false);
      if (settings && typeof settings.autoRefresh === 'boolean') {
        els.autoRefreshToggle.checked = settings.autoRefresh;
        startAutoRefresh();
      }
    }
    renderSaved();
    updateSaveButton();
  });
  window.EgMailAccount.init().finally(() => {
    if (initialAddress) openInbox(initialAddress);
  });
})();
