const DEFAULT_SETTINGS = {
  enabled: true,
  autoTranslate: false,
  firstLanguage: 'Japanese',
  secondLanguage: 'English',
  apiEndpoint: '',
  apiKey: '',
  apiModel: 'gpt-3.5-turbo'
};

const SYSTEM_PROMPT = 'You are a translator. Detect the source language and translate the text accurately. Return ONLY the translated text itself. Do not include any labels, source language names, explanations, or any other text besides the translation.';

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
      const result = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
      const settings = { ...DEFAULT_SETTINGS, ...result };
      
      // Only update storage if there are missing keys
      const missingKeys = Object.keys(DEFAULT_SETTINGS).filter(key => !(key in result));
      if (missingKeys.length > 0) {
        await chrome.storage.sync.set(settings);
      }
    } catch (error) {
      console.error('Failed to initialize settings:', error);
      // Fallback to defaults if storage fails
      await chrome.storage.sync.set(DEFAULT_SETTINGS);
    }
    
    // Also handle fresh installs
    chrome.runtime.onInstalled.addListener(async () => {
      await chrome.storage.sync.set(DEFAULT_SETTINGS);
    });
  }

  async callOpenAIAPI(settings, messages) {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`
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
        max_tokens: 500
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

  async callGeminiAPI(settings, messages) {
    const apiKey = settings.apiKey;
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
          maxOutputTokens: 500
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
        content: SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: `Translate the following text to ${settings.firstLanguage} (or to ${settings.secondLanguage} if the text is already in ${settings.firstLanguage}):\n\n${text}`
      }
    ];

    const isGemini = settings.apiEndpoint.includes('generativelanguage.googleapis.com');
    
    if (isGemini) {
      return await this.callGeminiAPI(settings, messages);
    } else {
      return await this.callOpenAIAPI(settings, messages);
    }
  }

  handleTranslationRequest(request, sender, sendResponse) {
    if (request.action !== 'translate') return false;

    // Get settings with defaults
    const keys = ['apiEndpoint', 'apiKey', 'firstLanguage', 'secondLanguage', 'apiModel'];
    const defaults = {
      firstLanguage: DEFAULT_SETTINGS.firstLanguage,
      secondLanguage: DEFAULT_SETTINGS.secondLanguage,
      apiModel: DEFAULT_SETTINGS.apiModel
    };
    
    chrome.storage.sync.get(keys, async (result) => {
      const settings = { ...defaults, ...result };
      
      if (!settings.apiEndpoint || !settings.apiKey) {
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
}

// Initialize the service
const translationService = new TranslationService();

// Set up message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  return translationService.handleTranslationRequest(request, sender, sendResponse);
});