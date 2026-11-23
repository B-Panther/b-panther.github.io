(function (root) {
  'use strict';

  const CSS_MARKERS = [
    'border-collapse:', 'border-radius:', 'font-family:', 'font-size:', 'font-feature-settings:',
    'line-height:', 'vertical-align:', 'text-decoration:', 'display:', 'background-color:',
    'padding:', 'margin:', 'letter-spacing:', 'max-width:'
  ];
  const CSS_PROPERTY = /(^|[\s"'=;{])(?:border(?:\s*-\s*[\w-]+)?|font(?:\s*-\s*[\w-]+)?|line\s*-\s*height|letter\s*-\s*spacing|text\s*-\s*decoration|vertical\s*-\s*align|display|background(?:\s*-\s*[\w-]+)?|color|width|height|min\s*-\s*width|max\s*-\s*width|min\s*-\s*height|max\s*-\s*height|margin(?:\s*-\s*[\w-]+)?|padding(?:\s*-\s*[\w-]+)?|white\s*-\s*space|overflow(?:\s*-\s*[\w-]+)?|text\s*-\s*align|align\s*-\s*items|justify\s*-\s*content|position|float|opacity|table\s*-\s*layout)\s*:\s*[^;{}\n"'=]{0,300};?/gi;

  function hasHtmlTags(text) {
    return /<\/?[a-z][^>]*>/i.test(String(text || ''));
  }

  function hasFlattenedDocumentArtifacts(input) {
    const text = String(input || '');
    if (hasHtmlTags(text)) return false;
    const doctype = /^\s*(?:<\s*!\s*)?doctype\s+html\b/i.test(text)
      || /^\s*&lt;\s*!\s*doctype\s+html\b/i.test(text);
    const markers = CSS_MARKERS.reduce((count, marker) => count + (text.toLowerCase().includes(marker) ? 1 : 0), 0);
    return doctype || markers >= 4;
  }

  function decodeQuotedPrintable(input, charset = 'utf-8') {
    let text = String(input || '').replace(/=(?:\r\n|\n|\r)/g, '');
    text = text.replace(/(?:=[0-9a-f]{2})+/gi, (sequence) => {
      const bytes = sequence.match(/=[0-9a-f]{2}/gi).map((part) => parseInt(part.slice(1), 16));
      try {
        return new TextDecoder(charset || 'utf-8', { fatal: false }).decode(new Uint8Array(bytes));
      } catch (_) {
        try { return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes)); }
        catch (_) { return bytes.map((byte) => String.fromCharCode(byte)).join(''); }
      }
    });

    // Some inbox providers strip the '=' before QP tokens in flattened HTML text.
    if (hasFlattenedDocumentArtifacts(text)) {
      text = text.replace(/(^|[^a-z0-9=])3D(?=["'])/gi, '$1=');
      text = text.replace(/([?&][a-z0-9_.%-]{1,50})3D(?=[a-z0-9])/gi, '$1=');
    }
    return text.replace(/\b039;/g, "'");
  }

  function looksLikeHTML(input) {
    const text = String(input || '');
    return /<(?:!doctype|\/?(?:html|head|body|table|div|p|span|br|section|article|h[1-6]))\b/i.test(text)
      || /^\s*(?:<\s*!\s*)?doctype\s+html\b/i.test(text)
      || /&lt;\s*(?:!doctype|\/?(?:html|head|body|table|div|p))\b/i.test(text);
  }

  function decodeEscapedMarkup(input) {
    let text = String(input || '');
    if (!/&lt;\s*(?:!doctype|\/?(?:html|head|body|table|div|p|span|br))\b/i.test(text)) return text;
    return text
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#0*39;|&apos;/gi, "'");
  }

  function decodeBasicEntities(input) {
    return String(input || '')
      .replace(/&nbsp;|&#0*160;/gi, ' ')
      .replace(/&quot;/gi, '"')
      .replace(/&#0*39;|&apos;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&');
  }

  function cleanFlattenedDocumentText(input, charset = 'utf-8') {
    let text = decodeBasicEntities(decodeQuotedPrintable(input, charset));
    text = text.replace(/^\s*(?:<\s*!\s*)?doctype\s+html\b[\s\S]{0,800}?(?:\b(?:transitional|strict|xhtml)\b|>)/i, ' ');
    text = text.replace(/(?:^|\s)(?:<\s*!\s*)?doctype\s+html\b[\s\S]{0,800}?(?:\b(?:transitional|strict|xhtml)\b|>)/gi, ' ');
    text = text.replace(/\bpa\s+dding\b/gi, 'padding').replace(/\blay(?=\s*:)/gi, 'display');
    // Broken style properties sometimes run directly into real message copy.
    text = text.replace(/\bfont\s*-\s*feature\s*-\s*settings\s*:\s*/gi, ' ');
    for (let pass = 0; pass < 8; pass += 1) {
      const cleaned = text.replace(CSS_PROPERTY, '$1 ');
      if (cleaned === text) break;
      text = cleaned;
    }
    text = text.replace(/\blin\s+e\s*-\s*:\s*[\w.-]+/gi, ' ');
    text = text.replace(/\bline-hei\b|\blin\s+[a-f0-9]{6,}\b|\blin\b/gi, ' ');
    text = text.replace(/\be\s*-\s*:/gi, ' ');
    text = text.replace(/\bcol\s+[A-F0-9]{3,8}\b/gi, ' ');
    text = text.replace(/(?:all\s+and\s*)?\(\s*max-width\s*:[^)]{0,80}\)/gi, ' ');
    text = text.replace(/\b(?:only\s+screen|media\s+(?:only\s+)?screen)\b/gi, ' ');
    text = text.replace(/\b(?:style|dir|cellspacing|cellpadding|colspan|rowspan|valign|align|src|href|class|id|width|height)\s*=\s*["']?[^"'\s;]{0,180}["']?/gi, ' ');
    text = text.replace(/\b(?:dir|cellspacing|cellpadding|colspan|rowspan|valign|style|width|height)\b/gi, ' ');
    text = text.replace(/\bIGUIAvatar-[\w.-]+\.(?:jpg|jpeg|png|gif)\b/gi, ' ');
    text = text.replace(/\b[\w.-]*cdninstagram\.com\b/gi, ' ');
    text = text.replace(/\bcontent-atl\d+-\d\b/gi, ' ');
    text = text.replace(/\b3D[A-Z0-9_-]{6,}\b/gi, ' ');
    text = text.replace(/\b(?=[A-F0-9]{6,}\b)(?=[A-F0-9]*[A-F])[A-F0-9]+\b/gi, ' ');
    text = text.replace(/\b(?=[A-Za-z0-9_-]{12,}\b)(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+\b/g, ' ');
    text = text.replace(/\b\d{1,4}px\b/gi, ' ').replace(/\bauto\b/gi, ' ');
    text = text.replace(/(^|\s)'t(?=\s+want to receive\b)/gi, "$1don't");
    text = text.replace(/\b99t(?=\s+forward\b)/gi, "don't");
    text = text.replace(/["=;]/g, ' ');
    text = text.replace(/<[^>]*>/g, ' ');
    text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ');
    text = text.replace(/[ \t]{2,}/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\s+([,.;!?])/g, '$1').replace(/\n{3,}/g, '\n\n').trim();
    text = text.replace(/\be\s*-\s*:/gi, ' ').replace(/[ \t]{2,}/g, ' ').trim();
    return text;
  }

  function hasDoctypeFragment(input) {
    return /(?:<\s*!\s*|!\s*|&lt;\s*!\s*)?doctype\s+html\b/i.test(String(input || ''));
  }

  function cleanFlattenedDocumentForDisplay(input, charset = 'utf-8') {
    let text = cleanFlattenedDocumentText(input, charset);
    text = text.replace(/(?:<\s*!\s*|!\s*|&lt;\s*!\s*)?doctype\s+html\b[\s\S]{0,800}?(?:\b(?:transitional|strict|xhtml)\b|>)/gi, ' ');
    return text.replace(/[ \t]{2,}/g, ' ').replace(/\s{3,}/g, '\n\n').trim();
  }

  function findBodyString(value, depth = 0) {
    if (typeof value === 'string') return value.trim() ? value : '';
    if (!value || typeof value !== 'object' || depth > 4) return '';
    if (Array.isArray(value)) return value.map((part) => findBodyString(part, depth + 1)).filter(Boolean).join('\n');
    const keys = ['html', 'text/html', 'htmlBody', 'body', 'content', 'text', 'text/plain', 'textBody', 'plain', 'value', 'data'];
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const result = findBodyString(value[key], depth + 1);
        if (result) return result;
      }
    }
    return '';
  }

  function getMessageContent(message) {
    if (typeof message === 'string') return message;
    if (!message || typeof message !== 'object') return '';
    for (const candidate of [message.content, message.body, message.html, message.text]) {
      const result = findBodyString(candidate);
      if (result) return result;
    }
    return '';
  }

  function getMessageCharset(message) {
    if (!message || typeof message !== 'object') return 'utf-8';
    const content = message.content && typeof message.content === 'object' ? message.content : {};
    const candidates = [message.charset, message.content_type, message.contentType, content.charset, content.content_type, content.contentType];
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue;
      const match = candidate.match(/charset\s*=\s*["']?([^;\s"']+)/i);
      if (match) return match[1];
      if (/^(?:utf-?8|windows-\d+|iso-8859-\d+|us-ascii)$/i.test(candidate.trim())) return candidate.trim();
    }
    return 'utf-8';
  }

  const api = Object.freeze({
    decodeQuotedPrintable,
    looksLikeHTML,
    hasFlattenedDocumentArtifacts,
    cleanFlattenedDocumentText,
    hasDoctypeFragment,
    cleanFlattenedDocumentForDisplay,
    decodeEscapedMarkup,
    getMessageContent,
    getMessageCharset
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.EgMailContent = api;
})(typeof window !== 'undefined' ? window : globalThis);
