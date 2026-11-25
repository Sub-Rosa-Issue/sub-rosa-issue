import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findViolations, scanTree } from './check-error-normalization.mjs';
test('detects catches, promise rejections and unknown-error function parameters', () => {
  for (const source of [
    'try {} catch (failure) { String(failure); }',
    'promise.catch(failure => JSON.stringify(failure))',
    'function message(value: unknown) { return value instanceof Error ? value.message : String(value); }',
    'try {} catch (failure) { return `${failure}`; }',
    'try {} catch (failure) { return failure["message"]; }',
  ]) assert.ok(findViolations(source).length, source);
});
test('allows typed domain rethrows, shared normalization and unrelated strings', () => {
  assert.deepEqual(findViolations('try {} catch (error) { if(error instanceof DomainError) throw error; log(normalizeError(error)); show(publicErrorMessage(error)); }'), []);
  assert.deepEqual(findViolations('const value = "data"; String(value); JSON.stringify(value);'), []);
});
test('repository migrated scope is clean', () => assert.deepEqual(scanTree(), []));
