# Browser Control Agent

A Chrome extension that enables AI-powered browser automation through natural language commands.

## Overview

Browser Control Agent is a Chrome extension that allows you to automate web-based tasks using natural language instructions. Simply tell the agent what you want to accomplish (e.g., "find 10 properties to stay in Chiang Mai in September"), and it will intelligently navigate websites and perform actions on your behalf.

## Key Features

- **Natural Language Control**: Interact with your browser using everyday language
- **Multimodal Understanding**: The agent processes both visual and textual content to understand web pages
- **Adaptive Automation**: Intelligently handles dynamic web content through an iterative decision-making process
- **Privacy-Focused**: All processing happens client-side within your browser

## How It Works

1. You provide a high-level goal through the side panel chat interface
2. The AI agent analyzes the current webpage using text and screenshots
3. It decides on the appropriate action (clicking, typing, scrolling, etc.)
4. After executing the action, it re-evaluates the page state and determines the next step
5. This loop continues until your goal is achieved

## Technology

Browser Control Agent leverages Google's Gemini 1.5 multimodal language model to understand web content and determine the most appropriate actions to take.

## Installation

1. Clone this repository
2. Install dependencies: `npm install`
3. Build the extension: `npm run build`
4. Load the extension in Chrome:
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the `dist` folder

## Usage

1. Click the Browser Control Agent icon in your Chrome toolbar to open the side panel
2. Enter your API key in the options page (accessible via the side panel)
3. Navigate to a website where you want to automate tasks
4. Enter your goal in the chat interface and watch as the agent works for you

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Documentation

For more detailed information about the project architecture and implementation, see the [documentation](docs/README.md).
