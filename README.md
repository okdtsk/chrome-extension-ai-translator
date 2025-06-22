# Chrome Extension AI Translator

A Chrome extension that automatically translates selected text using OpenAI or Gemini compatible APIs.

## Features

- **Automatic Translation Popup**: Select any text on a webpage to see instant translation
- **Smart Language Detection**: Automatically detects source language and translates accordingly
- **Flexible API Support**: Works with OpenAI, Gemini, or any compatible API endpoints
- **Customizable Settings**:
  - Configure base language for translations
  - Custom system prompts for translation behavior
  - API endpoint and authentication configuration
  - Model selection support

## Installation

1. Clone this repository or download the source code
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory
5. The extension icon will appear in your Chrome toolbar

## Setup

1. Click the extension icon and select "Settings"
2. Configure your preferred settings:
   - **Base Language**: Your primary language (text in this language translates to English, other languages translate to this)
   - **System Prompt**: Customize the AI's translation behavior
   - **API Configuration**:
     - Select API type (OpenAI, Gemini, or Custom)
     - Enter your API endpoint
     - Add your API key
     - Specify the model (optional)

## Usage

1. Select any text on a webpage
2. Wait briefly (about 0.5 seconds)
3. A popup will appear with the translation
4. Click the × button or press Escape to close the popup

## API Configuration Examples

### OpenAI
- **Endpoint**: `https://api.openai.com/v1/chat/completions`
- **Model**: `gpt-3.5-turbo` or `gpt-4`

### Gemini
- **Endpoint**: `https://generativelanguage.googleapis.com/v1beta/models`
- **Model**: `gemini-pro`

## Development

The extension consists of:
- `manifest.json` - Extension configuration
- `background.js` - Service worker for API calls
- `content.js/css` - Content scripts for text selection and popup
- `popup.html/js/css` - Extension popup interface
- `options.html/js/css` - Settings page

## Privacy

- API keys are stored securely in Chrome's sync storage
- No data is collected or stored beyond your Chrome sync
- All translations are performed directly between your browser and the chosen API

## License

This project is open source and available under the MIT License.