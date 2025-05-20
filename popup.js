document.addEventListener('DOMContentLoaded', function () {
  // DOM要素参照
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

  // セッションIDを生成
  function generateSessionId() {
    return Math.random().toString(36).substring(2, 15);
  }

  // 新しいセッションを開始
  startButton.addEventListener('click', function () {
    const sessionId = generateSessionId();

    firebase.database().ref(`sessions/${sessionId}/info`).set({
      created: firebase.database.ServerValue.TIMESTAMP,
      lastActive: firebase.database.ServerValue.TIMESTAMP
    });

    chrome.storage.local.set({
      activeSession: true,
      isHost: true,
      sessionId: sessionId,
      color: '#000000',
      penSize: 3
    }, function () {
      const url = `${window.location.origin}?session=${sessionId}`;
      sessionUrlInput.value = url;
      startSection.style.display = 'none';
      activeSection.style.display = 'block';

      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'startSession',
          sessionId: sessionId
        });
      });
    });
  });

  // 既存のセッションに参加
  joinButton.addEventListener('click', function () {
    const sessionId = document.getElementById('join-code').value.trim();
    if (sessionId) {
      firebase.database().ref(`sessions/${sessionId}/info`).once('value', (snapshot) => {
        if (snapshot.exists()) {
          chrome.storage.local.set({
            activeSession: true,
            isHost: false,
            sessionId: sessionId,
            color: '#000000',
            penSize: 3
          }, function () {
            startSection.style.display = 'none';
            activeSection.style.display = 'block';
            sessionUrlInput.value = `${window.location.origin}?session=${sessionId}`;

            chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
              chrome.tabs.sendMessage(tabs[0].id, {
                action: 'joinSession',
                sessionId: sessionId
              });
            });
          });
        } else {
          alert('セッションが見つかりません。セッションIDを確認してください。');
        }
      });
    }
  });

  // URLをクリップボードにコピー
  copyButton.addEventListener('click', function () {
    sessionUrlInput.select();
    document.execCommand('copy');
  });

  // キャンバスをクリア
  clearButton.addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'clearCanvas'
      });
    });
  });

  // セッション終了
  endButton.addEventListener('click', function () {
    chrome.storage.local.get(['sessionId'], function (data) {
      const sessionId = data.sessionId;
      if (sessionId) {
        chrome.storage.local.get(['isHost'], function (data) {
          if (data.isHost) {
            const deleteTime = new Date();
            deleteTime.setMinutes(deleteTime.getMinutes() + 30);
            firebase.database().ref(`sessions/${sessionId}/info/scheduledDelete`).set(deleteTime.getTime());
          }
        });
      }

      chrome.storage.local.set({ activeSession: false }, function () {
        startSection.style.display = 'block';
        activeSection.style.display = 'none';

        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'endSession'
          });
        });
      });
    });
  });

  // 色選択処理
  colorElements.forEach(function (elem) {
    elem.addEventListener('click', function () {
      const color = this.getAttribute('data-color');

      // 全ての色の選択状態をリセット
      colorElements.forEach(c => c.classList.remove('selected'));
      this.classList.add('selected');

      chrome.storage.local.set({ color: color });

      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'changeColor',
          color: color
        });
      });
    });
  });

  // 初期状態で選択中の色に selected をつける
  chrome.storage.local.get(['color'], function (data) {
    const currentColor = data.color || '#000000';
    colorElements.forEach(function (elem) {
      if (elem.getAttribute('data-color') === currentColor) {
        elem.classList.add('selected');
      }
    });
  });

  // 線の太さ変更
  penSizeInput.addEventListener('change', function () {
    const size = this.value;
    chrome.storage.local.set({ penSize: size });

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'changePenSize',
        size: size
      });
    });
  });

  // 初期状態チェック
  chrome.storage.local.get(['activeSession', 'sessionId'], function (data) {
    if (data.activeSession) {
      startSection.style.display = 'none';
      activeSection.style.display = 'block';
      sessionUrlInput.value = `${window.location.origin}?session=${data.sessionId}`;
    }
  });
});
