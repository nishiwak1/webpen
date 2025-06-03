// メインの描画機能
class SharedDrawing {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.controlBar = null;
    this.isDrawing = false;
    this.isEnabled = true;
    this.isBarVisible = true;
    this.currentColor = '#000000';
    this.currentRoom = null;
    this.ws = null;
    this.lastPos = { x: 0, y: 0 };
    this.isInitialized = false;
    
    this.init();
  }

  async init() {
    // DOMが完全に読み込まれるまで待機
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.initializeComponents());
    } else {
      this.initializeComponents();
    }
  }

  async initializeComponents() {
    if (this.isInitialized) return;
    
    try {
      // 既存の設定を読み込み
      const result = await chrome.storage.local.get(['currentRoom', 'isDrawing', 'currentColor', 'isBarVisible']);
      this.currentRoom = result.currentRoom;
      this.isEnabled = result.isDrawing !== false;
      this.currentColor = result.currentColor || '#000000';
      this.isBarVisible = result.isBarVisible !== false;

      // 少し遅延してからUIを作成（ページの読み込みが完了してから）
      setTimeout(() => {
        this.createControlBar();
        this.createCanvas();
        this.setupEventListeners();
        
        if (this.currentRoom) {
          this.connectWebSocket(this.currentRoom);
        }
        
        this.isInitialized = true;
        console.log('共有お絵描き拡張機能が初期化されました');
      }, 500);
      
    } catch (error) {
      console.error('初期化エラー:', error);
    }
  }

  createControlBar() {
    // 既存のコントロールバーがあれば削除
    const existingBar = document.getElementById('shared-drawing-control-bar');
    if (existingBar) {
      existingBar.remove();
    }

    // bodyが存在するか確認
    if (!document.body) {
      console.log('document.bodyが存在しません。再試行します...');
      setTimeout(() => this.createControlBar(), 100);
      return;
    }

    // コントロールバーを作成
    this.controlBar = document.createElement('div');
    this.controlBar.id = 'shared-drawing-control-bar';
    
    const barStyles = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      width: 100% !important;
      height: ${this.isBarVisible ? '60px' : '20px'} !important;
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

    // HTMLファイルからコンテンツを読み込む
    this.loadBarContent();
    
    // bodyの最初に挿入
    document.body.insertBefore(this.controlBar, document.body.firstChild);
    
    // ページのコンテンツを下にずらす
    if (!document.body.style.paddingTop) {
      document.body.style.paddingTop = this.isBarVisible ? '60px' : '20px';
    }
    
    console.log('コントロールバーを作成しました');
  }

  async loadBarContent() {
    try {
      // HTMLファイルのURLを取得
      const htmlUrl = chrome.runtime.getURL('control-bar.html');
      console.log('HTMLファイルを読み込み中:', htmlUrl);
      
      // HTMLを取得
      const response = await fetch(htmlUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const htmlContent = await response.text();
      console.log('HTMLコンテンツサイズ:', htmlContent.length, '文字');
      
      // 直接HTMLコンテンツを使用
      this.controlBar.innerHTML = htmlContent;
      
      // 初期状態を設定
      this.updateBarState();
      
      // イベントリスナーを設定
      this.setupControlBarEvents();
      
      console.log('HTMLコンテンツの読み込みが完了しました');
      
    } catch (error) {
      console.error('HTMLコンテンツの読み込みエラー:', error);
      console.error('control-bar.html ファイルを確認してください');
      
      // エラー表示のみ
      this.controlBar.innerHTML = `
        <div style="color: white; padding: 15px; text-align: center; font-family: Arial;">
          ⚠️ control-bar.html が見つかりません
        </div>
      `;
    }
  }

  updateBarState() {
    console.log('=== updateBarState デバッグ開始 ===');
    console.log('this.controlBar存在:', !!this.controlBar);
    
    if (!this.controlBar || !this.controlBar.innerHTML) {
        console.error('updateBarState: controlBarまたはHTMLが存在しません');
        return;
    }
    
    // 変数を一度だけ宣言
    const expandedContent = this.controlBar.querySelector('#expanded-content');
    const minimizedContent = this.controlBar.querySelector('#minimized-content');
    const roomJoin = this.controlBar.querySelector('#room-join');
    const roomCurrent = this.controlBar.querySelector('#room-current');
    const currentRoomCode = this.controlBar.querySelector('#current-room-code');
    const toggleBtn = this.controlBar.querySelector('#toggle-draw-btn');
    
    console.log('要素チェック:', {
        expandedContent: !!expandedContent,
        minimizedContent: !!minimizedContent,
        roomJoin: !!roomJoin,
        roomCurrent: !!roomCurrent,
        toggleBtn: !!toggleBtn
    });
    
    if (!expandedContent || !minimizedContent) {
        console.log('必要な要素が見つかりません');
        return;
    }
    
    // 展開/最小化の表示切り替え
    if (this.isBarVisible) {
        expandedContent.classList.remove('hidden');
        minimizedContent.classList.add('hidden');
    } else {
        expandedContent.classList.add('hidden');
        minimizedContent.classList.remove('hidden');
    }
    
    // 部屋状態の表示切り替え
    if (roomJoin && roomCurrent) {
        if (this.currentRoom) {
            roomJoin.classList.add('hidden');
            roomCurrent.classList.remove('hidden');
            if (currentRoomCode) {
                currentRoomCode.textContent = this.currentRoom;
            }
        } else {
            roomJoin.classList.remove('hidden');
            roomCurrent.classList.add('hidden');
        }
    }
    
    // 描画ボタンの状態更新
    if (toggleBtn) {
        toggleBtn.textContent = `描画: ${this.isEnabled ? 'ON' : 'OFF'}`;
        toggleBtn.className = `btn ${this.isEnabled ? 'btn-toggle-on' : 'btn-toggle-off'}`;
    }
    
    // 色ボタンの状態更新
    const colorBtns = this.controlBar.querySelectorAll('.color-btn');
    colorBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.color === this.currentColor);
    });
  }

  createCanvas() {
    // 既存のキャンバスがあれば削除
    const existingCanvas = document.getElementById('shared-drawing-canvas');
    if (existingCanvas) {
      existingCanvas.remove();
    }

    // 新しいキャンバスを作成
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'shared-drawing-canvas';
    
    // CSSスタイルを直接適用
    const canvasStyles = `
      position: fixed !important;
      top: ${this.isBarVisible ? '60px' : '20px'} !important;
      left: 0 !important;
      width: 100vw !important;
      height: calc(100vh - ${this.isBarVisible ? '60px' : '20px'}) !important;
      z-index: 2147483647 !important;
      pointer-events: ${this.isEnabled ? 'auto' : 'none'} !important;
      background: transparent !important;
      cursor: ${this.isEnabled ? 'crosshair' : 'default'} !important;
      touch-action: none !important;
      user-select: none !important;
      -webkit-user-select: none !important;
      -moz-user-select: none !important;
      -ms-user-select: none !important;
      transition: opacity 0.3s ease-in-out !important;
    `;
    
    this.canvas.style.cssText = canvasStyles;

    // キャンバスサイズを設定
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight - (this.isBarVisible ? 60 : 20);

    this.ctx = this.canvas.getContext('2d');
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.lineWidth = 3;
    this.ctx.strokeStyle = this.currentColor;

    document.body.appendChild(this.canvas);

    // ウィンドウリサイズ時の処理
    window.addEventListener('resize', () => {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight - (this.isBarVisible ? 60 : 20);
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.lineWidth = 3;
      this.ctx.strokeStyle = this.currentColor;
    });
  }

  setupEventListeners() {
    // マウスイベント
    this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
    this.canvas.addEventListener('mousemove', (e) => this.draw(e));
    this.canvas.addEventListener('mouseup', () => this.stopDrawing());
    this.canvas.addEventListener('mouseout', () => this.stopDrawing());

    // キーボードショートカット
    document.addEventListener('keydown', (e) => {
      // Ctrl+Shift+D で描画モード切り替え
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        this.toggleDrawing(!this.isEnabled);
      }
      // Ctrl+Shift+C でキャンバスクリア
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        this.clearCanvas();
      }
      // Ctrl+Shift+M でバー最小化/展開
      if (e.ctrlKey && e.shiftKey && e.key === 'M') {
        e.preventDefault();
        this.toggleBarVisibility(!this.isBarVisible);
      }
    });

    // Chrome拡張機能のメッセージリスナー
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.type) {
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
      }
    });
  }

  setupControlBarEvents() {
    const self = this;
    console.log('イベントリスナーを設定中...');
    
    // 展開/最小化ボタン
    const expandBtn = self.controlBar.querySelector('#expand-btn');
    const minimizeBtn = self.controlBar.querySelector('#minimize-btn');
    
    if (expandBtn) {
        expandBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('展開ボタンがクリックされました');
            self.toggleBarVisibility(true);
        });
    }
    
    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('最小化ボタンがクリックされました');
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
                console.log('Enterキーが押されました');
                self.joinRoom(roomInput.value.trim().toUpperCase());
            }
        });
    }
    
    if (joinBtn) {
        joinBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('参加ボタンがクリックされました');
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
            console.log('新規作成ボタンがクリックされました');
            const code = self.generateRoomCode();
            self.joinRoom(code);
        });
    }
    
    if (leaveBtn) {
        leaveBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('退出ボタンがクリックされました');
            self.leaveRoom();
        });
    }

    // 色選択ボタン
    const colorBtns = self.controlBar.querySelectorAll('.color-btn');
    colorBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('色ボタンがクリックされました:', btn.dataset.color);
            self.changeColor(btn.dataset.color);
        });
    });

    // 描画切り替えボタン
    const toggleDrawBtn = self.controlBar.querySelector('#toggle-draw-btn');
    if (toggleDrawBtn) {
        toggleDrawBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('描画切り替えボタンがクリックされました');
            self.toggleDrawing(!self.isEnabled);
        });
    }

    // キャンバスクリアボタン
    const clearBtn = self.controlBar.querySelector('#clear-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('クリアボタンがクリックされました');
            self.clearCanvas();
        });
    }
    
    console.log('イベントリスナーの設定が完了しました');
  }

  startDrawing(e) {
    if (!this.isEnabled) return;
    
    this.isDrawing = true;
    const rect = this.canvas.getBoundingClientRect();
    this.lastPos = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };

    // WebSocketで開始位置を送信
    this.sendDrawData({
      type: 'start',
      x: this.lastPos.x,
      y: this.lastPos.y,
      color: this.currentColor
    });
  }

  draw(e) {
    if (!this.isDrawing || !this.isEnabled) return;

    const rect = this.canvas.getBoundingClientRect();
    const currentPos = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };

    this.drawLine(this.lastPos, currentPos, this.currentColor);

    // WebSocketで描画データを送信
    this.sendDrawData({
      type: 'draw',
      x: currentPos.x,
      y: currentPos.y,
      prevX: this.lastPos.x,
      prevY: this.lastPos.y,
      color: this.currentColor
    });

    this.lastPos = currentPos;
  }

  stopDrawing() {
    if (!this.isDrawing) return;
    
    this.isDrawing = false;
    
    // WebSocketで終了を送信
    this.sendDrawData({
      type: 'end'
    });
  }

  drawLine(from, to, color) {
    this.ctx.strokeStyle = color;
    this.ctx.beginPath();
    this.ctx.moveTo(from.x, from.y);
    this.ctx.lineTo(to.x, to.y);
    this.ctx.stroke();
  }

  // WebSocket関連
  connectWebSocket(roomCode) {
    this.currentRoom = roomCode;
    
    // 既存の接続があれば閉じる
    if (this.ws) {
      this.ws.close();
    }
    
    try {
      // WebSocketサーバーに接続（本番環境では適切なURLに変更）
      const wsUrl = 'ws://localhost:8080'; // または 'wss://your-server.com'
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        console.log(`WebSocketサーバーに接続しました`);
        // 部屋に参加
        this.ws.send(JSON.stringify({
          type: 'join_room',
          roomCode: roomCode
        }));
      };
      
      this.ws.onmessage = (event) => {
        this.handleWebSocketMessage(event);
      };
      
      this.ws.onclose = () => {
        console.log('WebSocketサーバーから切断しました');
        this.ws = null;
      };
      
      this.ws.onerror = (error) => {
        console.error('WebSocketエラー:', error);
        // フォールバックとしてローカルストレージを使用
        this.ws = null;
      };
      
    } catch (error) {
      console.error('WebSocket接続エラー:', error);
      this.ws = null;
    }
  }

  sendDrawData(data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // WebSocketが利用できない場合はローカルストレージに保存
      this.saveToLocalStorage(data);
      return;
    }
    
    this.ws.send(JSON.stringify({
      room: this.currentRoom,
      ...data
    }));
  }

  handleWebSocketMessage(event) {
    try {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'room_joined':
          console.log(`部屋 ${data.roomCode} に参加しました (参加者数: ${data.clientCount})`);
          break;
          
        case 'user_joined':
          console.log(`新しいユーザーが参加しました (参加者数: ${data.clientCount})`);
          break;
          
        case 'user_left':
          console.log(`ユーザーが退出しました (参加者数: ${data.clientCount})`);
          break;
          
        case 'start':
          // 他のユーザーの描画開始
          break;
          
        case 'draw':
          // 他のユーザーの描画データを受信
          this.drawLine(
            { x: data.prevX, y: data.prevY },
            { x: data.x, y: data.y },
            data.color
          );
          break;
          
        case 'end':
          // 他のユーザーの描画終了
          break;
          
        case 'clear':
          // 他のユーザーがキャンバスをクリア
          this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
          break;
          
        default:
          console.log('未知のメッセージタイプ:', data.type);
      }
    } catch (error) {
      console.error('WebSocketメッセージの処理エラー:', error);
    }
  }

  // ローカル実装（WebSocketサーバーがない場合の代替）
  saveToLocalStorage(data) {
    const key = `drawing_${this.currentRoom}`;
    chrome.storage.local.get([key], (result) => {
      const drawings = result[key] || [];
      drawings.push({
        ...data,
        timestamp: Date.now()
      });
      
      // 最新1000件のみ保持
      if (drawings.length > 1000) {
        drawings.splice(0, drawings.length - 1000);
      }
      
      chrome.storage.local.set({ [key]: drawings });
    });
  }

  // 制御メソッド
  async changeColor(color) {
    this.currentColor = color;
    await chrome.storage.local.set({ currentColor: color });
    if (this.ctx) {
        this.ctx.strokeStyle = color;
    }
    this.updateBarState();
    console.log(`描画色を変更: ${color}`);
  }

  async joinRoom(roomCode) {
    this.currentRoom = roomCode;
    await chrome.storage.local.set({ currentRoom: roomCode });
    this.connectWebSocket(roomCode);
    this.updateBarState();
    console.log(`部屋 ${roomCode} に参加しました`);
  }

  async toggleDrawing(enabled) {
    this.isEnabled = enabled;
    await chrome.storage.local.set({ isDrawing: enabled });
    
    if (this.canvas) {
        this.canvas.style.pointerEvents = enabled ? 'auto' : 'none';
        this.canvas.style.cursor = enabled ? 'crosshair' : 'default';
    }
    
    this.updateBarState();
    console.log(`描画モード: ${enabled ? 'ON' : 'OFF'}`);
  }

  clearCanvas() {
    if (this.ctx) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    
    // WebSocketで他のユーザーにも送信
    this.sendDrawData({ type: 'clear' });
    console.log('キャンバスをクリアしました');
  }

  async toggleBarVisibility(visible) {
    this.isBarVisible = visible;
    await chrome.storage.local.set({ isBarVisible: visible });
    
    if (this.controlBar) {
        this.controlBar.style.height = visible ? '60px' : '20px';
    }
    
    if (document.body) {
        document.body.style.paddingTop = visible ? '60px' : '20px';
    }
    
    this.updateBarState();
    console.log(`バー表示: ${visible ? '展開' : '最小化'}`);
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  async leaveRoom() {
    if (this.ws) {
        this.ws.close();
        this.ws = null;
    }
    this.currentRoom = null;
    await chrome.storage.local.remove(['currentRoom']);
    this.updateBarState();
    console.log('部屋から退出しました');
  }
}

// 複数回の初期化を防ぐ
if (!window.sharedDrawingInstance) {
  console.log('共有お絵描き拡張機能を初期化中...');
  
  // ページの状態に関係なく初期化を試行
  const initializeExtension = () => {
    if (!window.sharedDrawingInstance) {
      window.sharedDrawingInstance = new SharedDrawing();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExtension);
    // フォールバックとして少し遅延させても実行
    setTimeout(initializeExtension, 1000);
  } else {
    initializeExtension();
  }
}