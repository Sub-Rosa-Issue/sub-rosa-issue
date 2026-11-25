// SPDX-License-Identifier: MIT
'use strict';
const { redactValue } = require('./serialization.cjs');
const normalized = new WeakSet();
const GENERIC_PUBLIC_MESSAGE = 'The operation could not be completed. Please try again or contact support.';
const transientCodes = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH']);

// Read data descriptors only. Error messages, getters, proxies and toJSON are untrusted.
function field(value, key) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  try {
    let object = value;
    for (let depth = 0; object && depth < 8; depth++, object = Object.getPrototypeOf(object)) {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (descriptor) return 'value' in descriptor ? descriptor.value : undefined;
    }
  } catch { /* Hostile proxies have no inspectable fields. */ }
  return undefined;
}
function build(value, seen, depth) {
  if (depth > 16 || (value && typeof value === 'object' && seen.has(value))) {
    return { name: 'UnknownError', message: depth > 16 ? '[MaxDepth]' : '[Circular]', retryable: false, context: {} };
  }
  if (value && typeof value === 'object') seen.add(value);
  const name = field(value, 'name');
  const message = field(value, 'message');
  const code = field(value, 'code') ?? field(value, 'contractErrorCode');
  let stack = field(value, 'stack');
  // V8 exposes a native lazy stack getter; never invoke application-defined accessors.
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, 'stack');
    if (stack === undefined && typeof message === 'string' && descriptor?.get &&
        Function.prototype.toString.call(descriptor.get).includes('[native code]')) {
      stack = descriptor.get.call(value);
    }
  } catch { /* Diagnostics still work without a stack. */ }
  const cause = field(value, 'cause');
  const response = field(value, 'response');
  const status = field(value, 'status') ?? field(value, 'statusCode') ?? field(response, 'status');
  const explicitRetry = field(value, 'retryable');
  const context = Object.create(null);
  if (value && typeof value === 'object') {
    try {
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (['name', 'message', 'stack', 'code', 'cause', 'retryable'].includes(key)) continue;
        context[key] = 'value' in descriptor ? descriptor.value : '[Accessor]';
      }
    } catch { context.value = '[Unserializable]'; }
  } else if (typeof value !== 'string') context.value = value;
  const result = {
    name: typeof name === 'string' ? name : 'UnknownError',
    message: typeof message === 'string' ? message : typeof value === 'string' ? value : 'Unknown error',
    retryable: typeof explicitRetry === 'boolean' ? explicitRetry : transientCodes.has(code) || status === 408 || status === 429 || (typeof status === 'number' && status >= 500 && status <= 599),
    context,
  };
  if (typeof code === 'string' || typeof code === 'number') result.code = code;
  if (typeof stack === 'string') result.stack = stack;
  if (cause !== undefined) result.cause = build(cause, seen, depth + 1);
  if (value && typeof value === 'object') seen.delete(value);
  return result;
}
/** Operator-only structured diagnostics. Never expose this object in HTTP/UI output. */
function normalizeError(value, context) {
  if (value && typeof value === 'object' && normalized.has(value) && context === undefined) return value;
  const result = build(value, new WeakSet(), 0);
  if (context !== undefined) result.context = { ...result.context, boundary: context };
  // Redact the complete tree together so a secret in a cause is removed from parent messages too.
  const safe = redactValue(result);
  normalized.add(safe);
  return safe;
}
/** Safe transport shape: fixed copy only, never arbitrary provider messages, stacks or context. */
function publicError(value) {
  const error = normalizeError(value);
  const message = error.retryable
    ? 'The service is temporarily unavailable. Please try again.'
    : GENERIC_PUBLIC_MESSAGE;
  return { message };
}
function publicErrorMessage(value) { return publicError(value).message; }
exports.normalizeError = normalizeError;
exports.publicError = publicError;
exports.publicErrorMessage = publicErrorMessage;
exports.redactValue = redactValue;
