/**
 * @fileoverview Render plain dataset/caller text as Markdown without interpreting it as markup.
 * @module utils/markdown-text
 */

/**
 * Escape literal prose; line breaks become spaces so a value cannot start a Markdown block.
 * An underscore between two letters or digits cannot delimit emphasis, so identifiers such
 * as `and_chr` and `browsercompat_search_features` stay copyable.
 */
function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*[\]|#~]/g, '\\$&')
    .replace(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, '\\_')
    .replace(/[\r\n]/g, ' ')
    .replace(/^(\s*)([-+]|\d+[.)])(?=\s)/, '$1\\$2');
}

/**
 * Escape literal text while keeping HTTP(S) destinations clickable. Parentheses
 * surrounding a normalized BCD link belong to the prose; balanced parentheses
 * within its URL remain part of the destination.
 */
export function markdownText(value: string): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const match of value.matchAll(/https?:\/\/[^\s<>]+/g)) {
    const start = match.index;
    parts.push(escapeText(value.slice(cursor, start)));
    let length = match[0].length;
    let depth = 0;
    for (let i = 0; i < length; i++) {
      const char = match[0][i];
      if (char === '(') depth++;
      if (char === ')') {
        if (depth === 0) {
          length = i;
          break;
        }
        depth--;
      }
    }
    while (length > 0 && /[.,;!]/.test(match[0][length - 1] ?? '')) length--;
    const url = match[0]
      .slice(0, length)
      .replace(/&/g, '&amp;')
      .replace(/["`\\|]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    parts.push(`<${url}>`, escapeText(match[0].slice(length)));
    cursor = start + match[0].length;
  }
  parts.push(escapeText(value.slice(cursor)));
  return parts.join('');
}
