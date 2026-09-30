/**
 * @fileoverview Underscore handling in literal Markdown text: identifiers stay copyable, emphasis delimiters do not.
 * @module tests/utils/markdown-text.test
 */

import { describe, expect, it } from 'vitest';
import { markdownText } from '@/utils/markdown-text.js';

describe('markdownText underscores', () => {
  it('leaves an underscore between letters or digits untouched', () => {
    expect(markdownText('and_chr 152 → chrome_android 152')).toBe(
      'and_chr 152 → chrome_android 152',
    );
    expect(markdownText('Pass as group to browsercompat_search_features')).toBe(
      'Pass as group to browsercompat_search_features',
    );
    expect(markdownText('api.Element.DOMActivate_event')).toBe('api.Element.DOMActivate_event');
  });

  it('escapes an underscore that could delimit emphasis', () => {
    expect(markdownText('_literal_')).toBe('\\_literal\\_');
    expect(markdownText('a __strong__ b')).toBe('a \\_\\_strong\\_\\_ b');
    expect(markdownText('snake_ case')).toBe('snake\\_ case');
    expect(markdownText('(_x)')).toBe('(\\_x)');
  });
});
