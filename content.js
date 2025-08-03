class SharedDrawing {
  constructor() {
    // 状態管理（タブ固有）
    this.controlBar = null;
    this.isBarVisible = true;
    this.currentRoom = null; // タブ固有
    this.userCount = 0;
    this.isInitialized = false;
    this.drawingStateBeforeMinimize = null;

    // 描画設定（タブ固有）
    this.isDrawingEnabled = true;
    this.currentColor = '#000000';
    this.currentOpacity = 0.7;

    // ひとつ戻る・進む用の、履歴管理
    this.myStrokes = []; // 自分が描いた線の履歴
    this.otherStrokes = []; // 他人が描いた線の履歴
    this.undoneStrokes = []; // 取り消した自分の線
    this.maxHistorySize = 50; // 履歴の最大サイズ

    // タブIDを生成（一意識別用）
    this.tabId = this.generateTabId();

    // WebSocketマネージャーを初期化
    this.wsManager = new WebSocketManager(
      (message) => this.handleWebSocketMessage(message),
      (status) => this.handleConnectionStatusChange(status)
    );

    // Canvasマネージャーを初期化
    this.canvasManager = new CanvasManager(
      (drawData) => this.handleLocalDraw(drawData)
    );

    this.init();
  }

  generateTabId() {
    return 'tab_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  async init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.initializeComponents());
    } else {
      this.initializeComponents();
    }
  }

  async initializeComponents() {
    if (this.isInitialized) return;

    try {
      // グローバル設定を読み込み（UI表示状態 + 描画モード）
      const result = await chrome.storage.local.get(['isBarVisible', 'isDrawingEnabled']);

      this.isBarVisible = result.isBarVisible !== false;
      this.isDrawingEnabled = result.isDrawingEnabled !== false;

      // UIが非表示なら描画をOFF
      if (!this.isBarVisible) {
        this.isDrawingEnabled = false;
      }

      // 描画設定はタブ固有のデフォルト値を使用
      this.canvasManager.setEnabled(this.isDrawingEnabled);
      this.canvasManager.setColor(this.currentColor);
      this.canvasManager.setOpacity(this.currentOpacity);

      // UI作成
      setTimeout(() => {
        this.createControlBar();
        this.canvasManager.create(this.isBarVisible);
        this.setupChromeListeners();

        // 新しいタブでは部屋に自動接続しない
        // ユーザーが手動で部屋コードを入力するまで待機

        this.isInitialized = true;
      }, 500);

    } catch (error) {
      console.error('初期化エラー:', error);
    }
  }

  // ----------------------------------------
  // 1. UI作成・管理
  // ----------------------------------------

  createControlBar() {
    const existingBar = document.getElementById('shared-drawing-control-bar');
    if (existingBar) {
      existingBar.remove();
    }

    // 非表示状態の場合は作成しない
    if (!this.isBarVisible) {
      return;
    }

    if (!document.body) {
      setTimeout(() => this.createControlBar(), 100);
      return;
    }

    this.controlBar = document.createElement('div');
    this.controlBar.id = 'shared-drawing-control-bar';

    const barStyles = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      width: 100% !important;
      height: 60px !important;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
      border-bottom: 1px solid rgba(255,255,255,0.2) !important;
      z-index: 2147483647 !important;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2) !important;
      transition: opacity 0.15s ease !important;
      overflow: hidden !important;
      box-sizing: border-box !important;
      pointer-events: auto !important;
      user-select: none !important;
      opacity: 0 !important;
      visibility: hidden !important;
    `;

    this.controlBar.style.cssText = barStyles;
    this.loadBarContent();
    document.body.insertBefore(this.controlBar, document.body.firstChild);

    this.updateBodyPadding();
  }

  async loadBarContent() {
    try {
      const htmlUrl = chrome.runtime.getURL('control-bar.html');
      const response = await fetch(htmlUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const htmlContent = await response.text();
      this.controlBar.innerHTML = htmlContent;
      this.updateBarState();
      this.setupControlBarEvents();

      // コンテンツ読み込み完了後、状態に応じて表示
      this.showBarIfNeeded();

    } catch (error) {
      console.error('HTMLコンテンツ読み込みエラー:', error);
      this.controlBar.innerHTML = `
        <div style="color: white; padding: 15px; text-align: center; font-family: Arial;">
          ⚠️ control-bar.html が見つかりません
        </div>
      `;
      this.showBarIfNeeded();
    }
  }

  // 新しいメソッド：状態に応じてバーを表示
  showBarIfNeeded() {
    if (this.controlBar && this.isBarVisible) {
      // 少し遅延を入れて自然に表示
      setTimeout(() => {
        if (this.controlBar) {
          this.controlBar.style.opacity = '1';
          this.controlBar.style.visibility = 'visible';
        }
      }, 50);
    }
  }

  // 新しいメソッド：バーを隠す
  hideBar() {
    if (this.controlBar) {
      this.controlBar.style.opacity = '0';
      this.controlBar.style.visibility = 'hidden';

      // アニメーション完了後に削除
      setTimeout(() => {
        if (this.controlBar) {
          this.controlBar.remove();
          this.controlBar = null;
        }
      }, 150);
    }
  }

  updateBarState() {
    if (!this.controlBar || !this.controlBar.innerHTML) return;

    const expandedContent = this.controlBar.querySelector('#expanded-content');
    const minimizedContent = this.controlBar.querySelector('#minimized-content');
    const roomJoin = this.controlBar.querySelector('#room-join');
    const roomCurrent = this.controlBar.querySelector('#room-current');
    const currentRoomCode = this.controlBar.querySelector('#current-room-code');
    const toggleDrawButton = this.controlBar.querySelector('#toggle-draw-btn');
    const opacitySlider = this.controlBar.querySelector('#opacity-slider');
    const opacityValue = this.controlBar.querySelector('#opacity-value');
    const roomInput = this.controlBar.querySelector('#room-input');

    // 展開/最小化の表示切り替え
    if (expandedContent && minimizedContent) {
      if (this.isBarVisible) {
        expandedContent.classList.remove('hidden');
        minimizedContent.classList.add('hidden');
      } else {
        expandedContent.classList.add('hidden');
        minimizedContent.classList.add('hidden');
      }
    }

    // 部屋入力フィールドを常にクリア（タブ固有の動作）
    if (roomInput) {
      roomInput.value = '';
    }

    // 部屋状態の表示切り替え
    if (roomJoin && roomCurrent) {
      if (this.currentRoom) {
        roomJoin.classList.add('hidden');
        roomCurrent.classList.remove('hidden');
        if (currentRoomCode) {
          const statusText = this.wsManager.connectionStatus === 'connected'
            ? `${this.currentRoom} (${this.userCount}人)`
            : `${this.currentRoom} (接続中...)`;
          currentRoomCode.textContent = statusText;
        }
      } else {
        roomJoin.classList.remove('hidden');
        roomCurrent.classList.add('hidden');
      }
    }

    // 描画ボタンの状態更新（タブ固有の状態を反映）
    if (toggleDrawButton) {
      const displayText = !this.isBarVisible ? '描画: OFF (最小化中)' : `描画: ${this.isDrawingEnabled ? 'ON' : 'OFF'}`;

      toggleDrawButton.textContent = displayText;
      toggleDrawButton.className = `btn ${this.isDrawingEnabled ? 'btn-toggle-on' : 'btn-toggle-off'}`;

      // 最小化中は描画ボタンを無効化
      toggleDrawButton.disabled = !this.isBarVisible;
      if (!this.isBarVisible) {
        toggleDrawButton.style.opacity = '0.5';
        toggleDrawButton.style.cursor = 'not-allowed';
      } else {
        toggleDrawButton.style.opacity = '';
        toggleDrawButton.style.cursor = 'pointer';
      }
    }

    // 透明度スライダーの状態更新（タブ固有の値を反映）
    if (opacitySlider) {
      opacitySlider.value = this.currentOpacity;
    }
    if (opacityValue) {
      opacityValue.textContent = Math.round(this.currentOpacity * 100) + '%';
    }

    // 色ボタンの状態更新（タブ固有の色を反映）
    const colorBtns = this.controlBar.querySelectorAll('.color-btn');
    colorBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.color === this.currentColor);
    });
  }

  updateBodyPadding() {
    if (!document.body) return;

    if (this.isBarVisible) {
      document.body.style.paddingTop = '60px';
    } else {
      document.body.style.paddingTop = '';
    }
  }

  // ----------------------------------------
  // 2. UI状態制御
  // ----------------------------------------

  async toggleBarVisibility(visible) {
    this.isBarVisible = visible;

    try {
      await chrome.storage.local.set({ isBarVisible: visible });
    } catch (error) {
      console.error('ストレージ保存エラー:', error);
    }

    if (visible) {
      // 表示時：バーを再作成
      this.createControlBar();

      // 最小化前の描画状態を復元
      if (this.drawingStateBeforeMinimize !== null) {
        await this.toggleDrawing(this.drawingStateBeforeMinimize);
        this.drawingStateBeforeMinimize = null;
      }
    } else {
      // 非表示時：現在の描画状態を保存して描画をOFFにする
      this.drawingStateBeforeMinimize = this.isDrawingEnabled;

      await this.toggleDrawing(false);

      // バーをアニメーション付きで隠す
      this.hideBar();
    }

    this.updateBodyPadding();
  }

  async syncUIState(isBarVisible) {
    console.log('UI状態同期受信:', this.isBarVisible, '->', isBarVisible);

    try {
      // ストレージから最新の描画モード状態を取得
      const result = await chrome.storage.local.get(['isDrawingEnabled']);
      const latestDrawingMode = result.isDrawingEnabled !== false;

      // 現在の状態と違う場合のみ更新
      if (this.isBarVisible !== isBarVisible || this.isDrawingEnabled !== latestDrawingMode) {
        this.isBarVisible = isBarVisible;
        this.isDrawingEnabled = latestDrawingMode;

        // UIが非表示なら描画をOFF
        if (!this.isBarVisible) {
          this.isDrawingEnabled = false;
        }
        // Canvas状態を更新
        this.canvasManager.setEnabled(this.isDrawingEnabled);

        if (isBarVisible) {
          // 表示時：バーを作成
          this.createControlBar();

          // 最小化前の描画状態を復元
          if (this.drawingStateBeforeMinimize !== null) {
            await this.toggleDrawing(this.drawingStateBeforeMinimize);
            this.drawingStateBeforeMinimize = null;
          }
        } else {
          // 非表示時：現在の描画状態を保存して描画をOFFにする
          this.drawingStateBeforeMinimize = this.isDrawingEnabled;

          await this.toggleDrawing(false);

          // バーを削除
          if (this.controlBar) {
            this.controlBar.remove();
            this.controlBar = null;
          }
        }

        this.updateBodyPadding();

        // バーが存在する場合のみ状態更新
        if (this.controlBar) {
          this.updateBarState();
        }

        console.log('UI状態同期完了:', isBarVisible);
      }
    } catch (error) {
      console.error('UI状態同期エラー:', error);
    }
  }

  // ----------------------------------------
  // 3. イベント設定
  // ----------------------------------------

  setupControlBarEvents() {
    const self = this;

    // 展開/最小化ボタン
    const expandBtn = self.controlBar.querySelector('#expand-btn');
    const minimizeBtn = self.controlBar.querySelector('#minimize-btn');

    if (expandBtn) {
      expandBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        self.toggleBarVisibility(true);
      });
    }

    if (minimizeBtn) {
      minimizeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        self.toggleBarVisibility(false);
      });
    }

    // 描画切り替えボタン
    const toggleDrawButton = self.controlBar.querySelector('#toggle-draw-btn');
    if (toggleDrawButton) {
      toggleDrawButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (!self.isBarVisible) {
          return;
        }

        self.toggleDrawing(!self.isDrawingEnabled);
      });
    }

    // 部屋関連ボタン
    const roomInput = self.controlBar.querySelector('#room-input');
    const joinBtn = self.controlBar.querySelector('#join-btn');
    const createBtn = self.controlBar.querySelector('#create-btn');
    const leaveBtn = self.controlBar.querySelector('#leave-btn');

    if (roomInput) {
      roomInput.addEventListener('keypress', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          const code = roomInput.value.trim().toUpperCase();
          self.joinRoom(code);
        }
      });
    }

    if (joinBtn) {
      joinBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const code = roomInput ? roomInput.value.trim().toUpperCase() : '';
        if (code.length === 8) {
          self.joinRoom(code);
        } else {
          alert('8桁のコードを入力してください');
        }
      });
    }

    if (createBtn) {
      createBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const code = self.generateRoomCode();
        self.joinRoom(code);
      });
    }

    if (leaveBtn) {
      leaveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        self.leaveRoom();
      });
    }

    // 色選択ボタン
    const colorBtns = self.controlBar.querySelectorAll('.color-btn');
    colorBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        self.changeColor(btn.dataset.color);
      });
    });

    // Undo/Redoボタン（暫定的に無効化）
    const undoBtn = self.controlBar.querySelector('#undo-btn');
    const redoBtn = self.controlBar.querySelector('#redo-btn');

    if (undoBtn) {
      undoBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Undo機能は開発中です');
        // self.handleUndo(); // 一時的にコメントアウト
      });
    }

    if (redoBtn) {
      redoBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Redo機能は開発中です');
        // self.handleRedo(); // 一時的にコメントアウト
      });
    }

    // キャンバスクリアボタン
    const clearBtn = self.controlBar.querySelector('#clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        self.clearCanvas();
      });
    }
  }

  setupChromeListeners() {
    // Chrome拡張機能メッセージ
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        try {
          switch (message.type) {
            case 'PING':
              sendResponse({ status: 'ok' });
              break;
            case 'TOGGLE_BAR_VISIBILITY':
              this.toggleBarVisibility(message.visible);
              break;
            case 'SYNC_UI_STATE':
              // 新しいメッセージタイプ：UI状態の同期
              this.syncUIState(message.isBarVisible);
              break;
            case 'TOGGLE_DRAWING':
              this.toggleDrawing(message.isDrawing);
              break;
            case 'CLEAR_CANVAS':
              this.clearCanvas();
              break;
            case 'CHANGE_COLOR':
              this.changeColor(message.color);
              break;
            case 'CHANGE_OPACITY':
              this.changeOpacity(message.opacity);
              break;
          }
        } catch (error) {
          console.error('メッセージ処理エラー:', error);
        }
      });
    }
  }

  // ----------------------------------------
  // 4. WebSocket関連
  // ----------------------------------------
  handleLocalDraw(drawData) {
    if (!this.wsManager.isConnected()) {
      console.log('WebSocket未接続のためローカルストレージに保存');
      this.saveToLocalStorage(drawData);
      return;
    }

    if (drawData.type === 'stroke') {
      const payload = {
        action: 'drawData',
        roomId: this.currentRoom,
        points: drawData.stroke.points,
        color: drawData.stroke.color,
        opacity: drawData.stroke.opacity,
        startTime: drawData.stroke.startTime
      };
      console.log('送信データ:', payload);
      this.wsManager.send(payload);
    }
  }

  handleConnectionStatusChange(status) {
    console.log('接続ステータス変更:', status);
    this.updateBarState();
  }

  handleWebSocketMessage(message) {
    console.log('受信メッセージ:', message);

    switch (message.type) {
      case 'roomJoined':
        console.log('🎉 部屋参加成功！');
        if (message.userCount !== undefined) {
          this.userCount = message.userCount;
          this.updateBarState();
        }
        break;

      case 'userLeft':
        console.log('ユーザー退出');
        if (message.userCount !== undefined) {
          this.userCount = message.userCount;
          this.updateBarState();
        }
        break;

      case 'drawData':
        console.log('線データ受信');
        const strokeData = message.data || message;

        if (strokeData && strokeData.points && strokeData.points.length > 1) {
          console.log('線描画開始:', strokeData.points.length, '点');

          // 新しいメソッドを使用
          this.canvasManager.drawReceivedStroke(strokeData);

          console.log('線描画完了');
        }
        break;

      case 'clearCanvas':
        console.log('キャンバスクリア受信');
        this.canvasManager.clear();
        break;

      default:
        console.log('未知のメッセージタイプ:', message.type);
    }
  }

  // ----------------------------------------
  // 5. 機能別メソッド
  // ----------------------------------------

  // 部屋管理
  async joinRoom(roomCode) {
    if (roomCode.length !== 8) {
      alert('8桁のコードを入力してください');
      return;
    }

    // タブ固有で部屋情報を管理（ストレージには保存しない）
    this.currentRoom = roomCode;
    this.wsManager.connect(roomCode);
    this.updateBarState();

    console.log(`タブ ${this.tabId} が部屋 ${roomCode} に参加`);
  }

  async leaveRoom() {
    this.wsManager.disconnect();
    this.currentRoom = null;
    this.userCount = 0;
    this.updateBarState();
    console.log(`タブ ${this.tabId} が部屋から退出`);
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // 描画設定
  async changeColor(color) {
    this.currentColor = color;
    this.canvasManager.setColor(color);
    this.updateBarState();
    console.log(`タブ ${this.tabId} の色を ${color} に変更`);
  }

  async changeOpacity(opacity) {
    this.currentOpacity = opacity;
    this.canvasManager.setOpacity(opacity);
    this.updateBarState();
    console.log(`タブ ${this.tabId} の透明度を ${opacity} に変更`);
  }

  async toggleDrawing(enabled) {
    this.isDrawingEnabled = enabled;
    this.canvasManager.setEnabled(enabled);

    try {
      await chrome.storage.local.set({ isDrawingEnabled: enabled });
    } catch (error) {
      console.error('描画設定保存エラー:', error);
    }

    this.updateBarState();
    console.log(`描画モードを ${enabled ? 'ON' : 'OFF'} に変更（全タブ共通）`);
  }

  clearCanvas() {
    this.canvasManager.clear();

    if (this.wsManager.isConnected()) {
      this.wsManager.send({
        action: 'clearCanvas',
        roomId: this.currentRoom
      });
    }
  }

  // ----------------------------------------
  // 6. その他
  // ----------------------------------------

  // ローカルストレージ保存（タブ固有のキーを使用）
  saveToLocalStorage(data) {
    if (!this.currentRoom) return;

    try {
      const key = `drawing_${this.currentRoom}_${this.tabId}`;
      chrome.storage.local.get([key], (result) => {
        const drawings = result[key] || [];
        drawings.push({ ...data, timestamp: Date.now() });

        if (drawings.length > 1000) {
          drawings.splice(0, drawings.length - 1000);
        }

        chrome.storage.local.set({ [key]: drawings });
      });
    } catch (error) {
      console.error('ローカルストレージ保存エラー:', error);
    }
  }
}

// 初期化処理（重複宣言を防ぐ）
if (!window.sharedDrawingInstance) {
  const initializeExtension = () => {
    try {
      if (!window.sharedDrawingInstance) {
        window.sharedDrawingInstance = new SharedDrawing();
      }
    } catch (error) {
      console.error('拡張機能初期化エラー:', error);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExtension);
    setTimeout(initializeExtension, 1000);
  } else {
    initializeExtension();
  }
}