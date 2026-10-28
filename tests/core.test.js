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

test('profileKeyId', () => {
  assert.equal(core.profileKeyId('abc'), 'profile_abc');
});

test('normalizeProfiles', async (t) => {
  await t.test('returns an empty list when nothing is configured', () => {
    assert.deepEqual(core.normalizeProfiles({}), { profiles: [], activeProfileId: '' });
    assert.deepEqual(core.normalizeProfiles(undefined), { profiles: [], activeProfileId: '' });
  });

  await t.test('migrates the legacy flat settings into a "default" profile', () => {
    const result = core.normalizeProfiles({
      apiEndpoint: 'https://api.anthropic.com/v1/messages',
      apiModel: 'claude-haiku-4-5'
    });
    assert.equal(result.activeProfileId, 'default');
    assert.deepEqual(result.profiles, [{
      id: 'default',
      name: 'Claude',
      apiEndpoint: 'https://api.anthropic.com/v1/messages',
      apiModel: 'claude-haiku-4-5'
    }]);
  });

  await t.test('keeps stored profiles and a valid active id', () => {
    const profiles = [
      { id: 'a', name: 'A', apiEndpoint: 'https://api.openai.com/v1/chat/completions', apiModel: 'gpt-4o' },
      { id: 'b', name: 'B', apiEndpoint: 'http://localhost:11434/api/chat', apiModel: 'llama3' }
    ];
    const result = core.normalizeProfiles({ apiProfiles: profiles, activeProfileId: 'b' });
    assert.equal(result.activeProfileId, 'b');
    assert.equal(result.profiles.length, 2);
  });

  await t.test('falls back to the first profile when the active id is stale', () => {
    const result = core.normalizeProfiles({
      apiProfiles: [{ id: 'a', name: 'A', apiEndpoint: 'https://x.example', apiModel: '' }],
      activeProfileId: 'gone'
    });
    assert.equal(result.activeProfileId, 'a');
  });

  await t.test('drops malformed profiles', () => {
    const result = core.normalizeProfiles({
      apiProfiles: [null, { name: 'no id' }, { id: 'ok', name: 'OK', apiEndpoint: 'https://x.example' }]
    });
    assert.deepEqual(result.profiles.map(profile => profile.id), ['ok']);
  });
});

test('keyLookupIds', async (t) => {
  const openai = 'https://api.openai.com/v1/chat/completions';

  await t.test('a regular profile only looks at its own key', () => {
    assert.deepEqual(core.keyLookupIds('work', openai), ['profile_work']);
  });

  await t.test('the migrated default profile falls back to the legacy provider key', () => {
    assert.deepEqual(core.keyLookupIds('default', openai), ['profile_default', 'openai']);
  });

  await t.test('no profile at all uses the legacy provider key', () => {
    assert.deepEqual(core.keyLookupIds('', openai), ['openai']);
    assert.deepEqual(core.keyLookupIds(undefined, 'http://localhost:11434/api/chat'), ['ollama']);
  });
});

test('canDeleteProfile', async (t) => {
  const saved = (id) => ({ id, name: id, apiEndpoint: 'https://x.example', apiModel: '' });
  const draft = (id) => ({ id, name: id, apiEndpoint: '', apiModel: '' });

  await t.test('refuses to delete the only profile', () => {
    assert.equal(core.canDeleteProfile([saved('a')], 'a'), false);
  });

  await t.test('refuses to delete the last saved profile when only drafts remain', () => {
    assert.equal(core.canDeleteProfile([saved('a'), draft('d')], 'a'), false);
  });

  await t.test('allows deleting a saved profile when another saved one remains', () => {
    assert.equal(core.canDeleteProfile([saved('a'), saved('b')], 'a'), true);
  });

  await t.test('allows deleting a draft next to a saved profile', () => {
    assert.equal(core.canDeleteProfile([saved('a'), draft('d')], 'd'), true);
  });

  await t.test('returns false for an unknown id', () => {
    assert.equal(core.canDeleteProfile([saved('a'), saved('b')], 'zzz'), false);
  });
});

test('isOpenAIResponsesEndpoint', async (t) => {
  await t.test('matches /responses paths', () => {
    assert.equal(core.isOpenAIResponsesEndpoint('https://api.openai.com/v1/responses'), true);
    assert.equal(core.isOpenAIResponsesEndpoint('https://api.openai.com/v1/responses/'), true);
    assert.equal(core.isOpenAIResponsesEndpoint('https://proxy.example/openai/v1/responses?api-version=x'), true);
  });

  await t.test('does not match chat completions or empty values', () => {
    assert.equal(core.isOpenAIResponsesEndpoint('https://api.openai.com/v1/chat/completions'), false);
    assert.equal(core.isOpenAIResponsesEndpoint(''), false);
    assert.equal(core.isOpenAIResponsesEndpoint(undefined), false);
  });
});

test('buildOpenAIRequestBody', async (t) => {
  const messages = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hello' }
  ];

  await t.test('builds a Responses API body', () => {
    const body = core.buildOpenAIRequestBody({
      endpoint: 'https://api.openai.com/v1/responses',
      model: 'gpt-6-luna',
      messages,
      maxOutputTokens: 1000,
      stream: true
    });
    assert.deepEqual(body, {
      model: 'gpt-6-luna',
      temperature: 0.3,
      instructions: 'sys',
      input: [{ role: 'user', content: 'hello' }],
      max_output_tokens: 1000,
      stream: true
    });
  });

  await t.test('uses max_completion_tokens for OpenAI chat completions', () => {
    const body = core.buildOpenAIRequestBody({
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-6-luna',
      messages,
      maxOutputTokens: 1000,
      stream: false
    });
    assert.equal(body.max_completion_tokens, 1000);
    assert.equal('max_tokens' in body, false);
    assert.equal('stream' in body, false);
    assert.deepEqual(body.messages, messages);
  });

  await t.test('keeps max_tokens for custom compatible endpoints', () => {
    const body = core.buildOpenAIRequestBody({
      endpoint: 'https://my-proxy.example/v1/chat/completions',
      model: 'm',
      messages,
      maxOutputTokens: 1000
    });
    assert.equal(body.max_tokens, 1000);
    assert.equal('max_completion_tokens' in body, false);
  });
});

test('adjustOpenAIBodyForError', async (t) => {
  await t.test('renames max_tokens when rejected', () => {
    const body = { model: 'm', max_tokens: 100, temperature: 0.3 };
    const error = { error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", param: 'max_tokens' } };
    assert.deepEqual(core.adjustOpenAIBodyForError(body, error), { model: 'm', temperature: 0.3, max_completion_tokens: 100 });
  });

  await t.test('drops temperature when rejected', () => {
    const body = { model: 'm', max_output_tokens: 100, temperature: 0.3 };
    const error = { error: { message: "Unsupported parameter: 'temperature' is not supported with this model.", param: 'temperature' } };
    assert.deepEqual(core.adjustOpenAIBodyForError(body, error), { model: 'm', max_output_tokens: 100 });
  });

  await t.test('returns null for unrelated or already-adjusted errors', () => {
    assert.equal(core.adjustOpenAIBodyForError({ model: 'm' }, { error: { param: 'temperature' } }), null);
    assert.equal(core.adjustOpenAIBodyForError({ model: 'm', temperature: 0.3 }, { error: { code: 'invalid_api_key' } }), null);
    assert.equal(core.adjustOpenAIBodyForError({ model: 'm' }, {}), null);
  });
});

test('extractOpenAIResponseText', async (t) => {
  await t.test('reads chat completions responses', () => {
    assert.equal(core.extractOpenAIResponseText({ choices: [{ message: { content: 'hi' } }] }), 'hi');
  });

  await t.test('reads Responses API output, skipping reasoning items', () => {
    const data = {
      output: [
        { type: 'reasoning', summary: [] },
        { type: 'message', content: [{ type: 'output_text', text: 'Hello ' }, { type: 'output_text', text: 'world' }] }
      ]
    };
    assert.equal(core.extractOpenAIResponseText(data), 'Hello world');
  });

  await t.test('returns empty string when no text', () => {
    assert.equal(core.extractOpenAIResponseText({}), '');
    assert.equal(core.extractOpenAIResponseText(null), '');
  });
});

test('extractOpenAIStreamDelta', async (t) => {
  await t.test('reads both stream formats', () => {
    assert.equal(core.extractOpenAIStreamDelta({ type: 'response.output_text.delta', delta: 'a' }), 'a');
    assert.equal(core.extractOpenAIStreamDelta({ choices: [{ delta: { content: 'b' } }] }), 'b');
  });

  await t.test('ignores lifecycle events', () => {
    assert.equal(core.extractOpenAIStreamDelta({ type: 'response.created' }), '');
    assert.equal(core.extractOpenAIStreamDelta({ choices: [{ delta: { role: 'assistant' } }] }), '');
  });
});
