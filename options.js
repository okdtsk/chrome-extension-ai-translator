const { PROVIDER_LABELS, profileKeyId, createProfileId, normalizeProfiles } = TranslatorCore;

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
      openai: 'gpt-4o-mini',
      gemini: 'gemini-1.5-flash',
      claude: 'claude-haiku-4-5',
      ollama: 'llama3'
    };

    this.MODEL_PRESETS = {
      openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
      gemini: ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro'],
      claude: ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-7'],
      ollama: ['llama3', 'llama3.1', 'mistral', 'phi3', 'gemma2']
    };
    
    this.profiles = [];
    this.activeProfileId = '';
    this.selectedProfileId = '';

    this.initialize();
  }

  async initialize() {
    await this.loadSettings();
    this.setupEventListeners();
    this.updateModelPresets();
  }

  updateModelPresets() {
    const datalist = document.getElementById('apiModelOptions');
    if (!datalist) return;
    const selected = document.querySelector('input[name="apiType"]:checked');
    const apiType = selected ? selected.value : 'openai';
    const presets = this.MODEL_PRESETS[apiType] || [];
    datalist.innerHTML = presets.map(model => `<option value="${model}"></option>`).join('');
  }

  async loadSettings() {
    const settings = await chrome.storage.local.get([
      'firstLanguage',
      'secondLanguage',
      'autoTranslate',
      'apiEndpoint',
      'apiModel',
      'apiProfiles',
      'activeProfileId',
      'translationStyle',
      'popupWidth',
      'historyEnabled',
      'glossary'
    ]);

    this.populateForm(settings);

    const { profiles, activeProfileId } = normalizeProfiles(settings);
    this.profiles = profiles;
    this.activeProfileId = activeProfileId;
    if (this.profiles.length === 0) {
      // First run: start with an empty draft that is persisted on first save.
      this.profiles.push(this.createDraftProfile());
    }
    this.selectedProfileId = this.activeProfileId || this.profiles[0].id;

    this.showApiKeyNote();
    this.renderProfileSelect();
    this.loadProfileIntoForm(this.getSelectedProfile());
  }

  createDraftProfile() {
    return { id: createProfileId(), name: 'New profile', apiEndpoint: '', apiModel: '' };
  }

  getSelectedProfile() {
    return this.profiles.find(profile => profile.id === this.selectedProfileId);
  }

  renderProfileSelect() {
    const select = document.getElementById('profileSelect');
    select.innerHTML = '';
    for (const profile of this.profiles) {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.id === this.activeProfileId
        ? `${profile.name} (active)`
        : profile.name;
      select.appendChild(option);
    }
    select.value = this.selectedProfileId;
    document.getElementById('deleteProfileBtn').disabled = this.profiles.length <= 1;
  }

  loadProfileIntoForm(profile) {
    document.getElementById('profileName').value = profile.name;
    document.getElementById('apiEndpoint').value = profile.apiEndpoint;
    document.getElementById('apiModel').value = profile.apiModel;

    const apiKeyInput = document.getElementById('apiKey');
    apiKeyInput.value = '';
    apiKeyInput.placeholder = 'Enter API key (stored encrypted)';
    const existingIndicator = apiKeyInput.parentElement.querySelector('.api-key-status');
    if (existingIndicator) existingIndicator.remove();

    const makeActive = document.getElementById('makeActive');
    const isActive = profile.id === this.activeProfileId;
    makeActive.checked = isActive || !this.activeProfileId;
    makeActive.disabled = isActive;

    this.detectApiType(profile.apiEndpoint);
    this.updateModelPresets();
    if (profile.apiEndpoint) {
      this.checkApiKeyStatus(profile);
    }
    this.setTestResult(document.getElementById('testConnectionResult'), '', '');
  }

  // Keep unsaved edits when switching between profiles in the editor.
  stashFormIntoProfile() {
    const profile = this.getSelectedProfile();
    if (!profile) return;
    profile.name = document.getElementById('profileName').value.trim() || profile.name;
    profile.apiEndpoint = document.getElementById('apiEndpoint').value.trim();
    profile.apiModel = document.getElementById('apiModel').value.trim();
  }

  handleProfileSwitch(event) {
    this.stashFormIntoProfile();
    this.selectedProfileId = event.target.value;
    this.renderProfileSelect();
    this.loadProfileIntoForm(this.getSelectedProfile());
  }

  handleNewProfile() {
    this.stashFormIntoProfile();
    const profile = this.createDraftProfile();
    this.profiles.push(profile);
    this.selectedProfileId = profile.id;
    this.renderProfileSelect();
    this.loadProfileIntoForm(profile);
    document.getElementById('profileName').select();
  }

  async handleDeleteProfile() {
    if (this.profiles.length <= 1) return;
    const profile = this.getSelectedProfile();
    if (!confirm(`Delete profile "${profile.name}" and its stored API key?`)) {
      return;
    }

    try {
      await chrome.runtime.sendMessage({
        action: 'storeApiKey',
        provider: profileKeyId(profile.id),
        apiKey: ''
      });

      this.profiles = this.profiles.filter(item => item.id !== profile.id);
      if (this.activeProfileId === profile.id) {
        this.activeProfileId = this.profiles[0].id;
      }
      this.selectedProfileId = this.activeProfileId;
      await this.persistProfiles();
      this.renderProfileSelect();
      this.loadProfileIntoForm(this.getSelectedProfile());
      this.showStatus('Profile deleted', 'success');
    } catch (error) {
      this.showStatus('Failed to delete profile', 'error');
    }
  }

  // Persist saved profiles and mirror the active one into the flat
  // apiEndpoint/apiModel keys that the translation path reads.
  async persistProfiles() {
    const saved = this.profiles.filter(profile => profile.apiEndpoint);
    const active = saved.find(profile => profile.id === this.activeProfileId) || saved[0];
    const update = { apiProfiles: saved, activeProfileId: active ? active.id : '' };
    if (active) {
      update.apiEndpoint = active.apiEndpoint;
      update.apiModel = active.apiModel;
    }
    this.activeProfileId = update.activeProfileId;
    await chrome.storage.local.set(update);
  }

  populateForm(settings) {
    document.getElementById('firstLanguage').value = 
      settings.firstLanguage || 'Japanese';
    
    document.getElementById('secondLanguage').value = 
      settings.secondLanguage || 'English';
    
    document.getElementById('autoTranslate').checked =
      settings.autoTranslate || false;

    document.getElementById('historyEnabled').checked =
      settings.historyEnabled || false;
    
    document.getElementById('glossary').value =
      settings.glossary || '';
    
    // Set translation style radio button
    const style = settings.translationStyle || 'balanced';
    const styleRadio = document.querySelector(`input[name="translationStyle"][value="${style}"]`);
    if (styleRadio) {
      styleRadio.checked = true;
    }

    // Set popup width radio button
    const width = settings.popupWidth || 'medium';
    const widthRadio = document.querySelector(`input[name="popupWidth"][value="${width}"]`);
    if (widthRadio) {
      widthRadio.checked = true;
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
    } else if (endpoint.includes(':11434') || endpoint.includes('ollama') || endpoint.includes('/api/chat')) {
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

    document.getElementById('profileSelect').addEventListener('change', this.handleProfileSwitch.bind(this));
    document.getElementById('newProfileBtn').addEventListener('click', this.handleNewProfile.bind(this));
    document.getElementById('deleteProfileBtn').addEventListener('click', this.handleDeleteProfile.bind(this));

    const testBtn = document.getElementById('testConnectionBtn');
    if (testBtn) {
      testBtn.addEventListener('click', this.handleTestConnection.bind(this));
    }

    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    if (clearHistoryBtn) {
      clearHistoryBtn.addEventListener('click', this.handleClearHistory.bind(this));
    }
  }

  async handleClearHistory() {
    const resultEl = document.getElementById('clearHistoryResult');
    if (!confirm('Delete all stored translation history?')) {
      return;
    }
    try {
      const response = await chrome.runtime.sendMessage({ action: 'clearHistory' });
      if (response && response.success) {
        this.setTestResult(resultEl, '✓ History cleared', 'success');
      } else {
        this.setTestResult(resultEl, `✕ ${response ? response.error : 'Failed to clear history'}`, 'error');
      }
    } catch (error) {
      this.setTestResult(resultEl, `✕ ${error.message}`, 'error');
    }
  }

  async handleTestConnection() {
    const btn = document.getElementById('testConnectionBtn');
    const resultEl = document.getElementById('testConnectionResult');
    const settings = this.getFormData();

    if (!settings.apiEndpoint) {
      this.setTestResult(resultEl, 'Please enter an API endpoint first', 'error');
      return;
    }

    btn.disabled = true;
    this.setTestResult(resultEl, 'Testing…', 'pending');

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'testConnection',
        apiEndpoint: settings.apiEndpoint,
        apiModel: settings.apiModel,
        apiKey: settings.apiKey,
        profileId: this.selectedProfileId,
        firstLanguage: settings.firstLanguage,
        secondLanguage: settings.secondLanguage
      });

      if (response && response.success) {
        const sample = (response.translation || '').trim().slice(0, 80);
        this.setTestResult(resultEl, `✓ Connected. Sample translation: "${sample}"`, 'success');
      } else {
        const message = response && response.error ? response.error : 'No response from background';
        this.setTestResult(resultEl, `✕ ${message}`, 'error');
      }
    } catch (error) {
      this.setTestResult(resultEl, `✕ ${error.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  setTestResult(el, message, type) {
    if (!el) return;
    el.textContent = message;
    el.className = `test-result ${type}`;
  }

  handleApiTypeChange(event) {
    const apiType = event.target.value;
    if (!this.API_ENDPOINTS[apiType]) return;

    this.apiEndpointInput.value = this.API_ENDPOINTS[apiType];
    document.getElementById('apiModel').value = this.DEFAULT_MODELS[apiType];

    // Rename only while the name is still an auto-generated one.
    const nameInput = document.getElementById('profileName');
    const current = nameInput.value.trim();
    if (!current || current === 'New profile' || Object.values(PROVIDER_LABELS).includes(current)) {
      nameInput.value = PROVIDER_LABELS[apiType];
    }

    this.updateModelPresets();
  }

  async handleSubmit(event) {
    event.preventDefault();
    
    const settings = this.getFormData();
    
    if (!this.validateSettings(settings)) {
      this.showStatus('Please fill in all required fields', 'error');
      return;
    }

    try {
      const { apiKey, makeActive, ...generalSettings } = settings;
      delete generalSettings.apiEndpoint;
      delete generalSettings.apiModel;
      delete generalSettings.profileName;

      this.stashFormIntoProfile();
      if (makeActive || !this.activeProfileId) {
        this.activeProfileId = this.selectedProfileId;
      }

      await chrome.storage.local.set(generalSettings);
      await this.persistProfiles();

      let keyStored = true;
      if (apiKey) {
        const response = await chrome.runtime.sendMessage({
          action: 'storeApiKey',
          provider: profileKeyId(this.selectedProfileId),
          apiKey: apiKey
        });
        keyStored = Boolean(response && response.success);
      }

      this.renderProfileSelect();
      this.loadProfileIntoForm(this.getSelectedProfile());

      if (!keyStored) {
        this.showStatus('Settings saved but failed to encrypt API key', 'warning');
      } else if (apiKey) {
        this.showStatus('Settings saved successfully! API key encrypted and stored.', 'success');
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
      historyEnabled: formData.get('historyEnabled') === 'on',
      apiEndpoint: formData.get('apiEndpoint'),
      apiKey: formData.get('apiKey'),
      profileName: formData.get('profileName'),
      makeActive: formData.get('makeActive') === 'on' || document.getElementById('makeActive').disabled,
      apiModel: formData.get('apiModel'),
      translationStyle: formData.get('translationStyle'),
      popupWidth: formData.get('popupWidth'),
      glossary: formData.get('glossary') || ''
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
  
  async checkApiKeyStatus(profile) {
    // Send message to background to check if API key exists
    chrome.runtime.sendMessage({
      action: 'checkApiKey',
      profileId: profile.id,
      apiEndpoint: profile.apiEndpoint
    }, (response) => {
      if (profile.id !== this.selectedProfileId) return;
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