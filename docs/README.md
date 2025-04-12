# Browser Control Agent - Documentation

## 1. Project Goal

The primary goal of this Chrome extension is to create an AI-powered agent capable of controlling the user's browser to automate web-based tasks. Users interact with the agent via a side panel chat interface, providing high-level goals (e.g., "find 10 properties to stay in Chiang Mai in September").

The agent leverages a multimodal large language model (Google Gemini 1.5 Flash/Pro) to understand the user's goal, analyze the current state of the web page (using text and screenshots), decide on the next appropriate action (like clicking, typing, scrolling, navigating), and execute that action.

The process is designed to be iterative and adaptive. After each action, the agent re-evaluates the page state and determines the subsequent step, allowing it to handle dynamic web content and potentially recover from minor errors or unexpected changes in page layout. This creates an "agentic loop" where the AI drives the browser interaction based on the user's objective.

The entire process runs client-side within the browser extension for privacy and simplicity.

## 2. Architecture Overview

The extension follows a standard Manifest V3 architecture, utilizing a background service worker, content scripts, and UI pages (side panel, options page). Communication between these components happens via Chrome's message passing APIs (`chrome.runtime.sendMessage`, `chrome.tabs.sendMessage`).

```mermaid
graph LR
    subgraph Browser Window
        subgraph Web Page
            DOM(Document Object Model)
            ContentScanner[pageScanner.ts] -- Reads --> DOM
            ContentExecutor[actionExecutor.ts] -- Modifies --> DOM
            AnnotatorOverlay[Annotator (Visual Overlays)] -- Draws (via OffscreenCanvas) --> Screenshot
        end
        SidePanelUI[Side Panel (React UI)]
        OptionsUI[Options Page (React UI)]
    end

    subgraph Extension Process
        BackgroundScript[background/index.ts (Agent Loop)] -- Orchestrates --> ContentScanner & ContentExecutor
        StorageSession[Session Storage (Agent State)]
        StorageLocal[Local Storage (API Key)]
        AnnotatorLogic[background/annotator.ts] -- Processes --> ScreenshotData
    end

    GeminiAPI[Google Gemini API (Multimodal)]

    User --> SidePanelUI
    SidePanelUI -- User Goal --> BackgroundScript
    BackgroundScript -- Request Scan --> ContentScanner
    ContentScanner -- Scans DOM --> DOM
    ContentScanner -- Element Data (inc. BBox) --> BackgroundScript
    BackgroundScript -- Request Screenshot --> ChromeAPI(chrome.tabs.captureVisibleTab)
    ChromeAPI -- Screenshot Data --> BackgroundScript
    BackgroundScript -- Screenshot + Element Data --> AnnotatorLogic
    AnnotatorLogic -- Annotated Screenshot Data --> BackgroundScript
    BackgroundScript -- Store/Retrieve State --> StorageSession
    BackgroundScript -- Retrieve API Key --> StorageLocal
    BackgroundScript -- API Request (Goal, History, Annotated Screenshot, Element Data) --> GeminiAPI
    GeminiAPI -- Next Action Command (JSON) --> BackgroundScript
    BackgroundScript -- Execute Action Command --> ContentExecutor
    ContentExecutor -- Finds Element & Executes --> DOM
    ContentExecutor -- Action Result --> BackgroundScript
    BackgroundScript -- Update UI --> SidePanelUI
    OptionsUI -- Save/Load API Key --> StorageLocal

```

**Core Agent Loop (`background/index.ts`):**

1.  Receive user goal from Side Panel.
2.  Initialize agent state (goal, history, etc.) in Session Storage.
3.  **Start Step:**
    a.  Load current agent state from Session Storage.
    b.  Verify target tab still exists.
    c.  Capture visible tab screenshot (`chrome.tabs.captureVisibleTab`).
    d.  Request page element scan from `pageScanner.ts` (`chrome.tabs.sendMessage`).
    e.  Receive element data (including bounding boxes).
    f.  Annotate screenshot with element IDs/boxes (`annotator.ts`).
    g.  Construct multimodal prompt (goal, history, annotated screenshot, element data).
    h.  Call Gemini API using SDK (`@google/generative-ai`).
    i.  Parse JSON action command from Gemini response.
    j.  Handle `finish` or `navigate` actions directly.
    k.  For other actions, send command to `actionExecutor.ts` (`chrome.tabs.sendMessage`).
    l.  Receive execution result.
    m. Update history and save agent state to Session Storage.
    n. If not finished, schedule the next `runAgentStep` (e.g., using `setTimeout`).
4.  Handle errors gracefully, update UI, and stop the loop if necessary.

## 3. File Descriptions

*   **`manifest.json`**: Defines the extension's core properties, permissions, background script, content scripts, UI pages, and icons.
*   **`vite.config.ts`**: Configuration for the Vite build tool, including React plugin and CRX plugin (`@crxjs/vite-plugin`) for packaging the extension.
*   **`tsconfig.json` / `tsconfig.node.json`**: TypeScript configuration files.
*   **`package.json`**: Lists project dependencies and scripts (`dev`, `build`).
*   **`index.html`**: HTML entry point for the Side Panel React app.
*   **`options.html`**: HTML entry point for the Options Page React app.
*   **`public/`**: Contains static assets (like icons) copied directly to the build output.
*   **`src/`**: Contains the main source code.
    *   **`src/background/index.ts`**: The main background service worker. Contains the core agent loop logic, state management (using Session Storage), communication handling, and Gemini API interaction.
    *   **`src/background/annotator.ts`**: Contains the `createAnnotatedScreenshot` function, which uses `OffscreenCanvas` to draw bounding boxes and IDs onto the captured screenshot.
    *   **`src/contentScripts/pageScanner.ts`**: Injected into web pages. Scans the DOM for interactable elements, extracts relevant data (tag, text, attributes, bounding box), assigns temporary IDs, and sends the data back to the background script.
    *   **`src/contentScripts/actionExecutor.ts`**: Injected into web pages. Receives action commands (like click, input, scroll) from the background script, finds the target element (using temporary IDs), performs the action on the DOM, and sends the result back.
    *   **`src/sidepanel/`**: Contains the React code for the Side Panel UI.
        *   `main.tsx`: Renders the React app into `index.html`.
        *   `App.tsx`: The main UI component (chat interface, input field, status display). Handles sending user goals and displaying agent messages/status.
    *   **`src/options/`**: Contains the React code for the Options Page UI.
        *   `main.tsx`: Renders the React app into `options.html`.
        *   `OptionsApp.tsx`: The UI component for entering and saving the Gemini API key to Local Storage.
    *   **`src/shared/`**: (Currently empty) Intended for shared types or utility functions used across different parts of the extension (e.g., `ActionCommand`, `InteractableElement` interfaces).

## 4. Key Technologies

*   **Chrome Extension API (Manifest V3)**: Foundation for the extension.
*   **TypeScript**: For static typing and improved code maintainability.
*   **React**: For building the Side Panel and Options Page user interfaces.
*   **Vite**: Fast build tool for development and production builds.
*   **`@crxjs/vite-plugin`**: Vite plugin to simplify MV3 extension development.
*   **`@google/generative-ai`**: Official Google SDK for interacting with the Gemini API.
*   **Google Gemini API (1.5 Flash/Pro)**: Multimodal LLM used for understanding context and deciding actions.
*   **OffscreenCanvas API**: Used in the background script for annotating screenshots without needing a visible canvas element.
