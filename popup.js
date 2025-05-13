
// popup.js
document.addEventListener('DOMContentLoaded', function() {
  const startButton = document.getElementById('start-session');
  const joinButton = document.getElementById('join-session');
  const copyButton = document.getElementById('copy-url');
  const clearButton = document.getElementById('clear-canvas');
  const endButton = document.getElementById('end-session');
  const startSection = document.getElementById('start-section');
  const activeSection = document.getElementById('active-session');
  const sessionUrlInput = document.getElementById('session-url');
  const colorElements = document.querySelectorAll('.color');
  const penSizeInput = document.getElementById('pen-size');
  
  // 新しいセッションを開始
  startButton.addEventListener('click', function() {
    const sessionId = generateSessionId();
    chrome.storage.local.set({
      activeSession: true,
      isHost: true,
      sessionId: sessionId,
      color: '#000000',
      penSize: 3
    }, function() {
      const url = `${window.location.origin}?session=${sessionId}`;
      sessionUrlInput.value = url;
      startSection.style.display = 'none';
      activeSection.style.display = 'block';
      
      // コンテンツスクリプトに通知
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'startSession',
          sessionId: sessionId
        });
      });
    });
  });
  
  // 既存のセッションに参加
  joinButton.addEventListener('click', function() {
    const sessionId = document.getElementById('join-code').value.trim();
    if (sessionId) {
      chrome.storage.local.set({
        activeSession: true,
        isHost: false,
        sessionId: sessionId,
        color: '#000000',
        penSize: 3
      }, function() {
        startSection.style.display = 'none';
        activeSection.style.display = 'block';
        
        // コンテンツスクリプトに通知
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'joinSession',
            sessionId: sessionId
          });
        });
      });
    }
  });
  
  // URLをクリップボードにコピー
  copyButton.addEventListener('click', function() {
    sessionUrlInput.select();
    document.execCommand('copy');
  });
  
  // キャンバスをクリア
  clearButton.addEventListener('click', function() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'clearCanvas'
      });
    });
  });
  
  // セッション終了
  endButton.addEventListener('click', function() {
    chrome.storage.local.set({activeSession: false}, function() {
      startSection.style.display = 'block';
      activeSection.style.display = 'none';
      
      // コンテンツスクリプトに通知
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'endSession'
        });
      });
    });
  });
  
  // 色選択
  colorElements.forEach(function(elem) {
    elem.addEventListener('click', function() {
      const color = this.getAttribute('data-color');
      chrome.storage.local.set({color: color});
      
      // コンテンツスクリプトに通知
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'changeColor',
          color: color
        });
      });
    });
  });
  
  // 線の太さ変更
  penSizeInput.addEventListener('change', function() {
    const size = this.value;
    chrome.storage.local.set({penSize: size});
    
    // コンテンツスクリプトに通知
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'changePenSize',
        size: size
      });
    });
  });
  
  // セッションIDを生成
  function generateSessionId() {
    return Math.random().toString(36).substring(2, 15);
  }
  
  // 初期状態のチェック
  chrome.storage.local.get(['activeSession', 'sessionId'], function(data) {
    if (data.activeSession) {
      startSection.style.display = 'none';
      activeSection.style.display = 'block';
      sessionUrlInput.value = `${window.location.origin}?session=${data.sessionId}`;
    }
  });
});