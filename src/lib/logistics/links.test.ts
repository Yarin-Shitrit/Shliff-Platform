import { describe, it, expect } from 'vitest';
import { extractLinks } from './links';

describe('the addresses in a note', () => {
  it('finds none in nothing, and none in plain words', () => {
    expect(extractLinks(null)).toEqual([]);
    expect(extractLinks('')).toEqual([]);
    expect(extractLinks('לבדוק מחיר אצל הספק ביום ראשון')).toEqual([]);
  });

  it('reads an address out of a Hebrew sentence, without the full stop after it', () => {
    expect(extractLinks('ראיתי כאן: https://www.ikea.co.il/p/123?color=red. נראה טוב')).toEqual([
      { url: 'https://www.ikea.co.il/p/123?color=red', host: 'ikea.co.il' },
    ]);
  });

  it('keeps every address, in the order written, each once', () => {
    const links = extractLinks('https://a.example/x\nאו http://b.example/y (וגם https://a.example/x)');
    expect(links.map((link) => link.url)).toEqual(['https://a.example/x', 'http://b.example/y']);
  });

  it('opens a bare www address as https', () => {
    expect(extractLinks('www.ace.co.il/drill')).toEqual([{ url: 'https://www.ace.co.il/drill', host: 'ace.co.il' }]);
  });

  it('never makes a pressable link of anything that is not a web address', () => {
    expect(extractLinks('javascript:alert(1) data:text/html,x mailto:a@b.co file:///c/x')).toEqual([]);
    expect(extractLinks('http://localhost/x https://')).toEqual([]);
  });
});
