// auto-scroller-extension/content_scripts/scroller.js

// --- Prevent multiple initializations ---
if (window.autoScrollerInitialized) {
    console.log("Auto Scroller CS: Already initialized. Skipping setup.");
} else {
    window.autoScrollerInitialized = true;
    console.log("Auto Scroller CS: Content script loading.");

    // --- State Variables ---
    let isScrolling = false;
    let scrollSpeed = 50; // Default speed, will be updated by messages
    let scrollIntervalId = null; // requestAnimationFrame ID
    let lastTimestamp = 0;
    let scrollAccumulator = 0;
    let delayedStartTimerId = null; // setTimeout ID for delayed start

    // --- Core Scrolling Logic ---
    function scrollStep(timestamp) {
        if (!isScrolling) return; // Exit if stopped

        if (!lastTimestamp) lastTimestamp = timestamp;
        const deltaTime = (timestamp - lastTimestamp) / 1000;
        lastTimestamp = timestamp;

        const pixelsToScrollThisFrame = scrollSpeed * deltaTime;
        scrollAccumulator += pixelsToScrollThisFrame;

        const scrollAmount = Math.floor(scrollAccumulator);

        if (scrollAmount >= 1) {
            window.scrollBy(0, scrollAmount);
            scrollAccumulator -= scrollAmount; // Subtract scrolled amount
        }

        const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight;
        // Use a small buffer (e.g., 2px) to avoid issues with fractional pixels
        if (window.scrollY >= scrollableHeight - 2) {
            console.log("Auto Scroller CS: Reached bottom of page.");
            stopScrollingInternal("reachedBottom");
        } else {
            scrollIntervalId = requestAnimationFrame(scrollStep);
        }
    }

    // --- Control Functions ---
    function startScrollingInternal(speed, reason = "manual") {
        // Clear any pending delayed start first
        if (delayedStartTimerId) {
            clearTimeout(delayedStartTimerId);
            delayedStartTimerId = null;
            console.log("Auto Scroller CS: Canceled pending delayed start.");
        }

        if (isScrolling) {
            console.log(`Auto Scroller CS: Already scrolling, updating speed to ${speed}.`);
            updateSpeedInternal(speed);
            return;
        }
        console.log(`Auto Scroller CS: Starting scroll (Reason: ${reason}) at speed ${speed}px/sec.`);
        isScrolling = true;
        scrollSpeed = speed;
        lastTimestamp = 0;
        scrollAccumulator = 0;

        if (scrollIntervalId) cancelAnimationFrame(scrollIntervalId);
        scrollIntervalId = requestAnimationFrame(scrollStep);
    }

    function stopScrollingInternal(reason = "manual") {
        // Clear any pending delayed start
        if (delayedStartTimerId) {
            clearTimeout(delayedStartTimerId);
            delayedStartTimerId = null;
            console.log("Auto Scroller CS: Canceled pending delayed start on stop.");
        }

        if (!isScrolling) return;
        console.log(`Auto Scroller CS: Stopping scroll (Reason: ${reason}).`);
        isScrolling = false;
        if (scrollIntervalId) {
            cancelAnimationFrame(scrollIntervalId);
            scrollIntervalId = null;
        }
        lastTimestamp = 0;
        scrollAccumulator = 0;

        // Notify background/popup that scrolling stopped
         try {
            chrome.runtime.sendMessage({ type: "scrollingStopped", reason: reason });
        } catch (e) {
            // This might fail if the extension context is invalidated (e.g., during update/unload)
            console.log("Auto Scroller CS: Could not send stopped message -", e.message);
        }
    }

    function updateSpeedInternal(newSpeed) {
        console.log(`Auto Scroller CS: Updating speed to ${newSpeed}px/sec.`);
        scrollSpeed = newSpeed;
    }

    // --- Message Listener (from Popup/Background) ---
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log("Auto Scroller CS: Received message", message);
        let response = { status: "Acknowledged" };

        switch (message.type) {
            case 'startScrolling':
                startScrollingInternal(message.speed, "popup");
                response = { status: "Scrolling started", isScrolling: true };
                break;
            case 'stopScrolling':
                stopScrollingInternal("popup");
                response = { status: "Scrolling stopped", isScrolling: false };
                break;
            case 'updateSpeed':
                if (isScrolling) {
                    updateSpeedInternal(message.speed);
                    response = { status: "Speed updated", currentSpeed: scrollSpeed };
                } else {
                     // Optionally update the internal speed even if not scrolling,
                     // so the next 'start' uses the slider's last value.
                     scrollSpeed = message.speed;
                    response = { status: "Not scrolling, speed value stored", currentSpeed: scrollSpeed };
                }
                break;
            case 'queryScrollStatus':
                response = { isScrolling: isScrolling, currentSpeed: scrollSpeed };
                break;
             case 'startScrollingWithDelay': // Handle message from service worker
                 // Delay is handled by the background script's setTimeout now.
                 // We just need to start immediately when this message arrives.
                 console.log("Auto Scroller CS: Received auto-start command.");
                 startScrollingInternal(message.speed, "autoStart");
                 response = { status: "Auto-scrolling initiated", isScrolling: true };
                 break;
            default:
                console.log("Auto Scroller CS: Unknown message type received:", message.type);
                response = { status: "Unknown message type" };
                break;
        }

        console.log("Auto Scroller CS: Sending response", response);
        sendResponse(response);
        // Return true only if you might send the response asynchronously later
    });

    // --- Stop on User Interaction & Notify Background Timer ---
    let interactionTimeout;
    let notifiedBackgroundTimer = false; // Flag to avoid spamming messages

    function handleUserInteraction(eventType) {
         // 1. Clear background timer *immediately* on first interaction if needed
         if (!notifiedBackgroundTimer && delayedStartTimerId) {
             try {
                 // Tell background to cancel its setTimeout if it hasn't fired yet
                 chrome.runtime.sendMessage({ type: "clearAutoStartTimer" });
                 notifiedBackgroundTimer = true; // Only send once
                 console.log("Auto Scroller CS: Notified background to clear auto-start timer due to user interaction.");
             } catch(e) {
                  console.log("Auto Scroller CS: Could not send clear timer message -", e.message);
             }
         }
          // 2. Clear any pending local delayed start
         if (delayedStartTimerId) {
            clearTimeout(delayedStartTimerId);
            delayedStartTimerId = null;
            console.log("Auto Scroller CS: Canceled local pending delayed start due to user interaction.");
         }

         // 3. Stop active scrolling after a short debounce
        if (isScrolling) {
            clearTimeout(interactionTimeout);
            interactionTimeout = setTimeout(() => {
                console.log(`Auto Scroller CS: User interaction (${eventType}) detected, stopping active scroll.`);
                stopScrollingInternal("userInteraction");
            }, 150); // Wait briefly after the last interaction event to stop
        }
    }

    // Add listeners for various interactions
    window.addEventListener('wheel', () => handleUserInteraction('wheel'), { passive: true });
    window.addEventListener('touchmove', () => handleUserInteraction('touch'), { passive: true }); // For touch devices
    window.addEventListener('keydown', (event) => {
        // Stop on common scroll-related keys
        if ([' ', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) {
             handleUserInteraction(`keydown (${event.key})`);
        }
    }, { passive: true });


    console.log("Auto Scroller CS: Content script initialized and listeners active.");
    // Optional: Send a message to background indicating readiness? Not usually necessary.
    // try { chrome.runtime.sendMessage({ type: "contentScriptReady" }); } catch(e){}

} // End of initialization check block