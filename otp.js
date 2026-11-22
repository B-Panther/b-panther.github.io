(() => {
  'use strict';

  const decodeQuotedPrintable = window.EgMailContent.decodeQuotedPrintable;

  function decodeMimeHeader(input) {
    return String(input || '').replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (whole, charset, encoding, data) => {
      try {
        let bytes;
        if (encoding.toLowerCase() === 'b') {
          const binary = atob(data);
          bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        } else {
          const normalized = data.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
          bytes = Uint8Array.from(normalized, (character) => character.charCodeAt(0));
        }
        return new TextDecoder(charset, { fatal: false }).decode(bytes);
      } catch (_) { return whole; }
    });
  }

  function collectCodes(source) {
    const patterns = [
      /\b(?:(?:facebook|meta|fb)\s+(?:(?:security|verification|confirmation|login|sign[ -]?in|one[ -]?time)\s+)?|(?:security|verification|confirmation|login|sign[ -]?in|one[ -]?time)\s+)(?:code|passcode|otp)\s*(?:is\b|[:=—-])?\s*([0-9]{4,8})\b/gi,
      /\b(?:use|enter|type|confirm|verify)\s+(?:the\s+|this\s+|your\s+)?(?:facebook\s+|meta\s+)?(?:security\s+|verification\s+|confirmation\s+|login\s+|sign[ -]?in\s+|one[ -]?time\s+)(?:code|passcode|otp)\s*(?:is\b|[:=—-])?\s*([0-9]{4,8})\b/gi,
      /\b([0-9]{4,8})\s+(?:is\s+(?:your|the)\s+)?(?:facebook\s+)?(?:security|verification|confirmation|login|sign[ -]?in|one[ -]?time)\s+code\b/gi
    ];
    const codes = new Set();
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(source)) !== null) codes.add(match[1]);
    }
    return [...codes];
  }

  function analyze(message, bodyText) {
    const from = decodeMimeHeader(message && message.from);
    const subject = decodeMimeHeader(message && message.subject);
    const body = decodeQuotedPrintable(bodyText);
    const source = `${from}\n${subject}\n${body}`.slice(0, 300000);
    const codes = collectCodes(source);
    const hasCodeWord = /\b(?:code|otp|passcode)\b/i.test(source);
    const hasVerificationIntent = /\b(?:verification|verify|security|confirmation|confirm|login|sign[ -]?in|authentication|authenticate|one[ -]?time|otp|passcode)\b/i.test(source);
    const hasProviderCodePhrase = /\b(?:facebook|meta|fb)\s+(?:(?:security|verification|confirmation|login|sign[ -]?in|one[ -]?time)\s+)?(?:code|passcode|otp)\b/i.test(source);
    const isOtp = hasCodeWord && (hasVerificationIntent || hasProviderCodePhrase);
    const facebook = /\bfacebook\b|facebookmail\.com|\bmeta\b/i.test(`${from}\n${subject}\n${body.slice(0, 8000)}`);
    return {
      isOtp,
      provider: facebook ? 'Facebook' : 'Verification',
      code: isOtp && codes.length === 1 ? codes[0] : '',
      ambiguous: isOtp && codes.length > 1
    };
  }

  window.EgMailOtp = Object.freeze({ analyze, decodeMimeHeader });
})();
