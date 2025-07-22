console.log('background.js 読み込み開始');

// 拡張機能インストール時
chrome.runtime.onInstalled.addListener(() => {
  console.log('拡張機能がインストールされました');

  // グローバル設定のみ初期化（UIの表示状態など）
  chrome.storage.local.set({
    isBarVisible: false,  // 初期状態は非表示
    isDrawingEnabled: true
  });
});

// タブ切り替え時の状態同期
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    console.log('タブ切り替え検知:', activeInfo.tabId);

    // 現在のUI状態を取得
    const result = await chrome.storage.local.get(['isBarVisible']);

    // アクティブになったタブに現在のUI状態を送信
    try {
      await chrome.tabs.sendMessage(activeInfo.tabId, {
        type: 'SYNC_UI_STATE',
        isBarVisible: result.isBarVisible
      });
      console.log('UI状態同期完了:', activeInfo.tabId, result.isBarVisible);
    } catch (error) {
      // コンテンツスクリプトが注入されていない場合は無視
      console.log('コンテンツスクリプト未注入のタブ:', activeInfo.tabId);
    }

  } catch (error) {
    console.error('タブ切り替え時のエラー:', error);
  }
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

    // UIの表示状態のみグローバルで管理
    const result = await chrome.storage.local.get(['isBarVisible', 'isDrawingEnabled']);
    const newVisibility = !result.isBarVisible;
    console.log('UI表示状態変更:', result.isBarVisible, '->', newVisibility);

    // 新しい状態を保存（UIの表示状態のみ）
    await chrome.storage.local.set({ isBarVisible: newVisibility });

    // 現在のタブに通知
    await chrome.tabs.sendMessage(tab.id, {
      type: 'TOGGLE_BAR_VISIBILITY',
      visible: newVisibility
    });

    // 他の全てのタブにも状態変更を通知
    try {
      const allTabs = await chrome.tabs.query({});
      for (const tabInfo of allTabs) {
        if (tabInfo.id !== tab.id) {
          try {
            await chrome.tabs.sendMessage(tabInfo.id, {
              type: 'SYNC_UI_STATE',
              isBarVisible: newVisibility,
              isDrawingEnabled: result.isDrawingEnabled
            });
            console.log('他タブに状態同期:', tabInfo.id);
          } catch (error) {
            // コンテンツスクリプトが注入されていないタブは無視
          }
        }
      }
    } catch (error) {
      console.error('他タブへの同期エラー:', error);
    }

    console.log('メッセージ送信完了');

  } catch (error) {
    console.error('エラー:', error);
    // エラー時はリロード
    await chrome.storage.local.set({ isBarVisible: true });
    chrome.tabs.reload(tab.id);
  }
});

console.log('background.js 読み込み完了');