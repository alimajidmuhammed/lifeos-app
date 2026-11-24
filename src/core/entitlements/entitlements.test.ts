import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_CATALOG,
  DEFAULT_FEATURE_FLAGS,
  evaluateDailyAiQuota,
  getTodayDayKey,
} from './entitlements';

test('Free tier entitlements enforce daily quota accurately', () => {
  const free = PLAN_CATALOG.free;
  const under = evaluateDailyAiQuota(5, free);
  assert.equal(under.allowed, true);
  assert.equal(under.remaining, 70);

  const atLimit = evaluateDailyAiQuota(75, free);
  assert.equal(atLimit.allowed, false);
  assert.equal(atLimit.remaining, 0);
});

test('Stage 0 feature flags keep Apple auth, Cloud Storage, and Paywall inactive', () => {
  assert.equal(DEFAULT_FEATURE_FLAGS['auth.apple.enabled'], false);
  assert.equal(DEFAULT_FEATURE_FLAGS['storage.cloud.enabled'], false);
  assert.equal(DEFAULT_FEATURE_FLAGS['ai.free_tier'], true);
  assert.equal(DEFAULT_FEATURE_FLAGS['billing.paywall.enabled'], false);
});

test('getTodayDayKey returns strict YYYY-MM-DD UTC key', () => {
  const key = getTodayDayKey(new Date('2026-11-23T18:00:00Z'));
  assert.equal(key, '2026-11-23');
});
