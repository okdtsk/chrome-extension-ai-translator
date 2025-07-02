# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Chrome extension for AI-powered translation that supports multiple AI providers (OpenAI, Gemini, Claude, Ollama). It's built with vanilla JavaScript without any build system or npm dependencies.

## Commands

Since this is a vanilla JavaScript Chrome extension without a build system:

### Development
```bash
# No build or development server needed
# Load extension directly in Chrome via chrome://extensions/ in Developer Mode
```

### Testing
```bash
# No automated tests - manual testing only
# Test by loading unpacked extension in Chrome Developer Mode
```

### Packaging
```bash
# Create a zip file for distribution (excluding unnecessary files)
zip -r chrome-extension-ai-translator.zip . -x "*.git*" -x "*.DS_Store" -x "*.zip" -x "*.pem" -x "key.pem"
```

## Architecture

### Component Structure
```
Web Page → Content Script (content.js) → Background Service Worker (background.js) → AI API
         ←                             ←                                          ←
```

### Core Classes

1. **TranslationService** (background.js:6-272)
   - Centralizes all API communication logic
   - Implements adapter pattern for multiple AI providers
   - Handles authentication and error responses
   - Methods: `callOpenAIAPI`, `callGeminiAPI`, `callClaudeAPI`, `callOllamaAPI`

2. **TranslationPopup** (content.js:32-372)
   - Manages the translation popup UI in web pages
   - Handles text selection detection and keyboard shortcuts
   - Creates and positions the popup element dynamically
   - Implements debouncing for selection events

3. **OptionsManager** (options.js:5-183)
   - Manages the settings page functionality
   - Handles API configuration and validation
   - Persists settings to Chrome Storage Sync

### Message Flow
1. User selects text or presses Cmd/Ctrl+C+C
2. Content script detects action and sends translation request to background
3. Background script calls appropriate AI API based on settings
4. Translation result sent back to content script
5. Content script displays result in popup

### API Support
The extension detects API type by URL pattern:
- OpenAI: Contains "openai.com"
- Gemini: Contains "generativelanguage.googleapis.com"
- Claude: Contains "anthropic.com"
- Ollama: Contains "localhost:11434" or "/api/chat"

### Storage Structure
Settings stored in Chrome Storage Local:
```javascript
{
  enabled: boolean,
  firstLanguage: string,
  secondLanguage: string,
  apiEndpoint: string,
  apiModel: string,
  autoTranslate: boolean,
  translationStyle: string
}
// API keys are stored separately with encryption:
// encrypted_api_key_[provider]: { data: number[], iv: number[] }
```

## Key Implementation Details

- **Manifest V3**: Uses service workers instead of background pages
- **No Dependencies**: Pure vanilla JavaScript, no npm packages
- **Error Handling**: Comprehensive error messages for different API failures
- **Security**: API keys encrypted with Web Crypto API and stored in Chrome's local storage
- **Keyboard Shortcut**: Cmd+C+C (Mac) or Ctrl+C+C (Windows/Linux) for manual translation
- **Auto-positioning**: Popup appears near selected text with smart viewport detection

## Development Rules

- **Git Operations**: Claude Code must not execute `git commit` and `git push` commands unless explicitly requested by the user
- **Commit Messages**: Use Conventional Commits style (https://www.conventionalcommits.org/en/v1.0.0/)
  - Format: `<type>[optional scope]: <description>`
  - Common types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`
  - Example: `feat: add support for DeepL API`