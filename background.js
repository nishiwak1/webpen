
// background.js
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    activeSession: false,
    isHost: false,
    sessionId: null,
    color: '#000000',
    penSize: 3
  });
});
