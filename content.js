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

    // ひとつ戻る・進む用の履歴管理
    this.history = []; // 全ての操作履歴（描画、クリアなど）
    this.historyIndex = -1; // 現在の履歴位置
    this.maxHistorySize = 50; // 履歴の最大サイズ
    this.redoStack = []; // Redo用のスタック

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

  showBarIfNeeded() {
    if (this.controlBar && this.isBarVisible) {
      setTimeout(() => {
        if (this.controlBar) {
          this.controlBar.style.opacity = '1';
          this.controlBar.style.visibility = 'visible';
        }
      }, 50);
    }
  }

  hideBar() {
    if (this.controlBar) {
      this.controlBar.style.opacity = '0';
      this.controlBar.style.visibility = 'hidden';

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

    // 描画ボタンの状態更新
    if (toggleDrawButton) {
      const displayText = !this.isBarVisible ? '描画: OFF (最小化中)' : `描画: ${this.isDrawingEnabled ? 'ON' : 'OFF'}`;

      toggleDrawButton.textContent = displayText;
      toggleDrawButton.className = `btn ${this.isDrawingEnabled ? 'btn-toggle-on' : 'btn-toggle-off'}`;

      toggleDrawButton.disabled = !this.isBarVisible;
      if (!this.isBarVisible) {
        toggleDrawButton.style.opacity = '0.5';
        toggleDrawButton.style.cursor = 'not-allowed';
      } else {
        toggleDrawButton.style.opacity = '';
        toggleDrawButton.style.cursor = 'pointer';
      }
    }

    // 透明度スライダーの状態更新
    if (opacitySlider) {
      opacitySlider.value = this.currentOpacity;
    }
    if (opacityValue) {
      opacityValue.textContent = Math.round(this.currentOpacity * 100) + '%';
    }

    // 色ボタンの状態更新
    const colorBtns = this.controlBar.querySelectorAll('.color-btn');
    colorBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.color === this.currentColor);
    });

    // Undo/Redoボタンの状態を更新
    this.updateUndoRedoButtons();
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
      this.createControlBar();
      if (this.drawingStateBeforeMinimize !== null) {
        await this.toggleDrawing(this.drawingStateBeforeMinimize);
        this.drawingStateBeforeMinimize = null;
      }
    } else {
      this.drawingStateBeforeMinimize = this.isDrawingEnabled;
      await this.toggleDrawing(false);
      this.hideBar();
    }

    this.updateBodyPadding();
  }

  async syncUIState(isBarVisible) {
    console.log('UI状態同期受信:', this.isBarVisible, '->', isBarVisible);

    try {
      const result = await chrome.storage.local.get(['isDrawingEnabled']);
      const latestDrawingMode = result.isDrawingEnabled !== false;

      if (this.isBarVisible !== isBarVisible || this.isDrawingEnabled !== latestDrawingMode) {
        this.isBarVisible = isBarVisible;
        this.isDrawingEnabled = latestDrawingMode;

        if (!this.isBarVisible) {
          this.isDrawingEnabled = false;
        }

        this.canvasManager.setEnabled(this.isDrawingEnabled);

        if (isBarVisible) {
          this.createControlBar();
          if (this.drawingStateBeforeMinimize !== null) {
            await this.toggleDrawing(this.drawingStateBeforeMinimize);
            this.drawingStateBeforeMinimize = null;
          }
        } else {
          this.drawingStateBeforeMinimize = this.isDrawingEnabled;
          await this.toggleDrawing(false);
          if (this.controlBar) {
            this.controlBar.remove();
            this.controlBar = null;
          }
        }

        this.updateBodyPadding();

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

    // Undo/Redoボタン
    const undoBtn = self.controlBar.querySelector('#undo-btn');
    const redoBtn = self.controlBar.querySelector('#redo-btn');

    if (undoBtn) {
      undoBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        self.handleUndo();
      });
    }

    if (redoBtn) {
      redoBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        self.handleRedo();
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

    // キーボードショートカット
    document.addEventListener('keydown', (e) => {
      // Ctrl+Z または Cmd+Z でUndo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        self.handleUndo();
      }
      // Ctrl+Shift+Z または Cmd+Shift+Z でRedo
      else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        self.handleRedo();
      }
      // Ctrl+Y または Cmd+Y でもRedo
      else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        self.handleRedo();
      }
    });
  }

  setupChromeListeners() {
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
    // 描画操作を履歴に追加（自分の操作のみ）
    if (drawData.type === 'stroke' && drawData.stroke) {
      this.addToHistory({
        type: 'stroke',
        stroke: drawData.stroke,
        timestamp: Date.now(),
        isLocal: true  // 自分の操作であることを明示
      });

      // Undo/Redoボタンの状態を更新
      this.updateUndoRedoButtons();
    }

    if (!this.wsManager.isConnected()) {
      console.log('WebSocket未接続のためローカルストレージに保存');
      this.saveToLocalStorage(drawData);
      return;
    }

    if (drawData.type === 'stroke') {
      const payload = {
        action: 'drawData',
        roomId: this.currentRoom,
        id: drawData.stroke.id,  // ストロークIDを送信
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

          // 他のユーザーの描画として処理（履歴には追加しない）
          this.canvasManager.drawReceivedStroke(strokeData);
          console.log('線描画完了');
        }
        break;

      case 'removeStroke':
        console.log('ストローク削除受信:', message.strokeId);
        // 他のユーザーが自分の線を削除した場合の処理
        // 該当するストロークを探して削除（ただし、他人の線は削除しない）
        this.handleRemoteStrokeRemoval(message.strokeId);
        break;

      case 'clearCanvas':
        console.log('キャンバスクリア受信');
        // クリア前の状態を保存（自分の線も含めて全て消える）
        const previousState = this.canvasManager.getCanvasState();

        // 全員の線をクリア
        this.canvasManager.clear();

        // クリア操作を履歴に追加（Undo可能にする）
        this.addToHistory({
          type: 'clear',
          previousState: previousState,
          timestamp: Date.now(),
          fromRemote: true
        });
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
    // クリア前の状態を保存（全員の線が消える）
    const previousState = this.canvasManager.getCanvasState();

    // クリア操作を履歴に追加
    this.addToHistory({
      type: 'clear',
      previousState: previousState,
      timestamp: Date.now(),
      isLocal: true
    });

    // キャンバスをクリア（全員の線を削除）
    this.canvasManager.clear();

    // Redoスタックもクリア（クリア後は復元できない）
    this.redoStack = [];

    // ボタン状態を更新
    this.updateUndoRedoButtons();

    if (this.wsManager.isConnected()) {
      this.wsManager.send({
        action: 'clearCanvas',
        roomId: this.currentRoom
      });
    }
  }

  // ----------------------------------------
  // 6. 履歴管理（Undo/Redo）
  // ----------------------------------------

  addToHistory(action) {
    // 現在の位置より後の履歴を削除（新しい分岐を作成）
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }

    // Redoスタックをクリア（新しい操作が入ったらRedoはリセット）
    this.redoStack = [];

    // 新しい操作を追加
    this.history.push(action);

    // 履歴サイズの制限
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    } else {
      this.historyIndex++;
    }

    // Undo/Redoボタンの状態を更新
    this.updateUndoRedoButtons();
  }

  // Undo処理（自分の操作のみ）
  handleUndo() {
    // 自分の最後のストロークを削除
    const removedStroke = this.canvasManager.undoMyLastStroke();

    if (removedStroke) {
      console.log('Undo実行: 自分のストロークを削除');

      // Redoスタックに追加
      this.redoStack.push({
        type: 'stroke',
        stroke: removedStroke
      });

      // 履歴からも削除（自分のストロークのみ）
      for (let i = this.history.length - 1; i >= 0; i--) {
        if (this.history[i].type === 'stroke' &&
          this.history[i].stroke.id === removedStroke.id) {
          this.history.splice(i, 1);
          if (this.historyIndex >= i) {
            this.historyIndex--;
          }
          break;
        }
      }

      // Undo/Redoボタンの状態を更新
      this.updateUndoRedoButtons();

      // 他のユーザーに通知（自分の線が消えたことを伝える）
      if (this.wsManager.isConnected()) {
        this.wsManager.send({
          action: 'removeStroke',
          roomId: this.currentRoom,
          strokeId: removedStroke.id
        });
      }
    } else {
      console.log('Undo: 削除できる自分のストロークがありません');
    }
  }

  // Redo処理（自分の操作のみ）
  handleRedo() {
    if (this.redoStack.length === 0) {
      console.log('Redo: Redoスタックが空です');
      return;
    }

    // Redoスタックから操作を取り出す
    const actionToRedo = this.redoStack.pop();
    console.log('Redo実行:', actionToRedo.type);

    if (actionToRedo.type === 'stroke' && actionToRedo.stroke) {
      // ストロークを復元
      this.canvasManager.redoStroke(actionToRedo.stroke);

      // 履歴に戻す
      this.history.push({
        type: 'stroke',
        stroke: actionToRedo.stroke,
        timestamp: Date.now()
      });
      this.historyIndex = this.history.length - 1;

      // 他のユーザーに通知（線が復活したことを伝える）
      if (this.wsManager.isConnected()) {
        this.wsManager.send({
          action: 'drawData',
          roomId: this.currentRoom,
          id: actionToRedo.stroke.id,
          points: actionToRedo.stroke.points,
          color: actionToRedo.stroke.color,
          opacity: actionToRedo.stroke.opacity,
          startTime: actionToRedo.stroke.startTime
        });
      }
    }

    // Undo/Redoボタンの状態を更新
    this.updateUndoRedoButtons();
  }

  // キャンバスを履歴から再構築
  rebuildCanvas() {
    console.log('キャンバス再構築開始 - 履歴位置:', this.historyIndex + 1);

    // キャンバスをクリア
    this.canvasManager.clear();

    // 現在の履歴位置までの操作を再実行
    for (let i = 0; i <= this.historyIndex; i++) {
      const action = this.history[i];

      switch (action.type) {
        case 'stroke':
          // ストロークを再描画
          this.canvasManager.drawReceivedStroke(action.stroke);
          break;
        case 'clear':
          // キャンバスをクリア
          this.canvasManager.clear();
          break;
      }
    }

    console.log('キャンバス再構築完了');
  }

  handleRemoteUndo() {
    // リモートからのUndoは単純に最後の操作を取り消す
    if (this.history.length > 0 && this.historyIndex >= 0) {
      const lastAction = this.history[this.historyIndex];

      // リモートからの操作の場合のみ処理
      if (lastAction.fromRemote) {
        this.redoStack.push(lastAction);
        this.historyIndex--;
        this.rebuildCanvas();
        this.updateUndoRedoButtons();
      }
    }
  }

  // リモート

  // リモートからのRedo処理
  handleRemoteRedo() {
    // リモートからのRedoはRedoスタックから復元
    if (this.redoStack.length > 0) {
      const actionToRedo = this.redoStack.pop();

      // リモートからの操作の場合のみ処理
      if (actionToRedo.fromRemote) {
        this.historyIndex++;
        this.history[this.historyIndex] = actionToRedo;

        switch (actionToRedo.type) {
          case 'stroke':
            this.canvasManager.drawReceivedStroke(actionToRedo.stroke);
            break;
          case 'clear':
            this.canvasManager.clear();
            break;
        }

        this.updateUndoRedoButtons();
      }
    }
  }

  // Undo/Redoボタンの有効/無効を更新
  updateUndoRedoButtons() {
    const undoBtn = this.controlBar?.querySelector('#undo-btn');
    const redoBtn = this.controlBar?.querySelector('#redo-btn');

    if (undoBtn) {
      const canUndo = this.historyIndex >= 0;
      undoBtn.disabled = !canUndo;
      undoBtn.style.opacity = canUndo ? '1' : '0.5';
      undoBtn.style.cursor = canUndo ? 'pointer' : 'not-allowed';

      // ツールチップを追加
      undoBtn.title = canUndo ? 'ひとつ戻る (Ctrl+Z)' : '戻る操作がありません';
    }

    if (redoBtn) {
      const canRedo = this.redoStack.length > 0;
      redoBtn.disabled = !canRedo;
      redoBtn.style.opacity = canRedo ? '1' : '0.5';
      redoBtn.style.cursor = canRedo ? 'pointer' : 'not-allowed';

      // ツールチップを追加
      redoBtn.title = canRedo ? 'やり直す (Ctrl+Shift+Z)' : 'やり直す操作がありません';
    }
  }

  // ----------------------------------------
  // 7. その他
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