import React, { useState, useEffect } from 'react';

// Optional: Import styles if you create a CSS module or global CSS
// import './App.css';

// Define message types for better structure (optional but good practice)
interface Message {
  sender: 'user' | 'agent' | 'system'; // Added 'system' for action log/intervention
  text: string;
}

function App() {
  const [goal, setGoal] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [agentStatus, setAgentStatus] = useState<string>('Idle'); // To show agent activity
  const [actionLog, setActionLog] = useState<string[]>([]); // State for action log
  const [needsIntervention, setNeedsIntervention] = useState<boolean>(false); // State for intervention flag

  // Effect to listen for messages from the background script
  useEffect(() => {
    const messageListener = (message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
      console.log('Sidepanel received message:', message);

      switch (message.type) {
        case 'AGENT_RESPONSE':
          setMessages(prev => [...prev, { sender: 'agent', text: message.payload }]);
          setAgentStatus('Idle'); // Reset status after response
          setNeedsIntervention(false); // Assume intervention resolved if agent responds
          break;
        case 'AGENT_STATUS_UPDATE':
          setAgentStatus(message.payload);
          break;
        case 'AGENT_ACTION_LOG':
          // Add action log entries as 'system' messages
          setMessages(prev => [...prev, { sender: 'system', text: message.payload }]);
          break;
        case 'AGENT_INTERVENTION_NEEDED':
          // Set intervention flag and add a system message
          setNeedsIntervention(true);
          setMessages(prev => [...prev, { sender: 'system', text: `Intervention Needed: ${message.payload}` }]);
          setAgentStatus('Waiting for User');
          break;
        default:
          console.warn('Received unknown message type:', message.type);
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

  // Function to end the current task
  const handleEndTask = () => {
    console.log("End Task button clicked");
    chrome.runtime.sendMessage({ type: 'END_TASK' }, (response) => {
      // Check for errors in the response
      if (chrome.runtime.lastError) {
        console.error('Error ending task:', chrome.runtime.lastError);
        setAgentStatus('Error ending task');
      } else {
        console.log('End task response:', response);
        setAgentStatus('Task Ended by User');
        // Add a system message to indicate task ended
        setMessages(prev => [...prev, { sender: 'system', text: 'Task ended by user.' }]);
      }
    });
  };

  return (
    <div className="App p-4 flex flex-col h-screen bg-gray-50">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold text-gray-800">Browser Control Agent</h1>
        <button
          onClick={handleEndTask}
          className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-3 rounded text-sm"
        >
          End Task
        </button>
      </div>
      <div className="mb-2 text-sm italic text-gray-600">Status: {agentStatus}</div>

      {/* Placeholder for Human Intervention Request */}
      {needsIntervention && (
        <div className="mb-4 p-3 bg-yellow-100 border border-yellow-400 text-yellow-700 rounded">
          <strong>Action Required:</strong> The agent needs your help to proceed. Please check the browser tab.
          {/* TODO: Add a button to acknowledge/resolve intervention */}
        </div>
      )}

      {/* Chat Window */}
      <div className="chat-window flex-grow overflow-y-auto border border-gray-300 rounded bg-white mb-4 p-3 space-y-2">
        {messages.map((msg, index) => (
          <div key={index} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`p-2 rounded-lg max-w-[80%] ${
              msg.sender === 'user' ? 'bg-blue-500 text-white' :
              msg.sender === 'agent' ? 'bg-gray-200 text-gray-800' :
              'bg-purple-100 text-purple-800 italic text-xs' // Style for 'system' messages (action log)
            }`}>
              {msg.text}
            </div>
          </div>
        ))}
      </div>

      {/* Action Log (Example - could be integrated into messages or separate) */}
      {/* <div className="action-log mb-4 p-2 border border-gray-200 rounded bg-gray-100 h-24 overflow-y-auto text-xs">
        <h3 className="font-semibold mb-1 text-gray-700">Action Log:</h3>
        {actionLog.length === 0 ? <p className="text-gray-500">No actions yet.</p> :
          actionLog.map((action, index) => <p key={index} className="text-gray-600">{action}</p>)
        }
      </div> */}

      {/* Input Area */}
      <div className="input-area flex items-end">
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Enter your goal..."
          rows={3}
          className="flex-grow border border-gray-300 rounded-l p-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={handleSend}
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-r h-[68px]" // Adjusted height to match textarea
        >
          Send
        </button>
      </div>
    </div>
  );
}

export default App;
