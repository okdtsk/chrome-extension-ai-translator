# Chrome Extension AI Translator

A Chrome extension that translates selected text using AI providers (OpenAI, Gemini, Claude, or a local Ollama server).

## Features

- **Translation popup**: Select any text on a webpage to translate it (auto on selection, or on demand via keyboard shortcut).
- **Two-language pivot**: Pick a first and second language. Text in the first language is translated to the second; text in any other language is translated to the first.
- **Multiple providers**: OpenAI, Gemini, Claude (Anthropic), Ollama (local), or any compatible custom endpoint.
- **Translation styles**: Five presets — Literal, Accurate, Balanced, Natural, Creative — control how freely the AI translates.
- **Encrypted API keys**: Keys are encrypted with the Web Crypto API (AES-GCM, PBKDF2-derived from the extension ID) and stored in `chrome.storage.local`. Not synced across devices.
- **Test connection**: One-click probe in the settings page validates endpoint, key, model, and host permissions before you translate.
- **Configurable popup width**: Narrow / Medium / Wide.
- **Draggable popup**: Move the result popup if it covers the source text.

## Installation

1. Clone this repository or download the source.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top right.
4. Click **Load unpacked** and select the extension directory.
5. The extension icon appears in your Chrome toolbar.

## Setup

1. Click the extension icon and choose **Settings**.
2. Configure:
   - **First Language / Second Language**: the two-language pivot above.
   - **Auto-translate on selection**: when on, selecting text triggers translation after a short delay. When off, use the keyboard shortcut below.
   - **Translation Style**: pick one of the five presets.
   - **Popup Width**: Narrow / Medium / Wide.
   - **API Type**: OpenAI, Gemini, Claude, Ollama, or Custom. Selecting a type pre-fills a sensible endpoint and model.
   - **API Endpoint / API Key / Model**: fill in for your chosen provider. API key is not required for Ollama.
3. Click **Test connection** to verify everything works, then **Save Settings**.

## Usage

1. Select any text on a webpage.
2. With **Auto-translate** on, the popup appears automatically after ~0.5 s. With it off, press **Cmd+C+C** (macOS) or **Ctrl+C+C** (Windows/Linux) to translate the current selection.
3. Click the **×** button or press **Escape** to close the popup.

## API Configuration Examples

### OpenAI
- **Endpoint**: `https://api.openai.com/v1/chat/completions`
- **Model**: `gpt-3.5-turbo`, `gpt-4`, etc.

### Gemini
- **Endpoint**: `https://generativelanguage.googleapis.com/v1beta/models`
- **Model**: `gemini-pro`

### Claude (Anthropic)
- **Endpoint**: `https://api.anthropic.com/v1/messages`
- **Model**: `claude-3-haiku-20240307` (or a newer Claude model)

### Ollama (local)
- **Endpoint**: `http://localhost:11434/api/chat`
- **Model**: `llama2`, `mistral`, `phi`, etc.
- API key is not required.

## Development

Vanilla JavaScript, no build step or npm dependencies. Load the directory directly via **Load unpacked** in `chrome://extensions/`.

Files:
- `manifest.json` — extension manifest (Manifest V3, service worker).
- `background.js` — service worker: provider adapters, encrypted storage, message handling.
- `content.js` / `content.css` — content script: selection detection, popup UI.
- `popup.html` / `popup.js` / `popup.css` — toolbar action popup.
- `options.html` / `options.js` / `options.css` — settings page.

### Packaging

```bash
zip -r chrome-extension-ai-translator.zip . -x "*.git*" -x "*.DS_Store" -x "*.zip" -x "*.pem" -x "key.pem"
```

## Privacy

- API keys are encrypted (AES-GCM) and stored in `chrome.storage.local`. They never leave your device except as authentication headers to the provider you configured.
- Selected text is sent to the AI provider you configured; no other telemetry or analytics are collected by this extension.

## License

MIT.
