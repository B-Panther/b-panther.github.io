'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const content = require('./mail-content.js');

test('decodes quoted-printable bytes, soft line wraps, and UTF-8 symbols', () => {
  assert.equal(content.decodeQuotedPrintable('Hi=2C there=21 =F0=9F=94=A5'), 'Hi, there! 🔥');
  assert.equal(content.decodeQuotedPrintable('first=\r\nsecond=3Dvalue'), 'firstsecond=value');
});

test('decodes quoted-printable text using the declared legacy charset', () => {
  assert.equal(content.decodeQuotedPrintable('caf=E9', 'windows-1252'), 'café');
});

test('removes flattened document and stylesheet artifacts while keeping message text', () => {
  const noisy = 'DOCTYPE HTML PUBLIC - DTD HTML 4.01 Transitional all and (max-width: 480px) display:block!important; font-family:Arial; border-collapse:collapse; vertical-align:top; font-size:12px; Your group request was approved. This message was sent to user@example.test.';
  assert.equal(content.hasFlattenedDocumentArtifacts(noisy), true);
  const clean = content.cleanFlattenedDocumentText(noisy);
  assert.doesNotMatch(clean, /DOCTYPE|font-family|border-collapse|display:block|vertical-align|font-size/i);
  assert.match(clean, /Your group request was approved\./);
  assert.match(clean, /This message was sent to user@example\.test\./);
});

test('cleans broken flattened attributes without swallowing body copy after CSS', () => {
  const noisy = 'DOCTYPE HTML PUBLIC - DTD HTML 4.01 Transitional all and (max-width: 480px) display:block!important;pa dding:10px 0 5px;vertical-align:top!important;width:100; ="font-family:Arial;font-size:14px;" posted something new. font-feature-settings: You have 1 notification you may not have seen.';
  const clean = content.cleanFlattenedDocumentText(noisy);
  assert.doesNotMatch(clean, /DOCTYPE|font-family|font-size|vertical-align|display:block|padding:|font-feature-settings/i);
  assert.match(clean, /posted something new\./);
  assert.match(clean, /You have 1 notification you may not have seen\./);
});

test('cleans a stripped DOCTYPE fragment in the middle of a flattened email for display only', () => {
  const noisy = 'Suggested accounts for you. !DOCTYPE HTML PUBLIC - DTD HTML 4.01 Transitional posted something new. You have a notification.';
  assert.equal(content.hasFlattenedDocumentArtifacts(noisy), false);
  assert.equal(content.hasDoctypeFragment(noisy), true);
  const clean = content.cleanFlattenedDocumentForDisplay(noisy);
  assert.doesNotMatch(clean, /!?DOCTYPE|DTD HTML 4\.01|Transitional/i);
  assert.match(clean, /Suggested accounts for you\./);
  assert.match(clean, /posted something new\./);
  assert.match(clean, /You have a notification\./);
});

test('does not classify ordinary plain text as flattened HTML', () => {
  const plain = 'Your Facebook group request has been approved. The reference is 123456.';
  assert.equal(content.hasFlattenedDocumentArtifacts(plain), false);
  assert.equal(content.cleanFlattenedDocumentText(plain), plain);
});

test('recognizes escaped HTML wrappers without treating them as executable', () => {
  const escaped = '&lt;!DOCTYPE html&gt;&lt;html&gt;&lt;body&gt;Hello&lt;/body&gt;&lt;/html&gt;';
  assert.equal(content.looksLikeHTML(escaped), true);
  assert.equal(content.decodeEscapedMarkup(escaped), '<!DOCTYPE html><html><body>Hello</body></html>');
});

test('selects structured HTML/text body fields and extracts the declared charset', () => {
  const message = {
    content: { 'text/html': '<p>Rich body</p>', 'text/plain': 'Plain body', charset: 'windows-1252' },
    content_type: 'multipart/alternative; boundary=part'
  };
  assert.equal(content.getMessageContent(message), '<p>Rich body</p>');
  assert.equal(content.getMessageCharset(message), 'windows-1252');
  assert.equal(content.getMessageContent({ body: { text: 'Body text' } }), 'Body text');
});
