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

  const PROVIDER_LABELS = {
    openai: 'OpenAI',
    gemini: 'Gemini',
    claude: 'Claude',
    ollama: 'Ollama',
    default: 'Custom'
  };

  // Encrypted API keys are stored per profile so two profiles on the same
  // provider (e.g. two OpenAI accounts) can hold different keys.
  const profileKeyId = (profileId) => `profile_${profileId}`;

  // Storage ids to try, in order, when looking up a profile's API key. Only the
  // migrated 'default' profile (or no profile at all, on installs that have not
  // saved one yet) may fall back to the legacy per-provider key; any other
  // profile must have its own key.
  const keyLookupIds = (profileId, endpoint) => {
    const legacyId = detectProvider(endpoint);
    if (!profileId) return [legacyId];
    if (profileId === 'default') return [profileKeyId(profileId), legacyId];
    return [profileKeyId(profileId)];
  };

  // A saved profile (one with an endpoint) may be deleted only if another saved
  // profile remains. Unsaved drafts never count, and deleting a draft is always
  // allowed as long as it is not the only profile.
  const canDeleteProfile = (profiles, profileId) => {
    const target = profiles.find(profile => profile.id === profileId);
    if (!target || profiles.length <= 1) return false;
    if (!target.apiEndpoint) return true;
    return profiles.some(profile => profile.id !== profileId && profile.apiEndpoint);
  };

  const createProfileId = () =>
    `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const isValidProfile = (profile) =>
    Boolean(profile && typeof profile.id === 'string' && profile.id &&
      typeof profile.apiEndpoint === 'string');

  // Resolve the stored profile list. Users upgrading from the single-config
  // layout get one profile built from their flat apiEndpoint/apiModel, with
  // the id 'default' so the key lookup can fall back to the legacy
  // per-provider key.
  const normalizeProfiles = (stored) => {
    const source = stored || {};
    const profiles = Array.isArray(source.apiProfiles)
      ? source.apiProfiles.filter(isValidProfile)
      : [];

    if (profiles.length === 0) {
      if (!source.apiEndpoint) return { profiles: [], activeProfileId: '' };
      const provider = detectProvider(source.apiEndpoint);
      return {
        profiles: [{
          id: 'default',
          name: PROVIDER_LABELS[provider],
          apiEndpoint: source.apiEndpoint,
          apiModel: source.apiModel || ''
        }],
        activeProfileId: 'default'
      };
    }

    const active = profiles.some(profile => profile.id === source.activeProfileId)
      ? source.activeProfileId
      : profiles[0].id;
    return { profiles, activeProfileId: active };
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

  // True when the endpoint targets the OpenAI Responses API (/v1/responses)
  // rather than Chat Completions. Matches on the URL path so OpenAI-compatible
  // hosts (proxies, Azure) that expose /responses work too.
  const isOpenAIResponsesEndpoint = (endpoint) => {
    if (!endpoint) return false;
    let path;
    try {
      path = new URL(endpoint).pathname;
    } catch {
      path = endpoint.split(/[?#]/)[0];
    }
    return /\/responses\/?$/.test(path);
  };

  // Build the request body for an OpenAI(-compatible) endpoint. The Responses
  // API takes `instructions` + `input` + `max_output_tokens`. Chat Completions
  // on api.openai.com uses `max_completion_tokens` (newer models reject
  // `max_tokens`); custom endpoints keep `max_tokens`, which compatible
  // servers widely support.
  const buildOpenAIRequestBody = ({ endpoint, model, messages, maxOutputTokens, stream }) => {
    const body = { model, temperature: 0.3 };
    if (isOpenAIResponsesEndpoint(endpoint)) {
      const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
      if (system) body.instructions = system;
      body.input = messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role, content: m.content }));
      body.max_output_tokens = maxOutputTokens;
    } else {
      body.messages = messages;
      if (detectProvider(endpoint) === 'openai') {
        body.max_completion_tokens = maxOutputTokens;
      } else {
        body.max_tokens = maxOutputTokens;
      }
    }
    if (stream) body.stream = true;
    return body;
  };

  // Given a failed request body and the API's error payload, return a body
  // with the offending parameter fixed so the call can be retried once, or
  // null if the error is not one we know how to recover from. Covers models
  // that reject a custom temperature (reasoning models) and endpoints that
  // reject `max_tokens` in favor of `max_completion_tokens`.
  const adjustOpenAIBodyForError = (body, errorData) => {
    const error = errorData && errorData.error;
    if (!error) return null;
    const param = error.param || '';
    const message = error.message || '';
    const mentions = (name) => param === name || message.includes(`'${name}'`);

    if (mentions('temperature') && 'temperature' in body) {
      const { temperature, ...rest } = body;
      return rest;
    }
    if (mentions('max_tokens') && 'max_tokens' in body) {
      const { max_tokens: maxTokens, ...rest } = body;
      return { ...rest, max_completion_tokens: maxTokens };
    }
    return null;
  };

  // Extract the generated text from a non-streaming OpenAI response. Handles
  // both Chat Completions (`choices`) and Responses API (`output`) shapes.
  // Returns '' when no text is present.
  const extractOpenAIResponseText = (data) => {
    if (!data) return '';
    const chatContent = data.choices?.[0]?.message?.content;
    if (chatContent) return chatContent;
    if (typeof data.output_text === 'string' && data.output_text) return data.output_text;
    if (!Array.isArray(data.output)) return '';
    return data.output
      .filter(item => item.type === 'message' && Array.isArray(item.content))
      .flatMap(item => item.content)
      .filter(part => part.type === 'output_text' && typeof part.text === 'string')
      .map(part => part.text)
      .join('');
  };

  // Extract a text delta from one parsed SSE event of either OpenAI API.
  // Returns '' for events that carry no text (role headers, keepalives,
  // Responses lifecycle events).
  const extractOpenAIStreamDelta = (event) => {
    if (!event) return '';
    if (event.type === 'response.output_text.delta') return event.delta || '';
    return event.choices?.[0]?.delta?.content || '';
  };

  const exports = {
    MAX_OUTPUT_TOKENS_CAP,
    MIN_OUTPUT_TOKENS,
    ERROR_MESSAGES,
    PROVIDER_LABELS,
    detectProvider,
    profileKeyId,
    keyLookupIds,
    canDeleteProfile,
    createProfileId,
    normalizeProfiles,
    estimateMaxOutputTokens,
    parseGlossary,
    buildGlossarySection,
    getSystemPrompt,
    makeCacheKey,
    parseOpenAIErrorMessage,
    parseClaudeErrorMessage,
    isOpenAIResponsesEndpoint,
    buildOpenAIRequestBody,
    adjustOpenAIBodyForError,
    extractOpenAIResponseText,
    extractOpenAIStreamDelta
  };

  root.TranslatorCore = exports;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
