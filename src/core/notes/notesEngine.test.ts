import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFolderTree,
  countMarkdownWords,
  flattenFolderTree,
  type NoteFolder,
} from './noteSchemas.ts';
import {
  parseMarkdownBlocks,
  toggleMarkdownChecklistLine,
} from './safeMarkdown.ts';
import {
  bootstrapE2EVault,
  decryptText,
  deriveAesKeyFromSecret,
  encryptText,
  verifyE2EPassphrase,
} from '../crypto/e2eCrypto.ts';
import { evaluatePrivacyGate } from '../ai/privacyGate.ts';

test('Nested Folder Tree builds hierarchy cleanly and neutralizes self/cyclic parents', () => {
  const folders: NoteFolder[] = [
    { id: 'f_root', uid: 'u1', name: 'Work', sortKey: 'B', isLockedFolder: false, version: 1 },
    { id: 'f_child', uid: 'u1', name: 'Q4 Specs', parentId: 'f_root', sortKey: 'C', isLockedFolder: false, version: 1 },
    { id: 'f_self', uid: 'u1', name: 'SelfRef', parentId: 'f_self', sortKey: 'D', isLockedFolder: false, version: 1 },
  ];

  const tree = buildFolderTree(folders);
  const flat = flattenFolderTree(tree);
  assert.equal(flat.length, 3);
  assert.equal(flat[0].folder.id, 'f_root');
  assert.equal(flat[0].depth, 0);
  assert.equal(flat[1].folder.id, 'f_child');
  assert.equal(flat[1].depth, 1);
  assert.equal(flat[2].folder.id, 'f_self');
  assert.equal(flat[2].depth, 0);
});

test('Safe Markdown AST parses headings, checklists, code blocks, and strips unsafe javascript: links', () => {
  const md = [
    '# Project Plan',
    '- [ ] Draft budget',
    '- [x] Review [Docs](https://example.com) and [Bad](javascript:alert(1))',
    '```ts',
    'const x = 1;',
    '```',
  ].join('\n');

  const blocks = parseMarkdownBlocks(md);
  assert.equal(blocks[0].type, 'heading');
  assert.equal(blocks[1].type, 'checklist');
  if (blocks[1].type === 'checklist') {
    assert.equal(blocks[1].items.length, 2);
    assert.equal(blocks[1].items[0].checked, false);
    assert.equal(blocks[1].items[1].checked, true);
    const links = blocks[1].items[1].tokens.filter((t) => t.type === 'link');
    assert.equal(links.length, 1);
    assert.equal(links[0].type === 'link' && links[0].href, 'https://example.com');
  }
  assert.equal(blocks[2].type, 'code_block');

  const toggled = toggleMarkdownChecklistLine(md, 1);
  assert.ok(toggled.includes('- [x] Draft budget'));
  assert.ok(countMarkdownWords(md) > 5);
});

test('Opt-in AES-256-GCM locked note round-trip succeeds and Privacy Gate blocks locked notes from AI', async () => {
  const boot = await bootstrapE2EVault('MyStrongLifeOSPass2026!');
  assert.equal(await verifyE2EPassphrase('MyStrongLifeOSPass2026!', boot.salt, boot.verifier), true);
  assert.equal(await verifyE2EPassphrase('WrongPassphrase!', boot.salt, boot.verifier), false);

  const key = await deriveAesKeyFromSecret('MyStrongLifeOSPass2026!', boot.salt);
  const secretMarkdown = '## Safe Combination\nPrivate recovery note content.';
  const envelope = await encryptText(secretMarkdown, key);
  assert.equal(envelope.alg, 'AES-256-GCM');
  assert.notEqual(envelope.ct, secretMarkdown);

  const decrypted = await decryptText(envelope, key);
  assert.equal(decrypted, secretMarkdown);

  const gate = evaluatePrivacyGate({
    freeTier: true,
    module: 'notes',
    text: secretMarkdown,
    containsLockedOrE2E: true,
  });
  assert.equal(gate.allowed, false);
  assert.equal(gate.code, 'BLOCKED_E2E_OR_LOCKED');
});
