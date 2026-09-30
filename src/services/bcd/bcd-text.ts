/**
 * @fileoverview Plain-text normalization for BCD's inline HTML descriptions and notes.
 * @module services/bcd/bcd-text
 */

/** Named entities used by BCD, plus the standard prose/XML escapes. Unknown names stay literal. */
const ENTITIES = new Map([
  ['lt', '<'],
  ['gt', '>'],
  ['amp', '&'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', ' '],
  ['copy', '©'],
  ['reg', '®'],
  ['trade', '™'],
  ['ndash', '–'],
  ['mdash', '—'],
  ['hellip', '…'],
]);

/** Decode one entity layer; invalid Unicode scalar values become the replacement character. */
function decodeEntities(value: string): string {
  return value.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (entity: string, name: string) => {
    if (!name.startsWith('#')) return ENTITIES.get(name) ?? entity;
    const hex = name[1]?.toLowerCase() === 'x';
    const point = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
    return point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)
      ? '�'
      : String.fromCodePoint(point);
  });
}

/** Read an anchor's actual href without matching attribute-like text inside quoted values. */
function anchorHref(tag: string): string | undefined {
  let cursor = 1;
  while (cursor < tag.length) {
    while (/\s/.test(tag[cursor] ?? '') && cursor < tag.length) cursor++;
    const start = cursor;
    while (cursor < tag.length && !/[\s=]/.test(tag[cursor] ?? '')) cursor++;
    const name = tag.slice(start, cursor).toLowerCase();
    while (/\s/.test(tag[cursor] ?? '') && cursor < tag.length) cursor++;
    if (tag[cursor] !== '=') continue;
    cursor++;
    while (/\s/.test(tag[cursor] ?? '') && cursor < tag.length) cursor++;
    const quote = tag[cursor] === '"' || tag[cursor] === "'" ? tag[cursor++] : undefined;
    const valueStart = cursor;
    while (cursor < tag.length && (quote ? tag[cursor] !== quote : !/\s/.test(tag[cursor] ?? '')))
      cursor++;
    const value = tag.slice(valueStart, cursor);
    if (quote) cursor++;
    if (name === 'href') return value;
  }
  return undefined;
}

/**
 * Strip actual BCD markup, keeping anchor labels with their destinations. The scan
 * consumes each opener once, including malformed/unclosed input; entities are
 * decoded only after markup, so escaped element names remain literal text.
 */
export function normalizeBcdText(value: string): string {
  const parts: string[] = [];
  const anchors: (string | undefined)[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const open = value.indexOf('<', cursor);
    if (open === -1) {
      parts.push(value.slice(cursor));
      break;
    }
    parts.push(value.slice(cursor, open));
    if (value.startsWith('<!--', open)) {
      const close = value.indexOf('-->', open + 4);
      cursor = close === -1 ? value.length : close + 3;
      continue;
    }
    const nameStart = open + (value[open + 1] === '/' ? 2 : 1);
    if (!/[a-z]/i.test(value[nameStart] ?? '')) {
      parts.push('<');
      cursor = open + 1;
      continue;
    }
    let end = nameStart;
    let quote: string | undefined;
    for (; end < value.length; end++) {
      const char = value[end];
      if (quote) {
        if (char === quote) quote = undefined;
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '>' || char === '<') break;
    }
    if (value[end] !== '>') {
      parts.push(value.slice(open, end));
      cursor = end;
      continue;
    }
    const tag = value.slice(nameStart, end);
    const name = /^[a-z][a-z\d-]*/i.exec(tag)?.[0].toLowerCase();
    if (name === 'a') {
      if (value[open + 1] === '/') {
        const href = anchors.pop();
        if (href) parts.push(` (${href})`);
      } else {
        anchors.push(anchorHref(tag));
      }
    } else if (name === 'br' || name === 'p' || name === 'div' || name === 'li') parts.push(' ');
    cursor = end + 1;
  }
  for (const href of anchors.reverse()) if (href) parts.push(` (${href})`);
  return decodeEntities(parts.join('')).replace(/\s+/g, ' ').trim();
}
