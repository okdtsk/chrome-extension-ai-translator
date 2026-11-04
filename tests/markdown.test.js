const test = require('node:test');
const assert = require('node:assert/strict');

const { selectionToMarkdown, renderMarkdown, markdownToPlainText } = require('../markdown.js');
const core = require('../core.js');

// Minimal DOM stand-ins: the serializer only reads nodeType, tagName,
// textContent, childNodes, parentNode, and getAttribute.
const text = (textContent) => ({ nodeType: 3, textContent, childNodes: [], parentNode: null });
const el = (tag, ...rest) => {
  const attrs = rest[0] && typeof rest[0] === 'object' && !('nodeType' in rest[0]) ? rest.shift() : {};
  const childNodes = rest.map(child => (typeof child === 'string' ? text(child) : child));
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    childNodes,
    parentNode: null,
    getAttribute: (name) => (name in attrs ? attrs[name] : null)
  };
  childNodes.forEach(child => { child.parentNode = node; });
  return node;
};
const fragment = (...children) => {
  const node = el('div', ...children);
  node.nodeType = 11;
  node.tagName = undefined;
  return node;
};

test('selectionToMarkdown: blocks', async (t) => {
  await t.test('serializes headings at their level', () => {
    assert.equal(
      selectionToMarkdown(fragment(el('h1', 'One'), el('h3', 'Three'), el('p', 'Body'))),
      '# One\n\n### Three\n\nBody'
    );
  });

  await t.test('serializes unordered lists', () => {
    assert.equal(
      selectionToMarkdown(fragment(el('ul', el('li', 'a'), '\n  ', el('li', 'b')))),
      '- a\n- b'
    );
  });

  await t.test('serializes ordered lists and honors the start attribute', () => {
    assert.equal(
      selectionToMarkdown(fragment(el('ol', { start: '3' }, el('li', 'a'), el('li', 'b')))),
      '3. a\n4. b'
    );
  });

  await t.test('indents nested lists under the marker', () => {
    const md = selectionToMarkdown(fragment(
      el('ol', el('li', 'a', el('ul', el('li', 'b'), el('li', 'c'))), el('li', 'd'))
    ));
    assert.equal(md, '1. a\n   - b\n   - c\n2. d');
  });

  await t.test('attaches a list nested directly in a list to the previous item', () => {
    const md = selectionToMarkdown(fragment(el('ul', el('li', 'a'), el('ul', el('li', 'b')))));
    assert.equal(md, '- a\n  - b');
  });

  await t.test('serializes blockquotes, rules, and code blocks', () => {
    const md = selectionToMarkdown(fragment(
      el('blockquote', el('p', 'q1'), el('p', 'q2')),
      el('hr'),
      el('pre', el('code', 'const a = 1;\n  b();\n'))
    ));
    assert.equal(md, '> q1\n>\n> q2\n\n---\n\n```\nconst a = 1;\n  b();\n```');
  });

  await t.test('lengthens the fence when code contains backticks', () => {
    assert.equal(
      selectionToMarkdown(fragment(el('pre', 'a\n```\nb'))),
      '````\na\n```\nb\n````'
    );
  });

  await t.test('treats br as a line break and double br as a paragraph break', () => {
    assert.equal(
      selectionToMarkdown(fragment(el('p', 'a', el('br'), 'b', el('br'), el('br'), 'c'))),
      'a\nb\n\nc'
    );
  });

  await t.test('separates table cells and rows', () => {
    const md = selectionToMarkdown(fragment(el('table', el('tbody',
      el('tr', el('td', 'a'), el('td', 'b')),
      el('tr', el('td', 'c'), el('td', 'd'))
    ))));
    assert.equal(md, 'a b\n\nc d');
  });

  await t.test('ignores non-content elements', () => {
    assert.equal(
      selectionToMarkdown(fragment(el('p', 'a', el('script', 'x()'), el('style', '.y{}')))),
      'a'
    );
  });

  await t.test('splits blocks nested in inline elements', () => {
    assert.equal(
      selectionToMarkdown(fragment(el('span', el('div', 'a'), el('div', 'b')))),
      'a\n\nb'
    );
  });
});

test('selectionToMarkdown: inline', async (t) => {
  await t.test('serializes bold, italic, strikethrough, and code', () => {
    assert.equal(
      selectionToMarkdown(fragment(el('p',
        el('strong', 'b1'), ' ', el('b', 'b2'), ' ', el('em', 'i1'), ' ', el('i', 'i2'), ' ',
        el('del', 'd'), ' ', el('code', 'c')
      ))),
      '**b1** **b2** *i1* *i2* ~~d~~ `c`'
    );
  });

  await t.test('moves edge whitespace outside the markers', () => {
    assert.equal(
      selectionToMarkdown(fragment(el('p', 'a', el('strong', ' b '), 'c'))),
      'a **b** c'
    );
  });

  await t.test('does not insert spaces between adjacent inline nodes', () => {
    assert.equal(selectionToMarkdown(fragment(el('p', '重要な', el('b', '単語'), 'です'))), '重要な**単語**です');
  });

  await t.test('does not double markers for nested bold', () => {
    assert.equal(selectionToMarkdown(fragment(el('p', el('b', el('strong', 'x'))))), '**x**');
  });

  await t.test('collapses source whitespace', () => {
    assert.equal(selectionToMarkdown(fragment(el('p', '  a\n   b\t c  '))), 'a b c');
  });

  await t.test('keeps link text but not the URL', () => {
    assert.equal(
      selectionToMarkdown(fragment(el('p', 'see ', el('a', { href: 'https://x.test/?token=1' }, 'docs')))),
      'see docs'
    );
  });

  await t.test('uses a longer delimiter for code containing a backtick', () => {
    assert.equal(selectionToMarkdown(fragment(el('p', el('code', 'a`b')))), '``a`b``');
  });

  await t.test('escapes literal Markdown characters in text', () => {
    assert.equal(
      selectionToMarkdown(fragment(el('p', 'a *b* `c` ~~d~~ C:\\dir \\*'))),
      'a \\*b\\* \\`c\\` \\~\\~d\\~\\~ C:\\dir \\\\\\*'
    );
  });

  await t.test('escapes block markers at the start of a line only', () => {
    assert.equal(
      selectionToMarkdown(fragment(
        el('p', '# no'), el('p', '- no'), el('p', '1. no'), el('p', '> no'), el('p', '---'), el('p', 'a - b')
      )),
      '\\# no\n\n\\- no\n\n1\\. no\n\n\\> no\n\n\\---\n\na - b'
    );
  });
});

test('selectionToMarkdown: selection context', async (t) => {
  const rangeIn = (common, startContainer = common, startOffset = 0) =>
    ({ commonAncestorContainer: common, startContainer, startOffset });

  await t.test('applies the heading that contains the selection', () => {
    const inner = text('Title');
    el('h2', inner);
    assert.equal(selectionToMarkdown(fragment('Title'), rangeIn(inner)), '## Title');
  });

  await t.test('applies inline formatting up to the enclosing block', () => {
    const inner = text('word');
    el('p', el('em', el('strong', inner)));
    assert.equal(selectionToMarkdown(fragment('word'), rangeIn(inner)), '***word***');
  });

  await t.test('stops at the enclosing block', () => {
    const inner = text('word');
    el('strong', el('p', inner));
    assert.equal(selectionToMarkdown(fragment('word'), rangeIn(inner)), 'word');
  });

  await t.test('uses the position of the item that contains the selection', () => {
    const inner = text('two');
    el('ol', { start: '5' }, el('li', 'one'), el('li', inner));
    assert.equal(selectionToMarkdown(fragment('two'), rangeIn(inner)), '6. two');
  });

  await t.test('uses a bullet for an item in an unordered list', () => {
    const inner = text('x');
    el('ul', el('li', inner));
    assert.equal(selectionToMarkdown(fragment('x'), rangeIn(inner)), '- x');
  });

  await t.test('rebuilds the list when the selection spans its items', () => {
    const start = text('two');
    const list = el('ol', el('li', 'one'), '\n', el('li', start), el('li', 'three'));
    assert.equal(
      selectionToMarkdown(fragment(el('li', 'two'), el('li', 'three')), rangeIn(list, start)),
      '2. two\n3. three'
    );
  });

  await t.test('counts items before the start offset when the list is the start container', () => {
    const list = el('ol', el('li', 'one'), el('li', 'two'));
    assert.equal(selectionToMarkdown(fragment(el('li', 'two')), rangeIn(list, list, 1)), '2. two');
  });

  await t.test('rebuilds an unordered list without numbering', () => {
    const list = el('ul', el('li', 'a'), el('li', 'b'));
    assert.equal(selectionToMarkdown(fragment(el('li', 'a'), el('li', 'b')), rangeIn(list)), '- a\n- b');
  });

  await t.test('applies a blockquote that spans the selection', () => {
    const quote = el('blockquote', el('p', 'a'), el('p', 'b'));
    assert.equal(selectionToMarkdown(fragment(el('p', 'a'), el('p', 'b')), rangeIn(quote)), '> a\n>\n> b');
  });

  await t.test('keeps code selected from inside a code block translatable', () => {
    const inner = text('// first\n// second');
    el('pre', el('code', inner));
    assert.equal(selectionToMarkdown(fragment('// first\n// second'), rangeIn(inner)), '// first\n// second');
  });

  await t.test('keeps inline code selected on its own translatable', () => {
    const inner = text('hello');
    el('p', el('code', inner));
    assert.equal(selectionToMarkdown(fragment('hello'), rangeIn(inner)), 'hello');
  });

  await t.test('returns an empty string when there is no content', () => {
    assert.equal(selectionToMarkdown(fragment()), '');
  });
});

test('renderMarkdown: blocks', async (t) => {
  await t.test('renders headings at every level', () => {
    assert.equal(renderMarkdown('# a\n\n###### b'), '<h1>a</h1><h6>b</h6>');
  });

  await t.test('does not treat seven hashes or a missing space as a heading', () => {
    assert.equal(renderMarkdown('####### a'), '<p>####### a</p>');
    assert.equal(renderMarkdown('#a'), '<p>#a</p>');
  });

  await t.test('renders paragraphs and line breaks', () => {
    assert.equal(renderMarkdown('a\nb\n\nc'), '<p>a<br>b</p><p>c</p>');
  });

  await t.test('renders unordered and ordered lists', () => {
    assert.equal(renderMarkdown('- a\n* b\n+ c'), '<ul><li><p>a</p></li><li><p>b</p></li><li><p>c</p></li></ul>');
    assert.equal(renderMarkdown('1. a\n2) b'), '<ol><li><p>a</p></li><li><p>b</p></li></ol>');
  });

  await t.test('keeps the start number of an ordered list', () => {
    assert.equal(renderMarkdown('3. a'), '<ol start="3"><li><p>a</p></li></ol>');
  });

  await t.test('splits lists of a different kind', () => {
    assert.equal(renderMarkdown('- a\n1. b'), '<ul><li><p>a</p></li></ul><ol><li><p>b</p></li></ol>');
  });

  await t.test('renders nested lists with any indent width', () => {
    const nested = '<ul><li><p>a</p><ul><li><p>b</p></li></ul></li><li><p>c</p></li></ul>';
    assert.equal(renderMarkdown('- a\n  - b\n- c'), nested);
    assert.equal(renderMarkdown('- a\n    - b\n- c'), nested);
    assert.equal(renderMarkdown('- a\n\t- b\n- c'), nested);
  });

  await t.test('keeps blank-separated items in one list', () => {
    assert.equal(renderMarkdown('- a\n\n- b'), '<ul><li><p>a</p></li><li><p>b</p></li></ul>');
  });

  await t.test('keeps indented paragraphs in the item', () => {
    assert.equal(renderMarkdown('- a\n\n  b\n\nc'), '<ul><li><p>a</p><p>b</p></li></ul><p>c</p>');
  });

  await t.test('renders blockquotes with nested blocks', () => {
    assert.equal(renderMarkdown('> # a\n>\n> b'), '<blockquote><h1>a</h1><p>b</p></blockquote>');
  });

  await t.test('renders horizontal rules', () => {
    assert.equal(renderMarkdown('a\n\n---\n\n- - -\n\n***'), '<p>a</p><hr><hr><hr>');
  });

  await t.test('renders fenced code without inline processing', () => {
    assert.equal(renderMarkdown('```js\n**a** <b>\n  c\n```'), '<pre><code>**a** &lt;b&gt;\n  c</code></pre>');
  });

  await t.test('renders an unclosed fence as code while streaming', () => {
    assert.equal(renderMarkdown('```\na'), '<pre><code>a</code></pre>');
  });

  await t.test('lets block markers interrupt a paragraph', () => {
    assert.equal(renderMarkdown('a\n# b\n- c'), '<p>a</p><h1>b</h1><ul><li><p>c</p></li></ul>');
  });

  await t.test('handles empty input and CRLF', () => {
    assert.equal(renderMarkdown(''), '');
    assert.equal(renderMarkdown(null), '');
    assert.equal(renderMarkdown('a\r\n\r\nb'), '<p>a</p><p>b</p>');
  });
});

test('renderMarkdown: inline', async (t) => {
  await t.test('renders bold, italic, strikethrough, and code', () => {
    assert.equal(
      renderMarkdown('**b** *i* ~~d~~ `c`'),
      '<p><strong>b</strong> <em>i</em> <del>d</del> <code>c</code></p>'
    );
  });

  await t.test('renders bold next to CJK text and punctuation', () => {
    assert.equal(renderMarkdown('これは**重要。**です'), '<p>これは<strong>重要。</strong>です</p>');
  });

  await t.test('renders nested emphasis in every order', () => {
    assert.equal(renderMarkdown('***a***'), '<p><em><strong>a</strong></em></p>');
    assert.equal(renderMarkdown('***a* b**'), '<p><strong><em>a</em> b</strong></p>');
    assert.equal(renderMarkdown('***a** b*'), '<p><em><strong>a</strong> b</em></p>');
    assert.equal(renderMarkdown('**a *b***'), '<p><strong>a <em>b</em></strong></p>');
    assert.equal(renderMarkdown('*a **b** c*'), '<p><em>a <strong>b</strong> c</em></p>');
  });

  await t.test('leaves unmatched or space-flanked markers literal', () => {
    assert.equal(renderMarkdown('**a'), '<p>**a</p>');
    assert.equal(renderMarkdown('2 * 3 * 4'), '<p>2 * 3 * 4</p>');
    assert.equal(renderMarkdown('** a **'), '<p>** a **</p>');
    assert.equal(renderMarkdown('~a~'), '<p>~a~</p>');
    assert.equal(renderMarkdown('`a'), '<p>`a</p>');
    assert.equal(renderMarkdown('****'), '<hr>');
  });

  await t.test('does not treat underscores as emphasis', () => {
    assert.equal(renderMarkdown('snake_case_name'), '<p>snake_case_name</p>');
  });

  await t.test('honors backslash escapes only before punctuation', () => {
    assert.equal(renderMarkdown('\\*a\\* \\# C:\\dir'), '<p>*a* # C:\\dir</p>');
    assert.equal(renderMarkdown('\\- a'), '<p>- a</p>');
    assert.equal(renderMarkdown('1\\. a'), '<p>1. a</p>');
  });

  await t.test('does not close emphasis on an escaped marker or inside code', () => {
    assert.equal(renderMarkdown('**a\\** b**'), '<p><strong>a** b</strong></p>');
    assert.equal(renderMarkdown('**a `**` b**'), '<p><strong>a <code>**</code> b</strong></p>');
  });

  await t.test('renders longer code delimiters and strips their padding', () => {
    assert.equal(renderMarkdown('``a`b``'), '<p><code>a`b</code></p>');
    assert.equal(renderMarkdown('`` `a` ``'), '<p><code>`a`</code></p>');
  });

  await t.test('renders inline formatting in headings and list items', () => {
    assert.equal(renderMarkdown('## **a**'), '<h2><strong>a</strong></h2>');
    assert.equal(renderMarkdown('- *a*'), '<ul><li><p><em>a</em></p></li></ul>');
  });
});

test('renderMarkdown: safety', async (t) => {
  await t.test('escapes HTML in every context', () => {
    const payload = '<img src=x onerror="alert(1)">';
    const escaped = '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;';
    assert.equal(renderMarkdown(payload), `<p>${escaped}</p>`);
    assert.equal(renderMarkdown(`# ${payload}`), `<h1>${escaped}</h1>`);
    assert.equal(renderMarkdown(`- ${payload}`), `<ul><li><p>${escaped}</p></li></ul>`);
    assert.equal(renderMarkdown(`> ${payload}`), `<blockquote><p>${escaped}</p></blockquote>`);
    assert.equal(renderMarkdown(`**${payload}**`), `<p><strong>${escaped}</strong></p>`);
    assert.equal(renderMarkdown(`\`${payload}\``), `<p><code>${escaped}</code></p>`);
    assert.equal(renderMarkdown(`\`\`\`\n${payload}\n\`\`\``), `<pre><code>${escaped}</code></pre>`);
  });

  await t.test('does not expose the fence info string', () => {
    assert.equal(renderMarkdown('```"><script>\na\n```'), '<pre><code>a</code></pre>');
  });

  await t.test('does not create links', () => {
    assert.equal(renderMarkdown('[a](javascript:alert(1))'), '<p>[a](javascript:alert(1))</p>');
  });
});

test('markdownToPlainText', async (t) => {
  await t.test('removes inline markers and escapes', () => {
    assert.equal(markdownToPlainText('**b** *i* ~~d~~ `c` \\*e\\*'), 'b i d c *e*');
  });

  await t.test('keeps the visible structure', () => {
    assert.equal(
      markdownToPlainText('# T\n\na\nb\n\n1. x\n   - y\n2. z\n\n> q\n\n---\n\n```\ncode\n```'),
      'T\n\na\nb\n\n1. x\n   - y\n2. z\n\n> q\n\n---\n\ncode'
    );
  });

  await t.test('handles empty input', () => {
    assert.equal(markdownToPlainText(''), '');
    assert.equal(markdownToPlainText(undefined), '');
  });
});

test('round trip through serialization and rendering', () => {
  const md = selectionToMarkdown(fragment(
    el('h2', 'T ', el('em', 'x')),
    el('p', 'Literal *stars* and ', el('strong', 'bold')),
    el('ol', el('li', '1. looks numbered', el('ul', el('li', '- looks bulleted'))))
  ));
  assert.equal(
    renderMarkdown(md),
    '<h2>T <em>x</em></h2><p>Literal *stars* and <strong>bold</strong></p>' +
    '<ol><li><p>1. looks numbered</p><ul><li><p>- looks bulleted</p></li></ul></li></ol>'
  );
});

test('getSystemPrompt asks the model to preserve Markdown', () => {
  for (const style of ['literal', 'accurate', 'balanced', 'natural', 'creative']) {
    const prompt = core.getSystemPrompt(style, []);
    assert.match(prompt, /Markdown/);
    assert.match(prompt, /Do not add/);
    assert.match(prompt, /Do not translate the contents of inline code/);
  }
});
