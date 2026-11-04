// Markdown is the format that carries the structure of the source text through
// the AI provider: the selected DOM is serialized to Markdown, the model keeps
// the markers while translating, and the output is rendered back for display.
//
// No chrome.* dependencies and no document access. Loaded as a content script
// and from history.html, and required from Node tests.

(function (root) {
  const STORED_FORMAT_MARKDOWN = 'markdown';
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

  // A backslash or tilde at the edge of the text could join a following marker,
  // so those are escaped as well.
  const escapeInlineText = (text) => text
    .replace(/\\(?=[!-/:-@[-`{-~]|$)/g, '\\\\')
    .replace(/[`*]/g, '\\$&')
    .replace(/~+/g, (run, position, escaped) => (
      run.length >= 2 || position === 0 || position + run.length === escaped.length
        ? run.replace(/~/g, '\\~')
        : run
    ));

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

  // Inline content is collected as a flat list of styled runs before any marker
  // is written. Markers joined from separately serialized spans can be ambiguous
  // (*a**b*), whereas merging runs first means adjacent spans with equal styles
  // share one set of markers, however their elements were nested.
  const collectRuns = (node, styles, ctx, runs) => {
    if (node.nodeType === TEXT_NODE) {
      const text = ctx.preformatted
        ? node.textContent
        : node.textContent.replace(/[ \t\r\n\f]+/g, ' ');
      runs.push({ text, styles });
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;

    const tag = tagOf(node);
    if (SKIPPED_TAGS.has(tag)) return;
    if (tag === 'br') {
      runs.push({ text: '\n', styles: [] });
      return;
    }
    if (CODE_TAGS.has(tag)) {
      runs.push({ code: rawText(node), styles });
      return;
    }

    const marker = INLINE_MARKERS[tag];
    const childStyles = marker && !styles.includes(marker) && !ctx.activeMarkers.has(marker)
      ? [...styles, marker]
      : styles;
    for (const child of Array.from(node.childNodes)) collectRuns(child, childStyles, ctx, runs);
    if (tag === 'td' || tag === 'th') runs.push({ text: ' ', styles: [] });
  };

  const sameStyles = (a, b) => a.length === b.length && a.every(style => b.includes(style));

  const mergeRuns = (runs) => {
    const merged = [];
    for (const run of runs) {
      const last = merged[merged.length - 1];
      if (last && sameStyles(last.styles, run.styles) && ('code' in last) === ('code' in run)) {
        if ('code' in run) last.code += run.code;
        else last.text += run.text;
      } else {
        merged.push({ ...run });
      }
    }
    return merged;
  };

  // Markers must touch the text they wrap, so whitespace at the edges of a run
  // and line breaks become separate runs.
  const separateWhitespace = (runs) => runs.flatMap((run) => {
    if ('code' in run) return run.code.trim() ? [run] : [];
    return run.text.split(/(\s*\n\s*)/).flatMap((part, position) => {
      if (position % 2 === 1) return [{ text: part, styles: [], space: true }];
      const [, lead, core, trail] = part.match(/^(\s*)([\s\S]*?)(\s*)$/);
      return [
        ...(lead ? [{ text: lead, styles: run.styles, space: true }] : []),
        ...(core ? [{ text: core, styles: run.styles }] : []),
        ...(trail ? [{ text: trail, styles: run.styles, space: true }] : [])
      ];
    });
  });

  // Consecutive whitespace acts as one run, keeping only the styles all of it has.
  const combineSpaces = (runs) => {
    const combined = [];
    for (const run of runs) {
      const last = combined[combined.length - 1];
      if (last && last.space && run.space) {
        last.text += run.text;
        last.styles = last.styles.filter(style => run.styles.includes(style));
      } else {
        combined.push({ ...run });
      }
    }
    return combined;
  };

  // A styled space stays styled only as far as both of its neighbors share that
  // style. Whitespace outside a span keeps the two sides as separate spans.
  const resolveSpaceStyles = (runs) => runs.map((run, position) => {
    if (!run.space) return run;
    // combineSpaces guarantees that the neighbors of a space are not spaces.
    const before = runs[position - 1];
    const after = runs[position + 1];
    const styles = before && after
      ? run.styles.filter(style => before.styles.includes(style) && after.styles.includes(style))
      : [];
    return { ...run, styles };
  });

  // The style that continues furthest is opened first, so it ends up outermost.
  const styleReach = (runs, from, style) => {
    let end = from;
    while (end < runs.length && runs[end].styles.includes(style)) end += 1;
    return end;
  };

  const writeRuns = (runs) => {
    const open = [];
    let output = '';
    runs.forEach((run, position) => {
      const firstEnded = open.findIndex(style => !run.styles.includes(style));
      if (firstEnded !== -1) {
        while (open.length > firstEnded) output += open.pop();
      }
      // Whitespace never opens a marker; the next run with text does.
      if (!run.space) {
        run.styles
          .filter(style => !open.includes(style))
          .sort((a, b) => styleReach(runs, position, b) - styleReach(runs, position, a))
          .forEach((style) => {
            output += style;
            open.push(style);
          });
      }
      output += 'code' in run ? codeSpan(run.code) : escapeInlineText(run.text);
    });
    while (open.length > 0) output += open.pop();
    return output;
  };

  const runsToMarkdown = (runs) =>
    writeRuns(resolveSpaceStyles(combineSpaces(separateWhitespace(mergeRuns(runs)))));

  const inlineToParagraphs = (raw, ctx) => raw
    .split('\n')
    .map(line => (ctx.preformatted ? line : line.replace(/ {2,}/g, ' ')).trim())
    .join('\n')
    .split(/\n{2,}/)
    .filter(Boolean)
    .map(paragraph => paragraph.split('\n').map(escapeLineStart).join('\n'));

  const serializeBlocks = (parent, ctx) => {
    const blocks = [];
    let runs = [];
    const flushInline = () => {
      blocks.push(...inlineToParagraphs(runsToMarkdown(runs), ctx));
      runs = [];
    };

    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === ELEMENT_NODE && !SKIPPED_TAGS.has(tagOf(child)) &&
          (BLOCK_TAGS.has(tagOf(child)) || containsBlock(child))) {
        flushInline();
        blocks.push(...serializeBlock(child, ctx));
      } else {
        collectRuns(child, [], ctx, runs);
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

    let markdown;
    if (isListTag(blockTag)) {
      const ordered = blockTag === 'ol';
      const start = listStart(block) + countItemsBefore(block, rangeStartChild(block, range));
      markdown = serializeList(fragment, ordered, start, ctx).join('\n');
    } else {
      markdown = serializeBlocks(fragment, ctx).join('\n\n');
      for (const marker of markers) markdown = wrapLines(markdown, marker);
      const heading = blockTag.match(HEADING_TAG);
      if (heading) markdown = headingLine(Number(heading[1]), markdown);
    }
    if (!markdown) return '';

    // Lists and quotes also apply through wrappers such as <li><p>, so every
    // enclosing one is added, innermost first.
    for (const ancestor of ancestors.slice(block ? ancestors.indexOf(block) : ancestors.length)) {
      markdown = applyStructure(ancestor, markdown);
    }
    return markdown;
  };

  const applyStructure = (ancestor, markdown) => {
    const tag = tagOf(ancestor);
    if (tag === 'blockquote') return quoteLines(markdown);
    if (tag !== 'li') return markdown;
    const parent = ancestor.parentNode;
    const ordered = Boolean(parent) && tagOf(parent) === 'ol';
    const marker = ordered ? `${listStart(parent) + countItemsBefore(parent, ancestor)}. ` : '- ';
    return marker + indentLines(markdown, marker.length).trimStart();
  };

  // Plain text taken from outside the DOM walk (form fields, the context menu
  // fallback) has no formatting, so all of its Markdown characters are literal.
  const plainTextToMarkdown = (text) => String(text || '')
    .split('\n')
    .map((line) => {
      const [, indent, rest] = line.match(/^(\s*)([\s\S]*)$/);
      return indent + escapeLineStart(escapeInlineText(rest));
    })
    .join('\n');

  // --- Markdown parsing -----------------------------------------------------

  // Model output is untrusted and rendering repeats on every streaming delta, so
  // work stays bounded on hostile input. Each unmatched opener scans to the end
  // of its text, so failed scans share one budget per render; past it, remaining
  // markers stay literal and no text is lost. Nesting recurses, so past the depth
  // limit deeper markers are also left as text.
  const MAX_FAILED_SCAN_CHARS = 1000000;
  const MAX_BLOCK_DEPTH = 32;
  const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;
  const FENCE = /^\s*(`{3,})[^`]*$/;
  const HEADING = /^\s*(#{1,6})[ \t]+(.*?)[ \t]*$/;
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

  const parseList = (lines, startIndex, depth) => {
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
          // Taking all the blank lines at once keeps a long run of them linear.
          for (; index < next; index += 1) itemLines.push('');
        } else if (indentOf(line) > indent) {
          itemLines.push(line.slice(Math.min(indentOf(line), contentColumn)));
          index += 1;
        } else {
          break;
        }
      }
      items.push(parseBlocks(itemLines, depth + 1));

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

  const parseBlocks = (lines, depth = 0) => {
    const canNest = depth < MAX_BLOCK_DEPTH;
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

      if (canNest && QUOTE.test(line)) {
        const quoted = [];
        while (index < lines.length && QUOTE.test(lines[index])) {
          quoted.push(lines[index].replace(QUOTE, ''));
          index += 1;
        }
        blocks.push({ type: 'quote', children: parseBlocks(quoted, depth + 1) });
        continue;
      }

      if (canNest && LIST_ITEM.test(line)) {
        const { block, nextIndex } = parseList(lines, index, depth);
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

  // Last position of each backtick run length, so an opener with no closer
  // fails at once instead of scanning the rest of the text.
  const lastBacktickRuns = (text) => {
    const last = new Map();
    for (const match of text.matchAll(/`+/g)) last.set(match[0].length, match.index);
    return last;
  };

  const matchCodeSpan = (text, start, lastRuns) => {
    const length = runLength(text, start, '`');
    if (!(lastRuns.get(length) > start)) return null;
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

  // Offset of the closer within a delimiter run, or -1 if the run does not
  // close. A run longer than its closer also holds an inner closer or the next
  // span's opener, so what is open inside the span decides which part this is:
  // **a *b*** closes italic first, while **a***b* opens italic after the bold.
  const closerOffset = (char, size, run, innerOpen) => {
    if (char === '~') return run >= 2 ? 0 : -1;
    if (size === 2) {
      if (run < 2) return -1;
      return innerOpen && run >= 3 ? 1 : 0;
    }
    if (run === 2) return -1;
    return innerOpen && run >= 3 ? 2 : 0;
  };

  // Find the closing delimiter, skipping escapes and code spans.
  const findClosing = (text, from, char, size, lastRuns) => {
    let index = from;
    let innerOpen = false;
    while (index < text.length) {
      const current = text[index];
      if (current === '\\') {
        index += 2;
      } else if (current === '`') {
        const span = matchCodeSpan(text, index, lastRuns);
        index = span ? span.end : index + runLength(text, index, '`');
      } else if (current === char) {
        const run = runLength(text, index, char);
        const offset = closerOffset(char, size, run, innerOpen);
        const close = index + offset;
        if (offset !== -1 && close > from && !/\s/.test(text[close - 1])) return close;
        if (char === '*' && run === (size === 2 ? 1 : 2)) innerOpen = !innerOpen;
        index += run;
      } else {
        index += 1;
      }
    }
    return -1;
  };

  // For a *** opener, the length of the next run tells which marker is inner:
  // ***a* b** is bold around italic, otherwise italic goes on the outside.
  const openerSizes = (text, index, run, lastRuns) => {
    if (run === 1 || run === 2) return [run];
    if (run !== 3) return [];
    return nextMarkerRunLength(text, index + run, lastRuns) === 1 ? [2, 1] : [1, 2];
  };

  const nextMarkerRunLength = (text, from, lastRuns) => {
    let index = from;
    while (index < text.length) {
      if (text[index] === '\\') {
        index += 2;
      } else if (text[index] === '`') {
        const span = matchCodeSpan(text, index, lastRuns);
        index = span ? span.end : index + runLength(text, index, '`');
      } else if (text[index] === '*') {
        return runLength(text, index, '*');
      } else {
        index += 1;
      }
    }
    return 0;
  };

  const parseInline = (text, budget) => {
    const lastRuns = lastBacktickRuns(text);
    const nodes = [];
    let buffer = '';
    let index = 0;
    const flush = () => {
      if (buffer) nodes.push({ type: 'text', text: buffer });
      buffer = '';
    };
    const pushMarked = (type, inner) => {
      flush();
      nodes.push({ type, children: parseInline(inner, budget) });
    };

    while (index < text.length) {
      const current = text[index];

      if (current === '\\' && ASCII_PUNCTUATION.test(text[index + 1] || '')) {
        buffer += text[index + 1];
        index += 2;
        continue;
      }

      if (current === '`') {
        const span = matchCodeSpan(text, index, lastRuns);
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
        const sizes = current === '*' ? openerSizes(text, index, run, lastRuns) : (run === 2 ? [2] : []);
        let matched = false;
        for (const size of sizes) {
          const contentStart = index + size;
          if (budget.failedScanChars >= MAX_FAILED_SCAN_CHARS) break;
          if (/\s/.test(text[contentStart] || ' ')) continue;
          const close = findClosing(text, contentStart, current, size, lastRuns);
          if (close === -1) {
            budget.failedScanChars += text.length - contentStart;
            continue;
          }
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

  const blocksToHtml = (blocks, budget) => blocks.map((block) => {
    switch (block.type) {
      case 'heading':
        return `<h${block.level}>${inlineToHtml(parseInline(block.text, budget))}</h${block.level}>`;
      case 'paragraph':
        return `<p>${inlineToHtml(parseInline(block.text, budget))}</p>`;
      case 'code':
        return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
      case 'rule':
        return '<hr>';
      case 'quote':
        return `<blockquote>${blocksToHtml(block.children, budget)}</blockquote>`;
      case 'list': {
        const items = block.items.map(item => `<li>${blocksToHtml(item, budget)}</li>`).join('');
        if (!block.ordered) return `<ul>${items}</ul>`;
        return block.start === 1 ? `<ol>${items}</ol>` : `<ol start="${block.start}">${items}</ol>`;
      }
      default:
        return '';
    }
  }).join('');

  // Every tag comes from the fixed set above and all text is escaped, so the
  // result is safe to assign to innerHTML even for untrusted model output.
  const renderMarkdown = (markdown) =>
    blocksToHtml(parseMarkdown(markdown), { failedScanChars: 0 });

  const inlineToPlain = (nodes) => nodes.map((node) =>
    (node.children ? inlineToPlain(node.children) : node.text)
  ).join('');

  const blocksToPlain = (blocks, budget) => blocks.map((block) => {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
        return inlineToPlain(parseInline(block.text, budget));
      case 'code':
        return block.text;
      case 'rule':
        return '---';
      case 'quote':
        return blocksToPlain(block.children, budget).split('\n').map(line => (line ? `> ${line}` : '>')).join('\n');
      case 'list':
        return block.items.map((item, position) => {
          const marker = block.ordered ? `${block.start + position}. ` : '- ';
          return marker + indentLines(itemToPlain(item, budget), marker.length).trimStart();
        }).join('\n');
      default:
        return '';
    }
  }).join('\n\n');

  const itemToPlain = (blocks, budget) => blocks.reduce((joined, block, position) => {
    const text = blocksToPlain([block], budget);
    if (position === 0) return text;
    return joined + (block.type === 'list' ? '\n' : '\n\n') + text;
  }, '');

  const markdownToPlainText = (markdown) =>
    blocksToPlain(parseMarkdown(markdown), { failedScanChars: 0 });

  // History entries saved before format preservation have no format and hold
  // plain text, where characters such as * are literal.
  const storedTextToHtml = (text, format) => (format === STORED_FORMAT_MARKDOWN
    ? renderMarkdown(text)
    : `<p class="plain-text">${escapeHtml(String(text || ''))}</p>`);

  const storedTextToPlain = (text, format) => (format === STORED_FORMAT_MARKDOWN
    ? markdownToPlainText(text)
    : String(text || ''));

  const exports = {
    selectionToMarkdown,
    plainTextToMarkdown,
    renderMarkdown,
    markdownToPlainText,
    storedTextToHtml,
    storedTextToPlain
  };

  root.TranslatorMarkdown = exports;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
