class TranslationPopup {
  constructor() {
    this.popup = null;
    this.selectionTimeout = null;
    this.isEnabled = true;
    this.autoTranslate = false;
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
      if (this.autoTranslate) {
        // Automatically start translation
        this.create(selectionInfo.x, selectionInfo.y);
        this.updateContent(this.getLoadingHTML());
        this.translateText(this.selectedText);
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
            this.create(selectionInfo.x, selectionInfo.y);
            this.updateContent(this.getLoadingHTML());
            this.translateText(this.selectedText);
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

  create(x, y) {
    this.remove();
    
    this.popup = document.createElement('div');
    this.popup.className = 'ai-translator-popup';
    
    // Add drag handle
    this.popup.innerHTML = `<div class="ai-translator-drag-handle"></div>`;
    
    document.body.appendChild(this.popup);
    this.positionPopup(x, y);
    
    // Setup drag functionality
    this.setupDragListeners();
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

  setupDragListeners() {
    const dragHandle = this.popup.querySelector('.ai-translator-drag-handle');
    if (!dragHandle) return;
    
    dragHandle.addEventListener('mousedown', this.handleDragStart.bind(this));
    document.addEventListener('mousemove', this.handleDragMove.bind(this));
    document.addEventListener('mouseup', this.handleDragEnd.bind(this));
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

  remove() {
    if (this.popup) {
      // Clean up drag event listeners
      document.removeEventListener('mousemove', this.handleDragMove.bind(this));
      document.removeEventListener('mouseup', this.handleDragEnd.bind(this));
      
      this.popup.remove();
      this.popup = null;
      this.isDragging = false;
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
    
    // Preserve drag handle and update content
    this.popup.innerHTML = `
      <div class="ai-translator-drag-handle"></div>
      <div class="ai-translator-body">
        ${html}
      </div>
    `;
    
    // Re-setup drag listeners since we recreated the drag handle
    this.setupDragListeners();
    
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