console.log('Content Script: actionExecutor.ts loaded');

// Re-use or redefine the ActionCommand interface (or import from a shared file later)
interface ActionCommand {
  action: string;
  elementId?: number;
  text?: string;
  direction?: 'up' | 'down';
  url?: string; // Although navigate is handled by background script
}

// Helper function to find an element based on the temporary ID assigned by pageScanner
// NOTE: This relies on the DOM structure not changing significantly between scan and execution.
// A more robust approach might involve stable selectors or re-scanning within this script.
const findElementByScanId = (targetId: number): HTMLElement | null => {
  let currentId = 1;
  const elements = document.querySelectorAll<HTMLElement>(
    'a, button, input:not([type="hidden"]), textarea, select, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="textbox"], [role="combobox"], [role="menuitem"]'
  );

  for (const element of elements) {
    // Re-apply the same visibility/viewport logic as the scanner
    if (element.offsetWidth > 0 && element.offsetHeight > 0) {
       const bounds = element.getBoundingClientRect();
       if (bounds.top >= 0 && bounds.left >= 0 && bounds.bottom <= window.innerHeight && bounds.right <= window.innerWidth) {
          if (currentId === targetId) {
            return element; // Found the element with the matching temporary ID
          }
          currentId++;
       }
    }
  }
  return null; // Element not found
};


// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('actionExecutor received message:', message);

  if (message.type === 'EXECUTE_ACTION_REQUEST') {
    const command = message.payload as ActionCommand;
    console.log('Executing action:', command);

    try {
      let result: any = { success: false, message: `Action '${command.action}' not implemented yet.` };

      // Actions requiring an elementId
      if (command.elementId !== undefined) {
        const targetElement = findElementByScanId(command.elementId);
        if (!targetElement) {
          throw new Error(`Element with ID ${command.elementId} not found or not visible.`);
        }

        // Highlight the element briefly (optional visual feedback)
        const originalOutline = targetElement.style.outline;
        targetElement.style.outline = '2px solid red';
        setTimeout(() => { targetElement.style.outline = originalOutline; }, 500);


        switch (command.action) {
          case 'click':
            targetElement.click();
            result = { success: true, message: `Clicked element ${command.elementId}` };
            break;

          case 'input':
            if (typeof command.text !== 'string') {
              throw new Error(`Input action requires 'text' property.`);
            }
            if (targetElement instanceof HTMLInputElement || targetElement instanceof HTMLTextAreaElement || targetElement instanceof HTMLSelectElement) {
               // Focus, clear existing value (optional), set new value, blur (optional)
               targetElement.focus();
               targetElement.value = command.text;
               targetElement.blur();
               // Optionally dispatch input/change events if needed by the page's JS
               targetElement.dispatchEvent(new Event('input', { bubbles: true }));
               targetElement.dispatchEvent(new Event('change', { bubbles: true }));
               result = { success: true, message: `Input text into element ${command.elementId}` };
            } else {
               throw new Error(`Element ${command.elementId} is not an input, textarea, or select element.`);
            }
            break;

          default:
             result.message = `Action '${command.action}' targeting an element is not implemented.`;
             console.warn(result.message);
        }

      } else { // Actions not requiring an elementId
         switch (command.action) {
            case 'scroll':
               const direction = command.direction === 'up' ? -1 : 1;
               window.scrollBy(0, window.innerHeight * direction * 0.8); // Scroll 80% of viewport height
               result = { success: true, message: `Scrolled window ${command.direction}` };
               break;

            // 'navigate' is handled by the background script
            // 'finish' would likely be handled by the background script state machine

            default:
               result.message = `Action '${command.action}' without an elementId is not implemented or handled elsewhere.`;
               console.warn(result.message);
         }
      }

      console.log('Action result:', result);
      sendResponse(result);

    } catch (error: any) {
      console.error('Error executing action:', command.action, error);
      sendResponse({ success: false, message: error.message });
    }

    // Return true because we are sending the response asynchronously (potentially after setTimeout for highlight)
    return true;
  }
});
