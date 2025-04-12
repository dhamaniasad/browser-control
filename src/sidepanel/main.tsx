import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Optional: Import a global CSS file if needed
// import './index.css';

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
