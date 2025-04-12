import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
// No longer need to import annotator since we'll use the content script instead

console.log('Background script loaded.');

async function abortCheck() {
  let s = await getAgentState();
  if (!s.isRunning || s.abortRequested) {
    console.log("abortCheck triggered. Stopping current step immediately.");
    throw new Error('ABORT_CHECK');
  }
}

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

// Function to send messages to the Side Panel (fire-and-forget style for status updates)
const sendMessageToSidePanel = (message: any) => {
  chrome.runtime.sendMessage(message).catch(error => {
    // Ignore specific errors that commonly occur when the side panel isn't open or closes during operation.
    // These are generally not critical for the agent's core function if messages are just status updates.
    const knownIgnorableErrors = [
      "Could not establish connection. Receiving end does not exist.",
      "The message port closed before a response was received."
    ];
    if (error instanceof Error && !knownIgnorableErrors.includes(error.message)) {
      // Log other unexpected errors
      console.warn('Unexpected error sending message to side panel:', error.message);
    }
    // No need to log the ignored errors, as they are expected if the panel closes.
    // console.log('Side panel responded:', response); // Cannot get response with .catch() like this
    }); // End of .catch() block
}; // End of sendMessageToSidePanel function

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
  abortRequested: false, // Add a flag to track abort requests
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
  abortRequested: boolean; // Add flag to track abort requests
  currentGoal: string | null;
  history: string[]; // Simple history of actions/observations
  activeTabId: number | null;
  apiKey: string | null;
}

// Variable to hold the timeout ID for the agent loop
let agentStepTimeoutId: NodeJS.Timeout | null = null; // Correct type for Node environments

// --- Agent Loop Function ---
async function runAgentStep() {
  // Load state at the beginning of each step
  let currentState = await getAgentState();
  console.log('runAgentStep called. Current agentState:', JSON.stringify(currentState));

  // Check for abort flag first - highest priority
  if (currentState.abortRequested) {
    console.log('Agent step aborted due to abort request');
    currentState.isRunning = false;
    currentState.abortRequested = false; // Reset the abort flag
    await setAgentState(currentState);
    sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: 'Idle (Aborted)' });
    sendMessageToSidePanel({ type: 'AGENT_RESPONSE', payload: 'Task stopped by user.' });
    return;
  }

  // Check state validity
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

    // 2. Get current page state
    sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: 'Scanning page...' });
    sendMessageToSidePanel({ type: 'AGENT_ACTION_LOG', payload: 'Scanning current page content.' }); // Action Log

    // First ensure tab is fully focused and updated to guarantee permission context
    await chrome.tabs.update(activeTabId, { active: true });
    
    // Skip explicit permission checks - these are in the manifest already
    // We'll just log that we're proceeding with the permissions in the manifest
    console.log("Proceeding with manifest permissions");

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
    await abortCheck();

    // Get tab information for additional context
    const tabInfo = await chrome.tabs.get(activeTabId);
    // Try to capture screenshot with improved error handling
    sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: 'Capturing screenshot...' });
    sendMessageToSidePanel({ type: 'AGENT_ACTION_LOG', payload: 'Capturing visible part of the page.' }); // Action Log

    let screenshotDataUrl: string;
    try {
      // First try - use current window (most reliable for activeTab)
      console.log("Attempting screenshot capture with default window");
      screenshotDataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
      console.log("Screenshot captured successfully with default window");
    } catch (captureError) {
      console.warn("First capture attempt failed:", captureError);
      
      try {
        // Second try - use window ID from the tab info
        console.log("Attempting screenshot with window ID:", tabInfo.windowId);
        screenshotDataUrl = await chrome.tabs.captureVisibleTab(tabInfo.windowId, { format: 'png' });
        console.log("Screenshot captured successfully with window ID");
      } catch (secondError) {
        console.error("Both screenshot capture methods failed:", secondError);
        throw new Error(`Screenshot capture failed. Please ensure the extension has proper permissions and try again.`);
      }
    }
    
    // Process screenshot data
    const base64ImageData = screenshotDataUrl.substring(screenshotDataUrl.indexOf(',') + 1);
    await abortCheck();
    
    // Add annotations directly to the page using content script
    sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: 'Adding annotations...' });
    sendMessageToSidePanel({ type: 'AGENT_ACTION_LOG', payload: 'Adding element markers to the page.' }); // Action Log
    
    // Send message to content script to add annotations
    await sendMessageToTabPromise(activeTabId, { 
      type: 'ADD_ANNOTATIONS_REQUEST', 
      payload: pageElements 
    });
    await abortCheck();
    
    // 3. Construct multimodal prompt (goal, history, annotated screenshot, element data)
    const historyString = currentState.history.slice(-5).join('\n'); // Use currentState
    
    // Image part for multimodal prompt
    const imagePart = {
      inlineData: {
        mimeType: "image/png",
        data: base64ImageData // Use the original screenshot (annotations now visible in DOM)
      }
    };
    
    // Detailed prompt with image reference and stronger emphasis on JSON format
    const textPrompt = `User goal: ${currentGoal}
    
Recent History:
${historyString}

Current page: ${tabInfo.title || 'Unknown'} - ${tabInfo.url || 'Unknown URL'}

Current page elements (for context, use numbers in image for actions):
${pageStateString}

Analyze the attached screenshot which has interactable elements marked with numbered red boxes. Based on the goal, history, and the screenshot, what is the next single action to take? Actions can be:
- navigate (specify URL)
- click (specify element id number from the box in the screenshot)
- input (specify element id number and text)
- scroll (specify direction: up or down)
- finish (if the goal is complete)

CRITICAL INSTRUCTION: Your response MUST CONTAIN ONLY a valid JSON object without any explanatory text before or after the JSON. Do not include code blocks or backticks. Your ENTIRE response should be only the JSON object.

CORRECT RESPONSE FORMAT: {"action": "click", "elementId": 5}
INCORRECT RESPONSE FORMAT: I think we should click element 5. {"action": "click", "elementId": 5}
INCORRECT RESPONSE FORMAT: \`\`\`json {"action": "click", "elementId": 5} \`\`\`

If the goal is complete, respond with: {"action": "finish"}`;

    sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: 'Thinking...' });
    sendMessageToSidePanel({ type: 'AGENT_ACTION_LOG', payload: 'Sending page context and screenshot to AI for next action.' }); // Action Log

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

    // Check for abort request before making the potentially long-running API call
    // Refresh state to get the latest abort flag
    currentState = await getAgentState();
    if (currentState.abortRequested) {
      console.log('Agent aborting before AI request due to abort request');
      currentState.isRunning = false;
      currentState.abortRequested = false; // Reset the abort flag
      await setAgentState(currentState);
      sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: 'Idle (Aborted)' });
      sendMessageToSidePanel({ type: 'AGENT_RESPONSE', payload: 'Task stopped by user.' });
      return;
    }

    // Send both text prompt and image data for multimodal processing
    const result = await model.generateContent([textPrompt, imagePart]);
    await abortCheck();
    const response = result.response;
    const agentResponseText = response.text().trim();
    console.log('Gemini SDK Success Response Text:', agentResponseText);
    
    // Remove annotations after AI has processed the screenshot
    sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: 'Removing annotations...' });
    await sendMessageToTabPromise(activeTabId, { 
      type: 'REMOVE_ANNOTATIONS_REQUEST' 
    });
    
    // Helper function to extract JSON from Gemini's response
    function extractJsonFromResponse(response: string): string | null {
      // Pattern 1: Match JSON inside code blocks (```json {...} ```)
      const codeBlockMatch = response.match(/```(?:json)?([^`]*?{.*?})[^`]*?```/s);
      if (codeBlockMatch && codeBlockMatch[1]) {
        console.log('Found JSON in code block format');
        return codeBlockMatch[1].trim();
      }
      
      // Pattern 2: Direct JSON object pattern
      const jsonObjectMatch = response.match(/{[\s\S]*"action"[\s\S]*}/);
      if (jsonObjectMatch) {
        console.log('Found direct JSON object format');
        return jsonObjectMatch[0];
      }
      
      // Pattern 3: Try the original basic cleanup as a last resort
      const cleanedForJson = response.replace(/^```json\s*|\s*```$/g, '').trim();
      if (cleanedForJson.startsWith('{') && cleanedForJson.endsWith('}')) {
        console.log('Found JSON after basic cleanup');
        return cleanedForJson;
      }
      
      return null;
    }
    
    // 5. Parse Gemini response
    let actionCommand: ActionCommand | null = null;
    if (!agentResponseText) throw new Error('Received empty response from Gemini.');

    try {
      const extractedJson = extractJsonFromResponse(agentResponseText);
      if (!extractedJson) {
        throw new Error('No valid JSON found in response');
      }
      
      console.log('Extracted JSON:', extractedJson);
      const parsedJson = JSON.parse(extractedJson);
      if (parsedJson && typeof parsedJson === 'object' && typeof parsedJson.action === 'string') {
         actionCommand = parsedJson as ActionCommand;
         console.log('Parsed action command:', actionCommand);
      } else { throw new Error('Invalid action format received from Gemini.'); }
    } catch (parseError: any) {
      console.error('JSON parsing error:', parseError);
      throw new Error(`Could not parse action from Gemini. Response: ${agentResponseText}`);
    }
    await abortCheck();

    // --- Action Handling ---
    if (!actionCommand) throw new Error('Action command is null after parsing attempt.');

    currentState.history.push(`Action: ${JSON.stringify(actionCommand)}`); // Add action to history
    await setAgentState(currentState); // Save state

    // Handle 'finish' action
    if (actionCommand.action === 'finish') {
      console.log('Agent finished goal.');
      sendMessageToSidePanel({ type: 'AGENT_ACTION_LOG', payload: 'AI determined the goal is complete.' }); // Action Log
      sendMessageToSidePanel({ type: 'AGENT_RESPONSE', payload: 'Task finished.' });
      currentState.isRunning = false;
      sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: 'Idle (Finished)' });
      await setAgentState(currentState); // Save final state
      return; // Stop the loop
    }

    // Handle 'navigate' action (special case handled by background script)
    if (actionCommand.action === 'navigate' && actionCommand.url) {
       const targetUrl = actionCommand.url;
       sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: `Navigating...` });
       sendMessageToSidePanel({ type: 'AGENT_ACTION_LOG', payload: `Navigating to ${targetUrl}` }); // Action Log
       // Verify before navigate
       await verifyTabExists(activeTabId);
       await chrome.tabs.update(activeTabId, { url: actionCommand.url });
       // TODO: Need to wait for navigation to complete properly before next step
       // For now, just proceed after a delay. The state is saved before returning.
       setTimeout(runAgentStep, 3000); // Wait 3s then trigger next step check
       return;
    }

    // 6. Execute other actions using promisified helper
    const actionDetail = JSON.stringify(actionCommand);
    sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: `Executing: ${actionCommand.action}...` });
    sendMessageToSidePanel({ type: 'AGENT_ACTION_LOG', payload: `Executing action: ${actionDetail}` }); // Action Log
    // Verify before executing action
    await verifyTabExists(activeTabId);
    const execResponse = await sendMessageToTabPromise(activeTabId, { type: 'EXECUTE_ACTION_REQUEST', payload: actionCommand });
    
    // Error handling is now done via catch block below
    console.log('Action execution response:', execResponse);
    currentState.history.push(`Result: ${JSON.stringify(execResponse)}`); // Add result to history
    await setAgentState(currentState); // Save state
    await abortCheck();

    // 7. Loop: Trigger next step
    // Still using setTimeout for simplicity, but state is persisted now.
    if (currentState.isRunning) { // Check if still running
       // Small delay before next step
       // Clear any previous timeout before setting a new one
       if (agentStepTimeoutId) {
         clearTimeout(agentStepTimeoutId);
       }
       agentStepTimeoutId = setTimeout(runAgentStep, 500);
    } else {
       // Clear timeout if stopped for other reasons
       if (agentStepTimeoutId) {
         clearTimeout(agentStepTimeoutId);
         agentStepTimeoutId = null;
       }
       sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: 'Idle (Stopped)' });
    }

  } catch (error: any) {
    console.error('Error during agent step:', error);
    const errorMessage = error.message || 'An unknown error occurred.';
    // Send specific error message as agent response
    sendMessageToSidePanel({ type: 'AGENT_RESPONSE', payload: `Agent Error: ${errorMessage}` });

    // --- Trigger Intervention Request on Error (Example) ---
    // In a real scenario, the agent logic would decide if intervention is needed based on the error type.
    // For now, we trigger it on any error during the step.
    sendMessageToSidePanel({
      type: 'AGENT_INTERVENTION_NEEDED',
      payload: `The agent encountered an error: ${errorMessage}. Please check the page or console for details.`
    });
    // ---------------------------------------------------------

    // Load the latest state before modifying and saving
    let latestState = await getAgentState();
    latestState.isRunning = false; // Stop the agent loop on error
    await setAgentState(latestState);
    // Status is updated by the AGENT_INTERVENTION_NEEDED message handler in App.tsx
    // sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: 'Idle (Error - Intervention Needed)' });
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
         abortRequested: false, // Initialize abort flag
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
        console.log("Loading API key and active tab...", { storageResult, tabs });
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
  } else if (message.type === 'END_TASK') {
  // Handle request to stop the agent
  (async () => {
    console.log('Received END_TASK request.');
    sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: 'Stopping agent...' });
    
    // Clear any pending timeout first
    if (agentStepTimeoutId) {
      clearTimeout(agentStepTimeoutId);
      agentStepTimeoutId = null;
      console.log('Cleared pending agent step timeout.');
    }
    
    try {
      // Get and update agent state
      const currentState = await getAgentState();
      
      if (currentState.isRunning) {
        // Set abort flag immediately
        currentState.abortRequested = true;
        await setAgentState(currentState);
        console.log('Abort flag set - agent will stop at next opportunity');
        
        // Also set isRunning to false to prevent scheduling new steps
        currentState.isRunning = false;
        await setAgentState(currentState);
        console.log('Agent stopped by user.');
        
        // Notify UI
        sendMessageToSidePanel({ type: 'AGENT_STATUS_UPDATE', payload: 'Idle (Stopped by User)' });
        sendMessageToSidePanel({ type: 'AGENT_ACTION_LOG', payload: 'Task ended by user.' });
        
        // Send response
        sendResponse({ status: 'Agent stopping...' });
      } else {
        console.log('Agent was not running.');
        sendResponse({ status: 'Agent already stopped.' });
      }
    } catch (error) {
      console.error('Error stopping agent:', error);
      sendResponse({ status: 'Error stopping agent' });
    }
    })();
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