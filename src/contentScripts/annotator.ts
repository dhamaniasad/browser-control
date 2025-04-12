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

// Constant for the container element used to hold highlights
const HIGHLIGHT_CONTAINER_ID = "browser-control-highlight-container";

// Store references to created elements for removal
let annotationContainer: HTMLElement | null = null;
let scrollEventListener: (() => void) | null = null;
let resizeEventListener: (() => void) | null = null;

// Function to highlight a specific element
function highlightElement(element: HTMLElement, index: number, rect: DOMRect): void {
  if (!annotationContainer) return;

  // Determine color based on index; the color array repeats as needed
  const colors = [
    "#FF0000", "#00FF00", "#0000FF", "#FFA500",
    "#800080", "#008080", "#FF69B4", "#4B0082",
    "#FF4500", "#2E8B57", "#DC143C", "#4682B4"
  ];
  const colorIndex = index % colors.length;
  const baseColor = colors[colorIndex];
  const backgroundColor = baseColor + "1A"; // 10% opacity

  // Create the overlay (bounding box) element
  const overlay = document.createElement("div");
  overlay.className = "browser-control-annotation-overlay";
  overlay.style.position = "fixed";
  overlay.style.border = `2px solid ${baseColor}`;
  overlay.style.backgroundColor = backgroundColor;
  overlay.style.pointerEvents = "none";
  overlay.style.boxSizing = "border-box";
  overlay.style.zIndex = "2147483646"; // One less than container
  
  // Position the overlay
  overlay.style.top = `${rect.top}px`;
  overlay.style.left = `${rect.left}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;

  // Create a label to display the highlight index
  const label = document.createElement("div");
  label.className = "browser-control-annotation-label";
  label.style.position = "fixed";
  label.style.background = baseColor;
  label.style.color = "white";
  label.style.padding = "1px 4px";
  label.style.borderRadius = "4px";
  label.style.fontSize = `${Math.min(12, Math.max(8, rect.height / 2))}px`;
  label.style.zIndex = "2147483647";
  label.style.pointerEvents = "none";
  label.textContent = index.toString();

  // Determine label position
  const labelWidth = 20;
  const labelHeight = 16;
  let labelTop = rect.top + 2;
  let labelLeft = rect.left + rect.width - labelWidth - 2;

  // If the element is too small, position the label above the overlay
  if (rect.width < labelWidth + 4 || rect.height < labelHeight + 4) {
    labelTop = rect.top - labelHeight - 2;
    labelLeft = rect.left + rect.width - labelWidth;
  }
  label.style.top = `${labelTop}px`;
  label.style.left = `${labelLeft}px`;

  // Add to container
  annotationContainer.appendChild(overlay);
  annotationContainer.appendChild(label);
}

// Function to add annotation overlays to the DOM
function addAnnotations(elements: InteractableElement[]): number {
  try {
    // Create container for annotations if it doesn't exist
    if (!annotationContainer) {
      annotationContainer = document.getElementById(HIGHLIGHT_CONTAINER_ID) as HTMLElement;
      if (!annotationContainer) {
        annotationContainer = document.createElement("div");
        annotationContainer.id = HIGHLIGHT_CONTAINER_ID;
        annotationContainer.style.position = "fixed";
        annotationContainer.style.pointerEvents = "none";
        annotationContainer.style.top = "0";
        annotationContainer.style.left = "0";
        annotationContainer.style.width = "100%";
        annotationContainer.style.height = "100%";
        annotationContainer.style.zIndex = "2147483647";
        document.body.appendChild(annotationContainer);
      }
    }
    
    // Map interactable elements to DOM elements
    const domElements: Array<{element: HTMLElement, rect: DOMRect, id: number}> = [];
    
    elements.forEach(el => {
      // Find the element by position
      const elementsAtPoint = document.elementsFromPoint(el.x + el.width/2, el.y + el.height/2);
      if (elementsAtPoint.length > 0) {
        const element = elementsAtPoint[0] as HTMLElement;
        const rect = new DOMRect(el.x, el.y, el.width, el.height);
        domElements.push({element, rect, id: el.id});
      }
    });
    
    // Highlight each element
    domElements.forEach(({element, rect, id}) => {
      highlightElement(element, id, rect);
    });
    
    // Create function to update annotations on scroll/resize
    const updateAnnotations = () => {
      if (!annotationContainer) return;
      
      // Clear existing annotations
      annotationContainer.innerHTML = '';
      
      // Re-add annotations with updated positions
      domElements.forEach(({element, rect, id}) => {
        // Get updated rect
        const newRect = element.getBoundingClientRect();
        highlightElement(element, id, newRect);
      });
    };
    
    // Remove any existing event listeners
    if (scrollEventListener) {
      window.removeEventListener('scroll', scrollEventListener);
    }
    if (resizeEventListener) {
      window.removeEventListener('resize', resizeEventListener);
    }
    
    // Add event listeners for scroll and resize
    scrollEventListener = updateAnnotations;
    resizeEventListener = updateAnnotations;
    window.addEventListener('scroll', scrollEventListener, { passive: true });
    window.addEventListener('resize', resizeEventListener, { passive: true });
    
    return elements.length;
  } catch (error) {
    console.error('Error adding annotations:', error);
    return 0;
  }
}

// Function to remove all annotation elements
function removeAnnotations(): boolean {
  try {
    // Remove event listeners
    if (scrollEventListener) {
      window.removeEventListener('scroll', scrollEventListener);
      scrollEventListener = null;
    }
    if (resizeEventListener) {
      window.removeEventListener('resize', resizeEventListener);
      resizeEventListener = null;
    }
    
    // Remove container
    if (annotationContainer && annotationContainer.parentNode) {
      annotationContainer.parentNode.removeChild(annotationContainer);
      annotationContainer = null;
    }
    
    return true;
  } catch (error) {
    console.error('Error removing annotations:', error);
    return false;
  }
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
