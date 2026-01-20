// content.js - Runs on LinkedIn profile pages and handles connection requests

console.log('[LinkedIn Outbound] Content script loaded');

// Listen for messages from background script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'sendConnection') {
    handleSendConnection(msg.message);
  }
  return false;
});

async function handleSendConnection(messageTemplate) {
  console.log('[LinkedIn Outbound] Starting connection process');

  try {
    // Wait for page to be fully loaded
    await waitForElement('main');

    // Get the person's name for personalization
    const profileName = getProfileName();
    console.log('[LinkedIn Outbound] Profile name:', profileName);

    // Personalize the message
    const personalizedMessage = personalizeMessage(messageTemplate, profileName);

    // Find and click the Connect button
    const connected = await clickConnectButton();

    if (!connected) {
      // Check why - already connected, pending, or just not found?
      const status = await checkConnectionStatus();
      if (status) {
        // Known status like "Already connected" or "Pending"
        sendResult(false, status);
      } else {
        // Unknown failure
        sendResult(false, 'Could not find Connect button');
      }
      return;
    }

    // Wait for the modal to appear
    console.log('[LinkedIn Outbound] Waiting for connection modal...');

    // Initial delay to let LinkedIn process the click
    await sleep(1000);

    // Try multiple times to find the modal (it may take time to render)
    let modal = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      // Try multiple selectors - LinkedIn uses different modal structures
      modal = document.querySelector('#artdeco-modal-outlet [role="dialog"]') ||
              document.querySelector('.artdeco-modal[role="dialog"]') ||
              document.querySelector('.send-invite') ||
              document.querySelector('[data-test-modal-id="send-invite-modal"]') ||
              document.querySelector('[role="dialog"]');

      if (modal) {
        console.log('[LinkedIn Outbound] Modal found on attempt', attempt + 1);
        break;
      }
      console.log('[LinkedIn Outbound] Modal not found yet, attempt', attempt + 1);
      await sleep(750); // Wait before next attempt
    }

    if (!modal) {
      console.log('[LinkedIn Outbound] No modal appeared after clicking Connect');
      sendResult(false, 'No modal appeared after clicking Connect');
      return;
    }

    // Extra wait for modal content to fully render
    await sleep(500);

    // Check if "Add a note" option appears
    const addNoteClicked = await clickAddNote();
    console.log('[LinkedIn Outbound] Add note clicked:', addNoteClicked);

    if (addNoteClicked) {
      // Wait for textarea
      await sleep(800);

      // Type the message
      const messageTyped = await typeMessage(personalizedMessage);

      if (!messageTyped) {
        sendResult(false, 'Could not type message in textarea');
        return;
      }
      console.log('[LinkedIn Outbound] Message typed successfully');
    }

    // Click the Send button
    await sleep(500);
    const sent = await clickSendButton();

    if (!sent) {
      sendResult(false, 'Could not find or click Send button');
      return;
    }

    // Wait and verify the modal closed (indicates success)
    await sleep(1000);
    const modalStillOpen = document.querySelector('#artdeco-modal-outlet [role="dialog"]') ||
                           document.querySelector('.artdeco-modal[role="dialog"]') ||
                           document.querySelector('[data-test-modal-id="send-invite-modal"]');
    if (modalStillOpen && modalStillOpen.offsetParent !== null) {
      // Check if it's the same invite modal (not a different modal)
      const isInviteModal = modalStillOpen.closest('[data-test-modal-id="send-invite-modal"]') ||
                            modalStillOpen.querySelector('.send-invite') ||
                            modalStillOpen.classList.contains('send-invite');
      if (isInviteModal) {
        console.log('[LinkedIn Outbound] Modal still open after clicking Send - may have failed');
        sendResult(false, 'Modal still open after Send - check for errors');
        return;
      }
    }

    console.log('[LinkedIn Outbound] Connection request sent successfully!');
    sendResult(true, null, profileName);

  } catch (error) {
    console.error('[LinkedIn Outbound] Error:', error);
    sendResult(false, error.message);
  }
}

function getProfileName() {
  // Try multiple selectors for the name
  const selectors = [
    'h1.text-heading-xlarge',
    'h1[class*="text-heading"]',
    '.pv-top-card h1',
    'h1'
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.textContent.trim()) {
      return el.textContent.trim();
    }
  }

  return 'there';
}

function personalizeMessage(template, fullName) {
  const nameParts = fullName.split(' ');
  const firstName = nameParts[0] || 'there';
  const lastName = nameParts.slice(1).join(' ') || '';

  return template
    .replace(/\{firstName\}/gi, firstName)
    .replace(/\{lastName\}/gi, lastName)
    .replace(/\{fullName\}/gi, fullName);
}

async function clickConnectButton() {
  console.log('[LinkedIn Outbound] Looking for Connect button...');

  // Find the main profile hero section first - all checks should be scoped to this
  const mainProfileSection = document.querySelector('.ph5.pb5') || document.querySelector('.pv-top-card') || document.querySelector('main section:first-child');
  console.log('[LinkedIn Outbound] Main profile section found:', !!mainProfileSection);

  // ============================================================
  // CHECK 1: Already connected (1st degree + Remove Connection)
  // ============================================================
  const distanceBadge = mainProfileSection?.querySelector('.distance-badge .dist-value, .dist-value')
                        || document.querySelector('.ph5 .distance-badge .dist-value');
  const is1stDegree = distanceBadge?.textContent?.trim() === '1st';

  if (is1stDegree) {
    console.log('[LinkedIn Outbound] Found 1st degree badge, checking for Remove Connection...');

    // Open More dropdown to check for Remove Connection (within hero section)
    const moreBtn = mainProfileSection?.querySelector('button[aria-label="More actions"]');
    if (moreBtn) {
      moreBtn.click();
      await sleep(800);

      const dropdown = moreBtn.closest('.artdeco-dropdown');
      const dropdownItems = dropdown
        ? dropdown.querySelectorAll('.artdeco-dropdown__item[role="button"]')
        : document.querySelectorAll('.artdeco-dropdown__item[role="button"]');

      for (const item of dropdownItems) {
        const ariaLabel = item.getAttribute('aria-label')?.toLowerCase() || '';
        const text = item.textContent?.toLowerCase() || '';

        if ((ariaLabel.includes('remove') && ariaLabel.includes('connection')) ||
            text.includes('remove connection')) {
          console.log('[LinkedIn Outbound] Found 1st degree + Remove Connection - already connected');
          document.body.click(); // Close dropdown
          await sleep(300);
          window._linkedinAlreadyConnected = true;
          return false;
        }
      }

      // Close dropdown before continuing
      document.body.click();
      await sleep(300);
    }
  }

  // ============================================================
  // CHECK 2: Pending (invitation already sent)
  // ============================================================
  // IMPORTANT: Only check within the main profile hero section (.ph5, .pv-top-card)
  // NOT the sidebar recommendations which may have Pending buttons for other people

  if (mainProfileSection) {
    // Look for Pending button with aria-label within main profile only
    const pendingBtn = mainProfileSection.querySelector('button[aria-label^="Pending"]');
    if (pendingBtn) {
      const ariaLabel = pendingBtn.getAttribute('aria-label');
      if (ariaLabel?.toLowerCase().includes('withdraw') || ariaLabel?.toLowerCase().includes('pending invitation')) {
        window._linkedinPendingConnection = true;
        return false;
      }
    }

    // Also check for button with exact text "Pending" in main profile action buttons only
    const actionButtons = mainProfileSection.querySelectorAll('button.artdeco-button');
    for (const btn of actionButtons) {
      const btnText = btn.querySelector('.artdeco-button__text')?.innerText?.trim().toLowerCase() || '';
      if (btnText === 'pending') {
        window._linkedinPendingConnection = true;
        return false;
      }
    }
  }

  // ============================================================
  // CHECK 3: Direct Connect button visible (in main profile section only)
  // ============================================================
  if (mainProfileSection) {
    const connectBtn = mainProfileSection.querySelector('button[aria-label*="Invite"][aria-label*="to connect"]');
    if (connectBtn) {
      console.log('[LinkedIn Outbound] Found direct Connect button via aria-label');
      connectBtn.click();
      await sleep(500);
      return true;
    }

    // Also check by button text within hero section only
    const heroBtns = mainProfileSection.querySelectorAll('button');
    for (const btn of heroBtns) {
      const btnText = btn.querySelector('.artdeco-button__text')?.innerText?.trim().toLowerCase() || '';
      const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';

      if (btnText === 'connect' || (ariaLabel.includes('invite') && ariaLabel.includes('connect'))) {
        console.log('[LinkedIn Outbound] Found Connect button by text:', btnText);
        btn.click();
        await sleep(500);
        return true;
      }
    }
  }

  // ============================================================
  // CHECK 4: Connect button in More dropdown (in main profile section only)
  // ============================================================
  const moreBtn = mainProfileSection?.querySelector('button[aria-label="More actions"]');
  if (moreBtn) {
    console.log('[LinkedIn Outbound] Opening More dropdown to find Connect...');
    moreBtn.click();
    await sleep(800);

    // Get dropdown items from the dropdown that just opened (should be near the More button)
    const dropdown = moreBtn.closest('.artdeco-dropdown');
    const dropdownItems = dropdown
      ? dropdown.querySelectorAll('.artdeco-dropdown__item[role="button"]')
      : document.querySelectorAll('.artdeco-dropdown__item[role="button"]');
    console.log('[LinkedIn Outbound] Found', dropdownItems.length, 'dropdown items');

    for (const item of dropdownItems) {
      const ariaLabel = item.getAttribute('aria-label')?.toLowerCase() || '';
      const text = item.textContent?.toLowerCase() || '';

      console.log('[LinkedIn Outbound] Dropdown item:', ariaLabel.substring(0, 50));

      // Look for "Invite ... to connect" in aria-label
      if (ariaLabel.includes('invite') && ariaLabel.includes('connect')) {
        console.log('[LinkedIn Outbound] Found Connect in dropdown, clicking...');
        item.click();
        await sleep(500);
        return true;
      }

      // Fallback: check text content for Connect (but not "Remove Connection" or "disconnect")
      if (text.includes('connect') && !text.includes('disconnect') && !text.includes('remove') && !text.includes('send profile')) {
        console.log('[LinkedIn Outbound] Found Connect by text in dropdown, clicking...');
        item.click();
        await sleep(500);
        return true;
      }
    }

    // Close dropdown
    document.body.click();
    await sleep(300);
    console.log('[LinkedIn Outbound] Connect not found in dropdown');
  } else {
    console.log('[LinkedIn Outbound] More button not found');
  }

  // ============================================================
  // CHECK 5: Failed - could not find Connect button
  // ============================================================
  console.log('[LinkedIn Outbound] Connect button not found anywhere');
  return false;
}

function findButtonByAriaLabel(label) {
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
    if (ariaLabel.includes(label.toLowerCase())) {
      return btn;
    }
  }
  return null;
}

async function clickAddNote() {
  console.log('[LinkedIn Outbound] Looking for Add a note button...');

  // Wait a moment for modal content to render
  await sleep(300);

  // Method 1: Find by aria-label (most reliable based on actual HTML)
  const addNoteBtn = document.querySelector('button[aria-label="Add a note"]');
  if (addNoteBtn) {
    console.log('[LinkedIn Outbound] Found Add a note button via aria-label');
    addNoteBtn.click();
    return true;
  }

  // Method 2: Look for button with text "Add a note"
  const buttons = document.querySelectorAll('.artdeco-modal button, #artdeco-modal-outlet button');
  for (const btn of buttons) {
    const text = btn.innerText?.trim().toLowerCase() || '';
    const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';

    if (text === 'add a note' || ariaLabel === 'add a note') {
      console.log('[LinkedIn Outbound] Found Add a note button via text');
      btn.click();
      return true;
    }
  }

  // Check if textarea is already visible (some flows skip the "Add a note" button)
  const textarea = document.querySelector('.artdeco-modal textarea, #artdeco-modal-outlet textarea');
  if (textarea && textarea.offsetParent !== null) {
    console.log('[LinkedIn Outbound] Textarea already visible, skipping Add a note');
    return true;
  }

  console.log('[LinkedIn Outbound] Add a note button not found');
  return false;
}

async function typeMessage(message) {
  console.log('[LinkedIn Outbound] Looking for message textarea...');

  // Wait for textarea to be ready
  await sleep(500);

  // Find the textarea for the note - try specific selectors first based on actual LinkedIn HTML
  const selectors = [
    'textarea#custom-message',                              // Primary: exact ID from LinkedIn
    'textarea[name="message"]',                             // By name attribute
    '.connect-button-send-invite__custom-message',          // By LinkedIn's specific class
    '#artdeco-modal-outlet textarea',                       // Inside modal outlet
    '.artdeco-modal textarea',                              // Inside modal
    '[role="dialog"] textarea',                             // Inside dialog
    '.send-invite textarea',                                // Inside send-invite modal
    'textarea'                                              // Fallback: any textarea
  ];

  for (const selector of selectors) {
    const textareas = document.querySelectorAll(selector);

    for (const textarea of textareas) {
      // Make sure it's visible
      if (textarea.offsetParent === null) continue;

      console.log('[LinkedIn Outbound] Found textarea:', selector);

      // Clear and focus
      textarea.focus();
      textarea.value = '';

      // Use multiple methods to set value (LinkedIn uses React)
      // Method 1: Direct value set
      textarea.value = message;

      // Method 2: Native input setter (bypasses React's synthetic events)
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      nativeInputValueSetter.call(textarea, message);

      // Method 3: Dispatch events
      textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
      textarea.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

      // Verify the value was set
      await sleep(200);
      if (textarea.value === message) {
        console.log('[LinkedIn Outbound] Message typed successfully');
        return true;
      }
    }
  }

  console.log('[LinkedIn Outbound] Could not find/fill textarea');
  return false;
}

async function clickSendButton() {
  // Wait a bit for button to become active
  await sleep(500);

  console.log('[LinkedIn Outbound] Looking for Send button...');

  // Try multiple times as LinkedIn may have async button state updates
  for (let attempt = 0; attempt < 3; attempt++) {
    // Method 1: Look for Send button by aria-label inside modal
    const sendByAriaLabel = document.querySelector('#artdeco-modal-outlet button[aria-label*="Send"]') ||
                            document.querySelector('.artdeco-modal button[aria-label*="Send"]');
    if (sendByAriaLabel && !sendByAriaLabel.disabled) {
      console.log('[LinkedIn Outbound] Found Send button via aria-label');
      sendByAriaLabel.click();
      await sleep(300);
      return true;
    }

    // Method 2: Look for primary button inside modal with "Send" text
    const modalButtons = document.querySelectorAll('#artdeco-modal-outlet button, .artdeco-modal button, .send-invite button');
    for (const btn of modalButtons) {
      const text = btn.innerText?.trim().toLowerCase() || '';
      const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';

      // Skip dismiss/close/cancel buttons
      if (ariaLabel === 'dismiss' || text.includes('cancel') || text.includes('close') || text.includes('add a note')) {
        continue;
      }

      // Check for Send variations
      const isSendButton = text === 'send' ||
                           text.includes('send invitation') ||
                           text.includes('send without') ||
                           text.includes('send now') ||
                           ariaLabel.includes('send');

      if (isSendButton && !btn.disabled && btn.offsetParent !== null) {
        console.log('[LinkedIn Outbound] Found Send button:', text, '|', ariaLabel);
        btn.click();
        await sleep(300);
        return true;
      }
    }

    // Method 3: Find primary button in modal (usually the action button)
    const primaryInModal = document.querySelector('#artdeco-modal-outlet .artdeco-button--primary') ||
                           document.querySelector('.artdeco-modal .artdeco-button--primary');
    if (primaryInModal && !primaryInModal.disabled) {
      const text = primaryInModal.innerText?.trim().toLowerCase() || '';
      const ariaLabel = primaryInModal.getAttribute('aria-label')?.toLowerCase() || '';
      // Make sure it's not "Add a note" (which is secondary anyway)
      if (!text.includes('add') && ariaLabel !== 'dismiss') {
        console.log('[LinkedIn Outbound] Found primary button in modal:', text);
        primaryInModal.click();
        await sleep(300);
        return true;
      }
    }

    // Wait before retry
    await sleep(500);
    console.log('[LinkedIn Outbound] Send button not found, attempt', attempt + 1);
  }

  return false;
}

async function checkConnectionStatus() {
  console.log('[LinkedIn Outbound] Checking connection status...');

  // Check if we already detected status during Connect button search
  if (window._linkedinPendingConnection) {
    window._linkedinPendingConnection = false; // Reset for next profile
    return 'Connection already pending';
  }

  if (window._linkedinAlreadyConnected) {
    window._linkedinAlreadyConnected = false; // Reset for next profile
    return 'Already connected';
  }

  // Check if only Follow is available (no Connect option anywhere)
  const followBtn = document.querySelector('button[aria-label*="Follow"]');
  const connectBtn = document.querySelector('button[aria-label*="Invite"][aria-label*="connect"]');
  // Also check for Connect in dropdown (it's a div, not button)
  const connectInDropdown = document.querySelector('div[aria-label*="Invite"][aria-label*="connect"]');

  if (followBtn && !connectBtn && !connectInDropdown) {
    return 'Profile only allows Follow (not Connect)';
  }

  return null;
}

function findButtonByText(text) {
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    if (btn.textContent.trim().toLowerCase() === text.toLowerCase()) {
      return btn;
    }
  }
  return null;
}

function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(selector)) {
      resolve(document.querySelector(selector));
      return;
    }

    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) {
        observer.disconnect();
        resolve(document.querySelector(selector));
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Element ${selector} not found within ${timeout}ms`));
    }, timeout);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sendResult(success, error, profileName) {
  chrome.runtime.sendMessage({
    action: 'connectionResult',
    success,
    error,
    profileName
  });
}
