class PopupManager {
  constructor() {
    this.elements = {
      status: document.getElementById('status'),
      firstLanguage: document.getElementById('firstLanguage'),
      apiType: document.getElementById('apiType'),
      autoTranslate: document.getElementById('autoTranslate'),
      footerText: document.getElementById('footerText'),
      toggleBtn: document.getElementById('toggleExtension'),
      toggleText: document.getElementById('toggleText'),
      openOptionsBtn: document.getElementById('openOptions')
    };
    
    this.initialize();
  }

  async initialize() {
    await this.loadStatus();
    this.setupEventListeners();
  }

  async loadStatus() {
    const settings = await chrome.storage.sync.get([
      'enabled', 
      'firstLanguage',
      'autoTranslate',
      'apiEndpoint'
    ]);

    this.updateUI(settings);
  }

  updateUI(settings) {
    const { enabled = true, firstLanguage = 'Japanese', autoTranslate = false, apiEndpoint = '' } = settings;

    // Update status
    this.elements.status.textContent = enabled ? 'Active' : 'Disabled';
    this.elements.status.style.color = enabled ? '#34a853' : '#ea4335';
    
    // Update first language
    this.elements.firstLanguage.textContent = firstLanguage;
    
    // Update API type
    this.elements.apiType.textContent = this.detectApiType(apiEndpoint);
    
    // Update auto-translate status
    this.elements.autoTranslate.textContent = autoTranslate ? 'On' : 'Off';
    
    // Update footer text based on auto-translate setting
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const shortcut = isMac ? 'Cmd+C+C' : 'Ctrl+C+C';
    this.elements.footerText.textContent = autoTranslate 
      ? 'Select text on any page to translate'
      : `Select text and press ${shortcut} to translate`;

    // Update toggle button
    this.elements.toggleText.textContent = enabled ? 'Disable' : 'Enable';
    this.elements.toggleBtn.classList.toggle('disabled', enabled);
  }

  detectApiType(apiEndpoint) {
    if (!apiEndpoint) {
      return 'Not configured';
    }
    
    if (apiEndpoint.includes('openai')) {
      return 'OpenAI';
    } else if (apiEndpoint.includes('gemini') || apiEndpoint.includes('google')) {
      return 'Gemini';
    } else if (apiEndpoint.includes('anthropic')) {
      return 'Claude';
    } else if (apiEndpoint.includes('localhost:11434') || apiEndpoint.includes('/api/chat')) {
      return 'Ollama';
    } else {
      return 'Custom';
    }
  }

  setupEventListeners() {
    this.elements.toggleBtn.addEventListener('click', this.handleToggle.bind(this));
    this.elements.openOptionsBtn.addEventListener('click', this.handleOpenOptions.bind(this));
  }

  async handleToggle() {
    const { enabled = true } = await chrome.storage.sync.get('enabled');
    await chrome.storage.sync.set({ enabled: !enabled });
    await this.loadStatus();
  }

  handleOpenOptions() {
    chrome.runtime.openOptionsPage();
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new PopupManager();
});