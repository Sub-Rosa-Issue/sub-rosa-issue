// SPDX-License-Identifier: MIT
'use strict';
const REDACTED = '[REDACTED]';
const sensitive = (key) => /secret|token|password|passwd|privatekey|credential|cookie|authorization|apikey|mnemonic|seedphrase/i.test(key.replace(/[^a-z0-9]/gi, ''));

function scrubText(value, secrets) {
  let text = value
    .replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1[REDACTED]@')
    .replace(/([?&](?:[^=&\s]*(?:secret|token|password|credential|api[_-]?key)[^=&\s]*)=)[^&#\s]*/gi, '$1[REDACTED]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/gi, '$1 [REDACTED]')
    .replace(/((?:[\w-]*(?:secret|token|password|credential|authorization|cookie|api[_-]?key)[\w-]*)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1[REDACTED]')
    .replace(/\bS[A-Z2-7]{55}\b/g, REDACTED)
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, REDACTED);
  for (const secret of secrets) text = text.split(secret).join(REDACTED);
  return text;
}

function collectSecrets(value, secrets, seen = new WeakSet(), depth = 0) {
  if (!value || typeof value !== 'object' || depth > 32 || seen.has(value)) return;
  seen.add(value);
  try {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!('value' in descriptor)) continue;
      if (sensitive(key)) {
        const hidden = descriptor.value;
        if (typeof hidden === 'string' && hidden.length >= 4) secrets.add(hidden);
        else collectSecrets(hidden, secrets, seen, depth + 1);
      } else collectSecrets(descriptor.value, secrets, seen, depth + 1);
    }
  } catch { /* Uninspectable proxies are replaced during serialization. */ }
}

function serialize(value, secrets, seen = new WeakSet(), depth = 0) {
  if (typeof value === 'string') return scrubText(value, secrets);
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (value === undefined) return null;
  if (typeof value !== 'object') return `[${typeof value}]`;
  if (depth > 32) return '[MaxDepth]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const output = Array.isArray(value) ? [] : Object.create(null);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(value) && key === 'length') continue;
      output[key] = sensitive(key) ? REDACTED : 'value' in descriptor
        ? serialize(descriptor.value, secrets, seen, depth + 1) : '[Accessor]';
    }
    return output;
  } catch {
    return '[Unserializable]';
  } finally {
    seen.delete(value);
  }
}

function redactValue(value) {
  const secrets = new Set();
  collectSecrets(value, secrets);
  return serialize(value, secrets);
}
exports.redactValue = redactValue;
exports.collectSecrets = collectSecrets;
exports.scrubText = scrubText;
exports.serialize = serialize;
