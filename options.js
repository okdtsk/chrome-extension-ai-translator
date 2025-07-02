// Note about API key handling
const API_KEY_NOTE = 'Your API key is encrypted and stored locally on this device. It is not synced across devices for security reasons.';

class OptionsManager {
  constructor() {
    this.form = document.getElementById('settingsForm');
    this.statusDiv = document.getElementById('status');
    this.apiTypeRadios = document.querySelectorAll('input[name="apiType"]');
    this.apiEndpointInput = document.getElementById('apiEndpoint');
    
    this.API_ENDPOINTS = {
      openai: 'https://api.openai.com/v1/chat/completions',
      gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
      claude: 'https://api.anthropic.com/v1/messages',
      ollama: 'http://localhost:11434/api/chat'
    };
    
    this.DEFAULT_MODELS = {
      openai: 'gpt-3.5-turbo',
      gemini: 'gemini-pro',
      claude: 'claude-3-haiku-20240307',
      ollama: 'llama2'
    };
    
    this.initialize();
  }

  async initialize() {
    await this.loadSettings();
    this.setupEventListeners();
  }

  async loadSettings() {
    const settings = await chrome.storage.local.get([
      'firstLanguage',
      'secondLanguage',
      'autoTranslate',
      'apiEndpoint',
      'apiModel',
      'translationStyle'
    ]);

    this.populateForm(settings);
    this.detectApiType(settings.apiEndpoint);
    
    // Show note about API key storage
    this.showApiKeyNote();
    
    // Check if API key exists
    if (settings.apiEndpoint) {
      this.checkApiKeyStatus(settings.apiEndpoint);
    }
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
    
    // API key is stored encrypted, so we can't display it
    document.getElementById('apiKey').value = '';
    document.getElementById('apiKey').placeholder = 'Enter API key (stored encrypted)';
    
    document.getElementById('apiModel').value = 
      settings.apiModel || '';
    
    // Set translation style radio button
    const style = settings.translationStyle || 'balanced';
    const styleRadio = document.querySelector(`input[name="translationStyle"][value="${style}"]`);
    if (styleRadio) {
      styleRadio.checked = true;
    }
  }

  detectApiType(endpoint) {
    if (!endpoint) return;
    
    if (endpoint.includes('openai')) {
      document.getElementById('apiTypeOpenAI').checked = true;
    } else if (endpoint.includes('generativelanguage.googleapis.com')) {
      document.getElementById('apiTypeGemini').checked = true;
    } else if (endpoint.includes('anthropic')) {
      document.getElementById('apiTypeClaude').checked = true;
    } else if (endpoint.includes('localhost:11434') || endpoint.includes('/api/chat')) {
      document.getElementById('apiTypeOllama').checked = true;
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
    } else if (apiType === 'claude') {
      this.apiEndpointInput.value = this.API_ENDPOINTS.claude;
      document.getElementById('apiModel').value = this.DEFAULT_MODELS.claude;
    } else if (apiType === 'ollama') {
      this.apiEndpointInput.value = this.API_ENDPOINTS.ollama;
      document.getElementById('apiModel').value = this.DEFAULT_MODELS.ollama;
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
      // Extract API key before saving
      const { apiKey, ...nonSensitiveSettings } = settings;
      
      // Save non-sensitive settings to local storage
      await chrome.storage.local.set(nonSensitiveSettings);
      
      // If API key was provided, send it to background script
      if (apiKey) {
        const provider = this.detectProviderFromEndpoint(settings.apiEndpoint);
        const response = await chrome.runtime.sendMessage({
          action: 'storeApiKey',
          provider: provider,
          apiKey: apiKey,
          skipPrompt: false
        });
        
        if (response.success) {
          this.showStatus('Settings saved successfully! API key encrypted and stored.', 'success');
        } else {
          this.showStatus('Settings saved but failed to encrypt API key', 'warning');
        }
      } else {
        this.showStatus('Settings saved successfully!', 'success');
      }
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
      apiModel: formData.get('apiModel'),
      translationStyle: formData.get('translationStyle')
    };
  }

  validateSettings(settings) {
    return settings.apiEndpoint; // API key is now optional in settings
  }

  showStatus(message, type) {
    this.statusDiv.textContent = message;
    this.statusDiv.className = `status ${type}`;
    
    setTimeout(() => {
      this.statusDiv.textContent = '';
      this.statusDiv.className = 'status';
    }, 3000);
  }
  
  showApiKeyNote() {
    const apiKeyGroup = document.getElementById('apiKey').parentElement;
    const noteDiv = document.createElement('div');
    noteDiv.className = 'info-note';
    noteDiv.textContent = API_KEY_NOTE;
    apiKeyGroup.appendChild(noteDiv);
  }
  
  detectProviderFromEndpoint(endpoint) {
    if (!endpoint) return 'default';
    
    if (endpoint.includes('openai')) {
      return 'openai';
    } else if (endpoint.includes('generativelanguage.googleapis.com')) {
      return 'gemini';
    } else if (endpoint.includes('anthropic')) {
      return 'claude';
    } else if (endpoint.includes('localhost:11434') || endpoint.includes('/api/chat')) {
      return 'ollama';
    }
    
    return 'default';
  }
  
  async checkApiKeyStatus(endpoint) {
    const provider = this.detectProviderFromEndpoint(endpoint);
    
    // Send message to background to check if API key exists
    chrome.runtime.sendMessage({
      action: 'checkApiKey',
      provider: provider
    }, (response) => {
      if (response && response.hasApiKey) {
        const apiKeyInput = document.getElementById('apiKey');
        apiKeyInput.placeholder = 'API key is already saved (enter new key to update)';
        
        // Add a visual indicator
        const indicator = document.createElement('div');
        indicator.className = 'api-key-status';
        indicator.textContent = '✓ API key is saved';
        indicator.style.color = '#2e7d32';
        indicator.style.fontSize = '12px';
        indicator.style.marginTop = '4px';
        
        const existingIndicator = apiKeyInput.parentElement.querySelector('.api-key-status');
        if (existingIndicator) {
          existingIndicator.remove();
        }
        apiKeyInput.parentElement.appendChild(indicator);
      }
    });
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new OptionsManager();
});