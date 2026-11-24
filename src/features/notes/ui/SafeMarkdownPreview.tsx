import React, { useMemo } from 'react';
import {
  parseMarkdownBlocks,
  type InlineToken,
} from '../../../core/notes/safeMarkdown';

interface SafeMarkdownPreviewProps {
  markdown: string;
  onToggleChecklistLine?: (lineIndex: number) => void;
}

function renderInlineTokens(tokens: readonly InlineToken[], keyPrefix: string): React.ReactNode {
  return tokens.map((tok, i) => {
    const key = `${keyPrefix}_${i}`;
    switch (tok.type) {
      case 'bold':
        return (
          <strong key={key} className="font-semibold text-[var(--text-primary)]">
            {tok.value}
          </strong>
        );
      case 'italic':
        return (
          <em key={key} className="italic">
            {tok.value}
          </em>
        );
      case 'strike':
        return (
          <del key={key} className="line-through text-[var(--text-muted)]">
            {tok.value}
          </del>
        );
      case 'code':
        return (
          <code
            key={key}
            className="font-numeric rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-1.5 py-0.5 text-[12px] text-[var(--text-primary)]"
          >
            {tok.value}
          </code>
        );
      case 'link':
        return (
          <a
            key={key}
            href={tok.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent)] underline underline-offset-2 hover:opacity-80"
          >
            {tok.label}
          </a>
        );
      default:
        return <React.Fragment key={key}>{tok.value}</React.Fragment>;
    }
  });
}

export const SafeMarkdownPreview: React.FC<SafeMarkdownPreviewProps> = ({
  markdown,
  onToggleChecklistLine,
}) => {
  const blocks = useMemo(() => parseMarkdownBlocks(markdown), [markdown]);

  if (blocks.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)] italic">
        Start writing Markdown to see a live preview here.
      </p>
    );
  }

  return (
    <div className="space-y-3.5 text-sm leading-relaxed text-[var(--text-secondary)]">
      {blocks.map((block, idx) => {
        const key = `blk_${idx}`;
        switch (block.type) {
          case 'heading':
            if (block.level === 1) {
              return (
                <h1 key={key} className="text-xl font-bold tracking-tight text-[var(--text-primary)] pt-1">
                  {renderInlineTokens(block.tokens, key)}
                </h1>
              );
            }
            if (block.level === 2) {
              return (
                <h2 key={key} className="text-base font-semibold tracking-tight text-[var(--text-primary)] pt-1">
                  {renderInlineTokens(block.tokens, key)}
                </h2>
              );
            }
            return (
              <h3 key={key} className="text-sm font-semibold text-[var(--text-primary)] pt-0.5">
                {renderInlineTokens(block.tokens, key)}
              </h3>
            );

          case 'paragraph':
            return (
              <p key={key} className="text-sm leading-relaxed text-[var(--text-secondary)]">
                {renderInlineTokens(block.tokens, key)}
              </p>
            );

          case 'blockquote':
            return (
              <blockquote
                key={key}
                className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-4 py-3 text-sm italic text-[var(--text-secondary)]"
              >
                {renderInlineTokens(block.tokens, key)}
              </blockquote>
            );

          case 'code_block':
            return (
              <pre
                key={key}
                className="overflow-x-auto rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-3.5 font-numeric text-xs text-[var(--text-primary)]"
              >
                <code>{block.code}</code>
              </pre>
            );

          case 'hr':
            return <hr key={key} className="border-t border-[var(--border-hairline)] my-2" />;

          case 'bullet_list':
            return (
              <ul key={key} className="list-disc ps-5 space-y-1.5">
                {block.items.map((itemTokens, j) => (
                  <li key={`${key}_li_${j}`}>{renderInlineTokens(itemTokens, `${key}_li_${j}`)}</li>
                ))}
              </ul>
            );

          case 'ordered_list':
            return (
              <ol key={key} className="list-decimal ps-5 space-y-1.5 font-numeric">
                {block.items.map((itemTokens, j) => (
                  <li key={`${key}_ol_${j}`} className="font-sans">
                    {renderInlineTokens(itemTokens, `${key}_ol_${j}`)}
                  </li>
                ))}
              </ol>
            );

          case 'checklist':
            return (
              <div key={key} className="space-y-1.5">
                {block.items.map((item, j) => (
                  <label
                    key={`${key}_chk_${j}`}
                    className="flex items-start gap-2.5 cursor-pointer py-0.5"
                  >
                    <input
                      type="checkbox"
                      checked={item.checked}
                      disabled={!onToggleChecklistLine}
                      onChange={() => onToggleChecklistLine?.(item.lineIndex)}
                      className="mt-1 h-4 w-4 accent-[var(--accent)] rounded shrink-0"
                    />
                    <span className={item.checked ? 'line-through text-[var(--text-muted)]' : ''}>
                      {renderInlineTokens(item.tokens, `${key}_chk_${j}`)}
                    </span>
                  </label>
                ))}
              </div>
            );
        }
      })}
    </div>
  );
};
