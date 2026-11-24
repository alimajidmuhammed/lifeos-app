import { z } from 'zod';
import { compareSortKeys } from '../planner/fractionalIndex';

export const VAULT_DOC_TYPES = [
  'passport',
  'id',
  'license',
  'insurance',
  'warranty',
  'invoice',
  'contract',
  'receipt',
  'medical',
  'other',
] as const;

export type VaultDocType = (typeof VAULT_DOC_TYPES)[number];

export const VAULT_STORAGE_MODES = ['local_only', 'cloud_private'] as const;
export type VaultStorageMode = (typeof VAULT_STORAGE_MODES)[number];

export interface VaultDocTypeMeta {
  id: VaultDocType;
  labelKey: string;
  fallbackLabel: string;
  sensitiveByDefault: boolean;
}

export const VAULT_DOC_TYPE_META: Record<VaultDocType, VaultDocTypeMeta> = {
  passport: { id: 'passport', labelKey: 'vault.typePassport', fallbackLabel: 'Passport', sensitiveByDefault: true },
  id: { id: 'id', labelKey: 'vault.typeId', fallbackLabel: 'National ID', sensitiveByDefault: true },
  license: { id: 'license', labelKey: 'vault.typeLicense', fallbackLabel: 'Driver License', sensitiveByDefault: true },
  insurance: { id: 'insurance', labelKey: 'vault.typeInsurance', fallbackLabel: 'Insurance', sensitiveByDefault: true },
  warranty: { id: 'warranty', labelKey: 'vault.typeWarranty', fallbackLabel: 'Warranty', sensitiveByDefault: false },
  invoice: { id: 'invoice', labelKey: 'vault.typeInvoice', fallbackLabel: 'Invoice', sensitiveByDefault: false },
  contract: { id: 'contract', labelKey: 'vault.typeContract', fallbackLabel: 'Contract', sensitiveByDefault: true },
  receipt: { id: 'receipt', labelKey: 'vault.typeReceipt', fallbackLabel: 'Receipt', sensitiveByDefault: false },
  medical: { id: 'medical', labelKey: 'vault.typeMedical', fallbackLabel: 'Medical', sensitiveByDefault: true },
  other: { id: 'other', labelKey: 'vault.typeOther', fallbackLabel: 'Other', sensitiveByDefault: false },
};

const safeIdRegex = /^[a-zA-Z0-9_-]+$/;
const ymdRegex = /^\d{4}-\d{2}-\d{2}$/;
const sortKeyRegex = /^[0-9A-Za-z]+$/;

export const VaultFolderSchema = z.object({
  id: z.string().min(1).max(128).regex(safeIdRegex),
  uid: z.string().min(1).max(128).regex(safeIdRegex),
  name: z.string().trim().min(1).max(80),
  parentId: z.string().min(1).max(128).regex(safeIdRegex).optional(),
  sortKey: z.string().min(1).max(64).regex(sortKeyRegex),
  isLockedFolder: z.boolean(),
  version: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type VaultFolder = z.infer<typeof VaultFolderSchema>;

export const CreateVaultFolderInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  parentId: z.string().min(1).max(128).regex(safeIdRegex).optional(),
  isLockedFolder: z.boolean().default(false),
});

export type CreateVaultFolderInput = z.infer<typeof CreateVaultFolderInputSchema>;

export const VaultDocumentMetaSchema = z.object({
  id: z.string().min(1).max(128).regex(safeIdRegex),
  uid: z.string().min(1).max(128).regex(safeIdRegex),
  folderId: z.string().min(1).max(128).regex(safeIdRegex).optional(),
  title: z.string().trim().min(1).max(200),
  docType: z.enum(VAULT_DOC_TYPES),
  storageMode: z.enum(VAULT_STORAGE_MODES),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().min(0).max(52428800),
  pageCount: z.number().int().min(1).max(100),
  expiryDate: z.string().regex(ymdRegex).optional(),
  issuer: z.string().trim().max(120).optional(),
  documentNumberLast4: z.string().trim().max(64).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  notes: z.string().max(2000).optional(),
  ocrText: z.string().max(20000).optional(),
  isEncrypted: z.boolean(),
  isLocked: z.boolean(),
  localFileKey: z.string().min(1).max(128).regex(safeIdRegex).optional(),
  linkedReminderId: z.string().min(1).max(128).regex(safeIdRegex).optional(),
  version: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type VaultDocumentMeta = z.infer<typeof VaultDocumentMetaSchema>;

export const CreateVaultDocumentInputSchema = z.object({
  folderId: z.string().min(1).max(128).regex(safeIdRegex).optional(),
  title: z.string().trim().min(1).max(200),
  docType: z.enum(VAULT_DOC_TYPES).default('other'),
  storageMode: z.enum(VAULT_STORAGE_MODES).default('local_only'),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().min(0).max(52428800),
  pageCount: z.number().int().min(1).max(100).default(1),
  expiryDate: z.string().regex(ymdRegex).optional(),
  issuer: z.string().trim().max(120).optional(),
  documentNumberLast4: z.string().trim().max(64).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  notes: z.string().max(2000).optional(),
  ocrText: z.string().max(20000).optional(),
  isEncrypted: z.boolean().default(false),
  isLocked: z.boolean().default(false),
  localFileKey: z.string().min(1).max(128).regex(safeIdRegex).optional(),
  linkedReminderId: z.string().min(1).max(128).regex(safeIdRegex).optional(),
});

export type CreateVaultDocumentInput = z.infer<typeof CreateVaultDocumentInputSchema>;

export interface VaultFolderTreeNode {
  folder: VaultFolder;
  depth: number;
  children: VaultFolderTreeNode[];
}

export function buildVaultFolderTree(folders: VaultFolder[]): VaultFolderTreeNode[] {
  const byId = new Map<string, VaultFolder>();
  for (const f of folders) byId.set(f.id, f);

  // Neutralize self-parent or cyclic references safely
  const safeParent = new Map<string, string | null>();
  for (const f of folders) {
    if (!f.parentId || f.parentId === f.id || !byId.has(f.parentId)) {
      safeParent.set(f.id, null);
      continue;
    }
    const visited = new Set<string>([f.id]);
    let cursor: string | undefined = f.parentId;
    let cyclic = false;
    while (cursor) {
      if (visited.has(cursor)) {
        cyclic = true;
        break;
      }
      visited.add(cursor);
      cursor = byId.get(cursor)?.parentId;
    }
    safeParent.set(f.id, cyclic ? null : f.parentId);
  }

  const childrenByParent = new Map<string | null, VaultFolder[]>();
  for (const f of folders) {
    const p = safeParent.get(f.id) ?? null;
    const arr = childrenByParent.get(p) ?? [];
    arr.push(f);
    childrenByParent.set(p, arr);
  }

  for (const list of childrenByParent.values()) {
    list.sort((a, b) => compareSortKeys(a.sortKey, b.sortKey));
  }

  const buildNodes = (parentId: string | null, depth: number): VaultFolderTreeNode[] => {
    const list = childrenByParent.get(parentId) ?? [];
    return list.map((folder) => ({
      folder,
      depth,
      children: buildNodes(folder.id, depth + 1),
    }));
  };

  return buildNodes(null, 0);
}

export function flattenVaultFolderTree(
  nodes: VaultFolderTreeNode[]
): Array<{ folder: VaultFolder; depth: number }> {
  const out: Array<{ folder: VaultFolder; depth: number }> = [];
  const walk = (items: VaultFolderTreeNode[]) => {
    for (const n of items) {
      out.push({ folder: n.folder, depth: n.depth });
      if (n.children.length > 0) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, idx);
  return `${idx === 0 ? Math.round(val) : val.toFixed(val >= 10 ? 1 : 2)} ${units[idx]}`;
}
