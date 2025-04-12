import React from 'react';
import ReactDOM from 'react-dom/client';
import OptionsApp from './OptionsApp';
// Optional: Import a global CSS file if needed
// import './options.css';

// Find the root element defined in options.html
const rootElement = document.getElementById('root-options');

if (rootElement) {
  // Create a React root and render the OptionsApp component
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <OptionsApp />
    </React.StrictMode>
  );
} else {
  console.error("Could not find root element with ID 'root-options'");
}
