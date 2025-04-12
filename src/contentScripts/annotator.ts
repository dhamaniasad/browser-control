console.log('Content Script: annotator.ts loaded');

interface InteractableElement {
  id: number;
  tag: string;
  text?: string;
  attributes: { [key: string]: string };
  x: number;
  y: number;
  width: number;
  height: number;
}

// Store the created annotation elements for later removal
let annotationElements: HTMLElement[] = [];

// Function to add annotation overlays to the DOM
function addAnnotations(elements: InteractableElement[]) {
  // Create a style element for our annotations if it doesn't exist
  let styleElement = document.getElementById('browser-control-annotation-styles');
  if (!styleElement) {
    styleElement = document.createElement('style');
    styleElement.id = 'browser-control-annotation-styles';
    styleElement.textContent = `
      .browser-control-annotation {
        position: absolute;
        border: 2px solid red;
        z-index: 10000;
        pointer-events: none;
        box-sizing: border-box;
      }
      .browser-control-annotation-label {
        position: absolute;
        background-color: red;
        color: white;
        font-weight: bold;
        font-family: sans-serif;
        font-size: 12px;
        padding: 2px 4px;
        z-index: 10001;
        pointer-events: none;
        top: 0;
        left: 0;
        margin: 3px;
      }
    `;
    document.head.appendChild(styleElement);
    annotationElements.push(styleElement);
  }

  // Create annotation elements for each interactable element
  elements.forEach(el => {
    // Create box
    const box = document.createElement('div');
    box.className = 'browser-control-annotation';
    box.style.top = `${el.y}px`;
    box.style.left = `${el.x}px`;
    box.style.width = `${el.width}px`;
    box.style.height = `${el.height}px`;
    
    // Create label
    const label = document.createElement('div');
    label.className = 'browser-control-annotation-label';
    label.textContent = el.id.toString();
    
    // Add to DOM
    box.appendChild(label);
    document.body.appendChild(box);
    annotationElements.push(box);
  });

  return annotationElements.length;
}

// Function to remove all annotation elements
function removeAnnotations() {
  annotationElements.forEach(el => {
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  });
  annotationElements = [];
  return true;
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Annotator received message:', message);
  
  if (message.type === 'ADD_ANNOTATIONS_REQUEST') {
    try {
      const count = addAnnotations(message.payload);
      sendResponse({ 
        type: 'ADD_ANNOTATIONS_RESPONSE', 
        success: true, 
        count: count 
      });
    } catch (error) {
      console.error('Error adding annotations:', error);
      sendResponse({ 
        type: 'ADD_ANNOTATIONS_RESPONSE', 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
    return true; // Indicate async response
  }
  
  if (message.type === 'REMOVE_ANNOTATIONS_REQUEST') {
    try {
      const success = removeAnnotations();
      sendResponse({ 
        type: 'REMOVE_ANNOTATIONS_RESPONSE', 
        success: success 
      });
    } catch (error) {
      console.error('Error removing annotations:', error);
      sendResponse({ 
        type: 'REMOVE_ANNOTATIONS_RESPONSE', 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
    return true; // Indicate async response
  }
});
