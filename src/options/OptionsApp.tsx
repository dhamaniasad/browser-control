import React, { useState, useEffect } from 'react';

// Optional: Import styles if needed
// import './OptionsApp.css';

const API_KEY_STORAGE_KEY = 'gemini_api_key';

function OptionsApp() {
  const [apiKey, setApiKey] = useState<string>('');
  const [status, setStatus] = useState<string>('');

  // Load the saved API key when the component mounts
  useEffect(() => {
    chrome.storage.local.get([API_KEY_STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) {
        console.error('Error loading API key:', chrome.runtime.lastError);
        setStatus('Error loading API key.');
      } else if (result[API_KEY_STORAGE_KEY]) {
        setApiKey(result[API_KEY_STORAGE_KEY]);
        setStatus('API Key loaded.');
      } else {
        setStatus('API Key not set.');
      }
    });
  }, []);

  const handleSave = () => {
    if (!apiKey.trim()) {
        setStatus('API Key cannot be empty.');
        return;
    }
    chrome.storage.local.set({ [API_KEY_STORAGE_KEY]: apiKey.trim() }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error saving API key:', chrome.runtime.lastError);
        setStatus('Error saving API key.');
      } else {
        console.log('API Key saved successfully.');
        setStatus('API Key saved successfully!');
      }
    });
  };

  return (
    <div className="OptionsApp">
      <h1>Browser Control Agent - Options</h1>
      <p>Please enter your Gemini API Key. This will be stored locally in your browser's extension storage.</p>
      <div>
        <label htmlFor="apiKeyInput">Gemini API Key:</label>
        <input
          type="password" // Use password type to obscure the key
          id="apiKeyInput"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          style={{ width: '300px', marginLeft: '10px', marginRight: '10px' }}
        />
        <button onClick={handleSave}>Save Key</button>
      </div>
      {status && <p style={{ marginTop: '10px', fontStyle: 'italic' }}>Status: {status}</p>}
    </div>
  );
}

export default OptionsApp;
