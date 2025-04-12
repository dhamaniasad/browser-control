import React, { useState, useEffect } from 'react';

// Optional: Import styles if you create a CSS module or global CSS
// import './App.css';

// Define message types for better structure (optional but good practice)
interface Message {
  sender: 'user' | 'agent';
  text: string;
}

function App() {
  const [goal, setGoal] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [agentStatus, setAgentStatus] = useState<string>('Idle'); // To show agent activity

  // Effect to listen for messages from the background script
  useEffect(() => {
    const messageListener = (message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
      console.log('Sidepanel received message:', message);
      if (message.type === 'AGENT_RESPONSE') {
        setMessages(prev => [...prev, { sender: 'agent', text: message.payload }]);
        setAgentStatus('Idle'); // Reset status after response
      } else if (message.type === 'AGENT_STATUS_UPDATE') {
         setAgentStatus(message.payload);
      }
      // It's good practice to return true if you intend to send an asynchronous response,
      // but in this case, the side panel is mostly receiving.
      // sendResponse({ received: true }); // Optional: acknowledge receipt
    };

    chrome.runtime.onMessage.addListener(messageListener);

    // Cleanup listener on component unmount
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []); // Empty dependency array ensures this runs only once on mount

  const handleSend = () => {
    if (!goal.trim()) return;
    const userMessage: Message = { sender: 'user', text: goal };
    // Add user message to chat immediately
    setMessages(prev => [...prev, userMessage]);

    // Send the goal to the background script
    chrome.runtime.sendMessage({ type: 'USER_GOAL', payload: goal }, (response) => {
       // Check if an error occurred during the sendMessage call
       if (chrome.runtime.lastError) {
         console.error('Error sending message:', chrome.runtime.lastError);
         // Ensure lastError exists before accessing message
         const errorMessage = chrome.runtime.lastError.message ?? 'Unknown error sending message';
         setMessages(prev => [...prev, { sender: 'agent', text: `Error: ${errorMessage}` }]);
         setAgentStatus('Error');
       } else {
         console.log('Background script responded:', response);
         // Optionally handle acknowledgement from background script
         setAgentStatus('Processing...'); // Update status
       }
    });

    // Clear input
    setGoal('');
  };

  return (
    <div className="App">
      <h1>Browser Control Agent</h1>
      <div style={{ marginBottom: '5px', fontStyle: 'italic' }}>Status: {agentStatus}</div>
      <div className="chat-window" style={{ height: '300px', overflowY: 'scroll', border: '1px solid #ccc', marginBottom: '10px', padding: '5px' }}>
        {messages.map((msg, index) => (
          <div key={index} style={{ textAlign: msg.sender === 'user' ? 'right' : 'left', margin: '5px 0', padding: '3px', borderRadius: '5px', backgroundColor: msg.sender === 'user' ? '#e1f5fe' : '#f1f1f1' }}>
            {/* <strong>{msg.sender === 'user' ? 'You' : 'Agent'}:</strong>  */}
            {msg.text}
          </div>
        ))}
      </div>
      <div className="input-area">
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Enter your goal..."
          rows={3}
          style={{ width: 'calc(100% - 70px)', marginRight: '5px', verticalAlign: 'bottom' }}
        />
        <button onClick={handleSend} style={{ verticalAlign: 'bottom' }}>Send</button>
      </div>
    </div>
  );
}

export default App;
