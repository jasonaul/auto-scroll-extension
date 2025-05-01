// auto-scroller-extension/popup/popup.js

// --- Elements ---
const speedSlider = document.getElementById('speedSlider');
const speedInput = document.getElementById('speedInput'); // New input field
// const speedValueDisplay = document.getElementById('speedValue'); // No longer needed
const toggleButton = document.getElementById('toggleButton');
const statusMessage = document.getElementById('statusMessage');
const optionsLink = document.getElementById('optionsLink');

// --- State ---
let currentTabId = null;
let currentTabUrl = null;
let currentSpeed = 50; // Holds the actual px/sec speed
let defaultSpeed = 50;
let isSiteSpecific = false;
let isCurrentlyScrolling = false;

// --- Speed <-> Slider Mapping Functions ---
const MIN_SLIDER_VALUE = 0;
const MAX_SLIDER_VALUE = 100;
const MIN_SPEED = 1;
const MAX_SPEED = 1000;

function speedToSliderValue(speed) {
  if (speed <= MIN_SPEED) return MIN_SLIDER_VALUE;
  if (speed >= MAX_SPEED) return MAX_SLIDER_VALUE;
  const logMin = Math.log(MIN_SPEED);
  const logMax = Math.log(MAX_SPEED);
  const scale = (logMax - logMin) / (MAX_SLIDER_VALUE - MIN_SLIDER_VALUE);
  return Math.round((Math.log(speed) - logMin) / scale + MIN_SLIDER_VALUE);
}

function sliderValueToSpeed(sliderValue) {
  if (sliderValue <= MIN_SLIDER_VALUE) return MIN_SPEED;
  if (sliderValue >= MAX_SLIDER_VALUE) return MAX_SPEED;
  const logMin = Math.log(MIN_SPEED);
  const logMax = Math.log(MAX_SPEED);
  const scale = (logMax - logMin) / (MAX_SLIDER_VALUE - MIN_SLIDER_VALUE);
  const speed = Math.exp(logMin + scale * (sliderValue - MIN_SLIDER_VALUE));
  return Math.round(speed);
}
// --- End Mapping Functions ---

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log("Popup DOM loaded");
    statusMessage.textContent = 'Loading...';

    // Ensure elements exist
    if (!speedSlider || !speedInput) {
         console.error("Popup: Critical speed control elements not found!");
         statusMessage.textContent = "Error: UI components missing.";
         disableControls();
         return;
    }

    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs || tabs.length === 0 || !tabs[0].id || !tabs[0].url) {
            throw new Error("Cannot access active tab info.");
        }
        currentTabId = tabs[0].id;
        currentTabUrl = tabs[0].url;
        console.log(`Popup: Active tab ID: ${currentTabId}, URL: ${currentTabUrl}`);

        if (!currentTabUrl.startsWith('http://') && !currentTabUrl.startsWith('https://')) {
             throw new Error("Unavailable on this page (requires http/https).");
        }

        console.log("Popup: Asking background to ensure script is injected.");
        const injectionResponse = await chrome.runtime.sendMessage({ type: 'ensureScriptInjected', tabId: currentTabId });
        if (!injectionResponse || !injectionResponse.success) {
             console.error("Popup: Background script reported injection failure or script blocked.", injectionResponse);
             throw new Error("Could not prepare page for scrolling.");
        }
        console.log("Popup: Background script confirmed injection/presence.");

        // Get settings AND current scroll status
        await loadStateAndSettings(); // This will call updateUI

    } catch (error) {
        console.error("Popup: Initialization error:", error.message);
        statusMessage.textContent = `Error: ${error.message}`;
        disableControls();
    }

    // --- Add event listeners ---
    speedSlider.addEventListener('input', handleSliderInput);
    speedInput.addEventListener('input', handleNumberInput);
    // Optional: Update on 'change' too (when focus is lost from number input)
    speedInput.addEventListener('change', handleNumberInput);

    toggleButton.addEventListener('click', handleToggleButtonClick);
    optionsLink.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
    });
});

// --- Load settings and query content script status ---
async function loadStateAndSettings() {
    try {
        console.log("Popup: Requesting settings from background.");
        const settings = await chrome.runtime.sendMessage({ type: 'getSettings', url: currentTabUrl });

        if (!settings || settings.error) {
             throw new Error(`Failed to load settings: ${settings?.error || 'Unknown error'}`);
        }
        console.log("Popup: Received settings:", settings);
        defaultSpeed = settings.defaultSpeed ?? 50;
        currentSpeed = settings.effectiveSpeed ?? defaultSpeed;
        isSiteSpecific = (currentSpeed !== defaultSpeed && settings.siteSpeeds && settings.siteSpeeds[new URL(currentTabUrl).hostname]);

        console.log(`Popup: Effective speed is ${currentSpeed}`);

        console.log("Popup: Sending queryScrollStatus to content script");
        const response = await chrome.tabs.sendMessage(currentTabId, { type: 'queryScrollStatus' });

        if (response) {
            console.log("Popup: Received scroll status from content script:", response);
            isCurrentlyScrolling = response.isScrolling;
            if (isCurrentlyScrolling && response.currentSpeed !== undefined) {
                 currentSpeed = response.currentSpeed; // Use live speed if scrolling
                 console.log(`Popup: Overriding speed with content script's current speed: ${currentSpeed}`);
            }
        } else {
            console.warn("Popup: No response from content script for queryScrollStatus.");
            isCurrentlyScrolling = false;
        }

        updateUI(); // Update UI with loaded state

    } catch (error) {
        console.error("Popup: Error loading state/settings:", error.message);
         if (error.message.includes("Could not establish connection") || error.message.includes("Receiving end does not exist")) {
              statusMessage.textContent = 'Error: Page script comms failed. Try reloading page.';
         } else {
              statusMessage.textContent = `Error: ${error.message}`;
         }
        disableControls();
    }
}


// --- UI Update Functions ---
function updateUI() {
    // Clamp speed just in case
    currentSpeed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, currentSpeed));

    // Update both controls
    speedInput.value = currentSpeed;
    speedSlider.value = speedToSliderValue(currentSpeed);

    // Update button and status
    if (isCurrentlyScrolling) {
        toggleButton.textContent = 'Stop Scrolling';
        toggleButton.classList.add('stop');
        statusMessage.textContent = `Scrolling at ${currentSpeed} px/s.`;
    } else {
        toggleButton.textContent = 'Start Scrolling';
        toggleButton.classList.remove('stop');
        statusMessage.textContent = `Let's scroll this thing.`;
    }
    toggleButton.disabled = false;
    speedSlider.disabled = false;
    speedInput.disabled = false;
}

function disableControls() {
    toggleButton.disabled = true;
    speedSlider.disabled = true;
    speedInput.disabled = true; // Disable number input too
    toggleButton.textContent = 'Unavailable';
    toggleButton.classList.remove('stop');
}

// --- Event Handlers ---
function handleSliderInput() {
    // Get speed from slider's log position
    currentSpeed = sliderValueToSpeed(parseInt(speedSlider.value, 10));
    // Update the number input to match
    speedInput.value = currentSpeed;
    // Send update message if scrolling
    sendSpeedUpdateIfScrolling();
    // Update status message if not scrolling
     if (!isCurrentlyScrolling) {
         statusMessage.textContent = `Ready. Speed: <span class="math-inline">\{currentSpeed\} px/s\.</span>{isSiteSpecific ? ' (Site specific)' : ''}`;
     }
}

function handleNumberInput() {
    let speedFromInput = parseInt(speedInput.value, 10);
    // Validate and clamp the input value
    if (isNaN(speedFromInput) || speedFromInput < MIN_SPEED) {
        speedFromInput = MIN_SPEED;
    } else if (speedFromInput > MAX_SPEED) {
        speedFromInput = MAX_SPEED;
    }
    // Update internal speed state
    currentSpeed = speedFromInput;
    // Update the slider position to match
    speedSlider.value = speedToSliderValue(currentSpeed);
    // Optionally, update the input field itself if clamped/corrected on 'change' or 'blur' event
     if (event.type === 'change') { // Correct value in box if invalid only after user finishes input
         speedInput.value = currentSpeed;
     }
    // Send update message if scrolling
    sendSpeedUpdateIfScrolling();
     // Update status message if not scrolling
      if (!isCurrentlyScrolling) {
          statusMessage.textContent = `Ready. Speed: <span class="math-inline">\{currentSpeed\} px/s\.</span>{isSiteSpecific ? ' (Site specific)' : ''}`;
      }
}

// Helper to send speed update to content script
function sendSpeedUpdateIfScrolling() {
     if (isCurrentlyScrolling && currentTabId) {
         console.log(`Popup: Sending speed update: ${currentSpeed}`);
         chrome.tabs.sendMessage(currentTabId, { type: 'updateSpeed', speed: currentSpeed })
            .then(response => console.log("Popup: Live speed update response:", response))
            .catch(err => console.warn("Popup: Error sending live speed update:", err.message)); // Warn is fine
         // Update status while scrolling too
         statusMessage.textContent = `Scrolling at ${currentSpeed} px/s.`;
    }
}


async function handleToggleButtonClick() {
    if (!currentTabId) return;

    toggleButton.disabled = true;
    const action = isCurrentlyScrolling ? 'stop' : 'start';
    statusMessage.textContent = `${action === 'start' ? 'Starting' : 'Stopping'}...`;

    const messageType = isCurrentlyScrolling ? 'stopScrolling' : 'startScrolling';
    // Use the accurately synced currentSpeed
    const speedToSend = isCurrentlyScrolling ? 0 : currentSpeed;
    const messagePayload = { type: messageType, speed: speedToSend };

    try {
        console.log(`Popup: Sending ${messageType} to tab ${currentTabId} with speed ${speedToSend}`);
        const response = await chrome.tabs.sendMessage(currentTabId, messagePayload);
        console.log(`Popup: Received response for ${messageType}:`, response);

        if (response) {
             isCurrentlyScrolling = response.isScrolling;
             // Make sure internal speed matches actual speed after starting/stopping
             if (response.currentSpeed !== undefined) {
                  currentSpeed = response.currentSpeed;
             } else if (isCurrentlyScrolling) {
                  currentSpeed = speedToSend; // Assume start used the speed we sent
             }
        } else {
             isCurrentlyScrolling = !isCurrentlyScrolling; // Fallback assumption
             if (isCurrentlyScrolling) currentSpeed = speedToSend;
        }
        updateUI(); // Update button, status, slider/input values

    } catch (error) {
        console.error(`Popup: Error sending ${messageType} message:`, error.message);
        statusMessage.textContent = `Error: Could not ${action} scrolling.`;
        toggleButton.disabled = false;
    }
}

// --- Listener for updates from Content Script ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.tab && sender.tab.id === currentTabId) {
        console.log("Popup: Received message from its content script:", message);
        if (message.type === 'scrollingStopped') {
             if (isCurrentlyScrolling) {
                 isCurrentlyScrolling = false;
                 // Update UI without changing speed value
                 updateUI(); // Update button and status
                 statusMessage.textContent = `Stopped (${message.reason === 'reachedBottom' ? 'Reached bottom' : 'User interaction'}). Speed: ${currentSpeed} px/s.`;
             }
        }
    }
});