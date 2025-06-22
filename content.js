class TranslationPopup {
  constructor() {
    this.popup = null;
    this.selectionTimeout = null;
    this.isEnabled = true;
    this.autoTranslate = false;
    this.SELECTION_DELAY = 500;
    this.MIN_TEXT_LENGTH = 2;
    this.selectedText = '';
    
    this.initialize();
  }

  async initialize() {
    await this.loadSettings();
    this.setupEventListeners();
    this.setupStorageListener();
  }

  async loadSettings() {
    const { enabled = true, autoTranslate = false } = await chrome.storage.sync.get(['enabled', 'autoTranslate']);
    this.isEnabled = enabled;
    this.autoTranslate = autoTranslate;
  }

  setupStorageListener() {
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.enabled) {
        this.isEnabled = changes.enabled.newValue;
        if (!this.isEnabled) {
          this.remove();
        }
      }
      if (changes.autoTranslate) {
        this.autoTranslate = changes.autoTranslate.newValue;
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
    
    this.selectedText = selectedText;
    
    this.selectionTimeout = setTimeout(() => {
      this.create(selectionInfo.x, selectionInfo.y);
      
      if (this.autoTranslate) {
        // Automatically start translation
        this.updateContent(this.getLoadingHTML());
        this.translateText(this.selectedText);
      } else {
        // Show the translate button
        this.showTranslateButton();
      }
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
        y: rect.top + window.scrollY
      };
    } catch (error) {
      return null;
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
    }
  }

  create(x, y) {
    this.remove();
    
    this.popup = document.createElement('div');
    this.popup.className = 'ai-translator-popup';
    
    document.body.appendChild(this.popup);
    this.positionPopup(x, y);
  }

  positionPopup(x, y) {
    const rect = this.popup.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 10;
    const offset = 20;
    
    let posX = x - rect.width / 2;
    let posY = y + offset;
    
    // Adjust horizontal position
    if (posX < margin) {
      posX = margin;
    } else if (posX + rect.width > viewportWidth - margin) {
      posX = viewportWidth - rect.width - margin;
    }
    
    // Adjust vertical position
    if (posY + rect.height > viewportHeight - margin) {
      posY = y - rect.height - margin;
    }
    
    this.popup.style.left = `${posX}px`;
    this.popup.style.top = `${posY}px`;
  }

  remove() {
    if (this.popup) {
      this.popup.remove();
      this.popup = null;
    }
  }

  showTranslateButton() {
    this.updateContent(this.getTranslateButtonHTML());
    
    const translateBtn = this.popup.querySelector('.ai-translator-translate-btn');
    const closeBtn = this.popup.querySelector('.ai-translator-close');
    
    if (translateBtn) {
      translateBtn.addEventListener('click', () => {
        this.updateContent(this.getLoadingHTML());
        this.translateText(this.selectedText);
      });
    }
    
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.remove());
    }
  }

  async translateText(text) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'translate',
        text: text
      });
      
      if (response.error) {
        this.updateContent(this.getErrorHTML(response.error));
      } else {
        this.updateContent(this.getSuccessHTML(response.translation));
      }
    } catch (error) {
      this.updateContent(this.getErrorHTML('Unable to connect to translation service'));
    }
  }

  updateContent(html) {
    if (!this.popup) return;
    
    this.popup.innerHTML = html;
    
    const closeBtn = this.popup.querySelector('.ai-translator-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.remove());
    }
  }

  getTranslateButtonHTML() {
    const truncatedText = this.selectedText.length > 50 
      ? this.selectedText.substring(0, 50) + '...' 
      : this.selectedText;
    
    return `
      <div class="ai-translator-content">
        <div class="ai-translator-preview">${this.escapeHtml(truncatedText)}</div>
        <button class="ai-translator-translate-btn">
          <span class="ai-translator-btn-icon">🌐</span>
          Translate
        </button>
        <div class="ai-translator-close">×</div>
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
        <span class="ai-translator-error-icon">⚠️</span>
        <span>${this.escapeHtml(message)}</span>
      </div>
    `;
  }

  getSuccessHTML(translation) {
    return `
      <div class="ai-translator-content">
        <div class="ai-translator-result">${this.escapeHtml(translation)}</div>
        <div class="ai-translator-close">×</div>
      </div>
    `;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize the translation popup
const translationPopup = new TranslationPopup();