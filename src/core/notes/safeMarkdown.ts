/**
 * Expo-Portable Safe Markdown AST Parser (Zero Raw HTML / Zero dangerouslySetInnerHTML)
 *
 * Parses Markdown into strongly-typed block and inline AST nodes so React (or React Native)
 * renders native elements with strict URL scheme filtering (only http:// and https://).
 */

export type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'strike'; value: string }
  | { type: 'code'; value: string }
  | { type: 'link'; label: string; href: string };

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; tokens: InlineToken[] }
  | { type: 'paragraph'; tokens: InlineToken[] }
  | { type: 'blockquote'; tokens: InlineToken[] }
  | { type: 'code_block'; language: string; code: string }
  | { type: 'hr' }
  | { type: 'bullet_list'; items: InlineToken[][] }
  | { type: 'ordered_list'; items: InlineToken[][] }
  | { type: 'checklist'; items: Array<{ lineIndex: number; checked: boolean; tokens: InlineToken[] }> };

export function isSafeHttpUrl(url: string): boolean {
  const trimmed = url.trim();
  return /^https?:\/\/[^\s<>"]+$/i.test(trimmed);
}

export function parseInlineMarkdown(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let remaining = text;

  const pattern =
    /(`[^`]+`|\*\*[^*]+\*\*|~~[^~]+~~|\*[^*]+\*|\[([^\]]+)\]\(([^)]+)\))/;

  while (remaining.length > 0) {
    const match = pattern.exec(remaining);
    if (!match || match.index === undefined) {
      tokens.push({ type: 'text', value: remaining });
      break;
    }

    if (match.index > 0) {
      tokens.push({ type: 'text', value: remaining.slice(0, match.index) });
    }

    const raw = match[0];
    if (raw.startsWith('`') && raw.endsWith('`')) {
      tokens.push({ type: 'code', value: raw.slice(1, -1) });
    } else if (raw.startsWith('**') && raw.endsWith('**')) {
      tokens.push({ type: 'bold', value: raw.slice(2, -2) });
    } else if (raw.startsWith('~~') && raw.endsWith('~~')) {
      tokens.push({ type: 'strike', value: raw.slice(2, -2) });
    } else if (raw.startsWith('*') && raw.endsWith('*')) {
      tokens.push({ type: 'italic', value: raw.slice(1, -1) });
    } else if (raw.startsWith('[')) {
      const label = match[2] ?? '';
      const href = (match[3] ?? '').trim();
      if (isSafeHttpUrl(href)) {
        tokens.push({ type: 'link', label, href });
      } else {
        // Neutralize non-http(s) links (e.g. javascript:, data:) into plain text
        tokens.push({ type: 'text', value: label });
      }
    }

    remaining = remaining.slice(match.index + raw.length);
  }

  return tokens;
}

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Fenced code block
    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim().slice(0, 24);
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing fence
      blocks.push({ type: 'code_block', language, code: codeLines.join('\n') });
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // Headings (#, ##, ###)
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, tokens: parseInlineMarkdown(headingMatch[2]) });
      i++;
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        quoteLines.push(lines[i].trim().slice(2));
        i++;
      }
      blocks.push({ type: 'blockquote', tokens: parseInlineMarkdown(quoteLines.join(' ')) });
      continue;
    }

    // Checklist (- [ ] or - [x])
    if (/^[-*]\s+\[([ xX])\]\s+/.test(trimmed)) {
      const items: Array<{ lineIndex: number; checked: boolean; tokens: InlineToken[] }> = [];
      while (i < lines.length) {
        const m = /^[-*]\s+\[([ xX])\]\s+(.*)$/.exec(lines[i].trim());
        if (!m) break;
        items.push({
          lineIndex: i,
          checked: m[1].toLowerCase() === 'x',
          tokens: parseInlineMarkdown(m[2]),
        });
        i++;
      }
      blocks.push({ type: 'checklist', items });
      continue;
    }

    // Bullet list
    if (/^[-*]\s+/.test(trimmed)) {
      const items: InlineToken[][] = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        if (/^[-*]\s+\[([ xX])\]\s+/.test(t)) break;
        const m = /^[-*]\s+(.*)$/.exec(t);
        if (!m) break;
        items.push(parseInlineMarkdown(m[1]));
        i++;
      }
      blocks.push({ type: 'bullet_list', items });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: InlineToken[][] = [];
      while (i < lines.length) {
        const m = /^\d+\.\s+(.*)$/.exec(lines[i].trim());
        if (!m) break;
        items.push(parseInlineMarkdown(m[1]));
        i++;
      }
      blocks.push({ type: 'ordered_list', items });
      continue;
    }

    // Paragraph (join contiguous non-blank plain lines)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,3}\s+|```|>\s+|[-*]\s+|\d+\.\s+|-{3,}$|\*{3,}$)/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: 'paragraph', tokens: parseInlineMarkdown(paraLines.join(' ')) });
  }

  return blocks;
}

/**
 * Toggles a specific markdown checklist line (0-based line index) safely.
 */
export function toggleMarkdownChecklistLine(markdown: string, lineIndex: number): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  if (lineIndex < 0 || lineIndex >= lines.length) return markdown;
  const line = lines[lineIndex];
  if (/^(\s*[-*]\s+)\[ \](.*)$/.test(line)) {
    lines[lineIndex] = line.replace(/^(\s*[-*]\s+)\[ \](.*)$/, '$1[x]$2');
  } else if (/^(\s*[-*]\s+)\[[xX]\](.*)$/.test(line)) {
    lines[lineIndex] = line.replace(/^(\s*[-*]\s+)\[[xX]\](.*)$/, '$1[ ]$2');
  }
  return lines.join('\n');
}
