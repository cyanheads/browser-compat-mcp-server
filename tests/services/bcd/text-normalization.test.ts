/**
 * @fileoverview BCD markup normalization with label, URL, and single-decode fidelity.
 * @module tests/services/bcd/text-normalization.test
 */

import { describe, expect, it } from 'vitest';
import { stripTags } from '@/services/search/search-service.js';

describe('#9 BCD HTML normalization', () => {
  it('preserves nested anchor labels and destinations in place', () => {
    expect(
      stripTags(
        'See <a href="https://example.test/a?x=1&amp;y=2"><code>foo()</code> and <b>bar</b></a>.',
      ),
    ).toBe('See foo() and bar (https://example.test/a?x=1&y=2).');
    expect(
      stripTags(
        '<a href="https://example.test/one">one</a><a href="https://example.test/two">two</a>',
      ),
    ).toBe('one (https://example.test/one)two (https://example.test/two)');
  });
  it('decodes named and numeric entities exactly once, preserving unknown names', () => {
    expect(
      stripTags(
        '&lt;input&gt; &lt;textarea&gt; &amp;lt; &#60;dialog&#x3e; &#x1F600; &constructor; &toString;',
      ),
    ).toBe('<input> <textarea> &lt; <dialog> 😀 &constructor; &toString;');
    expect(stripTags('&#0; &#xD800; &#x110000; &#xZZ; &amp;#60;')).toBe('� � � &#xZZ; &#60;');
  });
  it('drops comments, keeps text boundaries, and handles malformed or unclosed openers', () => {
    expect(stripTags('a<!-- <a href="bad">hidden</a> -->b<br>c')).toBe('ab c');
    expect(stripTags('before <code unfinished')).toBe('before <code unfinished');
    expect(stripTags('before <!-- unfinished')).toBe('before');
    expect(stripTags('<a href="https://example.test/one">unclosed <b>label')).toBe(
      'unclosed label (https://example.test/one)',
    );
    expect(stripTags('a < b > c')).toBe('a < b > c');
  });
  it('retains quoted greater-than signs and case-insensitive anchor attributes', () => {
    expect(stripTags('<A title="a > b" HREF=\'https://example.test/?q=&amp;lt;\'>label</A>')).toBe(
      'label (https://example.test/?q=&lt;)',
    );
  });
  it('reads href attributes rather than href-like text inside another attribute', () => {
    expect(
      stripTags(
        '<a title=" href=\'https://example.test/wrong\' " href="https://example.test/right">label</a>',
      ),
    ).toBe('label (https://example.test/right)');
  });
});
