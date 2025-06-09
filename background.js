// バックグラウンドサービスワーカー
console.log('background.js 読み込み開始');

// 拡張機能インストール時
chrome.runtime.onInstalled.addListener(() => {
  console.log('拡張機能がインストールされました');
  
  chrome.storage.local.set({
    isDrawing: true,
    currentColor: '#000000',
    isBarVisible: false
  });
});

// 拡張機能アイコンクリック時
chrome.action.onClicked.addListener(async (tab) => {
  console.log('拡張機能アイコンがクリックされました - tabId:', tab.id);
  
  try {
    // 現在の状態を取得
    const result = await chrome.storage.local.get(['isBarVisible']);
    const newVisibility = !result.isBarVisible;
    
    console.log('状態変更:', result.isBarVisible, '->', newVisibility);
    
    // 新しい状態を保存
    await chrome.storage.local.set({ isBarVisible: newVisibility });
    
    // コンテンツスクリプトに通知
    await chrome.tabs.sendMessage(tab.id, {
      type: 'TOGGLE_BAR_VISIBILITY',
      visible: newVisibility
    });
    
    console.log('メッセージ送信完了');
    
  } catch (error) {
    console.error('エラー:', error);
    
    // エラー時はリロード
    await chrome.storage.local.set({ isBarVisible: true });
    chrome.tabs.reload(tab.id);
  }
});

console.log('background.js 読み込み完了');