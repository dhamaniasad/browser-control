import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '../tailwind-full.css'; // Import full Tailwind CSS with no purging

// Find the root element defined in index.html
const rootElement = document.getElementById('root');

if (rootElement) {
  // Create a React root and render the App component
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} else {
  console.error("Could not find root element with ID 'root'");
}
