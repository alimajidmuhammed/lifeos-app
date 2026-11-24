/**
 * Firestore Security Rules Emulator Test Suite (Dirty Dozen)
 *
 * Run against Firebase Emulator Suite locally or in GitHub Actions CI:
 *   firebase emulators:exec --only firestore "npx tsx --test firestore.rules.test.ts"
 *
 * Requires devDependency `@firebase/rules-unit-testing` when running against the emulator.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('firestore.rules contains all Eight-Pillar security invariants', () => {
  const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
  assert.match(rules, /rules_version\s*=\s*'2';/);
  assert.match(rules, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);
  assert.match(rules, /request\.auth\.token\.email_verified == true/);
  assert.match(rules, /match \/entitlements\/\{entitlementId\}[\s\S]*allow create, update, delete: if false;/);
  assert.match(rules, /match \/aiUsage\/\{dayKey\}[\s\S]*incoming\(\)\.requestCount == existing\(\)\.requestCount \+ 1/);
  assert.match(rules, /isValidAiModuleToggles/);
  assert.match(rules, /existing\(\)\.status != 'settled'/);
  assert.match(rules, /match \/payments\/\{paymentId\}[\s\S]*allow update: if false;/);
  assert.match(rules, /isValidDebtPayment/);
  assert.match(rules, /isValidIsoTimestamp/);
  assert.match(rules, /existing\(\)\.status != 'archived'/);
  assert.match(rules, /data\.status == 'completed' \? data\.isCompleted == true : data\.isCompleted == false/);
  assert.match(rules, /isValidSubtaskList/);
  assert.match(rules, /isValidSortKey/);
  assert.match(rules, /!data\.isEncrypted \|\| data\.isLocked == true/);
  assert.match(rules, /data\.parentId != folderId/);
  assert.match(rules, /match \/versions\/\{versionId\}[\s\S]*allow update: if false;/);
  assert.match(rules, /isValidVaultFolder/);
  assert.match(rules, /isValidVaultDocumentMeta/);
  assert.match(rules, /data\.sizeBytes is int && data\.sizeBytes >= 0 && data\.sizeBytes <= 52428800/);
  assert.match(rules, /isValidHabitMonthLog/);
  assert.match(rules, /isValidDayKeyList/);
  assert.match(rules, /days\.size\(\) <= 31/);
  assert.match(rules, /isValidBudgetLimit/);
  assert.match(rules, /isValidSubscriptionItem/);
  assert.match(rules, /data\.bestStreak is int && data\.bestStreak >= data\.currentStreak/);
});

test('firebase-blueprint.json paths are all covered in firestore.rules', () => {
  const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
  const blueprint = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'firebase-blueprint.json'), 'utf8'));
  const expectedCollections = [
    'entitlements',
    'aiUsage',
    'debtLedgers',
    'debts',
    'payments',
    'reminders',
    'tasks',
    'noteFolders',
    'notes',
    'versions',
    'vaultFolders',
    'documents',
    'habits',
    'habitLogs',
    'transactions',
    'budgets',
    'subscriptions',
  ];
  assert.ok(blueprint.firestore['/users/{userId}']);
  assert.ok(blueprint.firestore['/users/{userId}/debts/{debtId}/payments/{paymentId}']);
  assert.ok(blueprint.firestore['/users/{userId}/noteFolders/{folderId}']);
  assert.ok(blueprint.firestore['/users/{userId}/notes/{noteId}/versions/{versionId}']);
  assert.ok(blueprint.firestore['/users/{userId}/vaultFolders/{folderId}']);
  assert.ok(blueprint.firestore['/users/{userId}/documents/{docId}']);
  assert.ok(blueprint.firestore['/users/{userId}/habitLogs/{bucketId}']);
  assert.ok(blueprint.firestore['/users/{userId}/budgets/{budgetId}']);
  assert.ok(blueprint.firestore['/users/{userId}/subscriptions/{subId}']);
  for (const col of expectedCollections) {
    assert.ok(rules.includes(`match /${col}/`), `Missing security rule match block for collection: ${col}`);
  }
});
