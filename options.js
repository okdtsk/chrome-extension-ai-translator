class OptionsManager {
  constructor() {
    this.form = document.getElementById('settingsForm');
    this.statusDiv = document.getElementById('status');
    this.apiTypeRadios = document.querySelectorAll('input[name="apiType"]');
    this.apiEndpointInput = document.getElementById('apiEndpoint');
    
    this.API_ENDPOINTS = {
      openai: 'https://api.openai.com/v1/chat/completions',
      gemini: 'https://generativelanguage.googleapis.com/v1beta/models'
    };
    
    this.DEFAULT_MODELS = {
      openai: 'gpt-3.5-turbo',
      gemini: 'gemini-pro'
    };
    
    this.initialize();
  }

  async initialize() {
    await this.loadSettings();
    this.setupEventListeners();
  }

  async loadSettings() {
    const settings = await chrome.storage.sync.get([
      'firstLanguage',
      'secondLanguage',
      'autoTranslate',
      'apiEndpoint',
      'apiKey',
      'apiModel'
    ]);

    this.populateForm(settings);
    this.detectApiType(settings.apiEndpoint);
  }

  populateForm(settings) {
    document.getElementById('firstLanguage').value = 
      settings.firstLanguage || 'Japanese';
    
    document.getElementById('secondLanguage').value = 
      settings.secondLanguage || 'English';
    
    document.getElementById('autoTranslate').checked = 
      settings.autoTranslate || false;
    
    document.getElementById('apiEndpoint').value = 
      settings.apiEndpoint || '';
    
    document.getElementById('apiKey').value = 
      settings.apiKey || '';
    
    document.getElementById('apiModel').value = 
      settings.apiModel || '';
  }

  detectApiType(endpoint) {
    if (!endpoint) return;
    
    if (endpoint.includes('openai')) {
      document.getElementById('apiTypeOpenAI').checked = true;
    } else if (endpoint.includes('generativelanguage.googleapis.com')) {
      document.getElementById('apiTypeGemini').checked = true;
    } else {
      document.getElementById('apiTypeCustom').checked = true;
    }
  }

  setupEventListeners() {
    this.form.addEventListener('submit', this.handleSubmit.bind(this));
    
    this.apiTypeRadios.forEach(radio => {
      radio.addEventListener('change', this.handleApiTypeChange.bind(this));
    });
  }

  handleApiTypeChange(event) {
    const apiType = event.target.value;
    
    if (apiType === 'openai') {
      this.apiEndpointInput.value = this.API_ENDPOINTS.openai;
      document.getElementById('apiModel').value = this.DEFAULT_MODELS.openai;
    } else if (apiType === 'gemini') {
      this.apiEndpointInput.value = this.API_ENDPOINTS.gemini;
      document.getElementById('apiModel').value = this.DEFAULT_MODELS.gemini;
    }
  }

  async handleSubmit(event) {
    event.preventDefault();
    
    const settings = this.getFormData();
    
    if (!this.validateSettings(settings)) {
      this.showStatus('Please fill in all required fields', 'error');
      return;
    }

    try {
      await chrome.storage.sync.set(settings);
      this.showStatus('Settings saved successfully!', 'success');
    } catch (error) {
      this.showStatus('Failed to save settings', 'error');
    }
  }

  getFormData() {
    const formData = new FormData(this.form);
    
    return {
      firstLanguage: formData.get('firstLanguage'),
      secondLanguage: formData.get('secondLanguage'),
      autoTranslate: formData.get('autoTranslate') === 'on',
      apiEndpoint: formData.get('apiEndpoint'),
      apiKey: formData.get('apiKey'),
      apiModel: formData.get('apiModel')
    };
  }

  validateSettings(settings) {
    return settings.apiEndpoint && settings.apiKey;
  }

  showStatus(message, type) {
    this.statusDiv.textContent = message;
    this.statusDiv.className = `status ${type}`;
    
    setTimeout(() => {
      this.statusDiv.textContent = '';
      this.statusDiv.className = 'status';
    }, 3000);
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new OptionsManager();
});