// Markdown is the format that carries the structure of the source text through
// the AI provider: the selected DOM is serialized to Markdown, the model keeps
// the markers while translating, and the output is rendered back for display.
//
// No chrome.* dependencies and no document access. Loaded as a content script
// and from history.html, and required from Node tests.

(function (root) {
  const ELEMENT_NODE = 1;
  const TEXT_NODE = 3;

  // --- DOM to Markdown ------------------------------------------------------

  const BLOCK_TAGS = new Set([
    'address', 'article', 'aside', 'blockquote', 'caption', 'center', 'dd', 'details',
    'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'li', 'main', 'menu',
    'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'tfoot', 'thead',
    'tr', 'ul'
  ]);
  const SKIPPED_TAGS = new Set([
    'canvas', 'embed', 'head', 'iframe', 'link', 'meta', 'noscript', 'object',
    'script', 'select', 'style', 'svg', 'template', 'textarea'
  ]);
  const INLINE_MARKERS = {
    strong: '**', b: '**', em: '*', i: '*', del: '~~', s: '~~', strike: '~~'
  };
  const CODE_TAGS = new Set(['code', 'kbd', 'samp', 'tt']);
  const HEADING_TAG = /^h([1-6])$/;

  const tagOf = (node) => (node.tagName || '').toLowerCase();
  const isListTag = (tag) => tag === 'ul' || tag === 'ol';

  const containsBlock = (node) => Array.from(node.childNodes).some(hasBlockInSubtree);

  const hasBlockInSubtree = (node) => {
    if (node.nodeType !== ELEMENT_NODE) return false;
    const tag = tagOf(node);
    if (SKIPPED_TAGS.has(tag)) return false;
    return BLOCK_TAGS.has(tag) || containsBlock(node);
  };

  const escapeInlineText = (text) => text
    .replace(/\\(?=[!-/:-@[-`{-~])/g, '\\\\')
    .replace(/[`*]/g, '\\$&')
    .replace(/~~/g, '\\~\\~');

  // Keep text at the start of a line from being read as a block marker.
  const escapeLineStart = (line) => {
    if (/^([-_])(?:\s*\1){2,}\s*$/.test(line)) return `\\${line}`;
    if (/^(?:#{1,6}|[-+])(?:\s|$)/.test(line) || line.startsWith('>')) return `\\${line}`;
    return line.replace(/^(\d{1,9})([.)])(?=\s|$)/, '$1\\$2');
  };

  // Markers must touch the text they wrap and cannot span a blank line, so
  // each line is wrapped on its own with edge whitespace left outside.
  const wrapLines = (text, marker) => text
    .split(/(\n+)/)
    .map((part) => {
      if (part.startsWith('\n')) return part;
      const [, lead, core, trail] = part.match(/^(\s*)([\s\S]*?)(\s*)$/);
      return core ? `${lead}${marker}${core}${marker}${trail}` : part;
    })
    .join('');

  const rawText = (node) => {
    if (node.nodeType === TEXT_NODE) return node.textContent;
    if (node.nodeType !== ELEMENT_NODE) return '';
    if (tagOf(node) === 'br') return '\n';
    return Array.from(node.childNodes).map(rawText).join('');
  };

  const longestBacktickRun = (text) =>
    (text.match(/`+/g) || []).reduce((longest, run) => Math.max(longest, run.length), 0);

  const codeSpan = (code) => {
    const content = code.replace(/\s+/g, ' ').trim();
    if (!content) return '';
    const delimiter = '`'.repeat(longestBacktickRun(content) + 1);
    const padding = content.startsWith('`') || content.endsWith('`') ? ' ' : '';
    return `${delimiter}${padding}${content}${padding}${delimiter}`;
  };

  const codeFence = (code) => {
    const content = code.replace(/\n+$/, '');
    if (!content.trim()) return [];
    const fence = '`'.repeat(Math.max(3, longestBacktickRun(content) + 1));
    return [`${fence}\n${content}\n${fence}`];
  };

  const serializeInlineChildren = (node, ctx) =>
    Array.from(node.childNodes).map(child => serializeInline(child, ctx)).join('');

  const serializeText = (node, ctx) => escapeInlineText(
    ctx.preformatted ? node.textContent : node.textContent.replace(/[ \t\r\n\f]+/g, ' ')
  );

  const serializeInline = (node, ctx) => {
    if (node.nodeType === TEXT_NODE) return serializeText(node, ctx);
    if (node.nodeType !== ELEMENT_NODE) return '';

    const tag = tagOf(node);
    if (SKIPPED_TAGS.has(tag)) return '';
    if (tag === 'br') return '\n';
    if (CODE_TAGS.has(tag)) return codeSpan(rawText(node));

    const marker = INLINE_MARKERS[tag];
    if (marker) {
      if (ctx.activeMarkers.has(marker)) return serializeInlineChildren(node, ctx);
      const activeMarkers = new Set(ctx.activeMarkers).add(marker);
      return wrapLines(serializeInlineChildren(node, { ...ctx, activeMarkers }), marker);
    }
    const content = serializeInlineChildren(node, ctx);
    return tag === 'td' || tag === 'th' ? `${content} ` : content;
  };

  const inlineToParagraphs = (raw, ctx) => raw
    .split('\n')
    .map(line => (ctx.preformatted ? line : line.replace(/ {2,}/g, ' ')).trim())
    .join('\n')
    .split(/\n{2,}/)
    .filter(Boolean)
    .map(paragraph => paragraph.split('\n').map(escapeLineStart).join('\n'));

  const serializeBlocks = (parent, ctx) => {
    const blocks = [];
    let inline = '';
    const flushInline = () => {
      blocks.push(...inlineToParagraphs(inline, ctx));
      inline = '';
    };

    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === ELEMENT_NODE && !SKIPPED_TAGS.has(tagOf(child)) &&
          (BLOCK_TAGS.has(tagOf(child)) || containsBlock(child))) {
        flushInline();
        blocks.push(...serializeBlock(child, ctx));
      } else {
        inline += serializeInline(child, ctx);
      }
    }
    flushInline();
    return blocks;
  };

  const headingLine = (level, content) => {
    const line = content.replace(/\s*\n\s*/g, ' ').trim();
    return line ? `${'#'.repeat(level)} ${line}` : '';
  };

  const quoteLines = (content) => content
    .split('\n')
    .map(line => (line ? `> ${line}` : '>'))
    .join('\n');

  const serializeBlock = (node, ctx) => {
    const tag = tagOf(node);
    const heading = tag.match(HEADING_TAG);
    if (heading) {
      const line = headingLine(Number(heading[1]), serializeBlocks(node, ctx).join(' '));
      return line ? [line] : [];
    }
    if (tag === 'hr') return ['---'];
    if (tag === 'pre') return codeFence(rawText(node));
    if (isListTag(tag)) return serializeList(node, tag === 'ol', listStart(node), ctx);
    if (tag === 'li') return serializeListItem(node, '- ', ctx);
    if (tag === 'blockquote') {
      const content = serializeBlocks(node, ctx).join('\n\n');
      return content ? [quoteLines(content)] : [];
    }
    return serializeBlocks(node, ctx);
  };

  const listStart = (list) => {
    const start = Number.parseInt(list.getAttribute('start'), 10);
    return Number.isNaN(start) ? 1 : start;
  };

  const indentLines = (text, width) => {
    const padding = ' '.repeat(width);
    return text
      .split('\n')
      .map(line => (line ? padding + line : line))
      .join('\n');
  };

  const SERIALIZED_LIST = /^(?:- |\d+\. )/;

  const serializeListItem = (item, marker, ctx) => {
    const blocks = serializeBlocks(item, ctx);
    if (blocks.length === 0) return [];
    const body = blocks.reduce((joined, block) =>
      joined + (SERIALIZED_LIST.test(block) ? '\n' : '\n\n') + block);
    return [marker + indentLines(body, marker.length).trimStart()];
  };

  const serializeList = (list, ordered, start, ctx) => {
    const items = [];
    let number = start;
    let lastMarkerWidth = 0;

    for (const child of Array.from(list.childNodes)) {
      const tag = tagOf(child);
      if (child.nodeType === TEXT_NODE && !child.textContent.trim()) continue;
      if (child.nodeType !== TEXT_NODE && child.nodeType !== ELEMENT_NODE) continue;
      if (SKIPPED_TAGS.has(tag)) continue;

      if (isListTag(tag) && items.length > 0) {
        const nested = serializeBlock(child, ctx).join('\n');
        if (nested) items[items.length - 1] += `\n${indentLines(nested, lastMarkerWidth)}`;
        continue;
      }

      const marker = ordered ? `${number}. ` : '- ';
      // An item that is not an <li> can only come from invalid markup, so a
      // lone text node or wrapper is treated as if it were the item.
      const source = child.nodeType === TEXT_NODE ? { childNodes: [child] } : child;
      const item = serializeListItem(source, marker, ctx);
      if (item.length > 0) {
        items.push(item[0]);
        lastMarkerWidth = marker.length;
      }
      number += 1;
    }
    return items.length > 0 ? [items.join('\n')] : [];
  };

  // --- Selection context ----------------------------------------------------

  const countItemsBefore = (list, boundary) => {
    let count = 0;
    for (const child of Array.from(list.childNodes)) {
      if (child === boundary) break;
      if (tagOf(child) === 'li') count += 1;
    }
    return count;
  };

  // Find the direct child of `list` where the range begins.
  const rangeStartChild = (list, range) => {
    if (range.startContainer === list) return list.childNodes[range.startOffset];
    let node = range.startContainer;
    while (node && node.parentNode !== list) node = node.parentNode;
    return node;
  };

  const elementAncestors = (range) => {
    const ancestors = [];
    let node = range ? range.commonAncestorContainer : null;
    while (node) {
      if (node.nodeType === ELEMENT_NODE) {
        const tag = tagOf(node);
        if (tag === 'body' || tag === 'html') break;
        ancestors.push(node);
      }
      node = node.parentNode;
    }
    return ancestors;
  };

  // A selection inside one element clones only that element's content, so the
  // formatting that surrounds it has to be read from the live ancestors.
  const selectionToMarkdown = (fragment, range = null) => {
    const ancestors = elementAncestors(range);
    const markers = [];
    let block = null;
    for (const ancestor of ancestors) {
      const tag = tagOf(ancestor);
      if (INLINE_MARKERS[tag] && !markers.includes(INLINE_MARKERS[tag])) {
        markers.push(INLINE_MARKERS[tag]);
      }
      if (BLOCK_TAGS.has(tag)) {
        block = ancestor;
        break;
      }
    }

    const ctx = {
      preformatted: ancestors.some(ancestor => tagOf(ancestor) === 'pre'),
      activeMarkers: new Set(markers)
    };
    const blockTag = block ? tagOf(block) : '';

    if (isListTag(blockTag)) {
      const ordered = blockTag === 'ol';
      const start = listStart(block) + countItemsBefore(block, rangeStartChild(block, range));
      return serializeList(fragment, ordered, start, ctx).join('\n');
    }

    let markdown = serializeBlocks(fragment, ctx).join('\n\n');
    if (!markdown) return '';
    for (const marker of markers) markdown = wrapLines(markdown, marker);

    const heading = blockTag.match(HEADING_TAG);
    if (heading) return headingLine(Number(heading[1]), markdown);
    if (blockTag === 'blockquote') return quoteLines(markdown);
    if (blockTag === 'li') {
      const parent = block.parentNode;
      const ordered = Boolean(parent) && tagOf(parent) === 'ol';
      const marker = ordered ? `${listStart(parent) + countItemsBefore(parent, block)}. ` : '- ';
      return marker + indentLines(markdown, marker.length).trimStart();
    }
    return markdown;
  };

  // --- Markdown parsing -----------------------------------------------------

  const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;
  const FENCE = /^\s*(`{3,})[^`]*$/;
  const HEADING = /^\s*(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
  const RULE = /^\s*([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
  const QUOTE = /^\s*>[ \t]?/;
  const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;

  const isBlank = (line) => !line.trim();
  const indentOf = (line) => line.match(/^\s*/)[0].length;
  const isOrderedMarker = (marker) => /\d/.test(marker);

  const startsBlock = (line) =>
    FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || LIST_ITEM.test(line);

  const matchListItem = (line, ordered, indent) => {
    if (RULE.test(line)) return null;
    const match = line.match(LIST_ITEM);
    if (!match || match[1].length !== indent || isOrderedMarker(match[2]) !== ordered) return null;
    return match;
  };

  const parseList = (lines, startIndex) => {
    const first = lines[startIndex].match(LIST_ITEM);
    const ordered = isOrderedMarker(first[2]);
    const indent = first[1].length;
    const items = [];
    let index = startIndex;

    while (index < lines.length) {
      const match = matchListItem(lines[index], ordered, indent);
      if (!match) break;

      const contentColumn = lines[index].length - match[3].length;
      const itemLines = [match[3]];
      index += 1;

      while (index < lines.length) {
        const line = lines[index];
        if (isBlank(line)) {
          let next = index + 1;
          while (next < lines.length && isBlank(lines[next])) next += 1;
          if (next === lines.length || indentOf(lines[next]) <= indent) break;
          itemLines.push('');
          index += 1;
        } else if (indentOf(line) > indent) {
          itemLines.push(line.slice(Math.min(indentOf(line), contentColumn)));
          index += 1;
        } else {
          break;
        }
      }
      items.push(parseBlocks(itemLines));

      let next = index;
      while (next < lines.length && isBlank(lines[next])) next += 1;
      if (next < lines.length && matchListItem(lines[next], ordered, indent)) {
        index = next;
      } else {
        break;
      }
    }

    const start = ordered ? Number.parseInt(first[2], 10) : 1;
    return { block: { type: 'list', ordered, start, items }, nextIndex: index };
  };

  const parseBlocks = (lines) => {
    const blocks = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      if (isBlank(line)) {
        index += 1;
        continue;
      }

      const fence = line.match(FENCE);
      if (fence) {
        const closing = new RegExp(`^\\s*\`{${fence[1].length},}\\s*$`);
        const code = [];
        index += 1;
        while (index < lines.length && !closing.test(lines[index])) {
          code.push(lines[index]);
          index += 1;
        }
        index += 1;
        blocks.push({ type: 'code', text: code.join('\n') });
        continue;
      }

      const heading = line.match(HEADING);
      if (heading) {
        blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
        index += 1;
        continue;
      }

      if (RULE.test(line)) {
        blocks.push({ type: 'rule' });
        index += 1;
        continue;
      }

      if (QUOTE.test(line)) {
        const quoted = [];
        while (index < lines.length && QUOTE.test(lines[index])) {
          quoted.push(lines[index].replace(QUOTE, ''));
          index += 1;
        }
        blocks.push({ type: 'quote', children: parseBlocks(quoted) });
        continue;
      }

      if (LIST_ITEM.test(line)) {
        const { block, nextIndex } = parseList(lines, index);
        blocks.push(block);
        index = nextIndex;
        continue;
      }

      const paragraph = [line.trim()];
      index += 1;
      while (index < lines.length && !isBlank(lines[index]) && !startsBlock(lines[index])) {
        paragraph.push(lines[index].trim());
        index += 1;
      }
      blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
    }
    return blocks;
  };

  const parseMarkdown = (markdown) =>
    parseBlocks(String(markdown || '').replace(/\r\n?/g, '\n').split('\n'));

  const runLength = (text, index, char) => {
    let length = 0;
    while (text[index + length] === char) length += 1;
    return length;
  };

  const matchCodeSpan = (text, start) => {
    const length = runLength(text, start, '`');
    let index = start + length;
    while (index < text.length) {
      if (text[index] !== '`') {
        index += 1;
        continue;
      }
      const run = runLength(text, index, '`');
      if (run === length) {
        let content = text.slice(start + length, index);
        if (content.length > 2 && content.startsWith(' ') && content.endsWith(' ') && content.trim()) {
          content = content.slice(1, -1);
        }
        return { content, end: index + run };
      }
      index += run;
    }
    return null;
  };

  // Find the closing delimiter, skipping escapes and code spans. Single
  // markers pass over ** pairs, and a *** run closes both levels, with the
  // innermost marker taken from the front of the run.
  const findClosing = (text, from, char, size) => {
    let index = from;
    while (index < text.length) {
      const current = text[index];
      if (current === '\\') {
        index += 2;
      } else if (current === '`') {
        const span = matchCodeSpan(text, index);
        index = span ? span.end : index + runLength(text, index, '`');
      } else if (current === char) {
        const run = runLength(text, index, char);
        const usable = size === 1 ? run === 1 || run === 3 : run >= size;
        const close = index + run - size;
        if (usable && close > from && !/\s/.test(text[close - 1])) return close;
        index += run;
      } else {
        index += 1;
      }
    }
    return -1;
  };

  // For a *** opener, the length of the next run tells which marker is inner:
  // ***a* b** is bold around italic, otherwise italic goes on the outside.
  const openerSizes = (text, index, run) => {
    if (run === 1 || run === 2) return [run];
    if (run !== 3) return [];
    const nextRun = text.slice(index + run).match(/\*+/);
    return nextRun && nextRun[0].length === 1 ? [2, 1] : [1, 2];
  };

  const parseInline = (text) => {
    const nodes = [];
    let buffer = '';
    let index = 0;
    const flush = () => {
      if (buffer) nodes.push({ type: 'text', text: buffer });
      buffer = '';
    };
    const pushMarked = (type, inner) => {
      flush();
      nodes.push({ type, children: parseInline(inner) });
    };

    while (index < text.length) {
      const current = text[index];

      if (current === '\\' && ASCII_PUNCTUATION.test(text[index + 1] || '')) {
        buffer += text[index + 1];
        index += 2;
        continue;
      }

      if (current === '`') {
        const span = matchCodeSpan(text, index);
        if (span) {
          flush();
          nodes.push({ type: 'code', text: span.content });
          index = span.end;
        } else {
          const run = runLength(text, index, '`');
          buffer += text.slice(index, index + run);
          index += run;
        }
        continue;
      }

      if (current === '*' || current === '~') {
        const run = runLength(text, index, current);
        const sizes = current === '*' ? openerSizes(text, index, run) : (run === 2 ? [2] : []);
        let matched = false;
        for (const size of sizes) {
          const contentStart = index + size;
          if (/\s/.test(text[contentStart] || ' ')) continue;
          const close = findClosing(text, contentStart, current, size);
          if (close === -1) continue;
          const type = current === '~' ? 'del' : (size === 2 ? 'strong' : 'em');
          pushMarked(type, text.slice(contentStart, close));
          index = close + size;
          matched = true;
          break;
        }
        if (!matched) {
          buffer += text.slice(index, index + run);
          index += run;
        }
        continue;
      }

      buffer += current;
      index += 1;
    }
    flush();
    return nodes;
  };

  // --- Output ---------------------------------------------------------------

  const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const escapeHtml = (text) => text.replace(/[&<>"']/g, char => HTML_ESCAPES[char]);

  const inlineToHtml = (nodes) => nodes.map((node) => {
    if (node.type === 'text') return escapeHtml(node.text).replace(/\n/g, '<br>');
    if (node.type === 'code') return `<code>${escapeHtml(node.text)}</code>`;
    return `<${node.type}>${inlineToHtml(node.children)}</${node.type}>`;
  }).join('');

  const blocksToHtml = (blocks) => blocks.map((block) => {
    switch (block.type) {
      case 'heading':
        return `<h${block.level}>${inlineToHtml(parseInline(block.text))}</h${block.level}>`;
      case 'paragraph':
        return `<p>${inlineToHtml(parseInline(block.text))}</p>`;
      case 'code':
        return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
      case 'rule':
        return '<hr>';
      case 'quote':
        return `<blockquote>${blocksToHtml(block.children)}</blockquote>`;
      case 'list': {
        const items = block.items.map(item => `<li>${blocksToHtml(item)}</li>`).join('');
        if (!block.ordered) return `<ul>${items}</ul>`;
        return block.start === 1 ? `<ol>${items}</ol>` : `<ol start="${block.start}">${items}</ol>`;
      }
      default:
        return '';
    }
  }).join('');

  // Every tag comes from the fixed set above and all text is escaped, so the
  // result is safe to assign to innerHTML even for untrusted model output.
  const renderMarkdown = (markdown) => blocksToHtml(parseMarkdown(markdown));

  const inlineToPlain = (nodes) => nodes.map((node) =>
    (node.children ? inlineToPlain(node.children) : node.text)
  ).join('');

  const blocksToPlain = (blocks) => blocks.map((block) => {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
        return inlineToPlain(parseInline(block.text));
      case 'code':
        return block.text;
      case 'rule':
        return '---';
      case 'quote':
        return blocksToPlain(block.children).split('\n').map(line => (line ? `> ${line}` : '>')).join('\n');
      case 'list':
        return block.items.map((item, position) => {
          const marker = block.ordered ? `${block.start + position}. ` : '- ';
          return marker + indentLines(itemToPlain(item), marker.length).trimStart();
        }).join('\n');
      default:
        return '';
    }
  }).join('\n\n');

  const itemToPlain = (blocks) => blocks.reduce((joined, block, position) => {
    const text = blocksToPlain([block]);
    if (position === 0) return text;
    return joined + (block.type === 'list' ? '\n' : '\n\n') + text;
  }, '');

  const markdownToPlainText = (markdown) => blocksToPlain(parseMarkdown(markdown));

  const exports = { selectionToMarkdown, renderMarkdown, markdownToPlainText };

  root.TranslatorMarkdown = exports;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
