// Define shared interface (Ideally move to a shared/types.ts file later)
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

// Helper function to load an image from a data URL into an ImageBitmap
function loadImage(dataUrl: string): Promise<ImageBitmap> {
  return new Promise(async (resolve, reject) => {
    try {
      // Service workers don't have direct access to DOM Image elements.
      // We need to fetch the data URL, convert it to a blob, then use createImageBitmap.
      const response = await fetch(dataUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch data URL: ${response.statusText}`);
      }
      const blob = await response.blob();
      createImageBitmap(blob).then(resolve).catch(reject);
    } catch (error) {
      console.error("Error loading image from data URL:", error);
      reject(error);
    }
  });
}

// Function to draw annotations and return base64 image data
export async function createAnnotatedScreenshot(
  screenshotDataUrl: string,
  elements: InteractableElement[]
): Promise<string> {
  try {
    const image = await loadImage(screenshotDataUrl);
    // Use OffscreenCanvas, available in service workers
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Could not get OffscreenCanvas 2D context');
    }

    // Draw the original screenshot onto the canvas
    ctx.drawImage(image, 0, 0);

    // --- Draw Annotations ---
    const fontSize = 12; // Adjust size as needed
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 2;
    ctx.fillStyle = 'red'; // Background color for text label

    elements.forEach(el => {
      // Draw bounding box rectangle
      ctx.strokeRect(el.x, el.y, el.width, el.height);

      // Prepare text label (element ID)
      const text = el.id.toString();
      const textMetrics = ctx.measureText(text);
      const textWidth = textMetrics.width;
      const textHeight = fontSize; // Approximation
      const padding = 3;

      // Calculate position for the background rectangle (top-left corner)
      const bgX = el.x + padding;
      const bgY = el.y + padding;
      const bgWidth = textWidth + padding * 2;
      const bgHeight = textHeight + padding;

      // Draw background rectangle
      ctx.fillRect(bgX, bgY, bgWidth, bgHeight);

      // Draw text label (white color) on top of the background
      ctx.fillStyle = 'white';
      // Adjust y position for text baseline alignment
      ctx.fillText(text, bgX + padding, bgY + textHeight);

      // Reset fill style for the next element's background
      ctx.fillStyle = 'red';
    });
    // --- End Annotations ---

    // Convert the annotated canvas back to a PNG data URL
    // Note: OffscreenCanvas.convertToBlob is preferred but might be complex with async flow here.
    // Using toDataURL directly if available, otherwise need alternative for workers.
    // For simplicity, assuming direct conversion or polyfill might be needed if OffscreenCanvas lacks toDataURL.
    // Let's assume conversion to Blob first, then read as Data URL.

    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });

  } catch (error) {
    console.error("Error creating annotated screenshot:", error);
    // Fallback: return original screenshot URL if annotation fails
    return screenshotDataUrl;
  }
}
