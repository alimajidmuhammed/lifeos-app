import { z } from 'zod';
import { sortBySortKey } from '../planner/fractionalIndex';

export const NoteFolderSchema = z.object({
  id: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  uid: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().trim().min(1, 'Folder name is required').max(80),
  parentId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  sortKey: z.string().min(1).max(64).regex(/^[0-9A-Za-z]+$/),
  isLockedFolder: z.boolean(),
  version: z.number().int().min(1),
  createdAtIso: z.string().optional(),
  updatedAtIso: z.string().optional(),
});
export type NoteFolder = z.infer<typeof NoteFolderSchema>;

export const CreateFolderInputSchema = z.object({
  name: z.string().trim().min(1, 'Folder name is required').max(80),
  parentId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  isLockedFolder: z.boolean().default(false),
});
export type CreateFolderInput = z.infer<typeof CreateFolderInputSchema>;

export const NoteItemSchema = z.object({
  id: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  uid: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  folderId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  title: z.string().trim().min(1, 'Note title is required').max(200),
  content: z.string().max(100000),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  isEncrypted: z.boolean(),
  isLocked: z.boolean(),
  pinned: z.boolean(),
  wordCount: z.number().int().min(0).max(100000),
  version: z.number().int().min(1),
  createdAtIso: z.string().optional(),
  updatedAtIso: z.string().optional(),
});
export type NoteItem = z.infer<typeof NoteItemSchema>;

export const CreateNoteInputSchema = z.object({
  folderId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  title: z.string().trim().min(1, 'Note title is required').max(200),
  content: z.string().max(100000).default(''),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  isEncrypted: z.boolean().default(false),
  isLocked: z.boolean().default(false),
  pinned: z.boolean().default(false),
});
export type CreateNoteInput = z.infer<typeof CreateNoteInputSchema>;

export const NoteVersionSchema = z.object({
  id: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  uid: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  noteId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  title: z.string().min(1).max(200),
  content: z.string().max(100000),
  isEncrypted: z.boolean(),
  versionNumber: z.number().int().min(1).max(100000),
  createdAtIso: z.string(),
});
export type NoteVersion = z.infer<typeof NoteVersionSchema>;

export function countMarkdownWords(markdown: string): number {
  const cleaned = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~\-[\]()]/g, ' ')
    .trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

export interface FolderTreeNode {
  folder: NoteFolder;
  depth: number;
  children: FolderTreeNode[];
}

/**
 * Builds a deterministic nested folder tree with cycle protection and depth cap (max depth 5).
 */
export function buildFolderTree(folders: readonly NoteFolder[]): FolderTreeNode[] {
  const sorted = sortBySortKey(folders);
  const byId = new Map(sorted.map((f) => [f.id, f]));
  const childrenMap = new Map<string | null, NoteFolder[]>();

  for (const f of sorted) {
    const validParent =
      f.parentId && f.parentId !== f.id && byId.has(f.parentId) ? f.parentId : null;
    const list = childrenMap.get(validParent) ?? [];
    list.push(f);
    childrenMap.set(validParent, list);
  }

  const visited = new Set<string>();

  const buildNodes = (parentId: string | null, depth: number): FolderTreeNode[] => {
    if (depth > 5) return [];
    const list = childrenMap.get(parentId) ?? [];
    const result: FolderTreeNode[] = [];
    for (const folder of list) {
      if (visited.has(folder.id)) continue;
      visited.add(folder.id);
      result.push({
        folder,
        depth,
        children: buildNodes(folder.id, depth + 1),
      });
    }
    return result;
  };

  return buildNodes(null, 0);
}

export function flattenFolderTree(nodes: readonly FolderTreeNode[]): Array<{ folder: NoteFolder; depth: number }> {
  const out: Array<{ folder: NoteFolder; depth: number }> = [];
  const walk = (list: readonly FolderTreeNode[]) => {
    for (const n of list) {
      out.push({ folder: n.folder, depth: n.depth });
      if (n.children.length > 0) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}
