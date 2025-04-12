import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '../styles.css'; // Import our custom CSS instead of Tailwind
// import '../index.css'; // Keep for when Tailwind is fixed

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
