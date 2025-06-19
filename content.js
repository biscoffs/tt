// TikTok Profile Enhancer - content.js
// IMPORTANT: This initial console.log should be one of the very first things.
console.log('TikTok Profile Enhancer: Script execution started.'); 
const DEBUG_MODE = true; // Set to true for verbose debugging in the console
const ENABLE_OBSERVERS = true; // Set to false to disable observers for testing

// --- Globals for Observers and State ---
let isProcessingPage = false;
let newVideoIdsOnPage = []; // To store IDs of new videos identified on the current page
let currentProfileUsernameProcessed = ''; // Store the username of the profile last processed
let mainDomObserver = null; // Observes general DOM changes
let navigationObserver = null; // Observes for URL/navigation changes
let rightClickReapplyInterval = null; // Interval ID for re-applying right-click
let debouncedProcessPageForMainObserver = null; // Will be initialized in initializeObservers
let debouncedHandleMainPageMutations = null; // For debouncing mutation observer direct actions.


// --- Debounce Function ---
function debounce(func, delay) {
  let timeoutId;
  return function(...args) {
    if (DEBUG_MODE && timeoutId) console.log(`TikTok Profile Enhancer: Debounce clearing previous timeout ${timeoutId} for ${func.name}`);
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: Debounce executing for ${func.name}`);
      func.apply(this, args);
    }, delay);
  };
}


// --- Right-Click Enabler ---
function enableRightClick() {
  if (DEBUG_MODE) console.log('TikTok Profile Enhancer: enableRightClick called.');
  // Clear previous interval if it exists, to prevent multiple intervals running
  if (rightClickReapplyInterval) {
    if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Clearing existing rightClickReapplyInterval.');
    clearInterval(rightClickReapplyInterval);
  }

  // Add a capturing event listener to stop `contextmenu` events from being blocked
  if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Adding contextmenu listener.');
  document.addEventListener('contextmenu', function(event) {
    event.stopPropagation();
    event.stopImmediatePropagation();
  }, true);

  // Nullify oncontextmenu for body and document
  if (document.body) {
    document.body.oncontextmenu = null;
  }
  document.oncontextmenu = null;

  // Periodically re-apply nullification as some scripts might add it back
  rightClickReapplyInterval = setInterval(() => {
    let changed = false;
    if (document.body && document.body.oncontextmenu !== null) {
      document.body.oncontextmenu = null;
      changed = true;
    }
    if (document.oncontextmenu !== null) {
      document.oncontextmenu = null;
      changed = true;
    }
    if (DEBUG_MODE && changed) console.log('TikTok Profile Enhancer: Right-click properties re-nullified by interval.');
  }, 2000); // Re-apply every 2 seconds
  if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Right-click enabled and periodic check active.');
}

// --- Profile Username Extraction ---
function getProfileUsernameFromUrl() {
  if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Attempting to get username from URL:', window.location.pathname);
  const pathParts = window.location.pathname.split('/').filter(part => part.trim() !== '');
  if (pathParts.length > 0 && pathParts[0].startsWith('@')) {
    const username = pathParts[0].substring(1);
    if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Username found:', username);
    return username;
  }
  if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Could not extract username from URL.');
  return null;
}

// --- Tab Bar Element Location ---
function findTabBarElement() {
  if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Attempting to find tab bar element...');
  // Primary selector using data-e2e attribute
  let tabBar = document.querySelector('[data-e2e="user-profile-tabs"]');
  if (tabBar) {
    if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Tab bar found with data-e2e selector.');
    return tabBar;
  }
  if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Tab bar not found with data-e2e, trying fallback.');

  // Fallback: More complex search based on known tab texts
  const knownTabTexts = ['Videos', 'Liked', 'Favourites', 'Reposts', 'Playlists'];
  const potentialTabElements = Array.from(document.querySelectorAll('p, button, div[role="tab"]'));

  for (const el of potentialTabElements) {
    if (knownTabTexts.includes(el.textContent.trim())) {
      let parentCandidate = el.parentElement;
      for (let i = 0; i < 5 && parentCandidate; i++) { // Check up to 5 levels up
        const children = Array.from(parentCandidate.children);
        let matchingTabsFound = 0;
        for (const child of children) {
          if (child.textContent && knownTabTexts.includes(child.textContent.trim())) {
            matchingTabsFound++;
          }
        }
        // If a parent contains multiple known tab texts and is visible
        if (matchingTabsFound > 1 && parentCandidate.offsetParent !== null) {
          if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Found potential tab bar via fallback:', parentCandidate);
          return parentCandidate;
        }
        parentCandidate = parentCandidate.parentElement;
      }
    }
  }
  if (DEBUG_MODE) console.warn('TikTok Profile Enhancer: Could not find tab bar element after all attempts.');
  return null;
}

// --- Page Data Extraction (formerly extractTotalVideoCount) ---
function extractPageData(usernameToFind) {
  if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: Attempting to extract page data for ${usernameToFind}`);
  let videoCount = null;
  let videoIds = [];
  let foundVideoCountPath = "N/A";
  let itemsSource = "N/A";

  try {
    const scriptElement = document.getElementById('SIGI_STATE') || 
                          document.querySelector('script[id^="__UNIVERSAL_DATA_FOR_REHYDRATION__"]');
    if (!scriptElement || !scriptElement.textContent) {
      if (DEBUG_MODE) console.warn('TikTok Profile Enhancer: JSON data script element not found or empty.');
      return { videoCount, videoIds };
    }
    if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Found script element:', scriptElement.id);

    let jsonData;
    try {
      jsonData = JSON.parse(scriptElement.textContent);
      if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Successfully parsed JSON data.');
    } catch (e) {
      if (DEBUG_MODE) console.error('TikTok Profile Enhancer: Failed to parse JSON data from script element.', e, e.stack);
      return { videoCount, videoIds };
    }

    // --- Primary Target for Data: __DEFAULT_SCOPE__['webapp.user-detail'] ---
    let userDetailData = null;
    if (jsonData && jsonData.__DEFAULT_SCOPE__ && 
        typeof jsonData.__DEFAULT_SCOPE__ === 'object' && jsonData.__DEFAULT_SCOPE__ !== null &&
        jsonData.__DEFAULT_SCOPE__['webapp.user-detail'] && 
        typeof jsonData.__DEFAULT_SCOPE__['webapp.user-detail'] === 'object') {
      userDetailData = jsonData.__DEFAULT_SCOPE__['webapp.user-detail'];
      if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Found 'webapp.user-detail' object. Keys:", Object.keys(userDetailData));
    } else {
      if (DEBUG_MODE) console.log("TikTok Profile Enhancer: 'webapp.user-detail' object not found. Will use root jsonData for some fallbacks.");
    }

    // --- Extract videoCount ---
    // Path 1.1: userInfo.stats.videoCount (within userDetailData)
    if (userDetailData && userDetailData.userInfo && userDetailData.userInfo.stats && typeof userDetailData.userInfo.stats.videoCount === 'number') {
        videoCount = userDetailData.userInfo.stats.videoCount;
        foundVideoCountPath = "webapp.user-detail.userInfo.stats.videoCount";
    }
    // Path 1.2: userDetailData.stats.videoCount (if username matches userInfo)
    else if (userDetailData && userDetailData.stats && typeof userDetailData.stats.videoCount === 'number' &&
             userDetailData.userInfo && (userDetailData.userInfo.uniqueId === usernameToFind || userDetailData.userInfo.nickName === usernameToFind)) {
        videoCount = userDetailData.stats.videoCount;
        foundVideoCountPath = "webapp.user-detail.stats.videoCount (username matched userInfo)";
    }
    // Path 1.3: UserModule within userDetailData
    else if (userDetailData && userDetailData.UserModule && userDetailData.UserModule.users && userDetailData.UserModule.users[usernameToFind] &&
             userDetailData.UserModule.users[usernameToFind].stats && typeof userDetailData.UserModule.users[usernameToFind].stats.videoCount === 'number') {
        videoCount = userDetailData.UserModule.users[usernameToFind].stats.videoCount;
        foundVideoCountPath = "webapp.user-detail.UserModule.users[username].stats.videoCount";
    }
    // Path 1.4: Iterate UserModule within userDetailData
    else if (userDetailData && userDetailData.UserModule && userDetailData.UserModule.users) {
        const users = userDetailData.UserModule.users;
        for (const key in users) {
            if (users.hasOwnProperty(key) && (users[key].uniqueId === usernameToFind || users[key].nickName === usernameToFind) &&
                users[key].stats && typeof users[key].stats.videoCount === 'number') {
                videoCount = users[key].stats.videoCount;
                foundVideoCountPath = `webapp.user-detail.UserModule.users[${key}].stats.videoCount (iterated)`;
                break;
            }
        }
    }
    // Path 2 (Fallback): UserModule at root jsonData
    else if (jsonData.UserModule && jsonData.UserModule.users && jsonData.UserModule.users[usernameToFind] &&
             jsonData.UserModule.users[usernameToFind].stats && typeof jsonData.UserModule.users[usernameToFind].stats.videoCount === 'number') {
        videoCount = jsonData.UserModule.users[usernameToFind].stats.videoCount;
        foundVideoCountPath = "root.UserModule.users[username].stats.videoCount";
    }
    // Path 3 (Fallback): Iterate UserModule at root jsonData
    else if (jsonData.UserModule && jsonData.UserModule.users) {
        const users = jsonData.UserModule.users;
         for (const key in users) {
            if (users.hasOwnProperty(key) && (users[key].uniqueId === usernameToFind || users[key].nickName === usernameToFind) &&
                users[key].stats && typeof users[key].stats.videoCount === 'number') {
                videoCount = users[key].stats.videoCount;
                foundVideoCountPath = `root.UserModule.users[${key}].stats.videoCount (iterated)`;
                break;
            }
        }
    }
    if (DEBUG_MODE && videoCount !== null) console.log(`TikTok Profile Enhancer: videoCount ${videoCount} found at ${foundVideoCountPath}`);

    // --- Extract videoIds ---
    // Path A: From userDetailData.UserModule.users[usernameToFind].itemList
    if (userDetailData && userDetailData.UserModule && userDetailData.UserModule.users &&
        userDetailData.UserModule.users[usernameToFind] && Array.isArray(userDetailData.UserModule.users[usernameToFind].itemList)) {
        userDetailData.UserModule.users[usernameToFind].itemList.forEach(item => { if(item && item.id) videoIds.push(item.id); });
        itemsSource = "webapp.user-detail.UserModule.users[username].itemList";
    }
    // Path B: From userDetailData.UserModule.itemList (if it's a direct list, less common for specific user)
    else if (userDetailData && userDetailData.UserModule && Array.isArray(userDetailData.UserModule.itemList)) {
        userDetailData.UserModule.itemList.forEach(item => { if(item && item.id) videoIds.push(item.id); });
        itemsSource = "webapp.user-detail.UserModule.itemList";
    }
     // Path C: From userDetailData.ItemModule (if video IDs are there, structure may vary)
    else if (userDetailData && userDetailData.ItemModule && typeof userDetailData.ItemModule === 'object') {
        Object.values(userDetailData.ItemModule).forEach(item => { if(item && item.id && item.author === usernameToFind) videoIds.push(item.id); }); // Check author
        itemsSource = "webapp.user-detail.ItemModule (filtered by author)";
        if(videoIds.length === 0) { // If filtering by author fails, try to grab all if only one user seems present
             const uniqueAuthors = new Set(Object.values(userDetailData.ItemModule).map(item => item.author));
             if (uniqueAuthors.size === 1 && uniqueAuthors.has(usernameToFind)) {
                Object.values(userDetailData.ItemModule).forEach(item => { if(item && item.id) videoIds.push(item.id); });
                itemsSource = "webapp.user-detail.ItemModule (all items, single author assumed)";
             }
        }
    }
    // Path D: (Fallback) From root jsonData.ItemModule
    else if (jsonData.ItemModule && typeof jsonData.ItemModule === 'object') {
        Object.values(jsonData.ItemModule).forEach(item => { if(item && item.id && item.author === usernameToFind) videoIds.push(item.id); });
        itemsSource = "root.ItemModule (filtered by author)";
         if(videoIds.length === 0) { 
             const uniqueAuthors = new Set(Object.values(jsonData.ItemModule).map(item => item.author));
             if (uniqueAuthors.size === 1 && uniqueAuthors.has(usernameToFind)) {
                Object.values(jsonData.ItemModule).forEach(item => { if(item && item.id) videoIds.push(item.id); });
                itemsSource = "root.ItemModule (all items, single author assumed)";
             }
        }
    }


    if (DEBUG_MODE) {
      console.log(`TikTok Profile Enhancer: Extracted videoCount: ${videoCount} (from ${foundVideoCountPath})`);
      console.log(`TikTok Profile Enhancer: Extracted ${videoIds.length} video IDs (from ${itemsSource || 'N/A'}). First 5:`, videoIds.slice(0,5));
      if (videoIds.length === 0 && videoCount !== null && videoCount > 0) {
          console.warn(`TikTok Profile Enhancer: videoCount is ${videoCount}, but no video IDs were extracted. Potential issue with itemList path.`);
          if (userDetailData) console.log("  Keys for userDetailData:", Object.keys(userDetailData));
          if (userDetailData && userDetailData.UserModule) console.log("  Keys for userDetailData.UserModule:", Object.keys(userDetailData.UserModule));
          if (jsonData.ItemModule) console.log("  Keys for jsonData.ItemModule:", Object.keys(jsonData.ItemModule));
      }
    }
    
    return { videoCount, videoIds };

  } catch (error) {
    if (DEBUG_MODE) console.error('TikTok Profile Enhancer: Error in extractPageData:', error, error.stack);
    else console.error('TikTok Profile Enhancer: Error extracting page data.');
    return { videoCount, videoIds }; // Return whatever was found, even if partial
  }
}

// --- Helper: URL Collection & Filtering ---
function getAllVideoUrlsFromPage() {
  if (DEBUG_MODE) console.log("TikTok Profile Enhancer: getAllVideoUrlsFromPage - Attempting to collect video URLs from DOM.");
  // Selector targets <a> tags likely to be video links within item containers.
  // This might need refinement based on actual DOM structure.
  // Common TikTok structure: DivItemContainer -> DivBasicLinkWrapper -> a tag
  // data-e2e="user-post-item" is often on a parent div.
  const videoElements = document.querySelectorAll('div[data-e2e="user-post-item"] a[href*="/video/"]');
  const urls = [];
  videoElements.forEach(el => {
    if (el.href && !urls.includes(el.href)) { // Ensure href exists and avoid duplicates
      urls.push(el.href);
    }
  });
  if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: getAllVideoUrlsFromPage - Found ${urls.length} video URLs.`);
  return urls;
}

function getNewVideoUrls(allVideoUrls, newIds) {
  if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: getNewVideoUrls - Filtering for ${newIds.length} new video IDs.`);
  if (!Array.isArray(allVideoUrls) || !Array.isArray(newIds) || newIds.length === 0) {
    return [];
  }
  const newUrls = allVideoUrls.filter(url => {
    return newIds.some(id => url.includes(`/video/${id}`));
  });
  if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: getNewVideoUrls - Found ${newUrls.length} new video URLs from ${allVideoUrls.length} total DOM URLs.`);
  return newUrls;
}


// --- UI Injection ---
function removeInjectedUI() {
  if (DEBUG_MODE) console.log('TikTok Profile Enhancer: removeInjectedUI called.');
  const existingContainer = document.getElementById('tiktok-enhancer-ui-container');
  if (existingContainer) {
    existingContainer.remove();
    if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Removed existing UI container.');
  }
}

function injectVideoCountsUI(tabBarEl, totalCount, newCount) {
  if (DEBUG_MODE) console.log('TikTok Profile Enhancer: injectVideoCountsUI called with total:', totalCount, 'new count:', newCount);
  if (!tabBarEl) {
    if (DEBUG_MODE) console.warn('TikTok Profile Enhancer: Tab bar element not provided for UI injection.');
    return;
  }
  removeInjectedUI(); 

  const uiContainer = document.createElement('div');
  uiContainer.id = 'tiktok-enhancer-ui-container';
  uiContainer.className = 'tiktok-enhancer-info-container';

  let clipboardIconUrl = "";
  try {
    clipboardIconUrl = chrome.runtime.getURL("images/clipboard.png");
  } catch (e) {
    if (DEBUG_MODE) console.error("TikTok Profile Enhancer: Error getting clipboardIconUrl", e);
    // Fallback or leave empty if you don't have a placeholder
  }


  // Total Videos Display
  const totalVideosWrapper = document.createElement('div');
  totalVideosWrapper.style.display = 'flex';
  totalVideosWrapper.style.alignItems = 'center';
  
  const totalVideosEl = document.createElement('div');
  totalVideosEl.id = 'tiktok-total-videos-display';
  totalVideosEl.className = 'tiktok-enhancer-info-item';
  totalVideosEl.textContent = `Total Videos: ${totalCount !== null ? totalCount : 'N/A'}`;
  totalVideosWrapper.appendChild(totalVideosEl);

  if (totalCount !== null && clipboardIconUrl) { // Only show copy icon if there's a count and icon URL
    const totalCopyIcon = document.createElement('img');
    totalCopyIcon.id = 'tiktok-total-videos-copy-icon';
    totalCopyIcon.src = clipboardIconUrl;
    totalCopyIcon.className = 'tiktok-enhancer-clipboard-icon';
    totalCopyIcon.title = 'Copy all video URLs'; // Tooltip
    // Styles moved to CSS, but direct style for size as per instruction
    totalCopyIcon.style.width = '20px'; 
    totalCopyIcon.style.height = '20px';
    // Other styles like cursor, marginLeft are in CSS
    totalVideosWrapper.appendChild(totalCopyIcon);
  }
  uiContainer.appendChild(totalVideosWrapper);

  // New Videos Display
  const newVideosWrapper = document.createElement('div');
  newVideosWrapper.style.display = 'flex';
  newVideosWrapper.style.alignItems = 'center';
  newVideosWrapper.style.marginLeft = '15px'; // Space between total and new sections

  const newVideosEl = document.createElement('div');
  newVideosEl.id = 'tiktok-new-videos-display';
  newVideosEl.className = 'tiktok-enhancer-info-item';
  newVideosEl.textContent = `New: ${newCount !== null ? newCount : 'N/A'}`;
  newVideosWrapper.appendChild(newVideosEl);

  if (newCount !== null && newCount > 0 && clipboardIconUrl) { // Only show copy icon if there are new videos and icon URL
    const newCopyIcon = document.createElement('img');
    newCopyIcon.id = 'tiktok-new-videos-copy-icon';
    newCopyIcon.src = clipboardIconUrl;
    newCopyIcon.className = 'tiktok-enhancer-clipboard-icon';
    newCopyIcon.title = 'Copy new video URLs'; // Tooltip
    newCopyIcon.style.width = '20px';
    newCopyIcon.style.height = '20px';
    newVideosWrapper.appendChild(newCopyIcon);
  }
  uiContainer.appendChild(newVideosWrapper);
  
  tabBarEl.appendChild(uiContainer);
  if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Injected video counts UI with clipboard icons.');

  // Attach event listeners to icons
  const totalCopyIcon = totalVideosWrapper.querySelector('#tiktok-total-videos-copy-icon');
  if (totalCopyIcon) {
    totalCopyIcon.addEventListener('click', async () => {
      if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Total videos copy icon clicked.");
      const allUrls = getAllVideoUrlsFromPage();
      if (allUrls.length > 0) {
        try {
          await navigator.clipboard.writeText(allUrls.join('\n')); // Join with newline for readability
          if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Copied all loaded video URLs to clipboard:", allUrls.join('\n'));
          totalCopyIcon.style.opacity = '0.5'; // Basic visual feedback
          setTimeout(() => { totalCopyIcon.style.opacity = '0.6'; }, 500);
        } catch (err) {
          console.error('TikTok Profile Enhancer: Failed to copy all URLs to clipboard:', err);
        }
      } else {
        if (DEBUG_MODE) console.log("TikTok Profile Enhancer: No video URLs found in DOM to copy for 'all'.");
      }
    });
  }

  const newCopyIcon = newVideosWrapper.querySelector('#tiktok-new-videos-copy-icon');
  if (newCopyIcon) {
    newCopyIcon.addEventListener('click', async () => {
      if (DEBUG_MODE) console.log("TikTok Profile Enhancer: New videos copy icon clicked. newVideoIdsOnPage:", newVideoIdsOnPage);
      if (newVideoIdsOnPage && newVideoIdsOnPage.length > 0) {
        const allUrlsOnPage = getAllVideoUrlsFromPage(); 
        const newUrlsToCopy = getNewVideoUrls(allUrlsOnPage, newVideoIdsOnPage);
        if (newUrlsToCopy.length > 0) {
          try {
            await navigator.clipboard.writeText(newUrlsToCopy.join('\n')); // Join with newline
            if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Copied new video URLs to clipboard:", newUrlsToCopy.join('\n'));
            newCopyIcon.style.opacity = '0.5'; // Basic visual feedback
            setTimeout(() => { newCopyIcon.style.opacity = '0.6'; }, 500);
          } catch (err) {
            console.error('TikTok Profile Enhancer: Failed to copy new URLs to clipboard:', err);
          }
        } else {
          if (DEBUG_MODE) console.log("TikTok Profile Enhancer: No new video URLs found in DOM to copy (though new IDs were present). This might mean videos aren't loaded in DOM yet.");
        }
      } else {
        if (DEBUG_MODE) console.log("TikTok Profile Enhancer: No new video IDs to look for, or newVideoIdsOnPage is empty.");
      }
    });
  }
}

// --- Chrome Storage Interaction ---
function getStoredDataForProfile(usernameKey, callback) {
  if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Attempting to get stored data for key:', usernameKey);
  chrome.storage.local.get(usernameKey, (result) => {
    if (chrome.runtime.lastError) {
      console.error('TikTok Profile Enhancer: Storage get error for key', usernameKey, ':', chrome.runtime.lastError.message);
      callback(null);
    } else {
      if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Successfully retrieved data for key', usernameKey, ':', result[usernameKey]);
      callback(result[usernameKey]);
    }
  });
}

function setStoredDataForProfile(usernameKey, data, callback) {
  if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Attempting to set stored data for key:', usernameKey, 'with data:', data);
  let storeObj = {};
  storeObj[usernameKey] = data;
  chrome.storage.local.set(storeObj, () => {
    if (chrome.runtime.lastError) {
      console.error('TikTok Profile Enhancer: Storage set error for key', usernameKey, ':', chrome.runtime.lastError.message);
      if (callback) callback(false);
    } else {
      if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Successfully stored data for key', usernameKey);
      if (callback) callback(true);
    }
  });
}

// --- Core Logic Orchestration ---
async function processProfilePage() {
  const initialUsernameForLog = getProfileUsernameFromUrl() || currentProfileUsernameProcessed;
  if (isProcessingPage) {
    if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: processProfilePage - SKIPPED as processing is already in progress for user: ${initialUsernameForLog}`);
    return;
  }
  isProcessingPage = true;
  if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: processProfilePage - STARTED, isProcessingPage = true for user: ${initialUsernameForLog}`);

  try {
    enableRightClick(); 

    const currentUsername = getProfileUsernameFromUrl();
    if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: processProfilePage - Current username from URL: ${currentUsername}`);

    if (!currentUsername) {
      if (currentProfileUsernameProcessed) {
        if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: processProfilePage - No current username, removing UI if any for ${currentProfileUsernameProcessed}`);
        removeInjectedUI();
      }
      currentProfileUsernameProcessed = '';
      newVideoIdsOnPage = []; // Clear new video IDs
    } else if (currentUsername === currentProfileUsernameProcessed && document.getElementById('tiktok-enhancer-ui-container')) {
      if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Profile already processed and UI exists for', currentUsername);
      // Still might need to re-apply styles if DOM changed for videos
      if(newVideoIdsOnPage.length > 0) applyStylingToNewVideos(newVideoIdsOnPage);
    } else {
        if (currentUsername !== currentProfileUsernameProcessed) {
          if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Username changed from', currentProfileUsernameProcessed, 'to', currentUsername, '. Removing old UI.');
          removeInjectedUI();
          newVideoIdsOnPage = []; // Reset for new user
        }

        const tabBar = findTabBarElement();
        if (!tabBar) {
          console.warn('TikTok Profile Enhancer: Tab bar not found for', currentUsername, '. Will retry on next DOM change/navigation.');
        } else {
            if (DEBUG_MODE) console.log('TikTok Profile Enhancer: processProfilePage - Tab bar found:', tabBar);

            const pageData = extractPageData(currentUsername);
            const currentTotalVideos = pageData.videoCount;
            const currentVideoIds = pageData.videoIds || [];
            if (DEBUG_MODE) console.log('TikTok Profile Enhancer: processProfilePage - Extracted pageData.videoCount:', currentTotalVideos, 'videoIds count:', currentVideoIds.length);
            
            const storedProfileData = await new Promise(resolve => getStoredDataForProfile(currentUsername, resolve));
            if (DEBUG_MODE) console.log('TikTok Profile Enhancer: processProfilePage - storedProfileData:', storedProfileData);
            
            let newVideosCountForDisplay = 0;
            newVideoIdsOnPage = []; // Reset before calculation

            if (storedProfileData) { // If there's any stored data for this profile
                if (typeof storedProfileData.lastSeenVideoCount === 'number' && typeof currentTotalVideos === 'number' && currentTotalVideos > storedProfileData.lastSeenVideoCount) {
                    newVideosCountForDisplay = currentTotalVideos - storedProfileData.lastSeenVideoCount;
                }
                if (Array.isArray(storedProfileData.seenVideoIds) && currentVideoIds.length > 0) {
                    newVideoIdsOnPage = currentVideoIds.filter(id => !storedProfileData.seenVideoIds.includes(id));
                } else if (currentVideoIds.length > 0) { // No stored IDs, but current IDs exist (treat all as new for styling)
                     newVideoIdsOnPage = [...currentVideoIds];
                }
            } else if (currentVideoIds.length > 0) { // No stored data at all, first time seeing this profile with video IDs
                 if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: No stored data for ${currentUsername}. All ${currentVideoIds.length} videos on page considered new for styling.`);
                 newVideoIdsOnPage = [...currentVideoIds];
                 // newVideosCountForDisplay could be set to currentVideoIds.length or currentTotalVideos if available
                 if(typeof currentTotalVideos === 'number') newVideosCountForDisplay = currentTotalVideos;
            }
            
            if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: New video IDs identified for styling: ${newVideoIdsOnPage.length}`, newVideoIdsOnPage.slice(0,5));

            injectVideoCountsUI(tabBar, currentTotalVideos, newVideosCountForDisplay); 
            applyStylingToNewVideos(newVideoIdsOnPage);
            currentProfileUsernameProcessed = currentUsername; 

            if (typeof currentTotalVideos === 'number') { 
              const dataToStore = {
                lastSeenVideoCount: currentTotalVideos,
                lastVisitedTimestamp: new Date().toISOString(),
                seenVideoIds: currentVideoIds // Store all current IDs
              };
              if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Storing data for', currentUsername, ':', dataToStore);
              setStoredDataForProfile(currentUsername, dataToStore); // No need to await if not critical for subsequent steps
              console.log(`TikTok Profile Enhancer: Updated info for ${currentUsername}. Total: ${currentTotalVideos}, New (count): ${newVideosCountForDisplay}`);
            } else {
              console.warn(`TikTok Profile Enhancer: Not updating stored data for ${currentUsername} due to missing or invalid total video count.`);
              if (DEBUG_MODE) console.log('TikTok Profile Enhancer: totalVideos was not a number, so not storing data.');
            }
        }
        if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: processProfilePage - Successfully processed or attempted for ${currentUsername}`);
    }

  } catch (e) {
    console.error('TikTok Profile Enhancer: Critical error in processProfilePage:', e, e.stack);
    removeInjectedUI(); 
  } finally {
    isProcessingPage = false;
    if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: processProfilePage - FINISHED, isProcessingPage = false for user: ${initialUsernameForLog}`);
  }
}

// New helper function:
function applyStylingToNewVideos(idsToStyle) {
    if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: Attempting to style ${idsToStyle.length} new videos.`);
    if (!Array.isArray(idsToStyle) || idsToStyle.length === 0) return;

    idsToStyle.forEach(videoId => {
        // More robust selector: Find an item container that has a link to the video.
        // TikTok's structure for video items: often a div containing an 'a' tag with href like "/@username/video/videoId"
        // The class names are heavily obfuscated and change often (e.g., "tiktok-xkd6y9-DivItemContainerV2", "css-1soki6-DivItemContainerV2")
        // We look for a div that has a direct child 'a' with the video link.
        const potentialVideoContainers = document.querySelectorAll('div > a[href*="/video/' + videoId + '"]');
        
        potentialVideoContainers.forEach(linkElement => {
            const container = linkElement.parentElement; // The div containing the link
            if (container) {
                 // Check if it's a plausible video item container (e.g. by checking for an img tag inside)
                if (container.querySelector('img')) {
                    if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: Styling video container for ID ${videoId}:`, container);
                    container.classList.add('tiktok-enhancer-new-video-outline');
                } else {
                     if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: Found link for video ${videoId}, but parent div doesn't look like a video item (no img). Styling link's parent.`, container);
                     container.classList.add('tiktok-enhancer-new-video-outline');
                }
            }
        });
    });
}

// --- Mutation Observer Handler ---
function handleMainPageMutations(mutations) {
  if (DEBUG_MODE) console.log("TikTok Profile Enhancer: handleMainPageMutations received", mutations.length, "mutations.");
  
  let newVideosLikelyAppeared = false;
  for (const mutation of mutations) {
    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const videoItemSelector = 'div[data-e2e="user-post-item"]'; 
          let videoItemsFound = [];

          if (node.matches(videoItemSelector)) {
            videoItemsFound.push(node);
          } else if (node.querySelector(videoItemSelector)) { 
            videoItemsFound.push(...node.querySelectorAll(videoItemSelector));
          }

          if (videoItemsFound.length > 0 && DEBUG_MODE) {
            console.log(`TikTok Profile Enhancer: Found ${videoItemsFound.length} potential video item(s) in added node:`, node);
          }

          videoItemsFound.forEach(videoItemElement => {
            const linkElement = videoItemElement.querySelector('a[href*="/video/"]');
            if (linkElement && linkElement.href) {
              const urlParts = linkElement.href.split('/');
              const videoIdFromLink = urlParts[urlParts.length - 1].split('?')[0]; 

              if (videoIdFromLink && newVideoIdsOnPage.includes(videoIdFromLink)) {
                if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: New video ID ${videoIdFromLink} detected in DOM. Applying style to:`, videoItemElement);
                videoItemElement.classList.add('tiktok-enhancer-new-video-outline');
                newVideosLikelyAppeared = true; // Set this flag even if it's styled, to confirm activity
              }
            }
          });
        }
      }
    }
  }

  if (newVideosLikelyAppeared && DEBUG_MODE) {
    console.log("TikTok Profile Enhancer: Applied styles to newly appeared videos via direct mutation handling (or confirmed they were already styled if newVideoIdsOnPage was up-to-date).");
  }

  // Call the debounced version of processProfilePage for broader page integrity checks
  if (debouncedProcessProfilePageFromMutation) {
    debouncedProcessProfilePageFromMutation();
  }
}


// --- Mutation Observers Setup ---
function initializeObservers() {
  if (DEBUG_MODE) console.log('TikTok Profile Enhancer: initializeObservers() function called.');
  if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: ENABLE_OBSERVERS flag is set to: ${ENABLE_OBSERVERS}`);

  if (mainDomObserver) mainDomObserver.disconnect();
  if (navigationObserver) navigationObserver.disconnect();
  // Do not clear rightClickReapplyInterval here, it should persist across observer re-initializations if enableRightClick is called.
  // if (rightClickReapplyInterval) clearInterval(rightClickReapplyInterval); 


  debouncedProcessProfilePageFromMutation = debounce(function() {
    if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Debounced call to processProfilePage from mutation handler.");
    const currentUsername = getProfileUsernameFromUrl();
    if (currentUsername && (currentUsername !== currentProfileUsernameProcessed || !document.getElementById('tiktok-enhancer-ui-container'))) {
        processProfilePage();
    } else if (!currentUsername && currentProfileUsernameProcessed) { 
        processProfilePage(); 
    } else {
        if(DEBUG_MODE) console.log("TikTok Profile Enhancer: Debounced processProfilePage call skipped - UI likely exists or not on profile page requiring full process.");
    }
  }, 500); 


  // Debounce the mutation handler itself to avoid processing too many micro-mutations rapidly.
  debouncedHandleMainPageMutations = debounce(handleMainPageMutations, 250);
  mainDomObserver = new MutationObserver(debouncedHandleMainPageMutations); 
  
  if (ENABLE_OBSERVERS) {
    if (document.body) {
      mainDomObserver.observe(document.body, { childList: true, subtree: true });
      if (DEBUG_MODE) console.log('TikTok Profile Enhancer: mainDomObserver STARTED on document.body.');
    } else {
      if (DEBUG_MODE) console.log('TikTok Profile Enhancer: document.body not found, mainDomObserver NOT started.');
    }
  } else {
    if (DEBUG_MODE) console.log('TikTok Profile Enhancer: mainDomObserver is DISABLED by ENABLE_OBSERVERS flag.');
  }


  // Navigation Observer setup
  let lastObservedUrl = window.location.href;
  navigationObserver = new MutationObserver(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastObservedUrl) {
      if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: URL changed from ${lastObservedUrl} to ${currentUrl}. Triggering processProfilePage.`);
      lastObservedUrl = currentUrl;
      currentProfileUsernameProcessed = ''; 
      removeInjectedUI(); 
      processProfilePage(); 
    }
  });

  if (ENABLE_OBSERVERS) {
    const headElement = document.querySelector('head');
    if (headElement) {
      navigationObserver.observe(headElement, { childList: true, subtree: true });
      if (DEBUG_MODE) console.log('TikTok Profile Enhancer: navigationObserver STARTED on <head>.');
    } else {
      // Fallback if head is not immediately available
      if (document.documentElement) {
        navigationObserver.observe(document.documentElement, { childList: true, subtree: true });
        if (DEBUG_MODE) console.log('TikTok Profile Enhancer: navigationObserver STARTED on documentElement (fallback).');
      } else {
        if (DEBUG_MODE) console.log('TikTok Profile Enhancer: <head> and documentElement not found, navigationObserver NOT started.');
      }
    }
  } else {
    if (DEBUG_MODE) console.log('TikTok Profile Enhancer: navigationObserver is DISABLED by ENABLE_OBSERVERS flag.');
  }

  // Initial attempt to process the page after script injection
  if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Scheduling initial processProfilePage calls.");
  setTimeout(processProfilePage, 750);  // Adjusted initial delays slightly
  setTimeout(processProfilePage, 2500); 
}

// --- Start Execution ---
if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Script execution started. Document readyState:', document.readyState);
// Wait for the DOM to be ready before initializing observers and processing
if (document.readyState === 'loading') {
  if (DEBUG_MODE) console.log('TikTok Profile Enhancer: DOM is loading, adding DOMContentLoaded listener.');
  document.addEventListener('DOMContentLoaded', () => {
    console.log('TikTok Profile Enhancer: DOMContentLoaded event triggered.');
    initializeObservers();
  });
} else {
  if (DEBUG_MODE) console.log('TikTok Profile Enhancer: DOM is already ready, calling initializeObservers directly.');
  initializeObservers(); // DOM is already ready
}

console.log('TikTok Profile Enhancer content script loaded and initialized.'); // Keep this final log
