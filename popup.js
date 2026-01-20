// popup.js - Handles UI interactions

document.addEventListener('DOMContentLoaded', async () => {
  const sheetIdInput = document.getElementById('sheetId');
  const apiKeyInput = document.getElementById('apiKey');
  const sheetRangeInput = document.getElementById('sheetRange');
  const messageInput = document.getElementById('message');
  const delayInput = document.getElementById('delay');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const statusDiv = document.getElementById('status');

  // Load saved settings
  const saved = await chrome.storage.local.get([
    'sheetId', 'apiKey', 'sheetRange', 'message', 'delay', 'isRunning'
  ]);

  if (saved.sheetId) sheetIdInput.value = saved.sheetId;
  if (saved.apiKey) apiKeyInput.value = saved.apiKey;
  if (saved.sheetRange) sheetRangeInput.value = saved.sheetRange;
  if (saved.message) messageInput.value = saved.message;
  if (saved.delay) delayInput.value = saved.delay;

  // Check if already running
  if (saved.isRunning) {
    updateUIRunning();
    requestStatusUpdate();
  }

  // Save settings on change
  const saveSettings = () => {
    chrome.storage.local.set({
      sheetId: sheetIdInput.value,
      apiKey: apiKeyInput.value,
      sheetRange: sheetRangeInput.value,
      message: messageInput.value,
      delay: parseInt(delayInput.value) || 10
    });
  };

  [sheetIdInput, apiKeyInput, sheetRangeInput, messageInput, delayInput].forEach(el => {
    el.addEventListener('change', saveSettings);
    el.addEventListener('input', saveSettings);
  });

  // Start button
  startBtn.addEventListener('click', async () => {
    const sheetId = sheetIdInput.value.trim();
    const apiKey = apiKeyInput.value.trim();
    const sheetRange = sheetRangeInput.value.trim();
    const message = messageInput.value.trim();
    const delay = parseInt(delayInput.value) || 10;

    if (!sheetId || !apiKey || !sheetRange || !message) {
      showStatus('Please fill in all required fields.', 'error');
      return;
    }

    if (delay < 5) {
      showStatus('Delay must be at least 5 seconds to avoid detection.', 'error');
      return;
    }

    // Save and start
    saveSettings();

    chrome.runtime.sendMessage({
      action: 'start',
      config: { sheetId, apiKey, sheetRange, message, delay }
    }, (response) => {
      if (response?.success) {
        updateUIRunning();
      } else {
        showStatus(response?.error || 'Failed to start', 'error');
      }
    });
  });

  // Stop button
  stopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'stop' }, (response) => {
      if (response?.success) {
        updateUIStopped();
        showStatus('Stopped by user.', '');
      }
    });
  });

  // Skip button - skip current failed profile and continue
  const skipBtn = document.getElementById('skipBtn');
  skipBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'skip' }, (response) => {
      if (response?.success) {
        skipBtn.style.display = 'none';
        updateUIRunning();
        showStatus('Skipping to next profile...', 'running');
      }
    });
  });

  // Listen for status updates from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'statusUpdate') {
      showStatus(msg.status, msg.type || '');
      if (msg.progress) {
        statusDiv.innerHTML += `<div class="progress">${msg.progress}</div>`;
      }
      if (msg.completed) {
        updateUIStopped();
      }
      // Show skip button on error
      if (msg.type === 'error' && msg.showSkip) {
        skipBtn.style.display = 'block';
        startBtn.style.display = 'none';
        stopBtn.style.display = 'none';
      }
    }
  });

  function updateUIRunning() {
    startBtn.style.display = 'none';
    stopBtn.style.display = 'block';
    disableInputs(true);
    showStatus('Running...', 'running');
  }

  function updateUIStopped() {
    startBtn.style.display = 'block';
    stopBtn.style.display = 'none';
    skipBtn.style.display = 'none';
    disableInputs(false);
  }

  function disableInputs(disabled) {
    [sheetIdInput, apiKeyInput, sheetRangeInput, messageInput, delayInput].forEach(el => {
      el.disabled = disabled;
    });
  }

  function showStatus(text, type) {
    statusDiv.textContent = text;
    statusDiv.className = type || '';
  }

  function requestStatusUpdate() {
    chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
      if (response) {
        showStatus(response.status, response.type || '');
        if (response.progress) {
          statusDiv.innerHTML += `<div class="progress">${response.progress}</div>`;
        }
        if (!response.isRunning) {
          updateUIStopped();
        }
      }
    });
  }

  // Export sent profiles as CSV
  document.getElementById('exportBtn').addEventListener('click', async () => {
    const data = await chrome.storage.local.get('sentProfiles');
    const sentProfiles = data.sentProfiles || {};

    if (Object.keys(sentProfiles).length === 0) {
      showStatus('No sent profiles to export.', 'error');
      return;
    }

    let csv = 'Row,URL,Status,Timestamp\n';
    for (const [key, value] of Object.entries(sentProfiles)) {
      const row = key.split(':')[1];
      const url = value.url || '';
      const status = value.status || '';
      const date = new Date(value.timestamp).toISOString();
      csv += `${row},"${url}","${status}","${date}"\n`;
    }

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `linkedin-outbound-log-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    showStatus('Exported sent profiles log.', 'success');
  });

  // Clear local log
  document.getElementById('clearLogBtn').addEventListener('click', async () => {
    if (confirm('Clear all sent profile records? This will allow re-processing profiles.')) {
      await chrome.storage.local.remove('sentProfiles');
      showStatus('Log cleared.', 'success');
    }
  });
});
