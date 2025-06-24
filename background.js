const DEFAULT_SETTINGS = {
  enabled: true,
  autoTranslate: false,
  firstLanguage: 'Japanese',
  secondLanguage: 'English',
  apiEndpoint: '',
  apiKey: '',
  apiModel: 'gpt-3.5-turbo',
  translationStyle: 'balanced' // literal, accurate, balanced, natural, creative
};

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

  async callClaudeAPI(settings, messages) {
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
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
        max_tokens: 500,
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
    const isOllama = settings.apiEndpoint.includes('localhost:11434') || settings.apiEndpoint.includes('/api/chat');
    
    if (isGemini) {
      return await this.callGeminiAPI(settings, messages);
    } else if (isClaude) {
      return await this.callClaudeAPI(settings, messages);
    } else if (isOllama) {
      return await this.callOllamaAPI(settings, messages);
    } else {
      return await this.callOpenAIAPI(settings, messages);
    }
  }

  handleTranslationRequest(request, sender, sendResponse) {
    if (request.action !== 'translate') return false;

    // Get settings with defaults
    const keys = ['apiEndpoint', 'apiKey', 'firstLanguage', 'secondLanguage', 'apiModel', 'translationStyle'];
    const defaults = {
      firstLanguage: DEFAULT_SETTINGS.firstLanguage,
      secondLanguage: DEFAULT_SETTINGS.secondLanguage,
      apiModel: DEFAULT_SETTINGS.apiModel,
      translationStyle: DEFAULT_SETTINGS.translationStyle
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