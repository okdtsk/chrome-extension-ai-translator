class TranslationPopup {
  constructor() {
    this.popup = null;
    this.selectionTimeout = null;
    this.isEnabled = true;
    this.autoTranslate = false;
    this.popupWidth = 'medium';
    this.SELECTION_DELAY = 500;
    this.MIN_TEXT_LENGTH = 2;
    this.selectedText = '';
    this.lastKeyTime = 0;
    this.lastKey = '';
    this.DOUBLE_KEY_TIMEOUT = 500; // ms between double key presses
    
    // Dragging properties
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.popupStartX = 0;
    this.popupStartY = 0;

    // Action-bar state. swapDirection flips each time the user presses the
    // swap button so a re-translate uses the opposite first/second order.
    this.currentTranslation = '';
    this.swapDirection = false;

    // Bind drag handlers once so add/removeEventListener match. bind() returns a
    // new function each call, so storing references is the only way to remove.
    this._onDragStart = this.handleDragStart.bind(this);
    this._onDragMove = this.handleDragMove.bind(this);
    this._onDragEnd = this.handleDragEnd.bind(this);

    this.initialize();
  }

  async initialize() {
    await this.loadSettings();
    this.setupEventListeners();
    this.setupStorageListener();
    this.setupRuntimeListener();
  }

  setupRuntimeListener() {
    if (!chrome.runtime || !chrome.runtime.onMessage) return;
    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.action === 'triggerTranslation') {
        this.triggerTranslation(message.selectionText);
      }
    });
  }

  triggerTranslation(fallbackText) {
    if (!this.isEnabled) return;

    const selection = window.getSelection();
    const liveText = selection ? selection.toString().trim() : '';
    const sourceText = liveText || (fallbackText ? fallbackText.trim() : '');

    if (!sourceText || sourceText.length < this.MIN_TEXT_LENGTH) return;

    const selectionInfo = liveText ? this.captureSelectionInfo(selection) : null;
    this.selectedText = sourceText;
    this.selectedTextWithBreaks = liveText
      ? this.captureTextWithStructure(selection)
      : sourceText;

    if (selectionInfo) {
      this.create(selectionInfo.x, selectionInfo.y, selectionInfo);
    } else {
      const x = window.innerWidth / 2;
      const y = window.scrollY + window.innerHeight / 3;
      this.create(x, y);
    }
    this.updateContent(this.getLoadingHTML());
    this.translateText(this.selectedTextWithBreaks);
  }

  async loadSettings() {
    const { enabled = true, autoTranslate = false, popupWidth = 'medium' } =
      await chrome.storage.local.get(['enabled', 'autoTranslate', 'popupWidth']);
    this.isEnabled = enabled;
    this.autoTranslate = autoTranslate;
    this.popupWidth = popupWidth;
  }

  setupStorageListener() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes.enabled) {
        this.isEnabled = changes.enabled.newValue;
        if (!this.isEnabled) {
          this.remove();
        }
      }
      if (changes.autoTranslate) {
        this.autoTranslate = changes.autoTranslate.newValue;
      }
      if (changes.popupWidth) {
        this.popupWidth = changes.popupWidth.newValue;
        this.applyWidthClass();
      }
    });
  }

  setupEventListeners() {
    document.addEventListener('mouseup', this.handleMouseUp.bind(this));
    document.addEventListener('mousedown', this.handleMouseDown.bind(this));
    document.addEventListener('keydown', this.handleKeyDown.bind(this));
  }

  handleMouseUp(event) {
    if (!this.isEnabled) return;
    
    clearTimeout(this.selectionTimeout);
    
    if (event.target.closest('.ai-translator-popup')) {
      return;
    }
    
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    
    if (selectedText.length < this.MIN_TEXT_LENGTH) {
      this.remove();
      return;
    }
    
    // Store the selected text and position info before the timeout
    const selectionInfo = this.captureSelectionInfo(selection);
    if (!selectionInfo) {
      return;
    }
    
    // Capture text with preserved structure
    this.selectedText = selectedText;
    this.selectedTextWithBreaks = this.captureTextWithStructure(selection);
    
    this.selectionTimeout = setTimeout(() => {
      if (this.autoTranslate) {
        // Automatically start translation
        this.create(selectionInfo.x, selectionInfo.y, selectionInfo);
        this.updateContent(this.getLoadingHTML());
        this.translateText(this.selectedTextWithBreaks);
      }
      // When auto-translate is off, don't show popup - wait for cmd+c+c
    }, this.SELECTION_DELAY);
  }
  
  captureSelectionInfo(selection) {
    if (!selection || selection.rangeCount === 0) {
      return null;
    }
    
    try {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      
      if (rect.width === 0 && rect.height === 0) {
        return null;
      }
      
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + window.scrollY,
        height: rect.height,
        bottom: rect.bottom + window.scrollY
      };
    } catch (error) {
      return null;
    }
  }

  captureTextWithStructure(selection) {
    if (!selection || selection.rangeCount === 0) {
      return selection.toString();
    }

    // Tags treated as paragraph breaks. The previous version also checked
    // getComputedStyle(node).display === 'block' on a *detached* tempDiv,
    // which returns UA defaults and was effectively dead code.
    const BLOCK_TAGS = new Set([
      'br', 'p', 'div',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'li', 'tr', 'article', 'section', 'blockquote', 'pre'
    ]);

    try {
      const range = selection.getRangeAt(0);

      const tempDiv = document.createElement('div');
      tempDiv.appendChild(range.cloneContents());

      const walker = document.createTreeWalker(
        tempDiv,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
        null,
        false
      );

      const textParts = [];
      let currentParagraph = [];

      while (walker.nextNode()) {
        const node = walker.currentNode;

        if (node.nodeType === Node.ELEMENT_NODE) {
          const tagName = node.tagName?.toLowerCase();
          if (tagName && BLOCK_TAGS.has(tagName)) {
            if (currentParagraph.length > 0) {
              textParts.push(currentParagraph.join(' ').trim());
              currentParagraph = [];
            }
          }
        } else if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent.trim();
          if (text) {
            currentParagraph.push(text);
          }
        }
      }

      if (currentParagraph.length > 0) {
        textParts.push(currentParagraph.join(' ').trim());
      }

      return textParts.filter(part => part.length > 0).join('\n\n');
    } catch (error) {
      return selection.toString();
    }
  }

  handleMouseDown(event) {
    if (!event.target.closest('.ai-translator-popup')) {
      clearTimeout(this.selectionTimeout);
      this.remove();
    }
  }

  handleKeyDown(event) {
    if (event.key === 'Escape') {
      this.remove();
      return;
    }
    
    // Check for cmd+c+c (Mac) or ctrl+c+c (Windows/Linux)
    const isCmdOrCtrl = event.metaKey || event.ctrlKey;
    
    if (!this.isEnabled || this.autoTranslate) return;
    
    if (isCmdOrCtrl && event.key === 'c') {
      const currentTime = Date.now();
      
      // Check if this is the second 'c' press within timeout
      if (this.lastKey === 'c' && (currentTime - this.lastKeyTime) < this.DOUBLE_KEY_TIMEOUT) {
        // Double cmd+c detected
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();
        
        if (selectedText.length >= this.MIN_TEXT_LENGTH) {
          // Get selection position
          const selectionInfo = this.captureSelectionInfo(selection);
          if (selectionInfo) {
            this.selectedText = selectedText;
            this.selectedTextWithBreaks = this.captureTextWithStructure(selection);
            this.create(selectionInfo.x, selectionInfo.y, selectionInfo);
            this.updateContent(this.getLoadingHTML());
            this.translateText(this.selectedTextWithBreaks);
          }
        }
        
        // Reset after successful detection
        this.lastKey = '';
        this.lastKeyTime = 0;
      } else {
        // First 'c' press
        this.lastKey = 'c';
        this.lastKeyTime = currentTime;
      }
    } else {
      // Reset if any other key is pressed
      this.lastKey = '';
      this.lastKeyTime = 0;
    }
  }

  create(x, y, selectionInfo = null) {
    this.remove();

    // Fresh popup starts in the default direction with no cached translation.
    this.swapDirection = false;
    this.currentTranslation = '';

    this.popup = document.createElement('div');
    this.popup.className = 'ai-translator-popup';
    this.applyWidthClass();
    
    // Add header with drag handle and close button
    this.popup.innerHTML = `
      <div class="ai-translator-header">
        <div class="ai-translator-drag-handle"></div>
        <button class="ai-translator-close-btn" aria-label="Close">×</button>
      </div>
    `;
    
    document.body.appendChild(this.popup);
    this.positionPopup(x, y, selectionInfo);

    // Document-level drag listeners are attached once per popup lifecycle.
    // setupDragListeners() (called below and from updateContent) only re-binds
    // the drag-handle mousedown.
    this.attachDocumentDragListeners();
    this.setupDragListeners();
    this.setupCloseButton();
  }

  positionPopup(x, y, selectionInfo = null) {
    const rect = this.popup.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 10;
    const minOffset = 10; // Minimum space between popup and selection
    
    let posX = x - rect.width / 2;
    let posY;
    
    // Calculate vertical position to avoid overlap
    if (selectionInfo && selectionInfo.height) {
      // Position below the selection with extra offset based on selection height
      posY = selectionInfo.bottom + minOffset;
      
      // If popup would go off screen, try positioning above
      if (posY + rect.height > viewportHeight + window.scrollY - margin) {
        posY = y - rect.height - minOffset;
        
        // If still overlapping when above, find the best position
        if (posY < window.scrollY + margin) {
          // Default to below with scrolling if needed
          posY = selectionInfo.bottom + minOffset;
        }
      }
    } else {
      // Fallback to original behavior if no selection info
      posY = y + 20;
      if (posY + rect.height > viewportHeight + window.scrollY - margin) {
        posY = y - rect.height - margin;
      }
    }
    
    // Adjust horizontal position
    if (posX < margin) {
      posX = margin;
    } else if (posX + rect.width > viewportWidth - margin) {
      posX = viewportWidth - rect.width - margin;
    }
    
    this.popup.style.left = `${posX}px`;
    this.popup.style.top = `${posY}px`;
  }

  setupDragListeners() {
    // Drag handle is re-created by updateContent() innerHTML rewrites, so the
    // mousedown listener must be re-attached each time. Document-level
    // listeners are attached once per popup in attachDocumentDragListeners().
    const dragHandle = this.popup.querySelector('.ai-translator-drag-handle');
    if (!dragHandle) return;
    dragHandle.addEventListener('mousedown', this._onDragStart);
  }

  attachDocumentDragListeners() {
    document.addEventListener('mousemove', this._onDragMove);
    document.addEventListener('mouseup', this._onDragEnd);
  }

  detachDocumentDragListeners() {
    document.removeEventListener('mousemove', this._onDragMove);
    document.removeEventListener('mouseup', this._onDragEnd);
  }

  setupCloseButton() {
    const closeBtn = this.popup.querySelector('.ai-translator-close-btn');
    if (!closeBtn) return;
    
    closeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this.remove();
    });
  }

  handleDragStart(event) {
    event.preventDefault();
    this.isDragging = true;
    
    // Get initial positions
    const rect = this.popup.getBoundingClientRect();
    this.popupStartX = rect.left;
    this.popupStartY = rect.top;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    
    // Add dragging class for visual feedback
    this.popup.classList.add('ai-translator-dragging');
  }

  handleDragMove(event) {
    if (!this.isDragging || !this.popup) return;
    
    event.preventDefault();
    
    // Calculate new position
    const deltaX = event.clientX - this.dragStartX;
    const deltaY = event.clientY - this.dragStartY;
    
    let newX = this.popupStartX + deltaX;
    let newY = this.popupStartY + deltaY;
    
    // Constrain to viewport
    const rect = this.popup.getBoundingClientRect();
    const margin = 10;
    
    newX = Math.max(margin, Math.min(newX, window.innerWidth - rect.width - margin));
    newY = Math.max(margin, Math.min(newY, window.innerHeight - rect.height - margin));
    
    // Apply new position
    this.popup.style.left = `${newX}px`;
    this.popup.style.top = `${newY}px`;
  }

  handleDragEnd(event) {
    if (!this.isDragging) return;
    
    this.isDragging = false;
    
    if (this.popup) {
      this.popup.classList.remove('ai-translator-dragging');
    }
  }

  applyWidthClass() {
    if (!this.popup) return;
    this.popup.classList.remove(
      'ai-translator-width-narrow',
      'ai-translator-width-medium',
      'ai-translator-width-wide'
    );
    this.popup.classList.add(`ai-translator-width-${this.popupWidth}`);
  }

  remove() {
    if (this.popup) {
      this.detachDocumentDragListeners();
      this.popup.remove();
      this.popup = null;
      this.isDragging = false;
    }
  }

  showTranslateButton() {
    this.updateContent(this.getTranslateButtonHTML());
    
    const translateBtn = this.popup.querySelector('.ai-translator-translate-btn');
    
    if (translateBtn) {
      translateBtn.addEventListener('click', () => {
        this.updateContent(this.getLoadingHTML());
        this.translateText(this.selectedTextWithBreaks || this.selectedText);
      });
    }
  }

  translateText(text, { retry = false } = {}) {
    // Open a fresh port per translation. Background streams deltas back; we
    // accumulate them into currentTranslation and re-render the popup body.
    let port;
    try {
      port = chrome.runtime.connect({ name: 'translate' });
    } catch (error) {
      this.currentTranslation = '';
      this.updateContent(this.getErrorHTML('Unable to connect to translation service'));
      return;
    }

    let accumulated = '';
    let finished = false;

    port.onMessage.addListener((msg) => {
      if (!msg || !this.popup) return;
      if (msg.type === 'delta' && typeof msg.text === 'string') {
        accumulated += msg.text;
        this.currentTranslation = accumulated;
        this.updateContent(this.getStreamingHTML(accumulated));
      } else if (msg.type === 'done') {
        finished = true;
        this.currentTranslation = msg.translation || accumulated;
        this.updateContent(this.getSuccessHTML(this.currentTranslation));
      } else if (msg.type === 'cached') {
        finished = true;
        this.currentTranslation = msg.translation || '';
        this.updateContent(this.getSuccessHTML(this.currentTranslation));
      } else if (msg.type === 'error') {
        finished = true;
        this.currentTranslation = '';
        this.updateContent(this.getErrorHTML(msg.error || 'Translation failed'));
      }
    });

    port.onDisconnect.addListener(() => {
      if (finished || !this.popup) return;
      if (accumulated) {
        // Stream cut off mid-flight — show what we have.
        this.currentTranslation = accumulated;
        this.updateContent(this.getSuccessHTML(accumulated));
      } else {
        this.updateContent(this.getErrorHTML('Translation interrupted'));
      }
    });

    try {
      port.postMessage({ text, swap: this.swapDirection, retry });
    } catch (error) {
      this.updateContent(this.getErrorHTML('Unable to send translation request'));
    }
  }

  updateContent(html) {
    if (!this.popup) return;

    // Preserve header with drag handle and close button, update content
    this.popup.innerHTML = `
      <div class="ai-translator-header">
        <div class="ai-translator-drag-handle"></div>
        <button class="ai-translator-close-btn" aria-label="Close">×</button>
      </div>
      <div class="ai-translator-body">
        ${html}
      </div>
    `;

    // Re-setup listeners since we recreated the elements
    this.setupDragListeners();
    this.setupCloseButton();
    this.setupActionBar();
  }

  setupActionBar() {
    if (!this.popup) return;

    const copyBtn = this.popup.querySelector('.ai-translator-action-copy');
    const retryBtn = this.popup.querySelector('.ai-translator-action-retry');
    const swapBtn = this.popup.querySelector('.ai-translator-action-swap');

    if (copyBtn) {
      copyBtn.addEventListener('click', this.handleCopy.bind(this));
    }
    if (retryBtn) {
      retryBtn.addEventListener('click', this.handleRetry.bind(this));
    }
    if (swapBtn) {
      swapBtn.addEventListener('click', this.handleSwap.bind(this));
    }
  }

  async handleCopy(event) {
    event.stopPropagation();
    const button = event.currentTarget;
    if (!this.currentTranslation) return;
    try {
      await navigator.clipboard.writeText(this.currentTranslation);
      this.flashButtonLabel(button, 'Copied');
    } catch (error) {
      this.flashButtonLabel(button, 'Copy failed');
    }
  }

  handleRetry(event) {
    event.stopPropagation();
    const source = this.selectedTextWithBreaks || this.selectedText;
    if (!source) return;
    this.updateContent(this.getLoadingHTML());
    this.translateText(source, { retry: true });
  }

  handleSwap(event) {
    event.stopPropagation();
    const source = this.selectedTextWithBreaks || this.selectedText;
    if (!source) return;
    this.swapDirection = !this.swapDirection;
    this.updateContent(this.getLoadingHTML());
    this.translateText(source);
  }

  flashButtonLabel(button, message) {
    const original = button.dataset.label || button.textContent;
    button.dataset.label = original;
    button.textContent = message;
    setTimeout(() => {
      if (button.isConnected) {
        button.textContent = original;
      }
    }, 1200);
  }

  getTranslateButtonHTML() {
    const truncatedText = this.selectedText.length > 50 
      ? this.selectedText.substring(0, 50) + '...' 
      : this.selectedText;
    
    return `
      <div class="ai-translator-content">
        <div class="ai-translator-preview">${this.escapeHtml(truncatedText)}</div>
        <button class="ai-translator-translate-btn">
          Translate
        </button>
      </div>
    `;
  }

  getLoadingHTML() {
    return `
      <div class="ai-translator-loading">
        <div class="ai-translator-spinner"></div>
        <span>Translating...</span>
      </div>
    `;
  }

  getErrorHTML(message) {
    return `
      <div class="ai-translator-error">
        <span>${this.escapeHtml(message)}</span>
      </div>
    `;
  }

  getStreamingHTML(partial) {
    return `
      <div class="ai-translator-content">
        <div class="ai-translator-result ai-translator-streaming">${this.formatTranslatedText(partial)}</div>
      </div>
    `;
  }

  getSuccessHTML(translation) {
    const swapLabel = this.swapDirection ? 'Swap ↺' : 'Swap';
    return `
      <div class="ai-translator-content">
        <div class="ai-translator-result">${this.formatTranslatedText(translation)}</div>
        <div class="ai-translator-action-bar">
          <button type="button" class="ai-translator-action-btn ai-translator-action-copy">Copy</button>
          <button type="button" class="ai-translator-action-btn ai-translator-action-retry">Retry</button>
          <button type="button" class="ai-translator-action-btn ai-translator-action-swap">${swapLabel}</button>
        </div>
      </div>
    `;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  formatTranslatedText(text) {
    // First escape HTML to prevent XSS
    const escaped = this.escapeHtml(text);
    
    // Convert line breaks to <br> tags for display
    // Handle different line break patterns
    return escaped
      .replace(/\n\n/g, '</p><p>') // Double line breaks become paragraphs
      .replace(/\n/g, '<br>') // Single line breaks become <br>
      .replace(/^(.+)$/, '<p>$1</p>'); // Wrap in initial paragraph
  }
}

// Initialize the translation popup
const translationPopup = new TranslationPopup();