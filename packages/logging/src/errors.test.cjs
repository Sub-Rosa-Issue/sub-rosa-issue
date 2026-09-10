// SPDX-License-Identifier: MIT
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeError, publicError, publicErrorMessage } = require('./errors.cjs');

test('native and domain errors retain name, code, cause, stack and context', () => {
  class DomainError extends Error { name = 'DomainError'; code = 'ROUND_CLOSED'; }
  const cause = Object.assign(new Error('connection failed'), { code: 'ETIMEDOUT' });
  const error = Object.assign(new DomainError('closed', { cause }), { roundId: 7n });
  const n = normalizeError(error);
  assert.equal(n.name, 'DomainError'); assert.equal(n.code, 'ROUND_CLOSED');
  assert.equal(n.context.roundId, '7'); assert.match(n.stack, /DomainError: closed/);
  assert.equal(n.cause.code, 'ETIMEDOUT'); assert.equal(n.cause.retryable, true);
  assert.equal(error.cause, cause); assert.ok(error instanceof DomainError);
  assert.equal(normalizeError(n), n);
});
test('strings, objects, RPC and HTTP failures normalize predictably', () => {
  assert.equal(normalizeError('oops').message, 'oops');
  assert.equal(normalizeError({ message: 'rpc', code: -32000 }).code, -32000);
  assert.equal(normalizeError({ message: 'http', response: { status: 503 } }).retryable, true);
  assert.equal(normalizeError({ status: 429 }).retryable, true);
  assert.equal(normalizeError({ status: 400 }).retryable, false);
  assert.equal(normalizeError({ code: 'ETIMEDOUT', retryable: false }).retryable, false);
  assert.equal(normalizeError({ code: 0 }).code, 0);
});
test('cycles and unserializable values never throw or run user code', () => {
  const value = new Error('cycle'); value.cause = value; value.extra = value;
  assert.equal(normalizeError(value).cause.message, '[Circular]');
  let invoked = 0;
  const hostile = { get message() { invoked++; throw new Error('getter'); }, toJSON() { invoked++; throw new Error('toJSON'); } };
  const proxy = new Proxy({}, { ownKeys() { throw new Error('proxy'); }, getOwnPropertyDescriptor() { throw new Error('proxy'); } });
  for (const input of [hostile, proxy, value, Symbol('x'), 12n, undefined, null, () => {}]) {
    assert.doesNotThrow(() => JSON.stringify(normalizeError(input)));
  }
  assert.equal(invoked, 0);
});
test('nested secrets are redacted across messages, stacks, causes and contexts', () => {
  const secret = 'S' + 'A'.repeat(55);
  const error = Object.assign(new Error(`failed Bearer bearer-value ${secret} api_key=inline-value https://u:p@host/?token=query-value`), {
    cause: Object.assign(new Error('child credential-value'), { credentials: 'credential-value' }),
    authorization: 'authorization-value', cookie: 'cookie-value', nested: { private_key: 'key-value' },
  });
  const serialized = JSON.stringify(normalizeError(error));
  for (const hidden of [secret, 'bearer-value', 'inline-value', 'query-value', 'u:p', 'credential-value', 'authorization-value', 'cookie-value', 'key-value']) assert.ok(!serialized.includes(hidden), hidden);
});
test('public output never exposes provider prose, code, stack or diagnostic context', () => {
  const input = { name: 'secret-name', message: 'opaque-provider-token', code: 'secret-code', stack: 'secret-stack', context: { token: 'secret-token' } };
  assert.deepEqual(Object.keys(publicError(input)), ['message']);
  assert.equal(publicErrorMessage(input), publicErrorMessage(new Error('different')));
  assert.ok(!JSON.stringify(publicError(input)).includes('secret'));
});

test('deep cause chains and sensitive context injection are bounded', () => {
  let error = new Error('root');
  for (let i = 0; i < 40; i++) error = new Error('nested', { cause: error });
  assert.ok(JSON.stringify(normalizeError(error)).includes('[MaxDepth]'));
  const normalized = normalizeError(new Error('boundary-value'), { apiKey: 'boundary-value' });
  assert.ok(!JSON.stringify(normalized).includes('boundary-value'));
});
