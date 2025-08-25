console.log('background.js 読み込み開始');

// 拡張機能インストール時
chrome.runtime.onInstalled.addListener(() => {
  console.log('拡張機能がインストールされました');

  // グローバル設定のみ初期化（UIの表示状態など）
  chrome.storage.local.set({
    isBarVisible: false,
    isDrawingEnabled: true
  });
});

// 拡張機能アイコンクリック時
chrome.action.onClicked.addListener(async (tab) => {
  console.log('拡張機能アイコンがクリックされました - tabId:', tab.id);

  try {
    // まずコンテンツスクリプトが注入されているか確認
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
      console.log('コンテンツスクリプトは既に注入されています');
    } catch (e) {
      console.log('コンテンツスクリプトを注入します');
      // コンテンツスクリプトを注入
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['websocket.js', 'canvas.js', 'content.js']
      });

      // 少し待機（注入完了を確実にするため）
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // 現在のタブの状態を確認するためにメッセージを送信
    let currentTabVisible = false;
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'GET_CURRENT_STATE'
      });
      currentTabVisible = response?.isBarVisible || false;
    } catch (error) {
      // タブが状態を返さない場合は非表示として扱う
      currentTabVisible = false;
    }

    const newVisibility = !currentTabVisible;
    console.log('現在のタブの表示状態変更:', currentTabVisible, '->', newVisibility);

    // 現在のタブにのみ通知
    await chrome.tabs.sendMessage(tab.id, {
      type: 'TOGGLE_BAR_VISIBILITY',
      visible: newVisibility
    });

    console.log('メッセージ送信完了');

  } catch (error) {
    console.error('エラー:', error);
    chrome.tabs.reload(tab.id);
  }
});

console.log('background.js 読み込み完了');