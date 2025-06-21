// TikTok Profile Enhancer - content.js
// IMPORTANT: This initial console.log should be one of the very first things.
console.log('TikTok Profile Enhancer: Script execution started.'); 

// --- Debug Mode Explanation ---
// IMPORTANT: Set DEBUG_MODE to false for normal use to reduce console noise.
// When true, you might encounter messages like:
// - "Debounce clearing previous timeout..." / "Debounce executing...": These are normal and expected messages from
//   MutationObservers handling dynamic page content. They indicate the extension is actively monitoring page changes.
// - "videoCount is X, but no video IDs were extracted...": This is a specific warning from this extension.
//   It signifies that while the page indicates a certain number of videos, the script couldn't find their IDs in the
//   page's JSON data. This might happen if TikTok changes its data structure. If you see this, providing the
//   accompanying detailed logs (which only appear in DEBUG_MODE) in a bug report is very helpful.
// - CSP (Content Security Policy) errors or net::ERR_BLOCKED_BY_CLIENT: These are generally NOT caused by this
//   extension. They usually stem from other extensions (e.g., ad blockers, privacy tools) or strict browser settings
//   interfering with page requests or script execution.
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
let debouncedProcessProfilePageFromMutation = null;
let promptElement = null; // Keep a reference to the prompt overlay


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
    if (DEBUG_MODE && changed) {
      console.log('TikTok Profile Enhancer: Right-click properties re-nullified by interval.');
      console.warn('TikTok Profile Enhancer: Right-click properties had to be re-nullified by interval. This might indicate aggressive scripts on the page.');
    }
  }, 10000); // Re-apply every 10 seconds
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
  const knownTabTexts = ['Videos', 'Liked', 'Favourites', 'Reposts', 'Playlists'];

  // 1. Primary selector using data-e2e attribute
  let tabBar = document.querySelector('[data-e2e="user-profile-tabs"]');
  if (tabBar) {
    if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Tab bar found with data-e2e selector.');
    return tabBar;
  }
  if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Tab bar not found with data-e2e selector. Trying text-based fallback.');

  // 2. Text-based Fallback
  if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Starting text-based fallback search for tab bar.');
  const potentialTabElements = Array.from(document.querySelectorAll('p, button, div[role="tab"]'));
  for (const el of potentialTabElements) {
    if (el.textContent && knownTabTexts.includes(el.textContent.trim())) {
      let parentCandidate = el.parentElement;
      for (let i = 0; i < 5 && parentCandidate; i++) { // Check up to 5 levels up
        const children = Array.from(parentCandidate.children);
        let matchingTabsFound = 0;
        for (const child of children) {
          if (child.textContent && knownTabTexts.includes(child.textContent.trim())) {
            matchingTabsFound++;
          }
        }
        if (matchingTabsFound > 1 && parentCandidate.offsetParent !== null) {
          if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Found potential tab bar via text-based fallback (parent of elements with known texts):', parentCandidate);
          return parentCandidate;
        }
        parentCandidate = parentCandidate.parentElement;
      }
    }
  }

  // 3. Structural Fallback (role="tablist")
  if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Text-based fallback failed. Trying role="tablist" structural fallback.');
  const tabLists = document.querySelectorAll('div[role="tablist"]');
  if (DEBUG_MODE && tabLists.length > 0) {
    console.log(`TikTok Profile Enhancer: Found ${tabLists.length} elements with role="tablist". Inspecting them...`);
  } else if (DEBUG_MODE) {
    console.log('TikTok Profile Enhancer: No elements found with role="tablist".');
  }

  for (const list of tabLists) {
    const tabs = list.querySelectorAll('[role="tab"]');
    if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: Inspecting role="tablist" element:`, list, `Number of role="tab" children: ${tabs.length}, Visible: ${list.offsetParent !== null}`);

    if (tabs.length >= 2 && list.offsetParent !== null) { 
      let knownTextFoundInList = false;
      tabs.forEach(t => {
        if (t.textContent && knownTabTexts.some(knownText => t.textContent.includes(knownText))) {
          knownTextFoundInList = true;
        }
      });

      if (knownTextFoundInList) {
        if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Found potential tab bar via role="tablist" and known text content:', list);
        return list; 
      } else {
        if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Found role="tablist" with >=2 tabs and visible, but no known tab text, skipping:', list);
      }
    } else {
      if (DEBUG_MODE && tabs.length < 2) console.log('TikTok Profile Enhancer: Found role="tablist" but it has less than 2 tabs, skipping:', list);
      if (DEBUG_MODE && list.offsetParent === null) console.log('TikTok Profile Enhancer: Found role="tablist" but it is not visible, skipping:', list);
    }
  }

  if (DEBUG_MODE) console.warn('TikTok Profile Enhancer: Could not find tab bar element after all attempts.');
  return null;
}

// --- Page Data Extraction (formerly extractTotalVideoCount) ---
function extractPageData(usernameToFind) {
  if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: Attempting to extract page data for ${usernameToFind}`);
  let videoCount = null;
  let videoIds = []; // Initialize as an empty array
  let foundVideoCountPath = "N/A";
  let itemsSource = "N/A";

  // --- Recursive Object Explorer (for debugging complex JSON) ---
  /* function exploreObject(obj, currentPath, usernameToFind) { 
    if (!obj || typeof obj !== 'object' || currentPath.split('.').length > 10) { 
        return;
    }
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            const newPath = currentPath ? `${currentPath}.${key}` : key;
            const value = obj[key];

            if (Array.isArray(value)) {
                if (DEBUG_MODE) { 
                    console.log(`TikTok Profile Enhancer: Found Array at ${newPath} (Length: ${value.length}). First item (if any):`, value.length > 0 ? JSON.stringify(value[0], null, 2) : "Empty array");
                    if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
                        console.log(`TikTok Profile Enhancer: Keys of first item in ${newPath}:`, Object.keys(value[0]));
                    }
                }
                let potentialVideoCountInArray = 0;
                for (let i = 0; i < Math.min(value.length, 5); i++) { 
                    if (value[i] && typeof value[i] === 'object' && value[i].id && (value[i].author === usernameToFind || (value[i].author && value[i].author.uniqueId === usernameToFind))) {
                        potentialVideoCountInArray++;
                    } else if (value[i] && typeof value[i] === 'object' && value[i].id && value[i].author && typeof value[i].author === 'string') { 
                         potentialVideoCountInArray++;
                    }
                }
                if (potentialVideoCountInArray > 0 && DEBUG_MODE) {
                    console.warn(`TikTok Profile Enhancer: ${potentialVideoCountInArray} item(s) in ${newPath} resemble video items (id & author match). Total length: ${value.length}`);
                }
                if (value.length > 30 && potentialVideoCountInArray > 0 && DEBUG_MODE) { 
                    console.warn(`TikTok Profile Enhancer: POTENTIALLY LARGE VIDEO LIST found at ${newPath} - Length: ${value.length}`);
                }
            } else if (typeof value === 'object' && value !== null) {
                if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: Exploring Object at ${newPath}. Keys:`, Object.keys(value));
                
                const objectKeys = Object.keys(value);
                if (objectKeys.length > 30 && DEBUG_MODE) { 
                    let numericKeyCount = 0;
                    let itemsResembleVideos = 0;
                    const firstFewKeyValuePairs = {};

                    for (let i = 0; i < objectKeys.length; i++) {
                        const itemKey = objectKeys[i];
                        if (/^\d+$/.test(itemKey)) { 
                            numericKeyCount++;
                            const itemValue = value[itemKey];
                            if (itemValue && typeof itemValue === 'object' && itemValue.id && (itemValue.author === usernameToFind || (itemValue.author && itemValue.author.uniqueId === usernameToFind))) {
                                itemsResembleVideos++;
                            }
                            if (i < 5) { 
                               firstFewKeyValuePairs[itemKey] = itemValue;
                            }
                        }
                        if (numericKeyCount >= 5 && i >= 20) break; 
                    }

                    if (numericKeyCount > 20 && itemsResembleVideos > 0) { 
                        console.warn(`TikTok Profile Enhancer: POTENTIAL VIDEO MAP found at ${newPath}. Key count: ${objectKeys.length}, Numeric keys (sample): ${numericKeyCount}, Video-like items (sample): ${itemsResembleVideos}`);
                        console.log(`TikTok Profile Enhancer: First few key-value pairs from ${newPath}:`, JSON.stringify(firstFewKeyValuePairs, null, 2));
                    }
                }
                exploreObject(value, newPath, usernameToFind); 
            }
        }
    }
  } */ // End of exploreObject

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
      if (DEBUG_MODE) {
        console.log('TikTok Profile Enhancer: Successfully parsed JSON data.');
        // Call to exploreObject commented out
        // console.log("TikTok Profile Enhancer: Starting comprehensive scan of jsonData...");
        // exploreObject(jsonData, "jsonData", usernameToFind); 
        // console.log("TikTok Profile Enhancer: Finished comprehensive scan of jsonData.");
      }
    } catch (e) {
      if (DEBUG_MODE) console.error('TikTok Profile Enhancer: Failed to parse JSON data from script element.', e, e.stack);
      return { videoCount, videoIds };
    }

    let userDetailData = null;
    if (jsonData && jsonData.__DEFAULT_SCOPE__ && 
        typeof jsonData.__DEFAULT_SCOPE__ === 'object' && jsonData.__DEFAULT_SCOPE__ !== null &&
        jsonData.__DEFAULT_SCOPE__['webapp.user-detail'] && 
        typeof jsonData.__DEFAULT_SCOPE__['webapp.user-detail'] === 'object') {
      userDetailData = jsonData.__DEFAULT_SCOPE__['webapp.user-detail'];
    } else {
      if (DEBUG_MODE) console.log("TikTok Profile Enhancer: 'webapp.user-detail' object not found. Will use root jsonData for some fallbacks.");
    }

    // --- Extract videoCount ---
    if (userDetailData && userDetailData.userInfo && userDetailData.userInfo.stats && typeof userDetailData.userInfo.stats.videoCount === 'number') {
        videoCount = userDetailData.userInfo.stats.videoCount;
        foundVideoCountPath = "webapp.user-detail.userInfo.stats.videoCount";
    }
    else if (userDetailData && userDetailData.stats && typeof userDetailData.stats.videoCount === 'number' &&
             userDetailData.userInfo && (userDetailData.userInfo.uniqueId === usernameToFind || userDetailData.userInfo.nickName === usernameToFind)) {
        videoCount = userDetailData.stats.videoCount;
        foundVideoCountPath = "webapp.user-detail.stats.videoCount (username matched userInfo)";
    }
    else if (userDetailData && userDetailData.UserModule && userDetailData.UserModule.users && userDetailData.UserModule.users[usernameToFind] &&
             userDetailData.UserModule.users[usernameToFind].stats && typeof userDetailData.UserModule.users[usernameToFind].stats.videoCount === 'number') {
        videoCount = userDetailData.UserModule.users[usernameToFind].stats.videoCount;
        foundVideoCountPath = "webapp.user-detail.UserModule.users[username].stats.videoCount";
    }
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
    else if (jsonData.UserModule && jsonData.UserModule.users && jsonData.UserModule.users[usernameToFind] &&
             jsonData.UserModule.users[usernameToFind].stats && typeof jsonData.UserModule.users[usernameToFind].stats.videoCount === 'number') {
        videoCount = jsonData.UserModule.users[usernameToFind].stats.videoCount;
        foundVideoCountPath = "root.UserModule.users[username].stats.videoCount";
    }
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

    // Path G: Try jsonData.__DEFAULT_SCOPE__['seo.abtest'].vidList (REFINED PRIMARY ATTEMPT)
    if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Attempting Path G: jsonData.__DEFAULT_SCOPE__['seo.abtest'].vidList");
    if (jsonData.__DEFAULT_SCOPE__ && jsonData.__DEFAULT_SCOPE__['seo.abtest'] && jsonData.__DEFAULT_SCOPE__['seo.abtest'].hasOwnProperty('vidList')) {
        const vidListCandidate = jsonData.__DEFAULT_SCOPE__['seo.abtest'].vidList;
        const vidListType = typeof vidListCandidate;
        if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: Path G data found. Type: ${vidListType}`);

        if (Array.isArray(vidListCandidate)) {
            if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Full content of seo.abtest.vidList (Array):', JSON.stringify(vidListCandidate));
            if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: seo.abtest.vidList is an array. Length: ${vidListCandidate.length}`);
            if (vidListCandidate.length > 0) {
                if (DEBUG_MODE) console.log('TikTok Profile Enhancer: First item of seo.abtest.vidList:', JSON.stringify(vidListCandidate[0], null, 2));
                let initialLength = videoIds.length;
                vidListCandidate.forEach(item => {
                    if (typeof item === 'string' && item.length > 0) {
                        if (!videoIds.includes(item)) videoIds.push(item);
                    } else if (typeof item === 'object' && item !== null && item.id && typeof item.id === 'string') {
                        if (!videoIds.includes(item.id)) videoIds.push(item.id);
                    }
                });

                if (videoIds.length > initialLength) { 
                    itemsSource = "__DEFAULT_SCOPE__.seo.abtest.vidList";
                    if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: Added ${videoIds.length - initialLength} IDs from Path G. Current total: ${videoIds.length}`);
                } else {
                    if (DEBUG_MODE) console.warn('TikTok Profile Enhancer: seo.abtest.vidList is an array, but no new IDs could be extracted (items might not be strings or objects with .id, or all were duplicates).');
                }
            } else {
                if (DEBUG_MODE) console.log('TikTok Profile Enhancer: seo.abtest.vidList is an empty array.');
            }
        } else if (vidListType === 'object' && vidListCandidate !== null) {
            if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Full content of seo.abtest.vidList (Object):', JSON.stringify(vidListCandidate));
            if (DEBUG_MODE) console.log('TikTok Profile Enhancer: seo.abtest.vidList is an object but not an array. Keys:', Object.keys(vidListCandidate));
        } else {
            if (DEBUG_MODE) console.log('TikTok Profile Enhancer: seo.abtest.vidList is neither an array nor a non-null object. Value:', vidListCandidate);
        }
    } else {
        if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Path G skipped (condition false or data missing).');
    }
    
    // Path A: From userDetailData.UserModule.users[usernameToFind].itemList
    if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Attempting Path A: userDetailData.UserModule.users[usernameToFind].itemList");
    if (userDetailData && userDetailData.UserModule && userDetailData.UserModule.users &&
        userDetailData.UserModule.users[usernameToFind] && Array.isArray(userDetailData.UserModule.users[usernameToFind].itemList)) {
        if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Path A data found (first 5):", userDetailData.UserModule.users[usernameToFind].itemList.slice(0, 5));
        let initialLength = videoIds.length;
        userDetailData.UserModule.users[usernameToFind].itemList.forEach(item => { if(item && item.id && !videoIds.includes(item.id)) videoIds.push(item.id); });
        if (videoIds.length > initialLength) {
            itemsSource = itemsSource !== "N/A" ? itemsSource + " + webapp.user-detail.UserModule.users[username].itemList" : "webapp.user-detail.UserModule.users[username].itemList";
            if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: Added ${videoIds.length - initialLength} IDs from Path A. Current total: ${videoIds.length}`);
        }
    } else {
        if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Path A skipped (condition false or data missing).");
    }

    // Path B: From userDetailData.UserModule.itemList
    if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Attempting Path B: userDetailData.UserModule.itemList");
    if (userDetailData && userDetailData.UserModule && Array.isArray(userDetailData.UserModule.itemList)) { 
        if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Path B data found (first 5):", userDetailData.UserModule.itemList.slice(0, 5));
        let initialLength = videoIds.length;
        userDetailData.UserModule.itemList.forEach(item => { if(item && item.id && !videoIds.includes(item.id)) videoIds.push(item.id); });
        if (videoIds.length > initialLength) {
            itemsSource = itemsSource !== "N/A" ? itemsSource + " + webapp.user-detail.UserModule.itemList" : "webapp.user-detail.UserModule.itemList";
            if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: Added ${videoIds.length - initialLength} IDs from Path B. Current total: ${videoIds.length}`);
        }
    } else {
        if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Path B skipped (condition false or data missing).");
    }

    // Path C: From userDetailData.ItemModule
    if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Attempting Path C: userDetailData.ItemModule");
    if (userDetailData && userDetailData.ItemModule && typeof userDetailData.ItemModule === 'object') { 
        if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Path C data found (keys):", Object.keys(userDetailData.ItemModule));
        let initialLength = videoIds.length;
        Object.values(userDetailData.ItemModule).forEach(item => { if(item && item.id && item.author === usernameToFind && !videoIds.includes(item.id)) videoIds.push(item.id); }); 
        if (videoIds.length > initialLength) {
            itemsSource = itemsSource !== "N/A" ? itemsSource + " + webapp.user-detail.ItemModule (filtered)" : "webapp.user-detail.ItemModule (filtered)";
             if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: Added ${videoIds.length - initialLength} IDs from Path C (filtered). Current total: ${videoIds.length}`);
        } else { 
             const uniqueAuthors = new Set(Object.values(userDetailData.ItemModule).map(item => item.author));
             if (uniqueAuthors.size === 1 && uniqueAuthors.has(usernameToFind)) {
                initialLength = videoIds.length; // Reset initialLength for this specific sub-case
                Object.values(userDetailData.ItemModule).forEach(item => { if(item && item.id && !videoIds.includes(item.id)) videoIds.push(item.id); });
                if (videoIds.length > initialLength) {
                    itemsSource = itemsSource !== "N/A" ? itemsSource + " + webapp.user-detail.ItemModule (all)" : "webapp.user-detail.ItemModule (all)";
                    if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: Added ${videoIds.length - initialLength} IDs from Path C (all). Current total: ${videoIds.length}`);
                }
             }
        }
    } else {
        if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Path C skipped (condition false or data missing).");
    }

    // Path D: (Fallback) From root jsonData.ItemModule
    if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Attempting Path D: root.ItemModule");
    if (jsonData.ItemModule && typeof jsonData.ItemModule === 'object') { 
        if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Path D data found (keys):", Object.keys(jsonData.ItemModule));
        let initialLength = videoIds.length;
        Object.values(jsonData.ItemModule).forEach(item => { if(item && item.id && item.author === usernameToFind && !videoIds.includes(item.id)) videoIds.push(item.id); });
        if (videoIds.length > initialLength) {
             itemsSource = itemsSource !== "N/A" ? itemsSource + " + root.ItemModule (filtered)" : "root.ItemModule (filtered)";
             if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: Added ${videoIds.length - initialLength} IDs from Path D (filtered). Current total: ${videoIds.length}`);
        } else { 
             const uniqueAuthors = new Set(Object.values(jsonData.ItemModule).map(item => item.author));
             if (uniqueAuthors.size === 1 && uniqueAuthors.has(usernameToFind)) {
                initialLength = videoIds.length; // Reset initialLength for this specific sub-case
                Object.values(jsonData.ItemModule).forEach(item => { if(item && item.id && !videoIds.includes(item.id)) videoIds.push(item.id); });
                if (videoIds.length > initialLength) {
                    itemsSource = itemsSource !== "N/A" ? itemsSource + " + root.ItemModule (all)" : "root.ItemModule (all)";
                    if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: Added ${videoIds.length - initialLength} IDs from Path D (all). Current total: ${videoIds.length}`);
                }
             }
        }
    } else {
        if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Path D skipped (condition false or data missing).");
    }

    // Path E: From userDetailData.userInfo.itemList
    if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Attempting Path E: userDetailData.userInfo.itemList");
    if (userDetailData && userDetailData.userInfo && Array.isArray(userDetailData.userInfo.itemList)) {
        if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Path E data found (first 5):", userDetailData.userInfo.itemList.slice(0, 5));
        let initialLength = videoIds.length;
        userDetailData.userInfo.itemList.forEach(item => { if(item && item.id && !videoIds.includes(item.id)) videoIds.push(item.id); });
        if (videoIds.length > initialLength) {
            itemsSource = itemsSource !== "N/A" ? itemsSource + " + webapp.user-detail.userInfo.itemList" : "webapp.user-detail.userInfo.itemList";
            if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: Added ${videoIds.length - initialLength} IDs from Path E. Current total: ${videoIds.length}`);
        }
    } else {
        if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Path E skipped (condition false or data missing).");
    }

    // Path F: Iterate through userDetailData's direct children
    if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Attempting Path F: Iterate through userDetailData's direct children (excluding .userInfo explored above)");
    if (userDetailData) {
        if (DEBUG_MODE && videoIds.length === 0) console.log('TikTok Profile Enhancer: Path F - Attempting to find itemList in direct children of userDetailData...');
        for (const moduleKey in userDetailData) {
            if (moduleKey === 'userInfo') continue; 
            if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: Path F - Checking moduleKey: ${moduleKey}`);
            if (userDetailData.hasOwnProperty(moduleKey) && typeof userDetailData[moduleKey] === 'object' && userDetailData[moduleKey] !== null) {
                const potentialModule = userDetailData[moduleKey];
                let initialLengthBeforeSubPath = videoIds.length;

                if (Array.isArray(potentialModule.itemList)) {
                    if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: Path F - Found userDetailData.${moduleKey}.itemList (first 5):`, potentialModule.itemList.slice(0,5));
                    potentialModule.itemList.forEach(item => { if(item && item.id && item.author === usernameToFind && !videoIds.includes(item.id)) videoIds.push(item.id); });
                    if (videoIds.length > initialLengthBeforeSubPath) {
                        itemsSource = itemsSource !== "N/A" ? itemsSource + ` + webapp.user-detail.${moduleKey}.itemList` : `webapp.user-detail.${moduleKey}.itemList`;
                        if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: Added ${videoIds.length - initialLengthBeforeSubPath} IDs from Path F (userDetailData.${moduleKey}.itemList). Current total: ${videoIds.length}`);
                        initialLengthBeforeSubPath = videoIds.length; 
                    }
                }
                
                if (typeof potentialModule.ItemModule === 'object' && potentialModule.ItemModule !== null) {
                     if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: Path F - Found userDetailData.${moduleKey}.ItemModule (keys):`, Object.keys(potentialModule.ItemModule));
                     Object.values(potentialModule.ItemModule).forEach(item => { if(item && item.id && item.author === usernameToFind && !videoIds.includes(item.id)) videoIds.push(item.id); });
                     if (videoIds.length > initialLengthBeforeSubPath) {
                        itemsSource = itemsSource !== "N/A" ? itemsSource + ` + webapp.user-detail.${moduleKey}.ItemModule` : `webapp.user-detail.${moduleKey}.ItemModule`;
                        if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: Added ${videoIds.length - initialLengthBeforeSubPath} IDs from Path F (userDetailData.${moduleKey}.ItemModule). Current total: ${videoIds.length}`);
                        initialLengthBeforeSubPath = videoIds.length;
                     }
                }

                if (potentialModule.users && potentialModule.users[usernameToFind] && Array.isArray(potentialModule.users[usernameToFind].itemList)) {
                    if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: Path F - Found userDetailData.${moduleKey}.users[${usernameToFind}].itemList (first 5):`, potentialModule.users[usernameToFind].itemList.slice(0,5));
                    potentialModule.users[usernameToFind].itemList.forEach(item => { if(item && item.id && !videoIds.includes(item.id)) videoIds.push(item.id); });
                     if (videoIds.length > initialLengthBeforeSubPath) {
                        itemsSource = itemsSource !== "N/A" ? itemsSource + ` + webapp.user-detail.${moduleKey}.users[user].itemList` : `webapp.user-detail.${moduleKey}.users[user].itemList`;
                        if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: Added ${videoIds.length - initialLengthBeforeSubPath} IDs from Path F (userDetailData.${moduleKey}.users). Current total: ${videoIds.length}`);
                     }
                }
            }
        }
    } else {
        if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Path F skipped (userDetailData is null).");
    }
    
    if (DEBUG_MODE) {
      console.log(`TikTok Profile Enhancer: Extracted videoCount: ${videoCount} (from ${foundVideoCountPath})`);
      
      if (videoCount !== null && videoCount > 0 && (!videoIds || videoIds.length < videoCount)) {
          console.warn('TikTok Profile Enhancer: videoCount is ' + videoCount + ', but found ' + (videoIds ? videoIds.length : 0) + ' video IDs. Further detailed logging for specific jsonData locations:');
          
          if (jsonData.ItemModule) { 
            console.log("TikTok Profile Enhancer: jsonData.ItemModule keys:", Object.keys(jsonData.ItemModule));
          } else { 
            console.log('TikTok Profile Enhancer: jsonData.ItemModule not found at root.'); 
          }
          if (jsonData.UserModule) { 
            console.log("TikTok Profile Enhancer: jsonData.UserModule keys:", Object.keys(jsonData.UserModule));
          } else { 
            console.log('TikTok Profile Enhancer: jsonData.UserModule not found at root.'); 
          }
          if (jsonData.VideoModule) { 
            console.log("TikTok Profile Enhancer: jsonData.VideoModule keys:", Object.keys(jsonData.VideoModule));
          }
      }
    }
    
    if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: extractPageData FINAL RETURN - Video Count: ${videoCount}, Total Video IDs Extracted: ${videoIds.length}, Final itemsSource: ${itemsSource || 'N/A'}`);
    return { videoCount, videoIds };

  } catch (error) {
    if (DEBUG_MODE) console.error('TikTok Profile Enhancer: Error in extractPageData:', error, error.stack);
    else console.error('TikTok Profile Enhancer: Error extracting page data.');
    return { videoCount, videoIds }; 
  }
}

// --- User Prompt UI Helper Functions ---
// let promptElement = null; // Already defined globally

function showPrompt(messageText, onFinishCallback, onResumeCallback) {
    if (DEBUG_MODE) console.log("TikTok Profile Enhancer: showPrompt called with message:", messageText);
    if (!promptElement) {
        promptElement = document.createElement('div');
        promptElement.id = 'tiktok-enhancer-prompt-overlay'; // ID matches CSS in styles.css
        
        promptElement.style.position = 'fixed';
        promptElement.style.top = '0';
        promptElement.style.left = '0';
        promptElement.style.width = '100%';
        promptElement.style.height = '100%';
        promptElement.style.backgroundColor = 'rgba(0,0,0,0.6)';
        promptElement.style.zIndex = '100000'; 
        promptElement.style.display = 'flex';
        promptElement.style.justifyContent = 'center';
        promptElement.style.alignItems = 'center';
        promptElement.style.fontFamily = 'Arial, sans-serif';

        const promptBox = document.createElement('div');
        promptBox.id = 'tiktok-enhancer-prompt-box'; // ID matches CSS
        promptBox.style.backgroundColor = 'white';
        promptBox.style.padding = '25px';
        promptBox.style.borderRadius = '10px';
        promptBox.style.textAlign = 'center';
        promptBox.style.boxShadow = '0 5px 20px rgba(0,0,0,0.4)';
        promptBox.style.color = '#333';
        promptBox.style.maxWidth = '90%';
        promptBox.style.width = '400px';


        const messageP = document.createElement('p');
        messageP.id = 'tiktok-enhancer-prompt-message'; // ID matches CSS
        messageP.style.marginBottom = '20px';
        messageP.style.fontSize = '16px';
        messageP.style.lineHeight = '1.5';

        const finishBtnEl = document.createElement('button'); // Renamed to avoid conflict
        finishBtnEl.id = 'tiktok-enhancer-prompt-finish-btn'; // ID matches CSS
        finishBtnEl.textContent = 'Finish & Copy URLs';
        finishBtnEl.className = 'tiktok-enhancer-prompt-button'; // Class matches CSS
        finishBtnEl.style.padding = '10px 15px';
        finishBtnEl.style.margin = '5px 10px';
        finishBtnEl.style.border = 'none';
        finishBtnEl.style.borderRadius = '5px';
        finishBtnEl.style.cursor = 'pointer';
        finishBtnEl.style.fontSize = '15px';
        finishBtnEl.style.backgroundColor = '#28a745';
        finishBtnEl.style.color = 'white';
        
        const resumeBtnEl = document.createElement('button'); // Renamed to avoid conflict
        resumeBtnEl.id = 'tiktok-enhancer-prompt-resume-btn'; // ID matches CSS
        resumeBtnEl.textContent = 'Attempt to Resume in 15s';
        resumeBtnEl.className = 'tiktok-enhancer-prompt-button'; // Class matches CSS
        resumeBtnEl.style.padding = '10px 15px';
        resumeBtnEl.style.margin = '5px 10px';
        resumeBtnEl.style.border = 'none';
        resumeBtnEl.style.borderRadius = '5px';
        resumeBtnEl.style.cursor = 'pointer';
        resumeBtnEl.style.fontSize = '15px';
        resumeBtnEl.style.backgroundColor = '#007bff';
        resumeBtnEl.style.color = 'white';

        promptBox.appendChild(messageP);
        promptBox.appendChild(finishBtnEl);
        promptBox.appendChild(resumeBtnEl);
        promptElement.appendChild(promptBox);
        document.body.appendChild(promptElement);
    }
    
    promptElement.querySelector('#tiktok-enhancer-prompt-message').textContent = messageText;
    promptElement.style.display = 'flex';

    const finishButton = promptElement.querySelector('#tiktok-enhancer-prompt-finish-btn');
    const resumeButton = promptElement.querySelector('#tiktok-enhancer-prompt-resume-btn');

    const newFinishButton = finishButton.cloneNode(true); 
    finishButton.parentNode.replaceChild(newFinishButton, finishButton);
    newFinishButton.addEventListener('click', () => {
        if (DEBUG_MODE) console.log("TikTok Profile Enhancer: 'Finish' button clicked on prompt.");
        hidePrompt();
        if (typeof onFinishCallback === 'function') onFinishCallback();
    });

    const newResumeButton = resumeButton.cloneNode(true); 
    resumeButton.parentNode.replaceChild(newResumeButton, resumeButton);
    newResumeButton.addEventListener('click', () => {
        if (DEBUG_MODE) console.log("TikTok Profile Enhancer: 'Resume' button clicked on prompt.");
        hidePrompt();
        if (typeof onResumeCallback === 'function') onResumeCallback();
    });
}

function hidePrompt() {
    if (promptElement) {
        promptElement.style.display = 'none';
        if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Prompt hidden.");
    }
}
// --- End of User Prompt UI Helper Functions ---

// --- Helper: URL Collection & Filtering ---
async function fetchAllVideoUrlsByScrolling() {
    if (DEBUG_MODE) console.log("TikTok Profile Enhancer: fetchAllVideoUrlsByScrolling - INITIATED.");
    // let isCurrentlyScrollingAndCapturing = false; // This is now managed by the promise state and callbacks

    if (window.isTiktokProfileEnhancerScrollingGlobal) { 
        if (DEBUG_MODE) console.log("TikTok Profile Enhancer: fetchAllVideoUrlsByScrolling - Global scroll already in progress. Exiting.");
        return []; // Return empty array if already scrolling
    }
    window.isTiktokProfileEnhancerScrollingGlobal = true; 

    const collectedUrls = new Set();
    const initialScrollTop = window.scrollY;
    let lastScrollHeight = 0;
    let noNewVideosStreak = 0;
    const MAX_NO_NEW_VIDEOS_STREAK = 3; 
    const SCROLL_DELAY_MS = 3000; 

    const currentUsernameForCount = getProfileUsernameFromUrl();
    // let targetVideoCount = 0; // Commented out as per instruction
    // let targetVideoCount = 0; // Commented out as per instruction for this subtask
    // if (currentUsernameForCount) {
    //     const pageData = extractPageData(currentUsernameForCount); 
    //     if (pageData && typeof pageData.videoCount === 'number' && pageData.videoCount > 0) {
    //         // targetVideoCount = pageData.videoCount; // Ensure this line is commented
    //         if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: fetchAllVideoUrlsByScrolling - Target video count for info: ${pageData.videoCount}`);
    //     } else {
    //         if (DEBUG_MODE) console.warn("TikTok Profile Enhancer: fetchAllVideoUrlsByScrolling - Could not get target video count. Will rely on scroll streak only.");
    //     }
    // } else {
    //      if (DEBUG_MODE) console.warn("TikTok Profile Enhancer: fetchAllVideoUrlsByScrolling - No username, cannot get target video count.");
    // }
    
    const initialDomUrls = getAllVideoUrlsFromPage(); 
    initialDomUrls.forEach(url => collectedUrls.add(url));
    if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: fetchAllVideoUrlsByScrolling - Found ${collectedUrls.size} initial URLs.`);

    return new Promise((resolve, reject) => {
        let isThisScrollProcessActive = true; // Flag for this specific promise chain
        const videoItemSelector = 'div[data-e2e="user-post-item"]'; 
        let observer;

        const processNewNodes = () => {
            const postLinkElements = document.querySelectorAll(`${videoItemSelector} a[href*="/video/"], ${videoItemSelector} a[href*="/photo/"]`);
            let newUrlsFoundInThisPass = 0;
            postLinkElements.forEach(el => {
                if (el.href && !collectedUrls.has(el.href)) {
                    collectedUrls.add(el.href);
                    newUrlsFoundInThisPass++;
                }
            });
            if (DEBUG_MODE && newUrlsFoundInThisPass > 0) {
                console.log(`TikTok Profile Enhancer: fetchAllVideoUrlsByScrolling - Added ${newUrlsFoundInThisPass} new URLs from DOM. Total unique: ${collectedUrls.size}`);
            }
            return newUrlsFoundInThisPass > 0;
        };

        const finish = (reason) => { 
            if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: fetchAllVideoUrlsByScrolling - FINISHED (${reason}). Total URLs collected: ${collectedUrls.size}`);
            isThisScrollProcessActive = false; // Stop this specific scroll process
            window.isTiktokProfileEnhancerScrollingGlobal = false; 
            if (observer) observer.disconnect();
            hidePrompt(); // Ensure prompt is hidden
            window.scrollTo(0, initialScrollTop); 
            resolve(Array.from(collectedUrls));
        };

        const resumeAfterUserWait = () => {
            if (DEBUG_MODE) console.log("TikTok Profile Enhancer: User chose to resume. Waiting 15 seconds...");
            setTimeout(() => {
                if (!isThisScrollProcessActive) { // Check if finish was called during the wait
                     if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Scrolling was stopped while waiting for resume timeout.");
                     return;
                }
                if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Resuming scroll process...");
                noNewVideosStreak = 0; 
                scrollStep(); 
            }, 15000);
        };


        const scrollStep = async () => {
            if (!isThisScrollProcessActive) { 
                 if (DEBUG_MODE) console.log("TikTok Profile Enhancer: fetchAllVideoUrlsByScrolling - scrollStep detected scrolling should stop.");
                 // finish is already called or will be called, no need to call it again.
                 return;
            }

            // Ensure targetVideoCount check is fully commented out
            /*
            if (targetVideoCount > 0 && collectedUrls.size >= targetVideoCount) {
                 if (DEBUG_MODE) console.log("TikTok Profile Enhancer: fetchAllVideoUrlsByScrolling - Target count reached. Finishing.");
                 finish("Target count reached");
                 return;
            }
            */

            lastScrollHeight = document.body.scrollHeight;
            window.scrollTo(0, lastScrollHeight);
            if (DEBUG_MODE) console.log("TikTok Profile Enhancer: fetchAllVideoUrlsByScrolling - Scrolled to bottom. Waiting for new content...");

            await new Promise(r => setTimeout(r, SCROLL_DELAY_MS)); 

            if (!isThisScrollProcessActive) { 
                 if (DEBUG_MODE) console.log("TikTok Profile Enhancer: fetchAllVideoUrlsByScrolling - scrollStep detected scrolling should stop after delay.");
                 return;
            }

            const newVideosAppeared = processNewNodes();

            if (newVideosAppeared) {
                noNewVideosStreak = 0;
            } else {
                noNewVideosStreak++;
                if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: fetchAllVideoUrlsByScrolling - No new videos detected this scroll. Streak: ${noNewVideosStreak}`);
            }

            if (noNewVideosStreak >= MAX_NO_NEW_VIDEOS_STREAK || 
                (document.body.scrollHeight === lastScrollHeight && !newVideosAppeared)) {
                
                if (DEBUG_MODE) console.warn("TikTok Profile Enhancer: fetchAllVideoUrlsByScrolling - Potential end of page or interruption. Pausing for user input.");
                const message = `Scraping paused. URLs found: ${collectedUrls.size}. Possible end of page or interruption (e.g., CAPTCHA).`;
                
                showPrompt(message, 
                    () => finish("User clicked Finish on prompt"), 
                    resumeAfterUserWait
                );
                return; 
            }
            
            if (isThisScrollProcessActive && (!promptElement || promptElement.style.display === 'none')) { 
                setTimeout(scrollStep, 100); 
            } else if (isThisScrollProcessActive && promptElement && promptElement.style.display === 'flex') {
                 if (DEBUG_MODE) console.log("TikTok Profile Enhancer: scrollStep - Paused for user decision via prompt.");
            } else { 
                if (DEBUG_MODE) console.log("TikTok Profile Enhancer: fetchAllVideoUrlsByScrolling - Scrolling stopped externally (not via prompt).");
                finish("Stopped externally (not via prompt)"); 
            }
        };
        
        observer = new MutationObserver((mutations) => {
            if (!isThisScrollProcessActive) { 
                if(observer) observer.disconnect();
                return;
            }
            let potentiallyNewContent = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    potentiallyNewContent = true;
                    break;
                }
            }
            if (potentiallyNewContent) {
                if (DEBUG_MODE) console.log("TikTok Profile Enhancer: fetchAllVideoUrlsByScrolling - MutationObserver detected new nodes.");
                processNewNodes(); 
            }
        });
        
        const videoFeedContainer = document.querySelector('div[data-e2e="user-post-item"]');
        const actualObserveTarget = videoFeedContainer ? videoFeedContainer.parentElement : document.body; 
        if (actualObserveTarget) {
             observer.observe(actualObserveTarget, { childList: true, subtree: true });
        } else {
             if (DEBUG_MODE) console.warn("TikTok Profile Enhancer: fetchAllVideoUrlsByScrolling - Could not find video feed container or body for MutationObserver.");
        }

        if (DEBUG_MODE) console.log("TikTok Profile Enhancer: fetchAllVideoUrlsByScrolling - Starting scroll process...");
        scrollStep(); 
    });
}

function getAllVideoUrlsFromPage() {
  if (DEBUG_MODE) console.log("TikTok Profile Enhancer: getAllVideoUrlsFromPage - Attempting to collect post URLs (videos and photos) from DOM.");
  const postElements = document.querySelectorAll('div[data-e2e="user-post-item"] a[href*="/video/"], div[data-e2e="user-post-item"] a[href*="/photo/"]'); // Selector is already correct
  if (DEBUG_MODE) console.log("TikTok Profile Enhancer: getAllVideoUrlsFromPage - postElements found:", postElements);
  const urls = [];
  postElements.forEach(el => { // Variable name 'postElements' is already correct
    if (el.href && !urls.includes(el.href)) { 
      urls.push(el.href);
    }
  });
  if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: getAllVideoUrlsFromPage - Final urls array:`, urls);
  if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: getAllVideoUrlsFromPage - Found ${urls.length} post URLs.`); // Log message is already correct
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

// --- User Prompt UI Helper Functions ---
// let promptElement = null; // Defined globally

function showPrompt(messageText, onFinishCallback, onResumeCallback) {
    if (DEBUG_MODE) console.log("TikTok Profile Enhancer: showPrompt called with message:", messageText);
    if (!promptElement) {
        promptElement = document.createElement('div');
        promptElement.id = 'tiktok-enhancer-prompt-overlay'; 
        
        promptElement.style.position = 'fixed';
        promptElement.style.top = '0';
        promptElement.style.left = '0';
        promptElement.style.width = '100%';
        promptElement.style.height = '100%';
        promptElement.style.backgroundColor = 'rgba(0,0,0,0.6)';
        promptElement.style.zIndex = '100000'; 
        promptElement.style.display = 'flex';
        promptElement.style.justifyContent = 'center';
        promptElement.style.alignItems = 'center';
        promptElement.style.fontFamily = 'Arial, sans-serif';

        const promptBox = document.createElement('div');
        promptBox.id = 'tiktok-enhancer-prompt-box'; 
        promptBox.style.backgroundColor = 'white';
        promptBox.style.padding = '25px';
        promptBox.style.borderRadius = '10px';
        promptBox.style.textAlign = 'center';
        promptBox.style.boxShadow = '0 5px 20px rgba(0,0,0,0.4)';
        promptBox.style.color = '#333';
        promptBox.style.maxWidth = '90%';
        promptBox.style.width = '400px';


        const messageP = document.createElement('p');
        messageP.id = 'tiktok-enhancer-prompt-message'; 
        messageP.style.marginBottom = '20px';
        messageP.style.fontSize = '16px';
        messageP.style.lineHeight = '1.5';

        const finishBtnEl = document.createElement('button'); 
        finishBtnEl.id = 'tiktok-enhancer-prompt-finish-btn'; 
        finishBtnEl.textContent = 'Finish & Copy URLs';
        finishBtnEl.className = 'tiktok-enhancer-prompt-button'; 
        finishBtnEl.style.padding = '10px 15px';
        finishBtnEl.style.margin = '5px 10px';
        finishBtnEl.style.border = 'none';
        finishBtnEl.style.borderRadius = '5px';
        finishBtnEl.style.cursor = 'pointer';
        finishBtnEl.style.fontSize = '15px';
        finishBtnEl.style.backgroundColor = '#28a745';
        finishBtnEl.style.color = 'white';
        
        const resumeBtnEl = document.createElement('button'); 
        resumeBtnEl.id = 'tiktok-enhancer-prompt-resume-btn'; 
        resumeBtnEl.textContent = 'Attempt to Resume in 15s';
        resumeBtnEl.className = 'tiktok-enhancer-prompt-button'; 
        resumeBtnEl.style.padding = '10px 15px';
        resumeBtnEl.style.margin = '5px 10px';
        resumeBtnEl.style.border = 'none';
        resumeBtnEl.style.borderRadius = '5px';
        resumeBtnEl.style.cursor = 'pointer';
        resumeBtnEl.style.fontSize = '15px';
        resumeBtnEl.style.backgroundColor = '#007bff';
        resumeBtnEl.style.color = 'white';

        promptBox.appendChild(messageP);
        promptBox.appendChild(finishBtnEl);
        promptBox.appendChild(resumeBtnEl);
        promptElement.appendChild(promptBox);
        document.body.appendChild(promptElement);
    }
    
    promptElement.querySelector('#tiktok-enhancer-prompt-message').textContent = messageText;
    promptElement.style.display = 'flex';

    const finishButton = promptElement.querySelector('#tiktok-enhancer-prompt-finish-btn');
    const resumeButton = promptElement.querySelector('#tiktok-enhancer-prompt-resume-btn');

    const newFinishButton = finishButton.cloneNode(true); 
    finishButton.parentNode.replaceChild(newFinishButton, finishButton);
    newFinishButton.addEventListener('click', () => {
        if (DEBUG_MODE) console.log("TikTok Profile Enhancer: 'Finish' button clicked on prompt.");
        hidePrompt();
        if (typeof onFinishCallback === 'function') onFinishCallback();
    });

    const newResumeButton = resumeButton.cloneNode(true); 
    resumeButton.parentNode.replaceChild(newResumeButton, resumeButton);
    newResumeButton.addEventListener('click', () => {
        if (DEBUG_MODE) console.log("TikTok Profile Enhancer: 'Resume' button clicked on prompt.");
        hidePrompt();
        if (typeof onResumeCallback === 'function') onResumeCallback();
    });
}

function hidePrompt() {
    if (promptElement) {
        promptElement.style.display = 'none';
        if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Prompt hidden.");
    }
}
// --- End of User Prompt UI Helper Functions ---


// --- UI Injection ---
function removeInjectedUI() {
  if (DEBUG_MODE) console.log('TikTok Profile Enhancer: removeInjectedUI - CALLED.'); // MODIFIED
  const existingContainer = document.getElementById('tiktok-enhancer-ui-container');
  if (existingContainer) {
    existingContainer.remove();
    if (DEBUG_MODE) console.log('TikTok Profile Enhancer: removeInjectedUI - Successfully REMOVED existing UI container.'); // MODIFIED
  } else {
    if (DEBUG_MODE) console.log('TikTok Profile Enhancer: removeInjectedUI - No existing UI container found to remove.');
  }
}

// MODIFIED function signature
function injectVideoCountsUI(tabBarEl, totalCount, newCount, currentVideoIds) {
  // ADDED BLOCK - Log parameters immediately
  if (DEBUG_MODE) {
      console.log(`TikTok Profile Enhancer: injectVideoCountsUI - CALLED. totalCount: ${totalCount}, newCount: ${newCount}, currentVideoIds length: ${currentVideoIds ? currentVideoIds.length : 'N/A'}`);
      console.log(`TikTok Profile Enhancer: injectVideoCountsUI - tabBarEl provided:`, tabBarEl ? 'Yes' : 'No', tabBarEl);
  }
  // END OF ADDED BLOCK

  if (!tabBarEl) {
    if (DEBUG_MODE) console.warn('TikTok Profile Enhancer: Tab bar element not provided for UI injection. Cannot proceed.');
    return;
  }

  if (DEBUG_MODE) console.log('TikTok Profile Enhancer: injectVideoCountsUI - Calling removeInjectedUI internally.');
  removeInjectedUI();

  if (DEBUG_MODE) console.log('TikTok Profile Enhancer: injectVideoCountsUI - Proceeding to create new UI container.');

  const uiContainer = document.createElement('div');
  uiContainer.id = 'tiktok-enhancer-ui-container';
  uiContainer.className = 'tiktok-enhancer-info-container';

  let clipboardIconUrl = "";
  try {
    clipboardIconUrl = chrome.runtime.getURL("images/clipboard.png");
  } catch (e) {
    if (DEBUG_MODE) console.error("TikTok Profile Enhancer: Error getting clipboardIconUrl", e);
  }

  const totalVideosWrapper = document.createElement('div');
  totalVideosWrapper.style.display = 'flex';
  totalVideosWrapper.style.alignItems = 'center';

  const totalVideosEl = document.createElement('div');
  totalVideosEl.id = 'tiktok-total-videos-display';
  totalVideosEl.className = 'tiktok-enhancer-info-item';
  if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: injectVideoCountsUI - About to set totalVideosEl.textContent with totalCount: ${totalCount}`);
  totalVideosEl.textContent = `Total Videos: ${totalCount !== null ? totalCount : 'N/A'}`;
  if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: injectVideoCountsUI - totalVideosEl.textContent IS NOW: "${totalVideosEl.textContent}"`);
  totalVideosWrapper.appendChild(totalVideosEl);

  if (totalCount !== null && clipboardIconUrl) {
    const totalCopyIcon = document.createElement('img');
    totalCopyIcon.id = 'tiktok-total-videos-copy-icon';
    totalCopyIcon.src = clipboardIconUrl;
    totalCopyIcon.className = 'tiktok-enhancer-clipboard-icon';
    totalCopyIcon.title = 'Copy all video URLs';
    totalCopyIcon.style.width = '20px';
    totalCopyIcon.style.height = '20px';
    totalVideosWrapper.appendChild(totalCopyIcon);

    totalCopyIcon.addEventListener('click', async () => {
        if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Total videos copy icon clicked. Initiating scroll and capture.");

        totalCopyIcon.style.opacity = '0.3';
        const originalTitle = totalCopyIcon.title;
        totalCopyIcon.title = 'Scraping URLs... please wait';

        try {
            const urlsToCopy = await fetchAllVideoUrlsByScrolling();

            if (urlsToCopy && urlsToCopy.length > 0) {
                await navigator.clipboard.writeText(urlsToCopy.join('\n'));
                if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: Copied ${urlsToCopy.length} URLs (scroll & capture) to clipboard.`);
                totalCopyIcon.title = `Copied ${urlsToCopy.length} URLs!`;
                setTimeout(() => {
                    totalCopyIcon.style.opacity = '0.6';
                    totalCopyIcon.title = originalTitle;
                }, 2000);
            } else {
                if (DEBUG_MODE) console.warn("TikTok Profile Enhancer: fetchAllVideoUrlsByScrolling returned no URLs.");
                totalCopyIcon.title = 'No URLs found to copy.';
                 setTimeout(() => {
                    totalCopyIcon.style.opacity = '0.6';
                    totalCopyIcon.title = originalTitle;
                }, 2000);
            }
        } catch (err) {
            console.error('TikTok Profile Enhancer: Error during fetchAllVideoUrlsByScrolling or clipboard write:', err);
            totalCopyIcon.title = 'Error copying URLs.';
            setTimeout(() => {
                totalCopyIcon.style.opacity = '0.6';
                totalCopyIcon.title = originalTitle;
            }, 2000);
        }
    });
  }
  uiContainer.appendChild(totalVideosWrapper);

  const newVideosWrapper = document.createElement('div');
  newVideosWrapper.style.display = 'flex';
  newVideosWrapper.style.alignItems = 'center';
  newVideosWrapper.style.marginLeft = '15px';

  const newVideosEl = document.createElement('div');
  newVideosEl.id = 'tiktok-new-videos-display';
  newVideosEl.className = 'tiktok-enhancer-info-item';
  if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: injectVideoCountsUI - About to set newVideosEl.textContent with newCount: ${newCount}`);
  newVideosEl.textContent = `New: ${newCount !== null ? newCount : 'N/A'}`;
  if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: injectVideoCountsUI - newVideosEl.textContent IS NOW: "${newVideosEl.textContent}"`);
  newVideosWrapper.appendChild(newVideosEl);

  if (newCount !== null && newCount > 0 && clipboardIconUrl) {
    const newCopyIcon = document.createElement('img');
    newCopyIcon.id = 'tiktok-new-videos-copy-icon';
    newCopyIcon.src = clipboardIconUrl;
    newCopyIcon.className = 'tiktok-enhancer-clipboard-icon';
    newCopyIcon.title = 'Copy new video URLs';
    newCopyIcon.style.width = '20px';
    newCopyIcon.style.height = '20px';
    newVideosWrapper.appendChild(newCopyIcon);

    newCopyIcon.addEventListener('click', async () => {
      if (DEBUG_MODE) console.log("TikTok Profile Enhancer: New videos copy icon clicked. newVideoIdsOnPage:", newVideoIdsOnPage);
      if (newVideoIdsOnPage && newVideoIdsOnPage.length > 0) {
        const allUrlsOnPage = getAllVideoUrlsFromPage();
        const newUrlsToCopy = getNewVideoUrls(allUrlsOnPage, newVideoIdsOnPage);
        if (newUrlsToCopy.length > 0) {
          try {
            await navigator.clipboard.writeText(newUrlsToCopy.join('\n'));
            if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Copied new video URLs to clipboard:", newUrlsToCopy.join('\n'));
            newCopyIcon.style.opacity = '0.5';
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
  uiContainer.appendChild(newVideosWrapper);

  if (DEBUG_MODE) console.log('TikTok Profile Enhancer: injectVideoCountsUI - About to append new UI container to tabBarEl:', tabBarEl);
  tabBarEl.appendChild(uiContainer);
  if (DEBUG_MODE) console.log('TikTok Profile Enhancer: injectVideoCountsUI - SUCCESSFULLY APPENDED new UI container to tabBarEl.');
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
  const newUsernameFromUrl = getProfileUsernameFromUrl(); // Renamed to avoid conflict if already exists
  if (DEBUG_MODE) { // Add this block
       console.log(`TikTok Profile Enhancer: processProfilePage - ENTERED. Current URL User: '${newUsernameFromUrl}', Prior Processed User: '${currentProfileUsernameProcessed}', isProcessingPage: ${isProcessingPage}`);
  }
  const currentUrlForLog = window.location.href; // For accurate exit log
  const currentUrlUsername = newUsernameFromUrl; // Ensure using the new variable established above.
  // Note: The original log line used 'currentUrlUsername' before it was robustly defined by newUsernameFromUrl.
  // The new log above is more comprehensive and uses newUsernameFromUrl directly.

  if (!currentUrlUsername) {
    if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Not a profile page. Clearing UI and resetting processed user state.');
    removeInjectedUI();
    if (currentProfileUsernameProcessed) { currentProfileUsernameProcessed = ''; } 
    if (newVideoIdsOnPage.length > 0) { newVideoIdsOnPage = []; } 
    // isProcessingPage will be set to false in the finally block.
    return; // Return here, finally block will still execute
  }

  // Re-entrancy Guard for Same Profile (if already processing)
  if (isProcessingPage && currentUrlUsername === currentProfileUsernameProcessed) {
    if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: processProfilePage - SKIPPED (isProcessingPage was true for user '${currentUrlUsername}' and username matches).`);
    return;
  }

  isProcessingPage = true;

  try {
    enableRightClick(); 

    if (currentUrlUsername !== currentProfileUsernameProcessed) {
        if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: New profile detected or context switch. Old: '${currentProfileUsernameProcessed || "None"}', New: '${currentUrlUsername}'. Resetting UI and new video list.`);
        removeInjectedUI();
        newVideoIdsOnPage = []; 
    } else {
        if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: Re-processing for same user '${currentUrlUsername}'. UI might be updated or re-styled.`);
    }

    const tabBar = findTabBarElement();
    if (!tabBar) {
      if (DEBUG_MODE) console.warn('TikTok Profile Enhancer: Tab bar not found for', currentUrlUsername, '. Cannot inject UI. Processed user remains:', currentProfileUsernameProcessed);
      return; 
    }

    if (DEBUG_MODE && currentUrlUsername) { // Add this log // ensure using currentUrlUsername which is now newUsernameFromUrl
       console.log(`TikTok Profile Enhancer: processProfilePage - About to call extractPageData for user: '${currentUrlUsername}'.`);
    }
    const pageData = extractPageData(currentUrlUsername); // Ensure this uses the fresh username
    let displayTotalVideos = pageData.videoCount; 
    let displayVideoIds = pageData.videoIds || []; 
    if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: processProfilePage - displayVideoIds set to:`, displayVideoIds);

    let newVideosCountForDisplay = 0;
    let newVideoIdsOnPageForThisRun = [];
    const storedProfileData = await new Promise(resolve => getStoredDataForProfile(currentUrlUsername, resolve));
    if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: processProfilePage - storedProfileData:`, storedProfileData);


    if (storedProfileData) {
        if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: processProfilePage - storedProfileData.seenVideoIds:`, storedProfileData.seenVideoIds);
        if (typeof storedProfileData.lastSeenVideoCount === 'number' && typeof displayTotalVideos === 'number' && displayTotalVideos > storedProfileData.lastSeenVideoCount) {
            newVideosCountForDisplay = displayTotalVideos - storedProfileData.lastSeenVideoCount;
        }
        if (Array.isArray(storedProfileData.seenVideoIds) && displayVideoIds.length > 0) {
            const filteredIds = displayVideoIds.filter(id => !storedProfileData.seenVideoIds.includes(id));
            if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: processProfilePage - Filtered IDs (new):`, filteredIds);
            newVideoIdsOnPageForThisRun = filteredIds;
        } else if (displayVideoIds.length > 0) { 
            if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: processProfilePage - No seenVideoIds in stored data or displayVideoIds empty, using all displayVideoIds for newVideoIdsOnPageForThisRun.`);
            newVideoIdsOnPageForThisRun = [...displayVideoIds]; 
        }
    } else if (displayVideoIds.length > 0) { 
        if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: processProfilePage - No stored data for ${currentUrlUsername}. All ${displayVideoIds.length} videos on page considered new for styling purposes.`);
        newVideoIdsOnPageForThisRun = [...displayVideoIds];
        if(typeof displayTotalVideos === 'number') {
            newVideosCountForDisplay = displayTotalVideos;
        } else {
             newVideosCountForDisplay = displayVideoIds.length; 
        }
    }
    if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: processProfilePage - newVideoIdsOnPageForThisRun final value before assignment:`, newVideoIdsOnPageForThisRun);
    newVideoIdsOnPage = newVideoIdsOnPageForThisRun; 

    if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: processProfilePage - Calling applyStylingToNewVideos with newVideoIdsOnPage:`, newVideoIdsOnPage);
    injectVideoCountsUI(tabBar, displayTotalVideos, newVideosCountForDisplay, displayVideoIds);
    applyStylingToNewVideos(newVideoIdsOnPage);

    currentProfileUsernameProcessed = currentUrlUsername; // Ensure this uses the fresh username
    if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: processProfilePage - Updated currentProfileUsernameProcessed to: '${currentProfileUsernameProcessed}'.`); // Add this

    if (typeof displayTotalVideos === 'number') {
        const dataToStore = { lastSeenVideoCount: displayTotalVideos, lastVisitedTimestamp: new Date().toISOString(), seenVideoIds: displayVideoIds };
        setStoredDataForProfile(currentUrlUsername, dataToStore); 
    } else { 
        if (DEBUG_MODE) console.warn(`TikTok Profile Enhancer: Not storing data for ${currentUrlUsername} due to invalid video count.`);
    }

  } catch (e) {
    console.error('TikTok Profile Enhancer: Critical error in processProfilePage for user', currentUrlUsername, ':', e, e.stack);
    removeInjectedUI();
  } finally {
    isProcessingPage = false;
    if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: processProfilePage - EXITED. URL User: '${currentUrlUsername}', Processed User: '${currentProfileUsernameProcessed}', isProcessing: ${isProcessingPage}`);
  }
}

// New helper function:
function applyStylingToNewVideos(idsToStyle) {
    if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: applyStylingToNewVideos - Received idsToStyle:`, idsToStyle);
    if (!Array.isArray(idsToStyle) || idsToStyle.length === 0) {
        if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: applyStylingToNewVideos - idsToStyle is empty or not an array. Returning early.`);
        return;
    }

    idsToStyle.forEach(videoId => {
        if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: applyStylingToNewVideos - Processing videoId: ${videoId}`);
        const potentialVideoContainers = document.querySelectorAll('div > a[href*="/video/' + videoId + '"]');
        if (DEBUG_MODE) {
            console.log(`TikTok Profile Enhancer: applyStylingToNewVideos - For videoId ${videoId}, potentialVideoContainers.length: ${potentialVideoContainers.length}`);
            console.log(`TikTok Profile Enhancer: applyStylingToNewVideos - For videoId ${videoId}, potentialVideoContainers:`, potentialVideoContainers);
        }
        
        potentialVideoContainers.forEach(linkElement => {
            const container = linkElement.parentElement; 
            if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: applyStylingToNewVideos - linkElement:`, linkElement, `container:`, container);
            if (container) {
                if (container.querySelector('img')) {
                    if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: applyStylingToNewVideos - Attempting to apply outline to container for video ID: ${videoId}`, container);
                    container.classList.add('tiktok-enhancer-new-video-outline');
                    if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: applyStylingToNewVideos - Successfully applied outline to container for video ID: ${videoId}`);
                } else {
                     if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: applyStylingToNewVideos - Found link for video ${videoId}, but parent div doesn't look like a video item (no img). Styling link's parent. Attempting to apply outline.`, container);
                     container.classList.add('tiktok-enhancer-new-video-outline');
                     if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: applyStylingToNewVideos - Successfully applied outline to (fallback) container for video ID: ${videoId}`);
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
                newVideosLikelyAppeared = true; 
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

  let lastObservedUrl = window.location.href;
  navigationObserver = new MutationObserver(() => {
    // Inside navigationObserver callback
    const currentUrl = window.location.href;
    if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: NAV OBSERVED - New URL detected: ${currentUrl}, Previous URL: ${lastObservedUrl}`); // Add this
    if (currentUrl !== lastObservedUrl) {
        if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: NAV OBSERVED - URL HAS CHANGED.`); // Add this
        lastObservedUrl = currentUrl;
        // Log state BEFORE changes
        if (DEBUG_MODE) { // Add this block
            console.log(`TikTok Profile Enhancer: NAV OBSERVED - Before reset: currentProfileUsernameProcessed = '${currentProfileUsernameProcessed}', isProcessingPage = ${isProcessingPage}`);
        }
        removeInjectedUI();
        currentProfileUsernameProcessed = ''; 
        newVideoIdsOnPage = [];
        isProcessingPage = false; 
        // Log state AFTER changes
        if (DEBUG_MODE) { // Add this block
            console.log(`TikTok Profile Enhancer: NAV OBSERVED - After reset: currentProfileUsernameProcessed = '${currentProfileUsernameProcessed}', isProcessingPage = ${isProcessingPage}`);
            console.log(`TikTok Profile Enhancer: NAV OBSERVED - Calling processProfilePage() due to navigation.`);
        }
        processProfilePage(); 
    } else { // Add this else block for logging
        if (DEBUG_MODE) console.log(`TikTok Profile Enhancer: NAV OBSERVED - URL did NOT change. No action.`);
    }
  });

  if (ENABLE_OBSERVERS) {
    const headElement = document.querySelector('head');
    if (headElement) {
      navigationObserver.observe(headElement, { childList: true, subtree: true });
      if (DEBUG_MODE) console.log('TikTok Profile Enhancer: navigationObserver STARTED on <head>.');
    } else {
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

  if (DEBUG_MODE) console.log("TikTok Profile Enhancer: Scheduling initial processProfilePage calls.");
  setTimeout(processProfilePage, 750);  
  setTimeout(processProfilePage, 2500); 
}

// --- Start Execution ---
if (DEBUG_MODE) console.log('TikTok Profile Enhancer: Script execution started. Document readyState:', document.readyState);
if (document.readyState === 'loading') {
  if (DEBUG_MODE) console.log('TikTok Profile Enhancer: DOM is loading, adding DOMContentLoaded listener.');
  document.addEventListener('DOMContentLoaded', () => {
    console.log('TikTok Profile Enhancer: DOMContentLoaded event triggered.');
    initializeObservers();
  });
} else {
  if (DEBUG_MODE) console.log('TikTok Profile Enhancer: DOM is already ready, calling initializeObservers directly.');
  initializeObservers(); 
}

console.log('TikTok Profile Enhancer content script loaded and initialized.');