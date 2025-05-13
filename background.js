chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    activeSession: false,
    isHost: false,
    sessionId: null,
    color: '#000000',
    penSize: 3
  });
});

// ブラウザ終了時にセッションから退出
chrome.runtime.onSuspend.addListener(() => {
  chrome.storage.local.get(['activeSession', 'sessionId'], function(data) {
    if (data.activeSession && data.sessionId) {
      // Firebase のセッションから退出（オプション）
    }
  });
});