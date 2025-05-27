// メインの描画機能
class SharedDrawing {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.isDrawing = false;
    this.isEnabled = true;
    this.currentColor = '#000000';
    this.currentRoom = null;
    this.ws = null;
    this.lastPos = { x: 0, y: 0 };
    
    this.init();
  }

  async init() {
    // 既存の設定を読み込み
    const result = await chrome.storage.local.get(['currentRoom', 'isDrawing', 'currentColor']);
    this.currentRoom = result.currentRoom;
    this.isEnabled = result.isDrawing !== false;
    this.currentColor = result.currentColor || '#000000';

    this.createCanvas();
    this.setupEventListeners();
    
    if (this.currentRoom) {
      this.connectWebSocket(this.currentRoom);
    }
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
    this.canvas.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      z-index: 2147483647 !important;
      pointer-events: ${this.isEnabled ? 'auto' : 'none'} !important;
      background: transparent !important;
      cursor: ${this.isEnabled ? 'crosshair' : 'default'} !important;
    `;

    // キャンバスサイズを設定
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;

    this.ctx = this.canvas.getContext('2d');
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.lineWidth = 3;
    this.ctx.strokeStyle = this.currentColor;

    document.body.appendChild(this.canvas);

    // ウィンドウリサイズ時の処理
    window.addEventListener('resize', () => {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
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

    // タッチイベント（モバイル対応）
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      const mouseEvent = new MouseEvent('mousedown', {
        clientX: touch.clientX,
        clientY: touch.clientY
      });
      this.canvas.dispatchEvent(mouseEvent);
    });

    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      const mouseEvent = new MouseEvent('mousemove', {
        clientX: touch.clientX,
        clientY: touch.clientY
      });
      this.canvas.dispatchEvent(mouseEvent);
    });

    this.canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      const mouseEvent = new MouseEvent('mouseup', {});
      this.canvas.dispatchEvent(mouseEvent);
    });

    // メッセージリスナー
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.type) {
        case 'JOIN_ROOM':
          this.joinRoom(message.roomCode);
          break;
        case 'LEAVE_ROOM':
          this.leaveRoom();
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
    // 実際の実装では、WebSocketサーバーのURLを指定
    // ここでは簡易的なローカル実装
    console.log(`部屋 ${roomCode} に接続します`);
    this.currentRoom = roomCode;
    
    // 実際のWebSocketサーバー接続例:
    // this.ws = new WebSocket(`wss://your-server.com/room/${roomCode}`);
    // this.ws.onmessage = (event) => this.handleWebSocketMessage(event);
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
    const data = JSON.parse(event.data);
    
    if (data.type === 'draw') {
      this.drawLine(
        { x: data.prevX, y: data.prevY },
        { x: data.x, y: data.y },
        data.color
      );
    } else if (data.type === 'clear') {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
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
  joinRoom(roomCode) {
    this.currentRoom = roomCode;
    this.connectWebSocket(roomCode);
    console.log(`部屋 ${roomCode} に参加しました`);
  }

  leaveRoom() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.currentRoom = null;
    console.log('部屋から退出しました');
  }

  toggleDrawing(enabled) {
    this.isEnabled = enabled;
    this.canvas.style.pointerEvents = enabled ? 'auto' : 'none';
    this.canvas.style.cursor = enabled ? 'crosshair' : 'default';
    console.log(`描画モード: ${enabled ? 'ON' : 'OFF'}`);
  }

  clearCanvas() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // WebSocketで他のユーザーにも送信
    this.sendDrawData({ type: 'clear' });
    console.log('キャンバスをクリアしました');
  }

  changeColor(color) {
    this.currentColor = color;
    this.ctx.strokeStyle = color;
    console.log(`描画色を変更: ${color}`);
  }
}

// ページ読み込み後に初期化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new SharedDrawing();
  });
} else {
  new SharedDrawing();
}
