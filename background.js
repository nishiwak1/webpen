// バックグラウンドサービスワーカー
chrome.runtime.onInstalled.addListener(() => {
  console.log('共有お絵描き拡張機能がインストールされました');
  
  // 初期設定
  chrome.storage.local.set({
    isDrawing: true,
    currentColor: '#000000'
  });
});

// タブが更新された時の処理
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    // 現在の部屋情報を取得
    const result = await chrome.storage.local.get(['currentRoom']);
    if (result.currentRoom) {
      // 新しいタブでも描画キャンバスを表示
      chrome.tabs.sendMessage(tabId, {
        type: 'JOIN_ROOM',
        roomCode: result.currentRoom
      }).catch(() => {
        // メッセージ送信エラーは無視（まだコンテンツスクリプトが読み込まれていない場合）
      });
    }
  }
});

// アクションボタンクリック時の処理
chrome.action.onClicked.addListener(async (tab) => {
  // バーの表示切り替え
  const result = await chrome.storage.local.get(['isBarVisible']);
  const newVisibility = !(result.isBarVisible !== false);
  
  await chrome.storage.local.set({ isBarVisible: newVisibility });
  
  // コンテンツスクリプトに通知
  chrome.tabs.sendMessage(tab.id, {
    type: 'TOGGLE_BAR_VISIBILITY',
    visible: newVisibility
  }).catch(() => {
    // エラーは無視
  });
});

// メッセージ処理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'GET_ACTIVE_TAB':
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        sendResponse({ tab: tabs[0] });
      });
      return true; // 非同期レスポンス
      
    case 'BROADCAST_TO_ALL_TABS':
      // すべてのタブに同じメッセージを送信
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, message.data).catch(() => {
            // エラーは無視
          });
        });
      });
      break;
  }
});

// ストレージ変更の監視
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    // 設定変更をすべてのタブに通知
    Object.keys(changes).forEach(key => {
      if (key === 'currentRoom' || key === 'isDrawing' || key === 'currentColor') {
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {
              type: 'SETTING_CHANGED',
              key: key,
              oldValue: changes[key].oldValue,
              newValue: changes[key].newValue
            }).catch(() => {
              // エラーは無視
            });
          });
        });
      }
    });
  }
});

// アラーム機能（定期的な同期など）
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'sync-drawings') {
    // 定期的な描画データ同期処理
    syncDrawings();
  }
});

// 同期処理（実装例）
async function syncDrawings() {
  const result = await chrome.storage.local.get(['currentRoom']);
  if (result.currentRoom) {
    // 実際の実装では、サーバーとの同期処理を行う
    console.log(`部屋 ${result.currentRoom} の描画データを同期中...`);
  }
}

// 定期同期の開始
chrome.alarms.create('sync-drawings', {
  delayInMinutes: 1,
  periodInMinutes: 5
});