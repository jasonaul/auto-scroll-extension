// auto-scroller-extension/options/options.js
console.log("Options.js: Script starting execution.");

// --- Get Elements ---
const defaultSpeedSlider = document.getElementById('defaultSpeedSlider');
const defaultSpeedInput = document.getElementById('defaultSpeedInput');
const autoStartModeSelect = document.getElementById('autoStartMode');
const autoStartDelayInput = document.getElementById('autoStartDelay');
const autoStartDelayGroup = document.getElementById('autoStartDelayGroup');
const autoStartWhitelistTextarea = document.getElementById('autoStartWhitelist');
const whitelistGroup = document.getElementById('whitelistGroup');
const siteSpeedsContainer = document.getElementById('siteSpeedsContainer');
const addSiteSpeedButton = document.getElementById('addSiteSpeed');
const saveButton = document.getElementById('saveButton');
const statusDiv = document.getElementById('status');

// --- Log Element Retrieval ---
// Early check to ensure HTML elements are found by their IDs
const essentialElementsExist =
    defaultSpeedSlider &&
    defaultSpeedInput &&
    autoStartModeSelect &&
    autoStartDelayInput &&
    autoStartDelayGroup &&
    autoStartWhitelistTextarea &&
    whitelistGroup &&
    siteSpeedsContainer &&
    addSiteSpeedButton &&
    saveButton &&
    statusDiv;

if (!essentialElementsExist) {
    console.error("Options.js: CRITICAL ERROR - One or more HTML elements not found! Check IDs in options.html and options.js.");
    // Optionally display an error message to the user immediately
     if (statusDiv) { // Check if statusDiv itself exists
         statusDiv.textContent = "Error: Options page UI failed to load correctly. Check element IDs.";
         statusDiv.className = 'error';
     }
} else {
     console.log("Options.js: All expected HTML elements found.");
}

// --- Speed <-> Slider Mapping Functions ---
const MIN_SLIDER_VALUE = 0;
const MAX_SLIDER_VALUE = 100;
const MIN_SPEED = 1;
const MAX_SPEED = 1000;

function speedToSliderValue(speed) {
  if (typeof speed !== 'number' || isNaN(speed)) speed = MIN_SPEED; // Handle non-numeric input
  speed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, speed)); // Clamp speed first
  if (speed === MIN_SPEED) return MIN_SLIDER_VALUE;
  if (speed === MAX_SPEED) return MAX_SLIDER_VALUE;
  const logMin = Math.log(MIN_SPEED);
  const logMax = Math.log(MAX_SPEED);
  const scale = (logMax - logMin) / (MAX_SLIDER_VALUE - MIN_SLIDER_VALUE);
  return Math.round((Math.log(speed) - logMin) / scale + MIN_SLIDER_VALUE);
}

function sliderValueToSpeed(sliderValue) {
  if (typeof sliderValue !== 'number' || isNaN(sliderValue)) sliderValue = MIN_SLIDER_VALUE; // Handle non-numeric
  sliderValue = Math.max(MIN_SLIDER_VALUE, Math.min(MAX_SLIDER_VALUE, sliderValue)); // Clamp slider value
  if (sliderValue === MIN_SLIDER_VALUE) return MIN_SPEED;
  if (sliderValue === MAX_SLIDER_VALUE) return MAX_SPEED;
  const logMin = Math.log(MIN_SPEED);
  const logMax = Math.log(MAX_SPEED);
  const scale = (logMax - logMin) / (MAX_SLIDER_VALUE - MIN_SLIDER_VALUE);
  const speed = Math.exp(logMin + scale * (sliderValue - MIN_SLIDER_VALUE));
  return Math.round(speed);
}
// --- End Mapping Functions ---

// --- Utility to show status ---
function showStatus(message, isError = false, duration = 3000) {
    if (!statusDiv) return; // Don't try if status element is missing
    console.log(`Options Status: ${message} (Error: ${isError})`);
    statusDiv.textContent = message;
    statusDiv.className = isError ? 'error' : 'success';
    // Clear previous timeouts if any
    if (statusDiv.timerId) {
        clearTimeout(statusDiv.timerId);
    }
    if (duration > 0) {
        statusDiv.timerId = setTimeout(() => {
            if (statusDiv.textContent === message) { // Clear only if not overwritten
                 statusDiv.textContent = '';
                 statusDiv.className = '';
            }
            statusDiv.timerId = null; // Clear timer reference
        }, duration);
    }
}

// --- State Holder for Default Speed ---
// This holds the current default speed value being manipulated in the UI
let currentDefaultSpeedState = 50;

// --- Load settings when the page opens ---
function loadSettings() {
    console.log("Options: loadSettings() called.");
    if (!essentialElementsExist) {
        console.error("Options: Cannot load settings, essential elements missing.");
        return; // Stop if elements aren't there
    }
    try {
        statusDiv.textContent = "Loading settings..."; // Indicate loading
        statusDiv.className = "";

        chrome.runtime.sendMessage({ type: 'getSettings' }, (settings) => {
             console.log("Options: Received response from background:", settings);
            if (chrome.runtime.lastError) {
                console.error("Options: Error loading settings via sendMessage:", chrome.runtime.lastError.message);
                showStatus(`Error loading settings: ${chrome.runtime.lastError.message}`, true, 0);
                return;
            }
            // Check for logical errors returned by the background script itself
            if (!settings || settings.error) {
                 console.error("Options: Background script returned an error:", settings?.error);
                 showStatus(`Error loading settings: ${settings?.error || 'Unknown background error'}`, true, 0);
                 return;
            }

            console.log("Options: Populating form with settings:", settings);
            try {
                // --- Populate Default Speed ---
                currentDefaultSpeedState = settings.defaultSpeed ?? 50;
                currentDefaultSpeedState = Math.max(MIN_SPEED, Math.min(MAX_SPEED, currentDefaultSpeedState)); // Clamp
                defaultSpeedInput.value = currentDefaultSpeedState;
                defaultSpeedSlider.value = speedToSliderValue(currentDefaultSpeedState);
                console.log(`Options: Default speed set to ${currentDefaultSpeedState}`);

                // --- Populate Other Fields ---
                autoStartModeSelect.value = settings.autoStartMode ?? 'off';
                autoStartDelayInput.value = settings.autoStartDelay ?? 5;
                autoStartWhitelistTextarea.value = (settings.autoStartWhitelist ?? []).join('\n');

                // --- Populate Site Speeds ---
                siteSpeedsContainer.innerHTML = ''; // Clear existing entries
                const siteSpeeds = settings.siteSpeeds ?? {};
                console.log("Options: Processing site speeds:", siteSpeeds);
                let siteSpeedCount = 0;
                for (const domain in siteSpeeds) {
                    if (Object.hasOwnProperty.call(siteSpeeds, domain)) {
                        addSiteSpeedEntry(domain, siteSpeeds[domain]);
                        siteSpeedCount++;
                    }
                }
                console.log(`Options: ${siteSpeedCount} site speed entries added.`);

                // --- Final UI Updates ---
                updateAutoStartUI(); // Show/hide sections based on mode
                showStatus("Settings loaded.", false, 1500); // Brief confirmation
                console.log("Options: Form population and initial UI update complete.");

            } catch (uiError) {
                console.error("Options: Error applying settings to UI:", uiError);
                showStatus(`Error displaying settings: ${uiError.message}`, true, 0);
            }
        });
    } catch (error) {
         console.error("Options: Critical error in loadSettings() function:", error);
         showStatus(`Fatal error during setup: ${error.message}`, true, 0);
    }
}

// --- Save settings ---
function saveSettings() {
    console.log("Options: saveSettings() called.");
    if (!essentialElementsExist) {
        console.error("Options: Cannot save settings, essential elements missing.");
        showStatus("Error: UI components missing, cannot save.", true, 0);
        return; // Stop if elements aren't there
    }

    statusDiv.textContent = 'Validating & Saving...';
    statusDiv.className = '';
    let validationError = false;

    // --- Reset previous validation styles ---
    defaultSpeedInput.style.borderColor = '';
    autoStartDelayInput.style.borderColor = '';
    const allSiteSpeedInputs = siteSpeedsContainer.querySelectorAll('input');
    allSiteSpeedInputs.forEach(input => input.style.borderColor = '');


    try {
        // --- 1. Validate Default Speed (uses currentDefaultSpeedState) ---
        // The state should already be clamped by the input handlers, but double-check
        if (isNaN(currentDefaultSpeedState) || currentDefaultSpeedState < MIN_SPEED || currentDefaultSpeedState > MAX_SPEED) {
            console.error(`Options: Invalid currentDefaultSpeedState detected: ${currentDefaultSpeedState}`);
            defaultSpeedInput.style.borderColor = 'red'; // Highlight related input
            validationError = true;
            // Attempt to re-sync UI just in case state got corrupted
            currentDefaultSpeedState = Math.max(MIN_SPEED, Math.min(MAX_SPEED, parseInt(defaultSpeedInput.value, 10) || MIN_SPEED));
            defaultSpeedInput.value = currentDefaultSpeedState;
            defaultSpeedSlider.value = speedToSliderValue(currentDefaultSpeedState);
        } else {
             console.log(`Options: Validated Default Speed: ${currentDefaultSpeedState}`);
        }

        // --- 2. Validate Auto-Start Delay ---
        const autoStartDelay = parseInt(autoStartDelayInput.value, 10);
        if (isNaN(autoStartDelay) || autoStartDelay < 0) {
            autoStartDelayInput.style.borderColor = 'red';
            validationError = true;
            console.warn(`Options: Invalid Auto-Start Delay: ${autoStartDelayInput.value}`);
        } else {
            console.log(`Options: Validated Auto-Start Delay: ${autoStartDelay}`);
        }

        // --- 3. Process and Validate Site Speeds ---
        const siteSpeedEntries = siteSpeedsContainer.querySelectorAll('.site-speed-entry');
        let siteSpeeds = {};
        console.log(`Options: Processing ${siteSpeedEntries.length} site speed entries for saving.`);

        siteSpeedEntries.forEach((entry, index) => {
            const domainInput = entry.querySelector('input[type="text"]');
            const speedInput = entry.querySelector('input[type="number"]');
            const domain = domainInput.value.trim().toLowerCase();
            const speedString = speedInput.value.trim();
            let speed = NaN;

            if (speedString) speed = parseInt(speedString, 10);

            if (domain && !isNaN(speed) && speed >= MIN_SPEED && speed <= MAX_SPEED) {
                // Validate domain format loosely
                try {
                    new URL("http://" + domain); // Test parsing
                    console.log(`Options: Valid site speed entry #${index + 1}: Domain='${domain}', Speed=${speed}`);
                    siteSpeeds[domain] = speed;
                } catch (e) {
                    console.warn(`Options: Invalid domain format in entry #${index + 1}: "${domain}"`);
                    domainInput.style.borderColor = 'red';
                    validationError = true;
                }
            } else if (domain || speedString) { // Incomplete entry
                console.warn(`Options: Incomplete/invalid site speed entry #${index + 1}: Domain='${domain}', Speed='${speedString}'`);
                if (!domain) domainInput.style.borderColor = 'red';
                if (!speedString || isNaN(speed) || speed < MIN_SPEED || speed > MAX_SPEED) speedInput.style.borderColor = 'red';
                validationError = true;
            }
            // Ignore completely empty rows
        });


        // --- 4. Stop if Validation Failed ---
        if (validationError) {
             console.warn("Options: Validation failed. Settings not saved.");
             showStatus('Please fix the errors highlighted in red.', true, 5000);
             return;
        }

        // --- 5. Prepare Settings Object ---
        const settingsToSave = {
            defaultSpeed: currentDefaultSpeedState,
            autoStartMode: autoStartModeSelect.value,
            autoStartDelay: autoStartDelay,
            autoStartWhitelist: autoStartWhitelistTextarea.value
                                .split('\n')
                                .map(s => s.trim().toLowerCase())
                                .filter(Boolean), // Remove empty lines
            siteSpeeds: siteSpeeds
        };

        // --- 6. Send to Background ---
        console.log("Options: Sending settings to background:", settingsToSave);
        chrome.runtime.sendMessage({ type: 'saveSettings', settings: settingsToSave }, (response) => {
             if (chrome.runtime.lastError) {
                console.error("Options: Error sending saveSettings message:", chrome.runtime.lastError.message);
                showStatus(`Error saving: ${chrome.runtime.lastError.message}`, true, 0);
            } else if (response && response.status === "Settings saved") {
                console.log("Options: Settings saved successfully via background.");
                showStatus('Settings Saved!', false, 3000);
            } else {
                console.error("Options: Background script reported failure to save. Response:", response);
                showStatus(`Failed to save settings. ${response?.error || 'Background error'}`, true, 0);
            }
        });

    } catch (error) {
         console.error("Options: Critical error during saveSettings function:", error);
         showStatus(`Fatal error during save: ${error.message}`, true, 0);
    }
}

// --- Add a new row for site-specific speed ---
function addSiteSpeedEntry(domain = '', speed = '') {
    console.log(`Options: addSiteSpeedEntry called. Domain: '${domain}', Speed: '${speed}'`);
    if (!siteSpeedsContainer) return; // Stop if container doesn't exist

    const entryDiv = document.createElement('div');
    entryDiv.className = 'site-speed-entry';

    const domainInput = document.createElement('input');
    domainInput.type = 'text';
    domainInput.placeholder = 'example.com';
    domainInput.value = domain;
    // Optional: Add pattern or other validation attributes later if needed

    const speedInput = document.createElement('input');
    speedInput.type = 'number';
    speedInput.placeholder = 'Speed';
    speedInput.min = MIN_SPEED.toString(); // Set min/max for browser validation help
    speedInput.max = MAX_SPEED.toString();
    speedInput.value = speed;

    const removeButton = document.createElement('button');
    removeButton.setAttribute('type', 'button'); // Prevent form submission if wrapped in form later
    removeButton.setAttribute('aria-label', 'Remove site speed entry');
    // removeButton.textContent = 'Remove'; // Using CSS ::before for '×' now
    removeButton.onclick = () => {
        console.log("Options: Removing site speed entry.");
        entryDiv.remove();
        // Optionally trigger a re-save or indicate unsaved changes
    };

    entryDiv.appendChild(domainInput);
    entryDiv.appendChild(speedInput);
    entryDiv.appendChild(removeButton);
    siteSpeedsContainer.appendChild(entryDiv);
}

// --- Show/Hide Auto-Start elements based on selection ---
function updateAutoStartUI() {
    console.log("Options: updateAutoStartUI() called.");
    if (!autoStartModeSelect || !autoStartDelayGroup || !whitelistGroup) {
         console.warn("Options: Cannot update auto-start UI, elements missing.");
         return; // Stop if elements are missing
    }

    const selectedMode = autoStartModeSelect.value;
    console.log(`Options: Auto-start mode changed to: ${selectedMode}`);

    // Hide both by default, then selectively show
    autoStartDelayGroup.classList.add('hidden');
    whitelistGroup.classList.add('hidden');

    if (selectedMode === 'all' || selectedMode === 'whitelist') {
        autoStartDelayGroup.classList.remove('hidden');
         console.log("Options: Showing Auto-Start Delay group.");
    }

    if (selectedMode === 'whitelist') {
        whitelistGroup.classList.remove('hidden');
         console.log("Options: Showing Whitelist group.");
    }
}

// --- Sync Handlers for Default Speed Controls ---
function handleDefaultSpeedSliderInput() {
    if (!defaultSpeedSlider || !defaultSpeedInput) return;
    // Calculate speed based on slider's position
    const speed = sliderValueToSpeed(parseInt(defaultSpeedSlider.value, 10));
    // Update the state variable
    currentDefaultSpeedState = speed;
    // Update the number input field to match
    defaultSpeedInput.value = currentDefaultSpeedState;
    console.log(`Options: Slider moved -> Speed: ${currentDefaultSpeedState}`);
    // Note: We don't save automatically on slider input, only when Save button is clicked.
}

function handleDefaultSpeedNumberInput(event) {
     if (!defaultSpeedSlider || !defaultSpeedInput) return;
    let speedFromInput = parseInt(defaultSpeedInput.value, 10);
    let clampedSpeed = speedFromInput; // Assume valid initially

    // Validate and clamp the input value
    if (isNaN(speedFromInput) || speedFromInput < MIN_SPEED) {
        clampedSpeed = MIN_SPEED;
    } else if (speedFromInput > MAX_SPEED) {
        clampedSpeed = MAX_SPEED;
    }

    // Update the internal state variable
    currentDefaultSpeedState = clampedSpeed;
    // Update the slider position to match the (potentially clamped) speed
    defaultSpeedSlider.value = speedToSliderValue(currentDefaultSpeedState);

    // Only correct the input field visually if it was actually clamped,
    // and preferably only when the user finishes typing (e.g., on 'change' or 'blur')
    // to avoid interrupting typing.
    if (event.type === 'change' || event.type === 'blur') { // Update on finishing input
        if (clampedSpeed !== speedFromInput) { // Only update if clamped
             defaultSpeedInput.value = currentDefaultSpeedState;
             console.log(`Options: Number input corrected/clamped to: ${currentDefaultSpeedState}`);
        }
    }
     console.log(`Options: Number input changed -> Speed: ${currentDefaultSpeedState}`);
}

// --- Event Listeners ---
// We wait for DOMContentLoaded to ensure all elements are available before attaching listeners
document.addEventListener('DOMContentLoaded', () => {
    console.log("Options: DOMContentLoaded event fired.");

    if (!essentialElementsExist) {
        console.error("Options: Cannot attach event listeners - essential elements missing.");
        // Maybe display a persistent error on the page
        if(statusDiv) {
             statusDiv.textContent = "ERROR: Page elements failed to load.";
             statusDiv.className = "error";
        }
        return; // Stop execution if page structure is broken
    }

    try {
        // Load initial settings from storage
        loadSettings();

        // Attach listeners for user interactions
        defaultSpeedSlider.addEventListener('input', handleDefaultSpeedSliderInput);
        defaultSpeedInput.addEventListener('input', handleDefaultSpeedNumberInput);
        defaultSpeedInput.addEventListener('change', handleDefaultSpeedNumberInput); // Use 'change' for final validation/sync
        defaultSpeedInput.addEventListener('blur', handleDefaultSpeedNumberInput); // Also sync on blur

        saveButton.addEventListener('click', saveSettings);
        addSiteSpeedButton.addEventListener('click', () => addSiteSpeedEntry()); // Add empty entry
        autoStartModeSelect.addEventListener('change', updateAutoStartUI);

        console.log("Options: All event listeners attached successfully.");

    } catch (error) {
         console.error("Options: Error during initial setup or listener attachment:", error);
         showStatus(`Error initializing page: ${error.message}`, true, 0);
    }
});

console.log("Options.js: Script finished initial execution.");