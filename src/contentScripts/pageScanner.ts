console.log('Content Script: pageScanner.ts loaded');

interface InteractableElement {
  id: number; // Temporary ID for this scan
  tag: string;
  text?: string; // Inner text or accessible name
  attributes: { [key: string]: string }; // Key attributes like id, name, class, placeholder, aria-label
  // Add position/size for visual identification
  x: number;
  y: number;
  width: number;
  height: number;
}

// Function to extract relevant attributes
const getElementAttributes = (element: Element): { [key: string]: string } => {
  const attrs: { [key: string]: string } = {};
  const relevantAttrs = ['id', 'name', 'class', 'placeholder', 'aria-label', 'role', 'type', 'href', 'title'];
  relevantAttrs.forEach(attrName => {
    const value = element.getAttribute(attrName);
    if (value) {
      attrs[attrName] = value;
    }
  });
  return attrs;
};

// Function to get accessible name (simplified)
const getAccessibleName = (element: Element): string | undefined => {
  if (element.getAttribute('aria-label')) {
    return element.getAttribute('aria-label') ?? undefined;
  }
  if ((element as HTMLElement).innerText?.trim()) {
    return (element as HTMLElement).innerText.trim().substring(0, 100); // Limit length
  }
  if (element.getAttribute('title')) {
    return element.getAttribute('title') ?? undefined;
  }
   if ((element as HTMLInputElement).placeholder) {
    return (element as HTMLInputElement).placeholder;
  }
  return undefined;
}

// Function to scan the page and identify elements
const scanPage = (): InteractableElement[] => {
  const interactableElements: InteractableElement[] = [];
  let currentId = 1;

  // Select common interactable elements + elements with roles
  const elements = document.querySelectorAll<HTMLElement>(
    'a, button, input:not([type="hidden"]), textarea, select, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="textbox"], [role="combobox"], [role="menuitem"]'
  );

  elements.forEach(element => {
    // Basic visibility check (might need refinement)
    if (element.offsetWidth > 0 && element.offsetHeight > 0) {
       const bounds = element.getBoundingClientRect();
       if (bounds.top >= 0 && bounds.left >= 0 && bounds.bottom <= window.innerHeight && bounds.right <= window.innerWidth) {
          const elementData: InteractableElement = {
            id: currentId++,
            tag: element.tagName.toLowerCase(),
            text: getAccessibleName(element),
            attributes: getElementAttributes(element),
            x: Math.round(bounds.left), // Use integer coordinates
            y: Math.round(bounds.top),
            width: Math.round(bounds.width),
            height: Math.round(bounds.height),
          };
          // Filter out tiny elements that might just be layout artifacts
          if (elementData.width > 5 && elementData.height > 5) {
             interactableElements.push(elementData);
          } else {
             currentId--; // Don't increment ID for ignored elements
          }
       }
    }
  });

  console.log('pageScanner identified elements:', interactableElements);
  return interactableElements;
};

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('pageScanner received message:', message);
  if (message.type === 'SCAN_PAGE_REQUEST') {
    const elements = scanPage();
    // Send the identified elements back to the background script
    sendResponse({ type: 'SCAN_PAGE_RESPONSE', payload: elements });
  }
  // Return true if you intend to send an asynchronous response (although scanPage is synchronous here)
  // return true;
});

// Initial scan on load (optional, might be better triggered by background)
// scanPage();
