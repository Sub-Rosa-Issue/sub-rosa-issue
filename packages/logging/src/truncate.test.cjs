// SPDX-License-Identifier: MIT
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_MAX_LENGTH,
  DEFAULT_TRUNCATED_SUFFIX,
  truncateError,
  truncateStrings,
} = require('./truncate.cjs');

test('keeps the first maxLength characters and marks the truncated value', () => {
  assert.equal(truncateStrings('Hello, this is a very long string', { maxLength: 10 }), 'Hello, thi...');
  assert.equal(truncateStrings('Short', { maxLength: 10 }), 'Short');
  assert.equal(truncateStrings('ExactlyTen', { maxLength: 10 }), 'ExactlyTen');
});

test('does not retain the discarded tail', () => {
  const result = truncateStrings('prefix-sk_live_do_not_log_me', { maxLength: 6 });
  assert.equal(result, 'prefix...');
  assert.ok(!result.includes('sk_live'));
});

test('uses the documented default limit and marker', () => {
  const long = 'a'.repeat(DEFAULT_MAX_LENGTH);
  assert.equal(truncateStrings(long), long);
  assert.equal(truncateStrings(`${long}b`), `${long}${DEFAULT_TRUNCATED_SUFFIX}`);
});

test('applies the limit to nested objects and arrays', () => {
  const input = {
    round: 42,
    message: 'Hello world',
    nested: { deep: { deeper: 'A very deep nested string that needs truncation' } },
    list: ['short', 'A very long string that should be truncated'],
  };
  const result = truncateStrings(input, { maxLength: 10 });
  assert.equal(result.round, 42);
  assert.equal(result.message, 'Hello worl...');
  assert.equal(result.nested.deep.deeper, 'A very dee...');
  assert.deepEqual(result.list, ['short', 'A very lon...']);
});

test('passes non-string primitives through unchanged', () => {
  const input = { nullValue: null, undefinedValue: undefined, count: 7, enabled: true, total: 10n };
  assert.deepEqual(truncateStrings(input, { maxLength: 1 }), input);
  assert.equal(truncateStrings(null, { maxLength: 1 }), null);
  assert.equal(truncateStrings(1234, { maxLength: 1 }), 1234);
});

test('supports a zero limit by keeping only the marker', () => {
  assert.equal(truncateStrings('', { maxLength: 0 }), '');
  assert.equal(truncateStrings('anything', { maxLength: 0 }), '...');
});

test('rejects an invalid maxLength', () => {
  assert.throws(() => truncateStrings('x', { maxLength: -1 }), RangeError);
  assert.throws(() => truncateStrings('x', { maxLength: 1.5 }), RangeError);
  assert.throws(() => truncateStrings('x', { maxLength: Number.NaN }), RangeError);
});

test('truncates error messages and nested causes', () => {
  const err = Object.assign(new Error('wrapper failure from the upstream provider'), {
    code: 'ERR_TEST',
    detail: 'A custom detail string that is too long',
    cause: new Error('the underlying provider failure'),
  });
  const result = truncateError(err, { maxLength: 15 });
  assert.equal(result.name, 'Error');
  assert.equal(result.message, 'wrapper failure...');
  assert.equal(result.code, 'ERR_TEST');
  assert.equal(result.detail, 'A custom detail...');
  assert.equal(result.cause.message, 'the underlying ...');
  assert.ok(!('stack' in result));
});

test('handles errors nested in arrays and objects', () => {
  const result = truncateStrings({ errors: [new Error('first'), new Error('second')] }, { maxLength: 100 });
  assert.equal(result.errors[0].message, 'first');
  assert.equal(result.errors[1].message, 'second');
});

test('does not recurse forever on cyclic objects', () => {
  const context = { name: 'root' };
  context.self = context;
  const result = truncateStrings(context);
  assert.equal(result.name, 'root');
  assert.equal(result.self, '[Circular]');
});

test('does not recurse forever on cyclic error causes', () => {
  const err = new Error('boom');
  err.cause = err;
  const result = truncateError(err, { maxLength: 10 });
  assert.equal(result.message, 'boom');
  assert.equal(result.cause, '[Circular]');
});
