// background.js - Service worker that orchestrates the automation

let isRunning = false;
let shouldStop = false;
let currentConfig = null;
let currentIndex = 0;
let profiles = [];
let currentTabId = null;

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'start') {
    handleStart(msg.config).then(sendResponse);
    return true; // Async response
  }

  if (msg.action === 'stop') {
    handleStop();
    sendResponse({ success: true });
    return false;
  }

  if (msg.action === 'getStatus') {
    sendResponse({
      isRunning,
      status: isRunning ? `Processing profile ${currentIndex + 1} of ${profiles.length}` : 'Idle',
      progress: isRunning ? `${currentIndex}/${profiles.length} completed` : null
    });
    return false;
  }

  if (msg.action === 'skip') {
    handleSkip().then(sendResponse);
    return true;
  }

  if (msg.action === 'connectionResult') {
    handleConnectionResult(msg.success, msg.error, msg.profileName);
    return false;
  }

  return false;
});

async function handleStart(config) {
  if (isRunning) {
    return { success: false, error: 'Already running' };
  }

  currentConfig = config;
  shouldStop = false;
  currentIndex = 0;

  try {
    // Fetch profiles from Google Sheets
    profiles = await fetchProfilesFromSheet(config);

    if (profiles.length === 0) {
      return { success: false, error: 'No profiles found in sheet (or all already sent)' };
    }

    isRunning = true;
    await chrome.storage.local.set({ isRunning: true });

    broadcastStatus(`Found ${profiles.length} profiles to process`, 'running');

    // Start processing
    processNextProfile();

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function handleStop() {
  shouldStop = true;
  isRunning = false;
  chrome.storage.local.set({ isRunning: false });

  if (currentTabId) {
    chrome.tabs.remove(currentTabId).catch(() => {});
    currentTabId = null;
  }
}

async function fetchProfilesFromSheet(config) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.sheetId}/values/${encodeURIComponent(config.sheetRange)}?key=${config.apiKey}`;

  const response = await fetch(url);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to fetch sheet data');
  }

  const data = await response.json();
  const rows = data.values || [];

  // Process all valid LinkedIn profile URLs (no deduplication)
  const toProcess = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const profileUrl = row[0]?.trim();
    const rowIndex = i + 2; // +2 because sheets are 1-indexed and we started at A2

    if (profileUrl && profileUrl.includes('linkedin.com/in/')) {
      toProcess.push({
        url: profileUrl,
        rowIndex: rowIndex,
        sheetName: config.sheetRange.split('!')[0]
      });
    }
  }

  return toProcess;
}

async function processNextProfile() {
  if (shouldStop || currentIndex >= profiles.length) {
    finishProcessing();
    return;
  }

  const profile = profiles[currentIndex];
  broadcastStatus(`Opening profile ${currentIndex + 1} of ${profiles.length}...`, 'running', `${currentIndex}/${profiles.length} completed`);

  try {
    // Open the LinkedIn profile in a new tab
    const tab = await chrome.tabs.create({ url: profile.url, active: true });
    currentTabId = tab.id;

    // Wait for the tab to finish loading, then inject the content script action
    chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
      if (tabId === tab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);

        // Small delay to ensure page is fully rendered, then send message with retry
        setTimeout(() => {
          sendMessageWithRetry(tab.id, {
            action: 'sendConnection',
            message: currentConfig.message
          }, 3); // 3 retries
        }, 2000);
      }
    });

  } catch (error) {
    console.error('Error opening profile:', error);
    handleConnectionResult(false, error.message);
  }
}

async function handleConnectionResult(success, error, profileName) {
  const profile = profiles[currentIndex];

  // Define which errors should auto-skip (not stop processing)
  const autoSkipErrors = [
    'Connection already pending',
    'Already connected',
    'Profile only allows Follow (not Connect)'
  ];

  const shouldAutoSkip = !success && autoSkipErrors.some(e => error?.includes(e));

  if (success) {
    // Successfully sent connection request
    try {
      await updateSheetStatus(profile.rowIndex, profile.sheetName, 'Sent');
      broadcastStatus(`Sent connection to ${profileName || 'profile'}`, 'success');
    } catch (err) {
      console.error('Failed to update sheet:', err);
      broadcastStatus(`Connected but failed to update sheet: ${err.message}`, 'error');
    }

    // Close the tab and continue
    if (currentTabId) {
      await chrome.tabs.remove(currentTabId).catch(() => {});
      currentTabId = null;
    }

    moveToNextProfile();

  } else if (shouldAutoSkip) {
    // Known skip condition - log it and auto-continue
    const statusMap = {
      'Connection already pending': 'Pending',
      'Already connected': 'Already Connected',
      'Profile only allows Follow (not Connect)': 'Follow Only'
    };

    // Find matching status
    let statusLabel = 'Skipped';
    for (const [errorText, label] of Object.entries(statusMap)) {
      if (error?.includes(errorText)) {
        statusLabel = label;
        break;
      }
    }

    try {
      await updateSheetStatus(profile.rowIndex, profile.sheetName, statusLabel);
    } catch (err) {
      console.error('Failed to update sheet:', err);
    }

    broadcastStatus(`${statusLabel}: ${profileName || 'profile'} - skipping`, 'running');

    // Close the tab and continue automatically
    if (currentTabId) {
      await chrome.tabs.remove(currentTabId).catch(() => {});
      currentTabId = null;
    }

    moveToNextProfile();

  } else {
    // Real failure: log it, keep tab open for debugging, but continue to next profile
    try {
      await updateSheetStatus(profile.rowIndex, profile.sheetName, `Failed: ${error || 'unknown'}`);
    } catch (err) {
      console.error('Failed to update sheet:', err);
    }

    broadcastStatus(`Failed: ${error}. Tab kept open for review.`, 'error');

    // Keep the tab open for debugging but continue processing
    // Don't close currentTabId - leave it open
    currentTabId = null; // Clear reference so next profile opens in new tab

    moveToNextProfile();
  }
}

function moveToNextProfile() {
  currentIndex++;

  if (currentIndex < profiles.length && !shouldStop) {
    const delay = (currentConfig.delay || 10) * 1000;
    broadcastStatus(`Waiting ${currentConfig.delay}s before next profile...`, 'running', `${currentIndex}/${profiles.length} completed`);
    setTimeout(processNextProfile, delay);
  } else {
    finishProcessing();
  }
}

async function handleSkip() {
  // Close the current tab if open
  if (currentTabId) {
    await chrome.tabs.remove(currentTabId).catch(() => {});
    currentTabId = null;
  }

  // Move to next profile
  currentIndex++;

  if (currentIndex < profiles.length) {
    isRunning = true;
    await chrome.storage.local.set({ isRunning: true });

    const delay = (currentConfig.delay || 10) * 1000;
    broadcastStatus(`Skipped. Waiting ${currentConfig.delay}s before next profile...`, 'running', `${currentIndex}/${profiles.length} completed`);
    setTimeout(processNextProfile, delay);

    return { success: true };
  } else {
    finishProcessing();
    return { success: true, message: 'No more profiles' };
  }
}

async function updateSheetStatus(rowIndex, sheetName, status) {
  // Store status locally since API keys can't write to sheets
  // This also serves as a record of what was sent
  const sentProfiles = (await chrome.storage.local.get('sentProfiles'))?.sentProfiles || {};
  const key = `${currentConfig.sheetId}:${rowIndex}`;
  sentProfiles[key] = {
    status,
    timestamp: Date.now(),
    url: profiles[currentIndex]?.url
  };
  await chrome.storage.local.set({ sentProfiles });

  // Log for debugging
  console.log(`[LinkedIn Outbound] Marked row ${rowIndex} as: ${status}`);
}

function finishProcessing() {
  isRunning = false;
  chrome.storage.local.set({ isRunning: false });

  const message = shouldStop
    ? `Stopped. Processed ${currentIndex} of ${profiles.length} profiles.`
    : `Complete! Processed ${profiles.length} profiles.`;

  broadcastStatus(message, 'success', null, true);
}

function broadcastStatus(status, type, progress, completed, showSkip) {
  chrome.runtime.sendMessage({
    action: 'statusUpdate',
    status,
    type,
    progress,
    completed,
    showSkip
  }).catch(() => {
    // Popup might be closed, that's fine
  });
}

// Send message to content script with retry logic
function sendMessageWithRetry(tabId, message, retriesLeft) {
  chrome.tabs.sendMessage(tabId, message)
    .then(() => {
      console.log('[LinkedIn Outbound] Message sent to content script');
    })
    .catch(err => {
      console.error('[LinkedIn Outbound] Failed to send message:', err);
      if (retriesLeft > 0) {
        console.log(`[LinkedIn Outbound] Retrying... (${retriesLeft} attempts left)`);
        setTimeout(() => {
          sendMessageWithRetry(tabId, message, retriesLeft - 1);
        }, 1000); // Wait 1 second before retry
      } else {
        handleConnectionResult(false, 'Content script not responding after retries');
      }
    });
}
