// メインの描画機能（リファクタリング版）
class SharedDrawing {
  constructor() {
    // 状態管理
    this.controlBar = null;
    this.isBarVisible = true;
    this.currentRoom = null;
    this.userCount = 0;
    this.isInitialized = false;
    this.currentPenSize = 4;
    this.colorPanelVisible = false;
    
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
      // ストレージから設定を読み込み
      const result = await chrome.storage.local.get([
        'currentRoom', 'isDrawing', 'currentColor', 'currentOpacity', 'isBarVisible'
      ]);
      
      this.currentRoom = result.currentRoom;
      this.isBarVisible = result.isBarVisible !== false;
      
      // Canvas設定
      this.canvasManager.setEnabled(result.isDrawing !== false);
      this.canvasManager.setColor(result.currentColor || '#000000');
      this.canvasManager.setOpacity(result.currentOpacity !== undefined ? result.currentOpacity : 0.7);

      // UI作成
      setTimeout(() => {
        this.createControlBar();
        this.canvasManager.create(this.isBarVisible);
        this.setupChromeListeners();
        
        // 既存の部屋に接続
        if (this.currentRoom) {
          this.wsManager.connect(this.currentRoom);
        }
        
        this.isInitialized = true;
      }, 500);

      // ペンサイズ設定を読み込み
      this.currentPenSize = result.currentPenSize || 4;
      this.canvasManager.setPenSize(this.currentPenSize);
      
    } catch (error) {
      console.error('初期化エラー:', error);
    }
  }

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
      transition: all 0.3s ease !important;
      overflow: hidden !important;
      box-sizing: border-box !important;
      pointer-events: auto !important;
      user-select: none !important;
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
      
    } catch (error) {
      console.error('HTMLコンテンツ読み込みエラー:', error);
      this.controlBar.innerHTML = `
        <div style="color: white; padding: 15px; text-align: center; font-family: Arial;">
          ⚠️ control-bar.html が見つかりません
        </div>
      `;
    }
  }

  updateBarState() {
    if (!this.controlBar || !this.controlBar.innerHTML) return;
    
    const expandedContent = this.controlBar.querySelector('#expanded-content');
    const minimizedContent = this.controlBar.querySelector('#minimized-content');
    const roomJoin = this.controlBar.querySelector('#room-join');
    const roomCurrent = this.controlBar.querySelector('#room-current');
    const currentRoomCode = this.controlBar.querySelector('#current-room-code');
    const toggleBtn = this.controlBar.querySelector('#toggle-draw-btn');
    const opacitySlider = this.controlBar.querySelector('#opacity-slider');
    const opacityValue = this.controlBar.querySelector('#opacity-value');
    
    // 展開/最小化の表示切り替え
    if (expandedContent && minimizedContent) {
      if (this.isBarVisible) {
        expandedContent.classList.remove('hidden');
        minimizedContent.classList.add('hidden');
      } else {
        // 完全非表示時は両方とも隠す
        expandedContent.classList.add('hidden');
        minimizedContent.classList.add('hidden');
      }
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
    if (toggleBtn) {
      toggleBtn.textContent = `描画: ${this.canvasManager.isEnabled ? 'ON' : 'OFF'}`;
      toggleBtn.className = `btn ${this.canvasManager.isEnabled ? 'btn-toggle-on' : 'btn-toggle-off'}`;
    }
    
    // 透明度スライダーの状態更新
    if (opacitySlider) {
      opacitySlider.value = this.canvasManager.currentOpacity;
    }
    if (opacityValue) {
      opacityValue.textContent = Math.round(this.canvasManager.currentOpacity * 100) + '%';
    }
    
    // 色ボタンの状態更新
    const colorBtns = this.controlBar.querySelectorAll('.color-btn');
    colorBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.color === this.canvasManager.currentColor);
    });

    // ペンサイズボタンの状態更新
    const penSizeBtns = this.controlBar.querySelectorAll('.pen-size-btn');
    penSizeBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.size == this.currentPenSize);
    });
  }

  updateBodyPadding() {
    if (!document.body) return;
    
    if (this.isBarVisible) {
      document.body.style.paddingTop = '60px';
    } else {
      // 完全非表示時はパディングを元に戻す
      document.body.style.paddingTop = '';
    }
  }

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

    // 透明度スライダー
    const opacitySlider = self.controlBar.querySelector('#opacity-slider');
    if (opacitySlider) {
      opacitySlider.addEventListener('input', (e) => {
        e.stopPropagation();
        const opacity = parseFloat(e.target.value);
        self.changeOpacity(opacity);
      });
    }

    // 描画切り替えボタン
    const toggleDrawBtn = self.controlBar.querySelector('#toggle-draw-btn');
    if (toggleDrawBtn) {
      toggleDrawBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        self.toggleDrawing(!self.canvasManager.isEnabled);
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

    // ペンサイズボタンのイベントリスナー（色パネル表示用に変更）
    const penSizeBtns = self.controlBar.querySelectorAll('.pen-size-btn');
    penSizeBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        self.showColorPanel();
      });
    });

    // 色選択パネル関連のイベント
    self.setupColorPanelEvents();
  }

  // 色選択パネルのイベント設定
  setupColorPanelEvents() {
    const self = this;
    const colorPanel = self.controlBar.querySelector('#color-panel');
    const overlay = self.controlBar.querySelector('#overlay');
    const colorPanelClose = self.controlBar.querySelector('#color-panel-close');
    const opacitySliderPanel = self.controlBar.querySelector('#opacity-slider-panel');
    const opacityValuePanel = self.controlBar.querySelector('#opacity-value-panel');
    
    // 色選択パネルのボタンイベント
    const colorPanelBtns = self.controlBar.querySelectorAll('.color-panel-btn');
    colorPanelBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // 選択状態を更新
        colorPanelBtns.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        
        // 色を変更
        self.changeColor(btn.dataset.color);
      });
    });
    
    // 透明度スライダーのイベント
    if (opacitySliderPanel) {
      opacitySliderPanel.addEventListener('input', (e) => {
        const opacity = parseFloat(e.target.value);
        self.changeOpacity(opacity);
        
        // パネル内の表示も更新
        if (opacityValuePanel) {
          opacityValuePanel.textContent = Math.round(opacity * 100) + '%';
        }
      });
    }
    
    // 閉じるボタンのイベント
    if (colorPanelClose) {
      colorPanelClose.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        self.hideColorPanel();
      });
    }
    
    // オーバーレイクリックで閉じる
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        self.hideColorPanel();
      });
    }
    
    // ESCキーで閉じる
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && self.colorPanelVisible) {
        self.hideColorPanel();
      }
    });
  }

  // 色選択パネルを表示
  showColorPanel() {
    const colorPanel = this.controlBar.querySelector('#color-panel');
    const overlay = this.controlBar.querySelector('#overlay');
    const colorPanelBtns = this.controlBar.querySelectorAll('.color-panel-btn');
    const opacitySliderPanel = this.controlBar.querySelector('#opacity-slider-panel');
    const opacityValuePanel = this.controlBar.querySelector('#opacity-value-panel');
    
    if (!colorPanel || !overlay) return;
    
    // 現在の色を選択状態にする
    colorPanelBtns.forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.color === this.canvasManager.currentColor);
    });
    
    // 現在の透明度を設定
    if (opacitySliderPanel && opacityValuePanel) {
      opacitySliderPanel.value = this.canvasManager.currentOpacity;
      opacityValuePanel.textContent = Math.round(this.canvasManager.currentOpacity * 100) + '%';
    }
    
    overlay.classList.add('show');
    colorPanel.classList.add('show');
    this.colorPanelVisible = true;
  }

  // 色選択パネルを非表示
  hideColorPanel() {
    const colorPanel = this.controlBar.querySelector('#color-panel');
    const overlay = this.controlBar.querySelector('#overlay');
    
    if (!colorPanel || !overlay) return;
    
    overlay.classList.remove('show');
    colorPanel.classList.remove('show');
    this.colorPanelVisible = false;
  }

  // ペンサイズ変更メソッド
  async changePenSize(size) {
    this.currentPenSize = size;
    this.canvasManager.setPenSize(size);
    await chrome.storage.local.set({ currentPenSize: size });
    this.updateBarState();
  }

  setupChromeListeners() {
    // Chrome拡張機能メッセージ
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.type) {
        case 'PING':
          sendResponse({ status: 'ok' });
          break;
        case 'TOGGLE_BAR_VISIBILITY':
          this.toggleBarVisibility(message.visible);
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
        case 'CHANGE_PEN_SIZE':
          this.changePenSize(message.size);
          break;
      }
    });
  }

  // WebSocket関連のハンドラー
  handleLocalDraw(drawData) {
    if (!this.wsManager.isConnected()) {
      console.log('WebSocket未接続のためローカルストレージに保存');
      this.saveToLocalStorage(drawData);
      return;
    }

    if (drawData.type === 'stroke') {
      // サーバーが期待する形式に直接設定
      const payload = {
        action: 'drawData',
        roomId: this.currentRoom,
        // strokeの中身を直接展開
        points: drawData.stroke.points,
        color: drawData.stroke.color,
        opacity: drawData.stroke.opacity,
        penSize: drawData.stroke.penSize || this.currentPenSize,
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
        const strokeData = message.data || message; // message自体から取得
            
        // デバッグ用
        console.log('strokeData:', strokeData);
        console.log('strokeData.points:', strokeData.points);
        console.log('strokeData.points.length:', strokeData.points?.length);
            
        if (strokeData && strokeData.points && strokeData.points.length > 1) {
          console.log('線描画開始:', strokeData.points.length, '点');
          
          // 線全体を再描画
          for (let i = 1; i < strokeData.points.length; i++) {
            this.canvasManager.drawLine(
              strokeData.points[i-1], 
              strokeData.points[i], 
              strokeData.color || '#000000',
              strokeData.opacity !== undefined ? strokeData.opacity : 1.0,
              strokeData.penSize || 4
            );
          }
          console.log('線描画完了');
        } else {
          console.log('線データが無効:', {
            hasStrokeData: !!strokeData,
            hasPoints: !!(strokeData && strokeData.points),
            pointsLength: strokeData?.points?.length
          });
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

  // 部屋管理
  async joinRoom(roomCode) {
    if (roomCode.length !== 8) {
      alert('8桁のコードを入力してください');
      return;
    }
    
    this.currentRoom = roomCode;
    await chrome.storage.local.set({ currentRoom: roomCode });
    this.wsManager.connect(roomCode);
    this.updateBarState();
  }

  async leaveRoom() {
    this.wsManager.disconnect();
    this.currentRoom = null;
    this.userCount = 0;
    await chrome.storage.local.remove(['currentRoom']);
    this.updateBarState();
    console.log('部屋から退出');
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
    this.canvasManager.setColor(color);
    await chrome.storage.local.set({ currentColor: color });
    this.updateBarState();
    
    // 色選択パネル内の選択状態も更新
    const colorPanelBtns = this.controlBar.querySelectorAll('.color-panel-btn');
    colorPanelBtns.forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.color === color);
    });
  }

  async changeOpacity(opacity) {
    this.canvasManager.setOpacity(opacity);
    await chrome.storage.local.set({ currentOpacity: opacity });
    this.updateBarState();
    
    // パネル内の透明度表示も更新
    const opacitySliderPanel = this.controlBar.querySelector('#opacity-slider-panel');
    const opacityValuePanel = this.controlBar.querySelector('#opacity-value-panel');
    if (opacitySliderPanel && opacityValuePanel) {
      opacitySliderPanel.value = opacity;
      opacityValuePanel.textContent = Math.round(opacity * 100) + '%';
    }
  }

  async toggleDrawing(enabled) {
    this.canvasManager.setEnabled(enabled);
    await chrome.storage.local.set({ isDrawing: enabled });
    this.updateBarState();
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

  async toggleBarVisibility(visible) {
    this.isBarVisible = visible;
    await chrome.storage.local.set({ isBarVisible: visible });

    if (visible) {
      // 表示時：バーを再作成
      this.createControlBar();
    } else {
      // 非表示時：バーを完全に削除
      if (this.controlBar) {
        this.controlBar.remove();
        this.controlBar = null;
      }
    }

    this.canvasManager.updatePosition(visible);
    this.updateBodyPadding();

    // バーが存在する場合のみ状態更新
    if (this.controlBar) {
      this.updateBarState();
    }
  }

  // ローカルストレージ保存（オフライン時用）
  saveToLocalStorage(data) {
    const key = `drawing_${this.currentRoom}`;
    chrome.storage.local.get([key], (result) => {
      const drawings = result[key] || [];
      drawings.push({ ...data, timestamp: Date.now() });
      
      if (drawings.length > 1000) {
        drawings.splice(0, drawings.length - 1000);
      }
      
      chrome.storage.local.set({ [key]: drawings });
    });
  }
}

// 初期化処理
if (!window.sharedDrawingInstance) {
  const initializeExtension = () => {
    if (!window.sharedDrawingInstance) {
      window.sharedDrawingInstance = new SharedDrawing();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExtension);
    setTimeout(initializeExtension, 1000);
  } else {
    initializeExtension();
  }
}