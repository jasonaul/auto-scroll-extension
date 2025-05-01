// auto-scroller-extension/background/service-worker.js

console.log("Auto Scroller: Service Worker started.");

// --- Constants ---
const DEFAULT_SETTINGS = {
    defaultSpeed: 50,
    siteSpeeds: {},
    autoStartMode: 'off', // 'off', 'all', 'whitelist'
    autoStartDelay: 5,    // seconds
    autoStartWhitelist: [] // array of hostnames
};

// Store active auto-start timeouts to prevent duplicates if a page updates quickly
const autoStartTimers = {}; // tabId -> timerId

// --- Initial Setup on Extension Install/Update ---
chrome.runtime.onInstalled.addListener(details => {
    console.log(`Auto Scroller: ${details.reason} event.`);
    // Get existing settings or use defaults, then merge and save.
    chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS), (existingSettings) => {
         if (chrome.runtime.lastError) {
             console.error("SW: Error getting settings on install:", chrome.runtime.lastError);
             // Try setting defaults anyway? Or maybe it's better to fail here?
             // For now, let's log and attempt to set defaults.
         }
        const mergedSettings = { ...DEFAULT_SETTINGS, ...existingSettings };
        // Ensure no undefined values slipped through if storage was corrupted/empty
        Object.keys(DEFAULT_SETTINGS).forEach(key => {
            if (mergedSettings[key] === undefined) {
                mergedSettings[key] = DEFAULT_SETTINGS[key];
            }
        });

        chrome.storage.sync.set(mergedSettings).then(() => {
             console.log("SW: Default settings initialized/verified.", mergedSettings);
        }).catch(err => {
             console.error("SW: Failed to set initial settings:", err);
        });
    });
});


// --- Function to Inject Content Script Programmatically ---
async function ensureScriptInjected(tabId) {
    if (typeof tabId !== 'number' || tabId <= 0) {
        console.warn(`SW: Invalid tabId received for injection: ${tabId}`);
        return false;
    }
    try {
        console.log(`SW: Ensuring script is injected into tab ${tabId}`);
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content_scripts/scroller.js'],
        });
        console.log(`SW: Script injection successful or script already present in tab ${tabId}.`);
        return true;
    } catch (err) {
        // Ignore errors indicating the script is already there, but log others.
        if (err.message.includes('Cannot access chrome://') || err.message.includes('Cannot access file://') || err.message.includes('No matching window')) {
             console.log(`SW: Cannot inject script into tab ${tabId} (likely protected page or closed tab).`);
        } else if (!err.message.includes('already been injected')) { // Allow duplicate injection attempts silently
             console.error(`SW: Failed to inject script into tab ${tabId}: ${err.message}`);
        } else {
             console.log(`SW: Script already present in tab ${tabId}.`)
        }
        // Return false for actual errors, true if it's just already injected or permission issue
        return !err.message.includes('Failed to execute script') && !err.message.includes('Cannot access page');
    }
}


// --- Calculate Effective Speed ---
function getEffectiveSpeed(url, settings) {
    let speed = settings.defaultSpeed;
    if (url && settings.siteSpeeds) {
        try {
            const hostname = new URL(url).hostname;
            // Check for exact match first
            if (settings.siteSpeeds[hostname] !== undefined) {
                speed = settings.siteSpeeds[hostname];
                console.log(`SW: Found exact site-specific speed for ${hostname}: ${speed}`);
            // Optional: Check for wildcard/subdomain matches (e.g., *.example.com) - more complex
            // Example (simple suffix check):
            // else {
            //     const matchingDomain = Object.keys(settings.siteSpeeds)
            //         .find(key => hostname.endsWith('.' + key));
            //     if (matchingDomain) {
            //         speed = settings.siteSpeeds[matchingDomain];
            //         console.log(`SW: Found wildcard site-specific speed via ${matchingDomain} for ${hostname}: ${speed}`);
            //     }
            // }
            }
        } catch (e) {
            console.warn(`SW: Could not parse URL "${url}" for site speed: ${e.message}`);
        }
    }
    return speed;
}


// --- Listen for messages (from Popup, Options, Content Script) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("SW: Received message", message, "from", sender.tab ? `tab ${sender.tab.id}`: sender.url ? `options page ${sender.url}` : "popup or unknown");

    if (message.type === 'getSettings') {
        chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS), (settings) => {
            if (chrome.runtime.lastError) {
                console.error("SW: Error getting settings:", chrome.runtime.lastError);
                sendResponse({ error: chrome.runtime.lastError.message });
                return;
            }
            // Merge with defaults in case some settings are missing in storage
             const completeSettings = { ...DEFAULT_SETTINGS, ...settings };

            // Calculate effective speed if URL is provided (usually from popup)
            let responseData = { ...completeSettings };
            if (message.url) {
                responseData.effectiveSpeed = getEffectiveSpeed(message.url, completeSettings);
                console.log(`SW: Effective speed for ${message.url}: ${responseData.effectiveSpeed}`);
            }
            console.log("SW: Sending settings:", responseData);
            sendResponse(responseData);
        });
        return true; // Indicates async response

    } else if (message.type === 'saveSettings') {
        // Basic validation could happen here too, but options page should handle most of it
        const settingsToSave = { ...DEFAULT_SETTINGS, ...message.settings }; // Ensure all keys exist
        chrome.storage.sync.set(settingsToSave)
            .then(() => {
                console.log("SW: Settings saved:", settingsToSave);
                sendResponse({ status: "Settings saved" });
            })
            .catch(err => {
                console.error("SW: Error saving settings:", err);
                sendResponse({ status: "Error saving settings", error: err.message });
            });
        return true; // Indicates async response

    } else if (message.type === 'ensureScriptInjected') {
        const tabIdToInject = message.tabId || (sender.tab ? sender.tab.id : null);
        if (tabIdToInject) {
            ensureScriptInjected(tabIdToInject).then(success => {
                sendResponse({ success: success });
            });
            return true; // Indicates async response
        } else {
             console.warn("SW: 'ensureScriptInjected' message received without tabId.");
             sendResponse({ success: false, error: "No tabId provided" });
        }

    } else if (message.type === 'clearAutoStartTimer') {
        // Message from content script if user interacts before timer fires
        if (sender.tab && sender.tab.id && autoStartTimers[sender.tab.id]) {
             clearTimeout(autoStartTimers[sender.tab.id]);
             delete autoStartTimers[sender.tab.id];
             console.log(`SW: Cleared auto-start timer for tab ${sender.tab.id} due to user interaction.`);
        }
         sendResponse({ status: "Timer cleared if exists" }); // Acknowledge
    }

    // Return false or undefined if not sending an async response
});

// --- Auto-Start Logic ---
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // Check if the tab finished loading and has a valid URL
    if (changeInfo.status === 'complete' && tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
        // Add a slight delay. Sometimes 'complete' fires just before everything is truly ready,
        // especially on complex pages or with other extensions running.
        await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms

        console.log(`SW: [onUpdated] Tab ${tabId} update check. Status: ${changeInfo.status}, URL: ${tab.url}`);

        // Clear any previous timer for this tab *before* checking settings
        if (autoStartTimers[tabId]) {
            clearTimeout(autoStartTimers[tabId]);
            delete autoStartTimers[tabId];
            console.log(`SW: [onUpdated] Cleared existing auto-start timer for tab ${tabId} on update.`);
        }

        try {
            const settings = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
            const completeSettings = { ...DEFAULT_SETTINGS, ...settings }; // Ensure defaults

            // --- DETAILED LOGGING ---
            console.log(`SW: [onUpdated] TabId: ${tabId}. Retrieved Settings:`, JSON.parse(JSON.stringify(completeSettings))); // Log a copy

            if (completeSettings.autoStartMode === 'off') {
                console.log(`SW: [onUpdated] TabId: ${tabId}. Auto-start is 'off'. No action.`);
                return; // Auto-start is disabled
            }

            let shouldAutoStart = false;
            let hostname = '';
            try {
                hostname = new URL(tab.url).hostname.toLowerCase(); // Ensure hostname is lowercase for comparison
                console.log(`SW: [onUpdated] TabId: ${tabId}. Extracted Hostname: "${hostname}"`);
            } catch (e) {
                console.error(`SW: [onUpdated] TabId: ${tabId}. Failed to parse URL "${tab.url}":`, e);
                return; // Cannot proceed without hostname
            }

            if (completeSettings.autoStartMode === 'all') {
                shouldAutoStart = true;
                console.log(`SW: [onUpdated] TabId: ${tabId}. Mode='all'. Setting shouldAutoStart=true.`);
            } else if (completeSettings.autoStartMode === 'whitelist') {
                const whitelist = completeSettings.autoStartWhitelist || [];
                console.log(`SW: [onUpdated] TabId: ${tabId}. Mode='whitelist'. Checking hostname "${hostname}" against whitelist:`, whitelist);

                // --- Refined Check: Handles missing 'www.' prefix ---
                // Check if the exact hostname is in the list OR
                // if the hostname without 'www.' is in the list.
                const isWhitelisted = whitelist.some(entry =>
                    entry === hostname || // Exact match (e.g., "www.reddit.com" === "www.reddit.com" or "reddit.com" === "reddit.com")
                    (entry === hostname.replace(/^www\./, '')) // Check without www (e.g., whitelist has "reddit.com", current is "www.reddit.com")
                );

                console.log(`SW: [onUpdated] TabId: ${tabId}. Result of whitelist check for "${hostname}": ${isWhitelisted}`); // <-- VERY IMPORTANT LOG

                if (isWhitelisted) {
                    shouldAutoStart = true;
                    console.log(`SW: [onUpdated] TabId: ${tabId}. Hostname "${hostname}" FOUND in whitelist. Setting shouldAutoStart=true.`);
                } else {
                    console.log(`SW: [onUpdated] TabId: ${tabId}. Hostname "${hostname}" NOT FOUND in whitelist.`);
                }
            }

            if (shouldAutoStart) {
                const delayMs = (completeSettings.autoStartDelay >= 0 ? completeSettings.autoStartDelay : 0) * 1000; // Ensure delay isn't negative
                const speed = getEffectiveSpeed(tab.url, completeSettings);

                console.log(`SW: [onUpdated] TabId: ${tabId}. Scheduling auto-start. Delay: ${delayMs}ms, Speed: ${speed}px/sec.`);

                // Set a timeout to inject and start scrolling
                autoStartTimers[tabId] = setTimeout(async () => {
                    // Ensure the tab still exists before trying to inject/message
                    try {
                         // Check if tab exists and is still on roughly the same URL (optional but good)
                        const currentTabData = await chrome.tabs.get(tabId);
                        if (!currentTabData || !currentTabData.url || new URL(currentTabData.url).hostname.toLowerCase() !== hostname) {
                             console.log(`SW: [Timer] Tab ${tabId} closed or navigated away before auto-start timer fired. Expected hostname: ${hostname}, Current: ${currentTabData?.url ? new URL(currentTabData.url).hostname.toLowerCase() : 'N/A'}.`);
                             delete autoStartTimers[tabId]; // Clean up timer reference
                             return;
                        }
                    } catch (e) {
                        console.log(`SW: [Timer] Tab ${tabId} closed before auto-start timer fired (error getting tab).`);
                        delete autoStartTimers[tabId]; // Clean up timer reference
                        return; // Stop execution if tab is gone
                    }

                    console.log(`SW: [Timer] Auto-start timer fired for tab ${tabId}. Injecting script and sending start command.`);
                    const injected = await ensureScriptInjected(tabId);
                    if (injected) {
                        try {
                            await chrome.tabs.sendMessage(tabId, {
                                type: 'startScrollingWithDelay', // Content script handles this
                                speed: speed,
                                delay: 0 // Delay already happened via setTimeout
                            });
                            console.log(`SW: [Timer] Sent 'startScrollingWithDelay' command to tab ${tabId}.`);
                        } catch (error) {
                            // This might happen if the content script is blocked or hasn't loaded its listener yet.
                             if (error.message.includes("Could not establish connection") || error.message.includes("Receiving end does not exist")) {
                                 console.warn(`SW: [Timer] Error sending start command to tab ${tabId}: Content script listener not ready? Retrying once...`);
                                 // Optional: Retry once after a short delay
                                 await new Promise(resolve => setTimeout(resolve, 200));
                                 try {
                                     await chrome.tabs.sendMessage(tabId, {type: 'startScrollingWithDelay', speed: speed, delay: 0 });
                                      console.log(`SW: [Timer] Retry successful for tab ${tabId}.`);
                                 } catch (retryError) {
                                      console.error(`SW: [Timer] Retry also failed for tab ${tabId}:`, retryError.message);
                                 }
                             } else {
                                console.error(`SW: [Timer] Error sending start command to tab ${tabId}:`, error.message);
                             }
                        }
                    } else {
                        console.warn(`SW: [Timer] Script injection failed for auto-start on tab ${tabId}. Cannot start scrolling.`);
                    }
                    delete autoStartTimers[tabId]; // Clean up timer reference after execution or failure
                }, delayMs);
            } else {
                 console.log(`SW: [onUpdated] TabId: ${tabId}. Not scheduling auto-start (shouldAutoStart is false).`);
            }

        } catch (error) {
            console.error(`SW: [onUpdated] TabId: ${tabId}. Error during auto-start check:`, error);
            if (autoStartTimers[tabId]) {
                clearTimeout(autoStartTimers[tabId]);
                delete autoStartTimers[tabId];
            }
        }
    } else if (changeInfo.status === 'loading' && autoStartTimers[tabId]) {
        // Handle page reloads before timer fires
        clearTimeout(autoStartTimers[tabId]);
        delete autoStartTimers[tabId];
        console.log(`SW: [onUpdated] Tab ${tabId} started loading. Cleared pending auto-start timer.`);
    }
});

// Listen for tab removal to clean up timers
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (autoStartTimers[tabId]) {
        clearTimeout(autoStartTimers[tabId]);
        delete autoStartTimers[tabId];
        console.log(`SW: Tab ${tabId} removed. Cleared associated auto-start timer.`);
    }
});


console.log("SW: Service Worker Ready.");