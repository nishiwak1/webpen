// ポップアップの制御
document.addEventListener('DOMContentLoaded', async () => {
  const joinSection = document.getElementById('joinSection');
  const roomSection = document.getElementById('roomSection');
  const roomCodeInput = document.getElementById('roomCodeInput');
  const joinRoomBtn = document.getElementById('joinRoom');
  const createRoomBtn = document.getElementById('createRoom');
  const leaveRoomBtn = document.getElementById('leaveRoom');
  const currentRoomDiv = document.getElementById('currentRoom');
  const statusDiv = document.getElementById('status');
  const toggleDrawBtn = document.getElementById('toggleDraw');
  const clearCanvasBtn = document.getElementById('clearCanvas');
  const colorBtns = document.querySelectorAll('.color-btn');

  // 現在の状態を取得
  const result = await chrome.storage.local.get(['currentRoom', 'isDrawing', 'currentColor']);
  
  if (result.currentRoom) {
    showRoomSection(result.currentRoom);
  }
  
  updateDrawButton(result.isDrawing !== false);
  updateColorButtons(result.currentColor || '#000000');

  // イベントリスナー
  joinRoomBtn.addEventListener('click', () => {
    const code = roomCodeInput.value.trim().toUpperCase();
    if (code.length === 8) {
      joinRoom(code);
    }
  });

  createRoomBtn.addEventListener('click', () => {
    const code = generateRoomCode();
    joinRoom(code);
  });

  leaveRoomBtn.addEventListener('click', () => {
    leaveRoom();
  });

  toggleDrawBtn.addEventListener('click', () => {
    toggleDrawing();
  });

  clearCanvasBtn.addEventListener('click', () => {
    clearCanvas();
  });

  colorBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;
      selectColor(color);
    });
  });

  roomCodeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      joinRoomBtn.click();
    }
  });

  // 部屋に参加
  async function joinRoom(code) {
    try {
      await chrome.storage.local.set({ currentRoom: code });
      
      // コンテンツスクリプトに通知
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      chrome.tabs.sendMessage(tab.id, {
        type: 'JOIN_ROOM',
        roomCode: code
      });

      showRoomSection(code);
      statusDiv.textContent = `部屋 ${code} に接続中...`;
    } catch (error) {
      console.error('部屋参加エラー:', error);
      statusDiv.textContent = 'エラー: 部屋に参加できませんでした';
    }
  }

  // 部屋から退出
  async function leaveRoom() {
    try {
      await chrome.storage.local.remove(['currentRoom']);
      
      // コンテンツスクリプトに通知
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      chrome.tabs.sendMessage(tab.id, {
        type: 'LEAVE_ROOM'
      });

      showJoinSection();
      statusDiv.textContent = 'オフライン';
    } catch (error) {
      console.error('退室エラー:', error);
    }
  }

  // 描画モード切り替え
  async function toggleDrawing() {
    const result = await chrome.storage.local.get(['isDrawing']);
    const newState = !(result.isDrawing !== false);
    
    await chrome.storage.local.set({ isDrawing: newState });
    updateDrawButton(newState);

    // コンテンツスクリプトに通知
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, {
      type: 'TOGGLE_DRAWING',
      isDrawing: newState
    });
  }

  // キャンバスクリア
  async function clearCanvas() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, {
      type: 'CLEAR_CANVAS'
    });
  }

  // 色選択
  async function selectColor(color) {
    await chrome.storage.local.set({ currentColor: color });
    updateColorButtons(color);

    // コンテンツスクリプトに通知
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, {
      type: 'CHANGE_COLOR',
      color: color
    });
  }

  // UI更新関数
  function showRoomSection(code) {
    joinSection.style.display = 'none';
    roomSection.style.display = 'block';
    currentRoomDiv.textContent = code;
  }

  function showJoinSection() {
    joinSection.style.display = 'block';
    roomSection.style.display = 'none';
    roomCodeInput.value = '';
  }

  function updateDrawButton(isDrawing) {
    toggleDrawBtn.textContent = `描画: ${isDrawing ? 'ON' : 'OFF'}`;
    toggleDrawBtn.style.background = isDrawing ? '#4CAF50' : '#ff6b6b';
  }

  function updateColorButtons(selectedColor) {
    colorBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.color === selectedColor);
    });
  }

  // ランダム8桁コード生成
  function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
});
document.addEventListener('DOMContentLoaded', function() {
  // 既存のDOM要素参照
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
    
    // Firebase にセッションデータ構造を作成
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
      // セッションの存在を確認
      firebase.database().ref(`sessions/${sessionId}/info`).once('value', (snapshot) => {
        if (snapshot.exists()) {
          // セッションが存在する場合
          chrome.storage.local.set({
            activeSession: true,
            isHost: false,
            sessionId: sessionId,
            color: '#000000',
            penSize: 3
          }, function() {
            startSection.style.display = 'none';
            activeSection.style.display = 'block';
            sessionUrlInput.value = `${window.location.origin}?session=${sessionId}`;
            
            // コンテンツスクリプトに通知
            chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
              chrome.tabs.sendMessage(tabs[0].id, {
                action: 'joinSession',
                sessionId: sessionId
              });
            });
          });
        } else {
          // セッションが存在しない場合
          alert('セッションが見つかりません。セッションIDを確認してください。');
        }
      });
    }
  });
  
  // 残りのイベントリスナー（コピー、クリア、セッション終了など）
  // 以下は既存のコードとほぼ同じ
  
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
    chrome.storage.local.get(['sessionId'], function(data) {
      const sessionId = data.sessionId;
      if (sessionId) {
        // ホストの場合のみセッションデータを削除
        chrome.storage.local.get(['isHost'], function(data) {
          if (data.isHost) {
            // 30分後にセッションを削除する（オプション）
            const deleteTime = new Date();
            deleteTime.setMinutes(deleteTime.getMinutes() + 30);
            firebase.database().ref(`sessions/${sessionId}/info/scheduledDelete`).set(deleteTime.getTime());
          }
        });
      }
      
      // ローカルのセッション状態をリセット
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