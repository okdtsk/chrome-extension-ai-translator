// Pure helpers shared between the service worker and the test harness.
// No chrome.* dependencies. Loaded into the service worker via
// importScripts('core.js') and required from Node tests via require('./core.js').

(function (root) {
  const MAX_OUTPUT_TOKENS_CAP = 4096;
  const MIN_OUTPUT_TOKENS = 512;

  const ERROR_MESSAGES = {
    NO_CONFIG: 'Please configure API settings in extension options',
    NETWORK_ERROR: 'Network error. Please check your internet connection and API endpoint.',
    AUTH_FAILED: 'Authentication failed. Please check your API key.',
    INSUFFICIENT_QUOTA: 'No credits remaining. Please add credits to your OpenAI account.',
    RATE_LIMIT: 'Rate limit exceeded. Please try again later.',
    INVALID_RESPONSE: 'Unexpected response format from API.',
    GENERIC_ERROR: 'Translation failed. Please check your settings and try again.'
  };

  const detectProvider = (endpoint) => {
    if (!endpoint) return 'default';
    if (endpoint.includes('openai')) return 'openai';
    if (endpoint.includes('generativelanguage.googleapis.com')) return 'gemini';
    if (endpoint.includes('anthropic')) return 'claude';
    if (endpoint.includes(':11434') || endpoint.includes('ollama') || endpoint.includes('/api/chat')) {
      return 'ollama';
    }
    return 'default';
  };

  const estimateMaxOutputTokens = (text) => {
    const length = text ? text.length : 0;
    const estimate = Math.ceil(length * 1.5) + 256;
    return Math.min(MAX_OUTPUT_TOKENS_CAP, Math.max(MIN_OUTPUT_TOKENS, estimate));
  };

  const parseGlossary = (raw) => {
    if (!raw) return [];
    const rules = [];
    for (const original of raw.split('\n')) {
      const line = original.trim();
      if (!line || line.startsWith('#')) continue;

      const keepMatch = line.match(/^(.+?)\s*\(\s*(?:do not translate|keep(?: as[- ]is)?)\s*\)\s*$/i);
      if (keepMatch) {
        rules.push({ term: keepMatch[1].trim(), keep: true });
        continue;
      }

      const arrowMatch = line.match(/^(.+?)\s*(?:=>|->|→)\s*(.+)$/);
      if (arrowMatch) {
        const term = arrowMatch[1].trim();
        const translation = arrowMatch[2].trim();
        if (term && translation) {
          rules.push({ term, translation });
          continue;
        }
      }

      rules.push({ term: line, keep: true });
    }
    return rules;
  };

  const buildGlossarySection = (rules) => {
    if (!rules || rules.length === 0) return '';
    const lines = rules.map(rule =>
      rule.keep
        ? `- "${rule.term}" must remain unchanged`
        : `- "${rule.term}" must be translated as "${rule.translation}"`
    );
    return `\n\nGlossary (apply strictly, overrides style preferences):\n${lines.join('\n')}`;
  };

  const STYLE_INSTRUCTIONS = {
    literal: 'You are a strict literal translator. Translate the text word-for-word, preserving the exact structure and meaning. Do not adjust for grammar or natural flow.',
    accurate: 'You are a precise translator. Translate accurately with minimal adjustments only for basic grammar. Preserve the original structure as much as possible.',
    balanced: 'You are a balanced translator. Translate the text accurately while ensuring it sounds natural in the target language. Maintain the original meaning but adjust grammar and expressions for clarity.',
    natural: 'You are a natural translator. Translate with focus on natural expression in the target language. Adapt phrases and idioms while preserving the core meaning.',
    creative: 'You are a creative translator. Translate with significant interpretive freedom, fully adapting cultural references, idioms, and expressions to best convey the spirit and emotional impact in the target language.'
  };

  const getSystemPrompt = (translationStyle, glossaryRules) => {
    const style = translationStyle && STYLE_INSTRUCTIONS[translationStyle] ? translationStyle : 'balanced';
    const baseInstruction = 'IMPORTANT: Preserve the paragraph structure of the original text. Keep paragraph breaks where they appear in the source text. ';
    const glossarySection = buildGlossarySection(glossaryRules);
    const tail = ' Return ONLY the translated text itself with preserved paragraph breaks.';
    return baseInstruction + STYLE_INSTRUCTIONS[style] + tail + glossarySection;
  };

  const makeCacheKey = (params) => {
    return JSON.stringify({
      text: params.text,
      firstLanguage: params.firstLanguage,
      secondLanguage: params.secondLanguage,
      translationStyle: params.translationStyle,
      apiModel: params.apiModel,
      apiEndpoint: params.apiEndpoint || '',
      swap: Boolean(params.swap),
      glossary: params.glossary || ''
    });
  };

  const parseOpenAIErrorMessage = (errorData, status) => {
    if (errorData && errorData.error) {
      const errorCode = errorData.error.code;
      const errorMessage = errorData.error.message;
      switch (errorCode) {
        case 'rate_limit_exceeded':
          return `${ERROR_MESSAGES.RATE_LIMIT} ${errorMessage}`;
        case 'insufficient_quota':
          return ERROR_MESSAGES.INSUFFICIENT_QUOTA;
        case 'invalid_api_key':
          return ERROR_MESSAGES.AUTH_FAILED;
        default:
          return `API Error: ${errorMessage || errorCode}`;
      }
    }
    if (status === 401) return ERROR_MESSAGES.AUTH_FAILED;
    if (status === 429) return ERROR_MESSAGES.RATE_LIMIT;
    return ERROR_MESSAGES.GENERIC_ERROR;
  };

  const parseClaudeErrorMessage = (errorData, status) => {
    if (errorData && errorData.error) {
      const errorType = errorData.error.type;
      const errorMessage = errorData.error.message;
      switch (errorType) {
        case 'rate_limit_error':
          return `${ERROR_MESSAGES.RATE_LIMIT} ${errorMessage}`;
        case 'authentication_error':
          return ERROR_MESSAGES.AUTH_FAILED;
        case 'invalid_request_error':
          return `Invalid request: ${errorMessage}`;
        default:
          return `API Error: ${errorMessage || errorType}`;
      }
    }
    if (status === 401) return ERROR_MESSAGES.AUTH_FAILED;
    if (status === 429) return ERROR_MESSAGES.RATE_LIMIT;
    return ERROR_MESSAGES.GENERIC_ERROR;
  };

  const exports = {
    MAX_OUTPUT_TOKENS_CAP,
    MIN_OUTPUT_TOKENS,
    ERROR_MESSAGES,
    detectProvider,
    estimateMaxOutputTokens,
    parseGlossary,
    buildGlossarySection,
    getSystemPrompt,
    makeCacheKey,
    parseOpenAIErrorMessage,
    parseClaudeErrorMessage
  };

  root.TranslatorCore = exports;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
