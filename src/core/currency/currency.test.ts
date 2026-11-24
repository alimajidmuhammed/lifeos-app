import test from 'node:test';
import assert from 'node:assert/strict';
import { toMinorUnits, fromMinorUnits, convertMinorUnits, formatMoney } from './currency';

test('toMinorUnits and fromMinorUnits preserve exact integers for USD and IQD', () => {
  assert.equal(toMinorUnits(19.99, 'USD'), 1999);
  assert.equal(fromMinorUnits(1999, 'USD'), 19.99);
  assert.equal(toMinorUnits(25000, 'IQD'), 25000);
  assert.equal(fromMinorUnits(25000, 'IQD'), 25000);
});

test('convertMinorUnits converts USD to IQD using explicit FX snapshot', () => {
  // $100.00 at 1,310 IQD/USD = 131,000 IQD
  assert.equal(convertMinorUnits(10000, 'USD', 'IQD', 1310), 131000);
  // 131,000 IQD back to USD
  assert.equal(convertMinorUnits(131000, 'IQD', 'USD', 1 / 1310), 10000);
});

test('formatMoney outputs clean IQD and USD strings across locales', () => {
  assert.equal(formatMoney(250000, 'IQD', 'en'), '250,000 IQD');
  assert.equal(formatMoney(12550, 'USD', 'en'), '$125.50');
  assert.ok(formatMoney(250000, 'IQD', 'ar').includes('د.ع'));
  assert.ok(formatMoney(250000, 'IQD', 'ckb').includes('د.ع'));
});
