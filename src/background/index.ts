console.log('Background script loaded.');

const API_KEY_STORAGE_KEY = 'gemini_api_key'; // Same key as in OptionsApp

// Define the expected structure for actions from Gemini
interface ActionCommand {
  action: 'navigate' | 'click' | 'input' | 'scroll' | 'finish' | string; // Allow string for flexibility, refine later
  url?: string; // For navigate
  elementId?: number; // For click, input
  text?: string; // For input
  direction?: 'up' | 'down'; // For scroll
  // Add other potential fields as needed
}

// Function to send messages to the Side Panel
const sendMessageToSidePanel = (message: any) => {
  chrome.runtime.sendMessage(message, (response) => {
    if (chrome.runtime.lastError) {
      // Avoid logging errors if the side panel is simply closed
      if (chrome.runtime.lastError.message !== "Could not establish connection. Receiving end does not exist.") {
         console.error('Error sending message to side panel:', chrome.runtime.lastError.message);
      }
    } else {
      console.log('Side panel responded:', response);
    }
  });
};

// Main message listener for messages from Side Panel or Content Scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message, 'from:', sender);

  if (message.type === 'USER_GOAL') {
    const userGoal = message.payload;
    console.log('Received user goal:', userGoal);

    // Acknowledge receipt immediately
    sendResponse({ status: 'Goal received by background script' });

    // --- Start Agent Logic ---
    sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: 'Fetching API Key...' });

    // 1. Get API Key
    chrome.storage.local.get([API_KEY_STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) {
        console.error('Error loading API key:', chrome.runtime.lastError);
        sendMessageToSidePanel({ type: 'AGENT_RESPONSE', payload: `Error loading API key: ${chrome.runtime.lastError.message}` });
        return;
      }

      const apiKey = result[API_KEY_STORAGE_KEY];
      if (!apiKey) {
        console.warn('API Key not found.');
        sendMessageToSidePanel({ type: 'AGENT_RESPONSE', payload: 'Error: Gemini API Key not set. Please set it in the extension options.' });
        return;
      }
      console.log('API Key loaded successfully.');
      sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: 'Scanning current page...' });

      // 2. Get current page state (call content script)
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0 || tabs[0].id === undefined) {
          console.error('Could not find active tab.');
          sendMessageToSidePanel({ type: 'AGENT_RESPONSE', payload: 'Error: Could not find the active browser tab.' });
          return;
        }
        const activeTabId = tabs[0].id;

        chrome.tabs.sendMessage(activeTabId, { type: 'SCAN_PAGE_REQUEST' }, (scanResponse) => {
          if (chrome.runtime.lastError) {
            console.error('Error scanning page:', chrome.runtime.lastError);
            sendMessageToSidePanel({ type: 'AGENT_RESPONSE', payload: `Error scanning page: ${chrome.runtime.lastError.message}. Ensure the content script is injected or the page is supported.` });
            return;
          }

          if (scanResponse?.type !== 'SCAN_PAGE_RESPONSE') {
             console.error('Invalid response from page scanner:', scanResponse);
             sendMessageToSidePanel({ type: 'AGENT_RESPONSE', payload: 'Error: Received invalid response from page scanner.' });
             return;
          }

          const pageElements = scanResponse.payload;
          console.log('Received page elements:', pageElements);
          const pageStateString = JSON.stringify(pageElements, null, 2); // Basic representation

          // 3. Construct prompt for Gemini
          const prompt = `User goal: ${userGoal}\n\nCurrent page elements:\n${pageStateString}\n\nBased on the goal and page elements, what is the next single action to take? Actions can be navigate, click (specify element id), input (specify element id and text), scroll, or finish. Respond ONLY with a JSON object like {"action": "...", "elementId": <number>, "text": "..."}.`;
          sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: 'Calling Gemini API...' });

          // 4. Call Gemini API using gemini-flash
          const GEMINI_API_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
          fetch(GEMINI_API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
          })
          .then(response => {
            if (!response.ok) {
              return response.json().then(errorBody => {
                console.error('Gemini API Error Response:', errorBody);
                throw new Error(`HTTP error ${response.status}: ${errorBody?.error?.message ?? response.statusText}`);
              }).catch(() => { throw new Error(`HTTP error ${response.status}: ${response.statusText}`); });
            }
            return response.json();
          })
          .then(data => {
            console.log('Gemini API Success Response:', data);
            const agentResponseText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';

            // 5. Parse Gemini response
            let actionCommand: ActionCommand | null = null;
            if (agentResponseText) {
              try {
                const cleanedJsonString = agentResponseText.replace(/^```json\s*|\s*```$/g, '');
                const parsedJson = JSON.parse(cleanedJsonString);

                if (parsedJson && typeof parsedJson === 'object' && typeof parsedJson.action === 'string') {
                   actionCommand = parsedJson as ActionCommand;
                   console.log('Parsed action command:', actionCommand);
                } else { throw new Error('Invalid action format received from Gemini.'); }

                if (actionCommand) {
                   sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: `Executing action: ${actionCommand.action}...` });

                   // 6. Execute action (call content script)
                   chrome.tabs.sendMessage(activeTabId, { type: 'EXECUTE_ACTION_REQUEST', payload: actionCommand }, (execResponse) => {
                      if (chrome.runtime.lastError) {
                          console.error('Error executing action:', chrome.runtime.lastError);
                          sendMessageToSidePanel({ type: 'AGENT_RESPONSE', payload: `Error executing action: ${chrome.runtime.lastError.message}` });
                          return;
                      }
                      console.log('Action execution response:', execResponse);
                      // TODO: Handle response from action executor (e.g., success/failure, trigger next step/scan)
                      sendMessageToSidePanel({ type: 'AGENT_RESPONSE', payload: `Action '${actionCommand?.action}' execution attempted. Result: ${JSON.stringify(execResponse)}` });
                   });
                } else { throw new Error('Action command is null after parsing.'); }

              } catch (parseError: any) {
                console.error('Error parsing Gemini response JSON:', parseError);
                console.error('Original response text:', agentResponseText);
                sendMessageToSidePanel({ type: 'AGENT_RESPONSE', payload: `Error: Could not parse action from Gemini. Response: ${agentResponseText}` });
              }
            } else { sendMessageToSidePanel({ type: 'AGENT_RESPONSE', payload: 'Error: Received empty response from Gemini.' }); }
          })
          .catch((error: any) => {
            console.error('Error calling Gemini API:', error);
            sendMessageToSidePanel({ type: 'AGENT_RESPONSE', payload: `Error calling Gemini: ${error.message}` });
          });

          // 7. TODO: Loop/Update state (logic to continue after action execution)

        }); // End of chrome.tabs.sendMessage (SCAN_PAGE_REQUEST) callback
      }); // End of chrome.tabs.query callback
    }); // End of chrome.storage.local.get callback
    // --- End Agent Logic ---

    return true; // Indicate asynchronous response handling
  }
  // Handle other message types if needed
});

// --- Other Listeners (onInstalled, etc.) ---
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Extension installed or updated:', details);
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));
});
