import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { createAnnotatedScreenshot } from "./annotator"; // Import the annotator function

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

// Helper function to promisify chrome.tabs.sendMessage and check lastError
function sendMessageToTabPromise(tabId: number, message: any): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// Helper to verify tab exists before interacting
async function verifyTabExists(tabId: number): Promise<void> {
   try {
      await chrome.tabs.get(tabId);
   } catch (error: any) {
      // Rethrow a more specific error if tab not found
      throw new Error(`Target tab ${tabId} not found or inaccessible: ${error.message}`);
   }
}

// --- Agent State Storage (Using chrome.storage.session) ---
const AGENT_STATE_KEY = 'agentState';

// Default initial state
const initialAgentState: AgentState = {
  isRunning: false,
  currentGoal: null,
  history: [],
  activeTabId: null,
  apiKey: null,
};

// Function to get the current agent state from session storage
async function getAgentState(): Promise<AgentState> {
  try {
    const result = await chrome.storage.session.get(AGENT_STATE_KEY);
    // Return stored state or initial state if not found
    return result[AGENT_STATE_KEY] || { ...initialAgentState };
  } catch (error) {
    console.error("Error getting agent state:", error);
    return { ...initialAgentState }; // Return initial state on error
  }
}

// Function to save the agent state to session storage
async function setAgentState(newState: AgentState): Promise<void> {
  try {
    await chrome.storage.session.set({ [AGENT_STATE_KEY]: newState });
    console.log("Agent state saved:", newState);
  } catch (error) {
    console.error("Error setting agent state:", error);
  }
}

// Remove the global in-memory state variable
// let agentState: AgentState = { ...initialAgentState };
interface AgentState {
  isRunning: boolean;
  currentGoal: string | null;
  history: string[]; // Simple history of actions/observations
  activeTabId: number | null;
  apiKey: string | null;
}

// --- Agent Loop Function ---
async function runAgentStep() {
  // Load state at the beginning of each step
  let currentState = await getAgentState();
  console.log('runAgentStep called. Current agentState:', JSON.stringify(currentState));

  // Check state validity after loading
  if (!currentState.isRunning || !currentState.currentGoal || !currentState.apiKey || !currentState.activeTabId) {
    console.log('Agent step skipped: Not running or missing required state. isRunning:', currentState.isRunning, 'hasGoal:', !!currentState.currentGoal, 'hasApiKey:', !!currentState.apiKey, 'hasTabId:', !!currentState.activeTabId);
    // If state is invalid but was supposed to be running, reset it
    if (currentState.isRunning) {
       currentState.isRunning = false;
       await setAgentState(currentState);
    }
    sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: 'Idle (Error: Invalid State)' });
    return;
  }

  // Use loaded state
  const currentGoal = currentState.currentGoal;
  const apiKey = currentState.apiKey;
  const activeTabId = currentState.activeTabId;

  try {
    // Initial verification
    await verifyTabExists(activeTabId);

    // 2. Get current page state (scan + screenshot)
    sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: 'Scanning page & capturing screenshot...' });

    // Verify before capture
    await verifyTabExists(activeTabId);
    // Revert to using activeTabId for capture
    const screenshotDataUrl = await chrome.tabs.captureVisibleTab(activeTabId, { format: 'png' });
    const base64ImageData = screenshotDataUrl.substring(screenshotDataUrl.indexOf(',') + 1);

    // Verify before scan
    await verifyTabExists(activeTabId);
    const scanResponse = await sendMessageToTabPromise(activeTabId, { type: 'SCAN_PAGE_REQUEST' });
    // No need for separate check here, sendMessageToTabPromise handles lastError
    if (scanResponse?.type !== 'SCAN_PAGE_RESPONSE') throw new Error('Invalid response type from page scanner.');
    const pageElements = scanResponse.payload;
    console.log('Received page elements:', pageElements);
    const pageStateString = JSON.stringify(pageElements, null, 2);
    currentState.history.push(`Observation: Page scanned. ${pageElements.length} elements found.`);
    // Save state immediately after modifying history (important!)
    await setAgentState(currentState);

    // --- Create Annotated Screenshot ---
    sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: 'Annotating screenshot...' });
    const annotatedImageData = await createAnnotatedScreenshot(screenshotDataUrl, pageElements);
    // ---

    // 3. Construct prompt with ANNOTATED image and element data
    const historyString = currentState.history.slice(-5).join('\n'); // Use currentState
    const imagePart = {
      inlineData: {
        mimeType: "image/png",
        data: annotatedImageData // Use annotated image data
      }
    };
    // Update prompt to refer to numbered boxes
    // Note: Still sending full element JSON might exceed token limits. Consider summarizing.
    const textPrompt = `User goal: ${currentGoal}\n\nRecent History:\n${historyString}\n\nCurrent page elements (for context, use numbers in image for actions):\n${pageStateString}\n\nAnalyze the attached screenshot which has interactable elements marked with numbered red boxes. Based on the goal, history, and the screenshot, what is the next single action to take? Actions can be navigate, click (specify element id number from the box in the screenshot), input (specify element id number and text), scroll, or finish. Respond ONLY with a JSON object like {"action": "...", "elementId": <number>, "text": "..."}. If the goal is complete, respond with {"action": "finish"}.`;

    sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: 'Calling Gemini API...' });

    // 4. Call Gemini API (multimodal with annotated image)
    const genAI = new GoogleGenerativeAI(apiKey);
    // Use the requested gemini-2.0-flash model
    const model = genAI.getGenerativeModel({
       model: "gemini-2.0-flash", // Updated model name
       safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
       ],
    });

    // Send both text prompt and image data
    const result = await model.generateContent([textPrompt, imagePart]);
    const response = result.response;
    const agentResponseText = response.text().trim();
    console.log('Gemini SDK Success Response Text:', agentResponseText);

    // 5. Parse Gemini response
    let actionCommand: ActionCommand | null = null;
    if (!agentResponseText) throw new Error('Received empty response from Gemini.');

    try {
      const cleanedJsonString = agentResponseText.replace(/^```json\s*|\s*```$/g, '');
      const parsedJson = JSON.parse(cleanedJsonString);
      if (parsedJson && typeof parsedJson === 'object' && typeof parsedJson.action === 'string') {
         actionCommand = parsedJson as ActionCommand;
         console.log('Parsed action command:', actionCommand);
      } else { throw new Error('Invalid action format received from Gemini.'); }
    } catch (parseError: any) {
      throw new Error(`Could not parse action from Gemini. Response: ${agentResponseText}`);
    }

    // --- Action Handling ---
    if (!actionCommand) throw new Error('Action command is null after parsing attempt.');

    currentState.history.push(`Action: ${JSON.stringify(actionCommand)}`); // Add action to history
    await setAgentState(currentState); // Save state

    // Handle 'finish' action
    if (actionCommand.action === 'finish') {
      console.log('Agent finished goal.');
      sendMessageToSidePanel({ type: 'AGENT_RESPONSE', payload: 'Task finished.' });
      currentState.isRunning = false;
      sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: 'Idle (Finished)' });
      await setAgentState(currentState); // Save final state
      return; // Stop the loop
    }

    // Handle 'navigate' action (special case handled by background script)
    if (actionCommand.action === 'navigate' && actionCommand.url) {
       sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: `Navigating to ${actionCommand.url}...` });
       // Verify before navigate
       await verifyTabExists(activeTabId);
       await chrome.tabs.update(activeTabId, { url: actionCommand.url });
       // TODO: Need to wait for navigation to complete properly before next step
       // For now, just proceed after a delay. The state is saved before returning.
       setTimeout(runAgentStep, 3000); // Wait 3s then trigger next step check
       return;
    }

    // 6. Execute other actions using promisified helper
    sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: `Executing action: ${actionCommand.action}...` });
    // Verify before executing action
    await verifyTabExists(activeTabId);
    const execResponse = await sendMessageToTabPromise(activeTabId, { type: 'EXECUTE_ACTION_REQUEST', payload: actionCommand });

    // Error handling is now done via catch block below
    console.log('Action execution response:', execResponse);
    currentState.history.push(`Result: ${JSON.stringify(execResponse)}`); // Add result to history
    await setAgentState(currentState); // Save state

    // 7. Loop: Trigger next step
    // Still using setTimeout for simplicity, but state is persisted now.
    if (currentState.isRunning) { // Check if still running
       // Small delay before next step
       setTimeout(runAgentStep, 500);
    } else {
       sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: 'Idle (Stopped)' });
    }

  } catch (error: any) {
    console.error('Error during agent step:', error);
    sendMessageToSidePanel({ type: 'AGENT_RESPONSE', payload: `Agent Error: ${error.message}` });
    // Load the latest state before modifying and saving
    let latestState = await getAgentState();
    latestState.isRunning = false; // Stop on error
    await setAgentState(latestState);
    sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: 'Idle (Error)' });
  }
}


// --- Message Listener ---
// Make the listener async to await getAgentState
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message, 'from:', sender);

  if (message.type === 'USER_GOAL') {
    // Use an async IIFE to handle the async logic within the synchronous listener
    (async () => {
      // Load state first to check if already running
      const currentState = await getAgentState();
      if (currentState.isRunning) {
         sendResponse({ status: 'Agent already running. Please wait.' });
         return; // Don't start a new task if one is running
      }

      const userGoal = message.payload;
      console.log('Received user goal:', userGoal);
      sendResponse({ status: 'Goal received, starting agent...' });

      // --- Initialize Agent State in Storage ---
      // Define initialState within this scope
      const initialState: AgentState = {
         isRunning: true, // Set to running
         currentGoal: userGoal,
         history: [`User Goal: ${userGoal}`],
         activeTabId: null, // Will be set below
         apiKey: null, // Will be set below
      };

      sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: 'Initializing...' });

      // Get API Key and Active Tab ID, then save initial state and start loop
      Promise.all([
         chrome.storage.local.get([API_KEY_STORAGE_KEY]), // Still get API key from local storage
         chrome.tabs.query({ active: true, currentWindow: true })
      ]).then(async ([storageResult, tabs]) => { // Make callback async
         // Check API Key
         if (chrome.runtime.lastError) throw new Error(`Loading API key failed: ${chrome.runtime.lastError.message}`);
         const apiKey = storageResult[API_KEY_STORAGE_KEY];
         if (!apiKey) throw new Error('API Key not set. Please set it in the extension options.');
         initialState.apiKey = apiKey; // Update local initialState object
         console.log('API Key loaded successfully.');

         // Check Active Tab
         if (tabs.length === 0 || tabs[0].id === undefined) throw new Error('Could not find active browser tab.');
         initialState.activeTabId = tabs[0].id; // Update local initialState object
         console.log('Active tab found:', initialState.activeTabId);

         // Save the fully initialized state to session storage
         await setAgentState(initialState);

         // Start the first step of the agent loop
         runAgentStep();

      }).catch(async (error: any) => { // Make catch async
         console.error("Initialization failed:", error);
         sendMessageToSidePanel({ type: 'AGENT_RESPONSE', payload: `Initialization failed: ${error.message}` });
         // Ensure agent state is marked as not running in storage on init failure
         // Load the potentially partially saved state before marking as not running
         const stateToUpdate = await getAgentState();
         stateToUpdate.isRunning = false;
         await setAgentState(stateToUpdate);
         sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: 'Idle (Error)' });
      });
   })(); // End of async IIFE

    return true; // Indicate asynchronous response handling for the message listener
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
