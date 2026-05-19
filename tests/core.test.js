const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../core.js');

test('detectProvider', async (t) => {
  await t.test('returns "default" for falsy or unknown endpoints', () => {
    assert.equal(core.detectProvider(''), 'default');
    assert.equal(core.detectProvider(null), 'default');
    assert.equal(core.detectProvider(undefined), 'default');
    assert.equal(core.detectProvider('https://example.com/api'), 'default');
  });

  await t.test('detects OpenAI by hostname substring', () => {
    assert.equal(core.detectProvider('https://api.openai.com/v1/chat/completions'), 'openai');
    assert.equal(core.detectProvider('https://my-proxy.openai.example/v1/chat/completions'), 'openai');
  });

  await t.test('detects Gemini by generativelanguage host', () => {
    assert.equal(
      core.detectProvider('https://generativelanguage.googleapis.com/v1beta/models'),
      'gemini'
    );
  });

  await t.test('detects Claude by anthropic substring', () => {
    assert.equal(core.detectProvider('https://api.anthropic.com/v1/messages'), 'claude');
  });

  await t.test('detects Ollama by port, host token, or /api/chat path', () => {
    assert.equal(core.detectProvider('http://localhost:11434/api/chat'), 'ollama');
    assert.equal(core.detectProvider('http://my-ollama/api/chat'), 'ollama');
    assert.equal(core.detectProvider('http://ollama.local/api/chat'), 'ollama');
  });
});

test('estimateMaxOutputTokens', async (t) => {
  await t.test('returns the minimum for short or empty input', () => {
    assert.equal(core.estimateMaxOutputTokens(''), core.MIN_OUTPUT_TOKENS);
    assert.equal(core.estimateMaxOutputTokens(null), core.MIN_OUTPUT_TOKENS);
    assert.equal(core.estimateMaxOutputTokens('hi'), core.MIN_OUTPUT_TOKENS);
  });

  await t.test('scales with input length', () => {
    const short = core.estimateMaxOutputTokens('x'.repeat(200));
    const longer = core.estimateMaxOutputTokens('x'.repeat(1000));
    assert.ok(longer > short, 'longer input should produce a larger budget');
  });

  await t.test('clamps at MAX_OUTPUT_TOKENS_CAP for very long input', () => {
    const huge = core.estimateMaxOutputTokens('x'.repeat(100000));
    assert.equal(huge, core.MAX_OUTPUT_TOKENS_CAP);
  });
});

test('parseGlossary', async (t) => {
  await t.test('returns empty array for falsy input', () => {
    assert.deepEqual(core.parseGlossary(''), []);
    assert.deepEqual(core.parseGlossary(null), []);
    assert.deepEqual(core.parseGlossary(undefined), []);
  });

  await t.test('parses arrow forms', () => {
    const rules = core.parseGlossary('React -> リアクト\nVue => ヴュー\nAngular → アンギュラー');
    assert.deepEqual(rules, [
      { term: 'React', translation: 'リアクト' },
      { term: 'Vue', translation: 'ヴュー' },
      { term: 'Angular', translation: 'アンギュラー' }
    ]);
  });

  await t.test('parses keep variants', () => {
    const rules = core.parseGlossary(
      'Anthropic (do not translate)\nuseState (keep)\nfoo (keep as-is)\nbar (keep as is)'
    );
    assert.deepEqual(rules, [
      { term: 'Anthropic', keep: true },
      { term: 'useState', keep: true },
      { term: 'foo', keep: true },
      { term: 'bar', keep: true }
    ]);
  });

  await t.test('treats bare terms with no marker as keep', () => {
    assert.deepEqual(core.parseGlossary('JSON'), [{ term: 'JSON', keep: true }]);
  });

  await t.test('ignores comments and blank lines', () => {
    const rules = core.parseGlossary('# header comment\n\n   \nReact -> リアクト\n# trailing');
    assert.deepEqual(rules, [{ term: 'React', translation: 'リアクト' }]);
  });

  await t.test('falls back to keep when arrow has an empty side', () => {
    assert.deepEqual(core.parseGlossary('React ->'), [{ term: 'React ->', keep: true }]);
  });
});

test('buildGlossarySection', async (t) => {
  await t.test('returns empty string when no rules', () => {
    assert.equal(core.buildGlossarySection([]), '');
    assert.equal(core.buildGlossarySection(null), '');
  });

  await t.test('renders translation and keep rules', () => {
    const section = core.buildGlossarySection([
      { term: 'React', translation: 'リアクト' },
      { term: 'Anthropic', keep: true }
    ]);
    assert.match(section, /Glossary \(apply strictly/);
    assert.match(section, /"React" must be translated as "リアクト"/);
    assert.match(section, /"Anthropic" must remain unchanged/);
  });
});

test('getSystemPrompt', async (t) => {
  await t.test('defaults unknown styles to balanced', () => {
    const prompt = core.getSystemPrompt('mystery', []);
    assert.match(prompt, /balanced translator/);
  });

  await t.test('uses the requested style when valid', () => {
    assert.match(core.getSystemPrompt('literal', []), /literal translator/);
    assert.match(core.getSystemPrompt('creative', []), /creative translator/);
  });

  await t.test('appends the glossary section when rules are present', () => {
    const prompt = core.getSystemPrompt('balanced', [
      { term: 'React', translation: 'リアクト' }
    ]);
    assert.match(prompt, /Glossary \(apply strictly/);
    assert.match(prompt, /"React" must be translated as "リアクト"/);
  });

  await t.test('omits glossary section when no rules', () => {
    const prompt = core.getSystemPrompt('balanced', []);
    assert.doesNotMatch(prompt, /Glossary/);
  });
});

test('makeCacheKey', async (t) => {
  await t.test('produces stable output for equal inputs regardless of order', () => {
    const a = core.makeCacheKey({
      text: 'hello',
      firstLanguage: 'Japanese',
      secondLanguage: 'English',
      translationStyle: 'balanced',
      apiModel: 'gpt-4o-mini',
      apiEndpoint: 'https://api.openai.com/v1/chat/completions',
      swap: false,
      glossary: 'React -> リアクト'
    });
    const b = core.makeCacheKey({
      glossary: 'React -> リアクト',
      swap: false,
      apiEndpoint: 'https://api.openai.com/v1/chat/completions',
      apiModel: 'gpt-4o-mini',
      translationStyle: 'balanced',
      secondLanguage: 'English',
      firstLanguage: 'Japanese',
      text: 'hello'
    });
    assert.equal(a, b);
  });

  await t.test('different swap values produce different keys', () => {
    const base = {
      text: 'hello',
      firstLanguage: 'Japanese',
      secondLanguage: 'English',
      translationStyle: 'balanced',
      apiModel: 'gpt-4o-mini',
      apiEndpoint: 'https://api.openai.com/v1/chat/completions'
    };
    assert.notEqual(
      core.makeCacheKey({ ...base, swap: false }),
      core.makeCacheKey({ ...base, swap: true })
    );
  });

  await t.test('different glossary produces different keys', () => {
    const base = {
      text: 'hello',
      firstLanguage: 'Japanese',
      secondLanguage: 'English',
      translationStyle: 'balanced',
      apiModel: 'gpt-4o-mini',
      apiEndpoint: 'https://api.openai.com/v1/chat/completions',
      swap: false
    };
    assert.notEqual(
      core.makeCacheKey({ ...base, glossary: '' }),
      core.makeCacheKey({ ...base, glossary: 'React -> リアクト' })
    );
  });

  await t.test('different endpoints with the same model produce different keys', () => {
    const base = {
      text: 'hello',
      firstLanguage: 'Japanese',
      secondLanguage: 'English',
      translationStyle: 'balanced',
      apiModel: 'gpt-4o-mini',
      swap: false
    };
    assert.notEqual(
      core.makeCacheKey({ ...base, apiEndpoint: 'https://api.openai.com/v1/chat/completions' }),
      core.makeCacheKey({ ...base, apiEndpoint: 'https://my-proxy.example/v1/chat/completions' })
    );
  });
});

test('parseOpenAIErrorMessage', async (t) => {
  await t.test('maps known error codes', () => {
    assert.match(
      core.parseOpenAIErrorMessage({ error: { code: 'rate_limit_exceeded', message: 'too many' } }, 429),
      /Rate limit/
    );
    assert.match(
      core.parseOpenAIErrorMessage({ error: { code: 'insufficient_quota' } }, 402),
      /No credits/
    );
    assert.match(
      core.parseOpenAIErrorMessage({ error: { code: 'invalid_api_key' } }, 401),
      /Authentication failed/
    );
  });

  await t.test('falls back to status code for missing body', () => {
    assert.match(core.parseOpenAIErrorMessage({}, 401), /Authentication failed/);
    assert.match(core.parseOpenAIErrorMessage({}, 429), /Rate limit/);
    assert.match(core.parseOpenAIErrorMessage({}, 500), /Translation failed/);
  });
});

test('parseClaudeErrorMessage', async (t) => {
  await t.test('maps known error types', () => {
    assert.match(
      core.parseClaudeErrorMessage({ error: { type: 'rate_limit_error', message: 'slow down' } }, 429),
      /Rate limit/
    );
    assert.match(
      core.parseClaudeErrorMessage({ error: { type: 'authentication_error' } }, 401),
      /Authentication failed/
    );
    assert.match(
      core.parseClaudeErrorMessage({ error: { type: 'invalid_request_error', message: 'bad model' } }, 400),
      /Invalid request: bad model/
    );
  });
});
