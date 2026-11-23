'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

global.window = { EgMailContent: require('./mail-content.js') };
require('./otp.js');
const analyze = global.window.EgMailOtp.analyze;

test('protects a Meta account-recovery message even when the subject omits the word code', () => {
  const subject = 'Use 246810 to get back into your account';
  const result = analyze({ from: 'security@account.meta.com', subject }, subject);
  assert.equal(result.protectedMessage, true);
  assert.equal(result.recoveryIntent, true);
  assert.equal(result.code, '');
  assert.equal(result.displaySubject, 'Use [hidden] to get back into your account');
});

test('protects a Facebook security OTP in both the code result and display subject', () => {
  const subject = '135790 is your Facebook security code';
  const result = analyze({ from: 'security@facebookmail.com', subject }, 'Your Facebook security code is 135790.');
  assert.equal(result.protectedMessage, true);
  assert.equal(result.code, '');
  assert.equal(result.displaySubject, '[hidden] is your Facebook security code');
});

test('does not label ordinary non-recovery, non-Meta mail as protected', () => {
  const result = analyze({ from: 'updates@example.test', subject: 'New activity' }, 'A new post is available.');
  assert.equal(result.protectedMessage, false);
});
