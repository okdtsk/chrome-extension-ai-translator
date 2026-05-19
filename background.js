const DEFAULT_SETTINGS = {
  enabled: true,
  autoTranslate: false,
  firstLanguage: 'Japanese',
  secondLanguage: 'English',
  apiEndpoint: '',
  apiModel: 'gpt-3.5-turbo',
  translationStyle: 'balanced', // literal, accurate, balanced, natural, creative
  popupWidth: 'medium' // narrow, medium, wide
};

// Encrypted storage manager for sensitive data using Web Crypto API
class EncryptedStorageManager {
  constructor() {
    this.algorithm = 'AES-GCM';
    this.keyUsages = ['encrypt', 'decrypt'];
    this.saltKey = 'ai_translator_salt';
    this.ivKey = 'ai_translator_iv';
  }

  // Generate a cryptographic key from the extension's unique ID
  async generateKey() {
    // Use a combination of extension ID and a fixed salt for key derivation
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(chrome.runtime.id + 'AITranslatorExtension2024'),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );

    // Get or generate salt
    let salt = await this.getSalt();
    if (!salt) {
      salt = crypto.getRandomValues(new Uint8Array(16));
      await this.saveSalt(salt);
    }

    // Derive key using PBKDF2
    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: this.algorithm, length: 256 },
      true,
      this.keyUsages
    );

    return key;
  }

  async getSalt() {
    const result = await chrome.storage.local.get(this.saltKey);
    if (result[this.saltKey]) {
      return new Uint8Array(result[this.saltKey]);
    }
    return null;
  }

  async saveSalt(salt) {
    await chrome.storage.local.set({
      [this.saltKey]: Array.from(salt)
    });
  }

  // Encrypt data
  async encrypt(data) {
    try {
      const key = await this.generateKey();
      const encoder = new TextEncoder();
      const encodedData = encoder.encode(data);
      
      // Generate random IV for each encryption
      const iv = crypto.getRandomValues(new Uint8Array(12));
      
      const encryptedData = await crypto.subtle.encrypt(
        {
          name: this.algorithm,
          iv: iv
        },
        key,
        encodedData
      );

      // Return encrypted data with IV
      return {
        data: Array.from(new Uint8Array(encryptedData)),
        iv: Array.from(iv)
      };
    } catch (error) {
      console.error('Encryption failed:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  // Decrypt data
  async decrypt(encryptedObj) {
    try {
      const key = await this.generateKey();
      const encryptedData = new Uint8Array(encryptedObj.data);
      const iv = new Uint8Array(encryptedObj.iv);
      
      const decryptedData = await crypto.subtle.decrypt(
        {
          name: this.algorithm,
          iv: iv
        },
        key,
        encryptedData
      );

      const decoder = new TextDecoder();
      return decoder.decode(decryptedData);
    } catch (error) {
      console.error('Decryption failed:', error);
      throw new Error('Failed to decrypt data');
    }
  }

  // Store encrypted API key
  async storeApiKey(provider, apiKey) {
    if (!apiKey) {
      await chrome.storage.local.remove(`encrypted_api_key_${provider}`);
      return;
    }

    const encrypted = await this.encrypt(apiKey);
    await chrome.storage.local.set({
      [`encrypted_api_key_${provider}`]: encrypted
    });
  }

  // Retrieve and decrypt API key
  async getApiKey(provider) {
    const result = await chrome.storage.local.get(`encrypted_api_key_${provider}`);
    const encryptedData = result[`encrypted_api_key_${provider}`];
    
    if (!encryptedData) {
      return null;
    }

    try {
      return await this.decrypt(encryptedData);
    } catch (error) {
      console.error('Failed to decrypt API key:', error);
      // If decryption fails, remove the corrupted data
      await chrome.storage.local.remove(`encrypted_api_key_${provider}`);
      return null;
    }
  }

  // Check if API key exists
  async hasApiKey(provider) {
    const result = await chrome.storage.local.get(`encrypted_api_key_${provider}`);
    return !!result[`encrypted_api_key_${provider}`];
  }

  // Clear all encrypted data
  async clearAll() {
    const keys = await chrome.storage.local.get(null);
    const encryptedKeys = Object.keys(keys).filter(key => key.startsWith('encrypted_api_key_'));
    await chrome.storage.local.remove(encryptedKeys);
  }

  // Migrate from local storage (one-time operation)
  async migrateFromSyncStorage() {
    const result = await chrome.storage.local.get(['apiKey', 'apiEndpoint']);
    if (result.apiKey) {
      // Determine provider from endpoint
      let provider = 'default';
      
      if (result.apiEndpoint) {
        if (result.apiEndpoint.includes('openai')) {
          provider = 'openai';
        } else if (result.apiEndpoint.includes('generativelanguage.googleapis.com')) {
          provider = 'gemini';
        } else if (result.apiEndpoint.includes('anthropic')) {
          provider = 'claude';
        } else if (result.apiEndpoint.includes(':11434') || result.apiEndpoint.includes('ollama') || result.apiEndpoint.includes('/api/chat')) {
          provider = 'ollama';
        }
      }
      
      // Store encrypted in local storage
      await this.storeApiKey(provider, result.apiKey);
      
      // Remove from local storage
      await chrome.storage.local.remove(['apiKey']);
      
      return true; // Migration successful
    }
    return false; // No migration needed
  }

  // Get all non-sensitive settings from local storage
  async getNonSensitiveSettings() {
    const settings = await chrome.storage.local.get([
      'enabled',
      'firstLanguage',
      'secondLanguage',
      'apiEndpoint',
      'apiModel',
      'autoTranslate',
      'translationStyle',
      'popupWidth'
    ]);
    return settings;
  }

  // Save non-sensitive settings to local storage
  async saveNonSensitiveSettings(settings) {
    // Remove API key from settings before saving
    const { apiKey, ...nonSensitiveSettings } = settings;
    await chrome.storage.local.set(nonSensitiveSettings);
  }
}

// Initialize encrypted storage
let encryptedStorage = null;

async function initializeEncryptedStorage() {
  try {
    encryptedStorage = new EncryptedStorageManager();
    
    // Check if migration is needed
    const migrated = await encryptedStorage.migrateFromSyncStorage();
    if (migrated) {
      console.log('API key migrated to encrypted storage');
    }
    
    return encryptedStorage;
  } catch (error) {
    console.error('Failed to initialize encrypted storage:', error);
    throw error;
  }
}

const getSystemPrompt = (translationStyle) => {
  const style = translationStyle || 'balanced';
  const baseInstruction = 'IMPORTANT: Preserve the paragraph structure of the original text. Keep paragraph breaks where they appear in the source text. ';
  
  switch(style) {
    case 'literal':
      return baseInstruction + 'You are a strict literal translator. Translate the text word-for-word, preserving the exact structure and meaning. Do not adjust for grammar or natural flow. Return ONLY the translated text itself with preserved paragraph breaks.';
    
    case 'accurate':
      return baseInstruction + 'You are a precise translator. Translate accurately with minimal adjustments only for basic grammar. Preserve the original structure as much as possible. Return ONLY the translated text itself with preserved paragraph breaks.';
    
    case 'balanced':
      return baseInstruction + 'You are a balanced translator. Translate the text accurately while ensuring it sounds natural in the target language. Maintain the original meaning but adjust grammar and expressions for clarity. Return ONLY the translated text itself with preserved paragraph breaks.';
    
    case 'natural':
      return baseInstruction + 'You are a natural translator. Translate with focus on natural expression in the target language. Adapt phrases and idioms while preserving the core meaning. Return ONLY the translated text itself with preserved paragraph breaks.';
    
    case 'creative':
      return baseInstruction + 'You are a creative translator. Translate with significant interpretive freedom, fully adapting cultural references, idioms, and expressions to best convey the spirit and emotional impact in the target language. Return ONLY the translated text itself with preserved paragraph breaks.';
    
    default:
      return baseInstruction + 'You are a balanced translator. Translate the text accurately while ensuring it sounds natural in the target language. Return ONLY the translated text itself with preserved paragraph breaks.';
  }
};

// Translation output is usually within ~1.5x of input length in tokens.
// Add a 256-token buffer for short inputs, clamp to a safe upper bound so a
// stray very-long selection cannot rack up a huge bill on a single call.
const MAX_OUTPUT_TOKENS_CAP = 4096;
const MIN_OUTPUT_TOKENS = 512;
const estimateMaxOutputTokens = (text) => {
  const length = text ? text.length : 0;
  const estimate = Math.ceil(length * 1.5) + 256;
  return Math.min(MAX_OUTPUT_TOKENS_CAP, Math.max(MIN_OUTPUT_TOKENS, estimate));
};

const ERROR_MESSAGES = {
  NO_CONFIG: 'Please configure API settings in extension options',
  NETWORK_ERROR: 'Network error. Please check your internet connection and API endpoint.',
  AUTH_FAILED: 'Authentication failed. Please check your API key.',
  INSUFFICIENT_QUOTA: 'No credits remaining. Please add credits to your OpenAI account.',
  RATE_LIMIT: 'Rate limit exceeded. Please try again later.',
  INVALID_RESPONSE: 'Unexpected response format from API.',
  GENERIC_ERROR: 'Translation failed. Please check your settings and try again.'
};

class TranslationService {
  constructor() {
    this.initializeSettings();
  }

  async initializeSettings() {
    // Initialize settings on every startup
    try {
      if (!encryptedStorage) {
        await initializeEncryptedStorage();
      }
      
      const result = await encryptedStorage.getNonSensitiveSettings();
      const settings = { ...DEFAULT_SETTINGS, ...result };
      
      // Only update storage if there are missing keys (excluding apiKey)
      const missingKeys = Object.keys(DEFAULT_SETTINGS).filter(key => key !== 'apiKey' && !(key in result));
      if (missingKeys.length > 0) {
        await encryptedStorage.saveNonSensitiveSettings(settings);
      }
    } catch (error) {
      console.error('Failed to initialize settings:', error);
      // Fallback to defaults if storage fails
      const { apiKey, ...nonSensitiveDefaults } = DEFAULT_SETTINGS;
      await chrome.storage.local.set(nonSensitiveDefaults);
    }
  }

  async callOpenAIAPI(settings, messages, maxOutputTokens) {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey || ''}`
    };

    if (settings.organizationId) {
      headers['OpenAI-Organization'] = settings.organizationId;
    }

    const response = await fetch(settings.apiEndpoint, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        model: settings.apiModel || 'gpt-3.5-turbo',
        messages: messages,
        temperature: 0.3,
        max_tokens: maxOutputTokens
      })
    });

    const responseData = await response.json();

    if (!response.ok) {
      throw this.parseOpenAIError(responseData, response.status);
    }

    if (!responseData.choices?.[0]?.message?.content) {
      throw new Error(ERROR_MESSAGES.INVALID_RESPONSE);
    }

    return responseData.choices[0].message.content;
  }

  async callGeminiAPI(settings, messages, maxOutputTokens) {
    const apiKey = settings.apiKey || '';
    const model = settings.apiModel || 'gemini-pro';
    const url = `${settings.apiEndpoint}/${model}:generateContent?key=${apiKey}`;

    const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: maxOutputTokens
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    
    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error(ERROR_MESSAGES.INVALID_RESPONSE);
    }

    return data.candidates[0].content.parts[0].text;
  }

  async callClaudeAPI(settings, messages, maxOutputTokens) {
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey || '',
      'anthropic-version': '2023-06-01'
    };

    // Convert messages to Claude format
    const systemMessage = messages.find(m => m.role === 'system');
    const userMessages = messages.filter(m => m.role !== 'system');

    const response = await fetch(settings.apiEndpoint, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        model: settings.apiModel || 'claude-3-haiku-20240307',
        messages: userMessages.map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content
        })),
        system: systemMessage ? systemMessage.content : undefined,
        max_tokens: maxOutputTokens,
        temperature: 0.3
      })
    });

    const responseData = await response.json();

    if (!response.ok) {
      throw this.parseClaudeError(responseData, response.status);
    }

    if (!responseData.content?.[0]?.text) {
      throw new Error(ERROR_MESSAGES.INVALID_RESPONSE);
    }

    return responseData.content[0].text;
  }

  parseClaudeError(errorData, status) {
    if (errorData.error) {
      const errorType = errorData.error.type;
      const errorMessage = errorData.error.message;
      
      switch (errorType) {
        case 'rate_limit_error':
          return new Error(`${ERROR_MESSAGES.RATE_LIMIT} ${errorMessage}`);
        case 'authentication_error':
          return new Error(ERROR_MESSAGES.AUTH_FAILED);
        case 'invalid_request_error':
          return new Error(`Invalid request: ${errorMessage}`);
        default:
          return new Error(`API Error: ${errorMessage || errorType}`);
      }
    }
    
    if (status === 401) {
      return new Error(ERROR_MESSAGES.AUTH_FAILED);
    } else if (status === 429) {
      return new Error(ERROR_MESSAGES.RATE_LIMIT);
    }
    
    return new Error(ERROR_MESSAGES.GENERIC_ERROR);
  }

  async callOllamaAPI(settings, messages) {
    // Ollama expects a different format
    const systemMessage = messages.find(m => m.role === 'system');
    const userMessage = messages.find(m => m.role === 'user');
    
    const response = await fetch(settings.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: settings.apiModel || 'llama2',
        messages: messages,
        stream: false,
        options: {
          temperature: 0.3
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    
    if (!data.message?.content) {
      throw new Error(ERROR_MESSAGES.INVALID_RESPONSE);
    }

    return data.message.content;
  }

  parseOpenAIError(errorData, status) {
    if (errorData.error) {
      const errorCode = errorData.error.code;
      const errorMessage = errorData.error.message;
      
      switch (errorCode) {
        case 'rate_limit_exceeded':
          return new Error(`${ERROR_MESSAGES.RATE_LIMIT} ${errorMessage}`);
        case 'insufficient_quota':
          return new Error(ERROR_MESSAGES.INSUFFICIENT_QUOTA);
        case 'invalid_api_key':
          return new Error(ERROR_MESSAGES.AUTH_FAILED);
        default:
          return new Error(`API Error: ${errorMessage || errorCode}`);
      }
    }
    
    if (status === 401) {
      return new Error(ERROR_MESSAGES.AUTH_FAILED);
    } else if (status === 429) {
      return new Error(ERROR_MESSAGES.RATE_LIMIT);
    }
    
    return new Error(ERROR_MESSAGES.GENERIC_ERROR);
  }

  async translate(text, settings) {
    const messages = [
      {
        role: 'system',
        content: getSystemPrompt(settings.translationStyle)
      },
      {
        role: 'user',
        content: `Translate the following text to ${settings.firstLanguage} (or to ${settings.secondLanguage} if the text is already in ${settings.firstLanguage}):\n\n${text}`
      }
    ];

    const isGemini = settings.apiEndpoint.includes('generativelanguage.googleapis.com');
    const isClaude = settings.apiEndpoint.includes('anthropic.com');
    const isOllama = settings.apiEndpoint.includes(':11434') || settings.apiEndpoint.includes('ollama') || settings.apiEndpoint.includes('/api/chat');

    const maxOutputTokens = estimateMaxOutputTokens(text);

    if (isGemini) {
      return await this.callGeminiAPI(settings, messages, maxOutputTokens);
    } else if (isClaude) {
      return await this.callClaudeAPI(settings, messages, maxOutputTokens);
    } else if (isOllama) {
      return await this.callOllamaAPI(settings, messages);
    } else {
      return await this.callOpenAIAPI(settings, messages, maxOutputTokens);
    }
  }

  handleTranslationRequest(request, sender, sendResponse) {
    if (request.action !== 'translate') return false;

    // Get settings with defaults
    const keys = ['apiEndpoint', 'firstLanguage', 'secondLanguage', 'apiModel', 'translationStyle'];
    const defaults = {
      firstLanguage: DEFAULT_SETTINGS.firstLanguage,
      secondLanguage: DEFAULT_SETTINGS.secondLanguage,
      apiModel: DEFAULT_SETTINGS.apiModel,
      translationStyle: DEFAULT_SETTINGS.translationStyle
    };
    
    chrome.storage.local.get(keys, async (result) => {
      const settings = { ...defaults, ...result };

      const provider = this.detectProvider(settings.apiEndpoint);
      if (encryptedStorage) {
        settings.apiKey = await encryptedStorage.getApiKey(provider);
      }

      if (!settings.apiEndpoint || (provider !== 'ollama' && !settings.apiKey)) {
        sendResponse({ error: ERROR_MESSAGES.NO_CONFIG });
        return;
      }

      try {
        const translation = await this.translate(request.text, settings);
        sendResponse({ translation });
      } catch (error) {
        let errorMessage = error.message;
        
        if (error.message.includes('Failed to fetch')) {
          errorMessage = ERROR_MESSAGES.NETWORK_ERROR;
        }
        
        sendResponse({ error: errorMessage });
      }
    });

    return true; // Will respond asynchronously
  }
  
  detectProvider(endpoint) {
    if (!endpoint) return 'default';

    if (endpoint.includes('openai')) {
      return 'openai';
    } else if (endpoint.includes('generativelanguage.googleapis.com')) {
      return 'gemini';
    } else if (endpoint.includes('anthropic')) {
      return 'claude';
    } else if (endpoint.includes(':11434') || endpoint.includes('ollama') || endpoint.includes('/api/chat')) {
      return 'ollama';
    }

    return 'default';
  }
  
}

// Initialize the service lazily. Listeners must be registered synchronously at
// the top level (MV3), but storage/crypto are async — so callers await
// ensureInitialized() before touching encryptedStorage or translationService.
let translationService = null;
let initPromise = null;

function ensureInitialized() {
  if (!initPromise) {
    initPromise = (async () => {
      await initializeEncryptedStorage();
      translationService = new TranslationService();
    })().catch(error => {
      // Reset so the next call retries instead of returning a poisoned promise
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

// Kick off init eagerly on script load, but don't depend on it completing
// before the first message arrives.
ensureInitialized();

// Seed defaults only on fresh install, and never overwrite existing values.
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason !== 'install') return;

  const { apiKey, ...defaults } = DEFAULT_SETTINGS;
  const keys = Object.keys(defaults);
  const existing = await chrome.storage.local.get(keys);
  const toSet = {};
  for (const key of keys) {
    if (!(key in existing)) {
      toSet[key] = defaults[key];
    }
  }
  if (Object.keys(toSet).length > 0) {
    await chrome.storage.local.set(toSet);
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'storeApiKey') {
    ensureInitialized()
      .then(() => encryptedStorage.storeApiKey(request.provider, request.apiKey))
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.action === 'checkApiKey') {
    ensureInitialized()
      .then(() => encryptedStorage.hasApiKey(request.provider))
      .then(hasKey => sendResponse({ hasApiKey: hasKey }))
      .catch(() => sendResponse({ hasApiKey: false }));
    return true;
  } else if (request.action === 'translate') {
    ensureInitialized()
      .then(() => translationService.handleTranslationRequest(request, sender, sendResponse))
      .catch(error => sendResponse({ error: error.message || 'Translation service unavailable' }));
    return true;
  } else if (request.action === 'testConnection') {
    ensureInitialized()
      .then(async () => {
        const provider = translationService.detectProvider(request.apiEndpoint);
        let apiKey = request.apiKey;
        if (!apiKey) {
          apiKey = await encryptedStorage.getApiKey(provider);
        }
        if (!request.apiEndpoint || (provider !== 'ollama' && !apiKey)) {
          sendResponse({ success: false, error: ERROR_MESSAGES.NO_CONFIG });
          return;
        }
        const settings = {
          apiEndpoint: request.apiEndpoint,
          apiModel: request.apiModel,
          apiKey,
          firstLanguage: request.firstLanguage || DEFAULT_SETTINGS.firstLanguage,
          secondLanguage: request.secondLanguage || DEFAULT_SETTINGS.secondLanguage,
          translationStyle: 'balanced'
        };
        try {
          const translation = await translationService.translate('Hello', settings);
          sendResponse({ success: true, translation });
        } catch (error) {
          let errorMessage = error.message;
          if (errorMessage && errorMessage.includes('Failed to fetch')) {
            errorMessage = ERROR_MESSAGES.NETWORK_ERROR;
          }
          sendResponse({ success: false, error: errorMessage || ERROR_MESSAGES.GENERIC_ERROR });
        }
      })
      .catch(error => sendResponse({ success: false, error: error.message || 'Translation service unavailable' }));
    return true;
  }

  return false;
});

