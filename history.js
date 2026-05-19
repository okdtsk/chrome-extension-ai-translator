class HistoryPage {
  constructor() {
    this.listEl = document.getElementById('historyList');
    this.emptyEl = document.getElementById('emptyState');
    this.countEl = document.getElementById('entryCount');
    this.clearAllBtn = document.getElementById('clearAllBtn');
    this.entries = [];
    this.initialize();
  }

  async initialize() {
    this.clearAllBtn.addEventListener('click', () => this.handleClearAll());
    await this.refresh();
  }

  async refresh() {
    const response = await chrome.runtime.sendMessage({ action: 'getHistory' });
    this.entries = (response && response.entries) || [];
    this.render();
  }

  render() {
    this.listEl.innerHTML = '';
    if (this.entries.length === 0) {
      this.emptyEl.hidden = false;
      this.countEl.textContent = '';
      this.clearAllBtn.disabled = true;
      return;
    }

    this.emptyEl.hidden = true;
    this.countEl.textContent = `${this.entries.length} ${this.entries.length === 1 ? 'entry' : 'entries'}`;
    this.clearAllBtn.disabled = false;

    for (const entry of this.entries) {
      this.listEl.appendChild(this.buildEntry(entry));
    }
  }

  buildEntry(entry) {
    const item = document.createElement('li');
    item.className = 'history-entry';

    const meta = document.createElement('div');
    meta.className = 'entry-meta';
    const direction = entry.swap
      ? `${entry.secondLanguage} → ${entry.firstLanguage}`
      : `${entry.firstLanguage} ↔ ${entry.secondLanguage}`;
    meta.appendChild(this.buildTag(direction));
    if (entry.provider) meta.appendChild(this.buildTag(entry.provider));
    if (entry.apiModel) meta.appendChild(this.buildTag(entry.apiModel));
    if (entry.translationStyle) meta.appendChild(this.buildTag(entry.translationStyle));
    meta.appendChild(this.buildText(this.formatTimestamp(entry.timestamp)));

    const originalBlock = document.createElement('div');
    originalBlock.className = 'entry-block';
    originalBlock.appendChild(this.buildLabel('Original'));
    originalBlock.appendChild(this.buildBody(entry.original));

    const translationBlock = document.createElement('div');
    translationBlock.className = 'entry-block';
    translationBlock.appendChild(this.buildLabel('Translation'));
    translationBlock.appendChild(this.buildBody(entry.translation));

    const actions = document.createElement('div');
    actions.className = 'entry-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn btn-small';
    copyBtn.textContent = 'Copy translation';
    copyBtn.addEventListener('click', () => this.handleCopy(copyBtn, entry.translation));
    actions.appendChild(copyBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-small danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => this.handleDelete(entry.id));
    actions.appendChild(deleteBtn);

    item.appendChild(meta);
    item.appendChild(originalBlock);
    item.appendChild(translationBlock);
    item.appendChild(actions);
    return item;
  }

  buildTag(text) {
    const span = document.createElement('span');
    span.className = 'tag';
    span.textContent = text;
    return span;
  }

  buildText(text) {
    const span = document.createElement('span');
    span.textContent = text;
    return span;
  }

  buildLabel(text) {
    const span = document.createElement('span');
    span.className = 'entry-label';
    span.textContent = text;
    return span;
  }

  buildBody(text) {
    const p = document.createElement('p');
    p.className = 'entry-text';
    p.textContent = text || '';
    return p;
  }

  formatTimestamp(ts) {
    if (!ts) return '';
    try {
      const date = new Date(ts);
      return date.toLocaleString();
    } catch {
      return '';
    }
  }

  async handleCopy(button, text) {
    const original = button.dataset.label || button.textContent;
    button.dataset.label = original;
    try {
      await navigator.clipboard.writeText(text || '');
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Copy failed';
    }
    setTimeout(() => {
      if (button.isConnected) button.textContent = original;
    }, 1200);
  }

  async handleDelete(id) {
    const response = await chrome.runtime.sendMessage({ action: 'deleteHistoryEntry', id });
    if (response && response.success) {
      await this.refresh();
    }
  }

  async handleClearAll() {
    if (!confirm('Delete all stored translation history?')) return;
    const response = await chrome.runtime.sendMessage({ action: 'clearHistory' });
    if (response && response.success) {
      await this.refresh();
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new HistoryPage();
});
