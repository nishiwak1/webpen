// 既存のすべてのグローバル変数とクラスを完全にクリア
(function() {
  'use strict';

  // 既存の定義をすべて削除
  delete window.SharedDrawing;
  delete window.WebSocketManager;
  delete window.CanvasManager;
  delete window.SharedDrawingWebSocketManager;
  delete window.SharedDrawingCanvasManager;
  delete window.SharedDrawingMain;

  // 既存のインスタンスをクリーンアップ
  if (window.sharedDrawingInstance) {
    try {
      // DOM要素の削除
      const existingBar = document.getElementById('shared-drawing-control-bar');
      if (existingBar) existingBar.remove();
      
      const existingCanvas = document.getElementById('shared-drawing-canvas');
      if (existingCanvas) existingCanvas.remove();
      
      // WebSocket接続の切断
      if (window.sharedDrawingInstance.wsManager) {
        window.sharedDrawingInstance.wsManager.disconnect();
      }
      
      // body paddingのリセット
      if (document.body) {
        document.body.style.paddingTop = '';
      }
    } catch (e) {
      console.log('クリーンアップ中のエラー:', e);
    }
    window.sharedDrawingInstance = null;
  }

  // WebSocket通信を管理するクラス
  class WSManager {
    constructor(onMessageCallback, onStatusChangeCallback) {
      this.ws = null;
      this.currentRoom = null;
      this.connectionStatus = 'disconnected';
      this.isConnecting = false;
      this.reconnectAttempts = 0;
      this.maxReconnectAttempts = 5;
      this.onMessage = onMessageCallback;
      this.onStatusChange = onStatusChangeCallback;
    }

    connect(roomCode) {
      this.currentRoom = roomCode;
      this.connectionStatus = 'connecting';
      this.onStatusChange('connecting');
      
      // 既存の接続をクリーンアップ
      if (this.ws) {
        this.disconnect();
      }
      
      // 重複接続を防ぐ
      if (this.isConnecting) {
        console.log('接続処理中のため、重複接続をスキップ');
        return;
      }
      this.isConnecting = true;
      
      try {
        const wsUrl = 'wss://5uitf2s9w8.execute-api.ap-northeast-1.amazonaws.com/prod';
        console.log('WebSocket接続開始:', wsUrl, 'Room:', roomCode);
        this.ws = new WebSocket(wsUrl);
        
        const connectionTimeout = setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
            console.log('WebSocket接続タイムアウト');
            this.ws.close();
            this.reconnect();
          }
        }, 10000);
        
        this.ws.onopen = () => {
          clearTimeout(connectionTimeout);
          this.isConnecting = false;
          console.log('WebSocket接続成功');
          this.connectionStatus = 'connected';
          this.reconnectAttempts = 0;
          this.onStatusChange('connected');
          
          // 部屋に参加
          this.send({
            action: 'joinRoom',
            roomId: roomCode
          });
        };
        
        this.ws.onmessage = (event) => {
          console.log('Raw WebSocket data received:', event.data);
          try {
            const data = JSON.parse(event.data);
            this.onMessage(data);
          } catch (error) {
            console.error('メッセージ解析エラー:', error);
          }
        };
        
        this.ws.onclose = (event) => {
          clearTimeout(connectionTimeout);
          this.isConnecting = false;
          console.log('WebSocket切断:', event.code, event.reason);
          this.connectionStatus = 'disconnected';
          this.ws = null;
          this.onStatusChange('disconnected');
          
          // 自動再接続
          if (this.currentRoom && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnect();
          }
        };
        
        this.ws.onerror = (error) => {
          clearTimeout(connectionTimeout);
          this.isConnecting = false;
          console.error('WebSocketエラー:', error);
          this.connectionStatus = 'error';
          this.ws = null;
          this.onStatusChange('error');
        };
        
      } catch (error) {
        this.isConnecting = false;
        console.error('WebSocket接続エラー:', error);
        this.connectionStatus = 'error';
        this.ws = null;
        this.onStatusChange('error');
      }
    }

    reconnect() {
      if (this.isConnecting) return;
      
      this.reconnectAttempts++;
      console.log(`再接続試行 ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
      
      setTimeout(() => {
        if (!this.isConnecting && this.currentRoom) {
          this.connect(this.currentRoom);
        }
      }, 2000 * this.reconnectAttempts);
    }

    send(data) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        console.log('WebSocket未接続');
        return false;
      }
      
      console.log('WebSocketメッセージ送信:', data);
      this.ws.send(JSON.stringify(data));
      return true;
    }

    disconnect() {
      this.currentRoom = null;
      if (this.ws) {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.close();
        this.ws = null;
      }
      this.connectionStatus = 'disconnected';
      this.onStatusChange('disconnected');
    }

    isConnected() {
      return this.ws && this.ws.readyState === WebSocket.OPEN;
    }
  }

  // Canvasマネージャークラス
  class CanvasDrawer {
    constructor(onDraw) {
      this.canvas = null;
      this.ctx = null;
      this.isDrawing = false;
      this.isEnabled = true;
      this.currentColor = '#0066FF';
      this.currentOpacity = 0.7;
      this.currentPenSize = 4;
      this.currentTool = 'pen';
      this.onDraw = onDraw;
      this.currentStroke = null;
      this.lastPoint = null;
    }

    create(isBarVisible) {
      const existingCanvas = document.getElementById('shared-drawing-canvas');
      if (existingCanvas) {
        existingCanvas.remove();
      }

      this.canvas = document.createElement('canvas');
      this.canvas.id = 'shared-drawing-canvas';
      
      const canvasStyles = `
        position: fixed !important;
        top: ${isBarVisible ? '60px' : '0'} !important;
        left: 0 !important;
        width: 100vw !important;
        height: ${isBarVisible ? 'calc(100vh - 60px)' : '100vh'} !important;
        z-index: 2147483646 !important;
        pointer-events: ${this.isEnabled ? 'auto' : 'none'} !important;
        cursor: crosshair !important;
      `;
      
      this.canvas.style.cssText = canvasStyles;
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight - (isBarVisible ? 60 : 0);
      
      this.ctx = this.canvas.getContext('2d');
      this.setupCanvasEvents();
      
      document.body.appendChild(this.canvas);
      
      window.addEventListener('resize', () => {
        const oldImageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight - (isBarVisible ? 60 : 0);
        this.ctx.putImageData(oldImageData, 0, 0);
      });
    }

    setupCanvasEvents() {
      const startDrawing = (e) => {
        if (!this.isEnabled) return;
        
        e.preventDefault();
        this.isDrawing = true;
        
        const point = this.getEventPoint(e);
        this.lastPoint = point;
        
        this.currentStroke = {
          points: [point],
          color: this.currentColor,
          opacity: this.currentOpacity,
          penSize: this.currentPenSize,
          tool: this.currentTool,
          startTime: Date.now()
        };
        
        if (this.currentTool === 'eraser') {
          this.eraseAtPoint(point, this.currentPenSize);
        } else {
          this.ctx.beginPath();
          this.ctx.moveTo(point.x, point.y);
        }
      };

      const draw = (e) => {
        if (!this.isDrawing || !this.isEnabled) return;
        
        e.preventDefault();
        const point = this.getEventPoint(e);
        
        if (this.currentStroke) {
          this.currentStroke.points.push(point);
        }
        
        if (this.currentTool === 'eraser') {
          this.eraseAtPoint(point, this.currentPenSize);
        } else {
          this.drawLine(this.lastPoint, point, this.currentColor, this.currentOpacity, this.currentPenSize);
        }
        
        this.lastPoint = point;
      };

      const stopDrawing = (e) => {
        if (!this.isDrawing) return;
        
        this.isDrawing = false;
        
        if (this.currentStroke && this.currentStroke.points.length > 0) {
          this.onDraw({
            type: 'stroke',
            stroke: this.currentStroke
          });
        }
        
        this.currentStroke = null;
        this.lastPoint = null;
      };

      this.canvas.addEventListener('mousedown', startDrawing);
      this.canvas.addEventListener('mousemove', draw);
      this.canvas.addEventListener('mouseup', stopDrawing);
      this.canvas.addEventListener('mouseout', stopDrawing);

      this.canvas.addEventListener('touchstart', startDrawing, { passive: false });
      this.canvas.addEventListener('touchmove', draw, { passive: false });
      this.canvas.addEventListener('touchend', stopDrawing);
      this.canvas.addEventListener('touchcancel', stopDrawing);
    }

    getEventPoint(e) {
      const rect = this.canvas.getBoundingClientRect();
      const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      const clientY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
      
      return {
        x: clientX - rect.left,
        y: clientY - rect.top
      };
    }

    drawLine(startPoint, endPoint, color, opacity, penSize) {
      if (!this.ctx || !startPoint || !endPoint) return;
      
      // 描画設定を保存
      const previousGlobalAlpha = this.ctx.globalAlpha;
      const previousStrokeStyle = this.ctx.strokeStyle;
      const previousLineWidth = this.ctx.lineWidth;
      const previousLineCap = this.ctx.lineCap;
      const previousLineJoin = this.ctx.lineJoin;
      
      // 新しい設定を適用
      this.ctx.globalAlpha = opacity || this.currentOpacity;
      this.ctx.strokeStyle = color || this.currentColor;
      this.ctx.lineWidth = penSize || this.currentPenSize;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      
      console.log('Canvas描画:', {
        penSize: this.ctx.lineWidth,
        color: this.ctx.strokeStyle,
        opacity: this.ctx.globalAlpha
      });
      
      this.ctx.beginPath();
      this.ctx.moveTo(startPoint.x, startPoint.y);
      this.ctx.lineTo(endPoint.x, endPoint.y);
      this.ctx.stroke();
      
      // 設定を復元
      this.ctx.globalAlpha = previousGlobalAlpha;
      this.ctx.strokeStyle = previousStrokeStyle;
      this.ctx.lineWidth = previousLineWidth;
      this.ctx.lineCap = previousLineCap;
      this.ctx.lineJoin = previousLineJoin;
    }

    // 受信データ専用の描画メソッド（設定を強制適用）
    drawLineWithSettings(startPoint, endPoint, color, opacity, penSize) {
      if (!this.ctx || !startPoint || !endPoint) return;
      
      console.log('受信データ描画:', { color, opacity, penSize });
      
      // 描画設定を直接適用（現在の設定を無視）
      this.ctx.save(); // 状態を保存
      
      this.ctx.globalAlpha = opacity;
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = penSize;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.globalCompositeOperation = 'source-over';
      
      this.ctx.beginPath();
      this.ctx.moveTo(startPoint.x, startPoint.y);
      this.ctx.lineTo(endPoint.x, endPoint.y);
      this.ctx.stroke();
      
      this.ctx.restore(); // 状態を復元
      
      console.log('受信データ描画完了 - 太さ:', penSize);
    }

    eraseAtPoint(point, size) {
      if (!this.ctx || !point) return;
      
      this.ctx.globalCompositeOperation = 'destination-out';
      this.ctx.globalAlpha = 1.0;
      this.ctx.fillStyle = 'rgba(0,0,0,1)';
      
      this.ctx.beginPath();
      this.ctx.arc(point.x, point.y, size / 2, 0, Math.PI * 2);
      this.ctx.fill();
      
      this.ctx.globalCompositeOperation = 'source-over';
    }

    clear() {
      if (this.ctx) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      }
    }

    updatePosition(isBarVisible) {
      if (this.canvas) {
        this.canvas.style.top = isBarVisible ? '60px' : '0';
        this.canvas.style.height = isBarVisible ? 'calc(100vh - 60px)' : '100vh';
        this.canvas.height = window.innerHeight - (isBarVisible ? 60 : 0);
      }
    }

    setEnabled(enabled) {
      this.isEnabled = enabled;
      if (this.canvas) {
        this.canvas.style.pointerEvents = enabled ? 'auto' : 'none';
      }
    }

    setColor(color) { this.currentColor = color; }
    setOpacity(opacity) { this.currentOpacity = opacity; }
    setPenSize(size) { this.currentPenSize = size; }
    setTool(tool) { this.currentTool = tool; }

    getCanvasData() {
      if (this.canvas) {
        return this.canvas.toDataURL();
      }
      return null;
    }

    restoreCanvasData(dataURL) {
      if (!this.ctx || !dataURL) return;
      
      const img = new Image();
      img.onload = () => {
        this.clear();
        this.ctx.drawImage(img, 0, 0);
      };
      img.src = dataURL;
    }
  }

  // メインクラス
  class DrawingApp {
    constructor() {
      this.controlBar = null;
      this.isBarVisible = true;
      this.currentRoom = null;
      this.userCount = 0;
      this.isInitialized = false;
      this.currentPenSize = 4;
      this.colorPanelVisible = false;
      this.currentTool = 'pen';
      this.drawingHistory = [];
      this.historyIndex = -1;
      this.maxHistorySize = 50;
      
      this.wsManager = new WSManager(
        (message) => this.handleWebSocketMessage(message),
        (status) => this.handleConnectionStatusChange(status)
      );
      
      this.canvasManager = new CanvasDrawer(
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
        const result = await chrome.storage.local.get([
          'currentRoom', 'isDrawing', 'currentColor', 'currentOpacity', 'isBarVisible',
          'currentPenSize', 'currentTool'
        ]);
        
        this.currentRoom = result.currentRoom;
        this.isBarVisible = result.isBarVisible !== false;
        this.currentPenSize = result.currentPenSize || 4;
        this.currentTool = result.currentTool || 'pen';
        
        this.canvasManager.setEnabled(result.isDrawing !== false);
        this.canvasManager.setColor(result.currentColor || '#0066FF');
        this.canvasManager.setOpacity(result.currentOpacity !== undefined ? result.currentOpacity : 0.7);
        this.canvasManager.setPenSize(this.currentPenSize);
        this.canvasManager.setTool(this.currentTool);

        setTimeout(() => {
          this.createControlBar();
          this.canvasManager.create(this.isBarVisible);
          this.setupChromeListeners();
          
          if (this.currentRoom) {
            this.wsManager.connect(this.currentRoom);
          }
          
          this.isInitialized = true;
        }, 500);
        
      } catch (error) {
        console.error('初期化エラー:', error);
      }
    }

    createControlBar() {
      const existingBar = document.getElementById('shared-drawing-control-bar');
      if (existingBar) {
        existingBar.remove();
      }
    
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
      
      if (expandedContent && minimizedContent) {
        if (this.isBarVisible) {
          expandedContent.classList.remove('hidden');
          minimizedContent.classList.add('hidden');
        } else {
          expandedContent.classList.add('hidden');
          minimizedContent.classList.add('hidden');
        }
      }
      
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
      
      if (toggleBtn) {
        toggleBtn.textContent = `描画: ${this.canvasManager.isEnabled ? 'ON' : 'OFF'}`;
        toggleBtn.className = `btn ${this.canvasManager.isEnabled ? 'btn-toggle-on' : 'btn-toggle-off'}`;
      }
      
      if (opacitySlider) {
        opacitySlider.value = this.canvasManager.currentOpacity;
      }
      if (opacityValue) {
        opacityValue.textContent = Math.round(this.canvasManager.currentOpacity * 100) + '%';
      }
      
      const toolBtns = this.controlBar.querySelectorAll('.tool-btn');
      toolBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tool === this.currentTool);
      });

      const penSizeBtns = this.controlBar.querySelectorAll('.pen-size-btn');
      penSizeBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.size == this.currentPenSize);
      });

      const undoBtn = this.controlBar.querySelector('#undo-btn');
      const redoBtn = this.controlBar.querySelector('#redo-btn');
      if (undoBtn) {
        undoBtn.disabled = this.historyIndex < 0;
      }
      if (redoBtn) {
        redoBtn.disabled = this.historyIndex >= this.drawingHistory.length - 1;
      }
    }

    updateBodyPadding() {
      if (!document.body) return;
      
      if (this.isBarVisible) {
        document.body.style.paddingTop = '60px';
      } else {
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

      // ツール選択ボタン
      const toolBtns = self.controlBar.querySelectorAll('.tool-btn');
      toolBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          self.changeTool(btn.dataset.tool);
        });
      });

      // ペンサイズボタン（カラーパネル表示のトリガーとしても使用）
      const penSizeBtns = self.controlBar.querySelectorAll('.pen-size-btn');
      penSizeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          // ペンサイズ変更
          self.changePenSize(parseInt(btn.dataset.size));
          // カラーパネルも表示
          self.showColorPanel();
        });
      });

      // 透明度スライダー（メインバー）
      const opacitySlider = self.controlBar.querySelector('#opacity-slider');
      if (opacitySlider) {
        opacitySlider.addEventListener('input', (e) => {
          e.stopPropagation();
          const opacity = parseFloat(e.target.value);
          self.changeOpacity(opacity);
        });

        // 透明度スライダーをダブルクリックでカラーパネル表示
        opacitySlider.addEventListener('dblclick', (e) => {
          e.preventDefault();
          e.stopPropagation();
          self.showColorPanel();
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

      // アンドゥ/リドゥボタン
      const undoBtn = self.controlBar.querySelector('#undo-btn');
      const redoBtn = self.controlBar.querySelector('#redo-btn');
      
      if (undoBtn) {
        undoBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          self.undo();
        });
      }

      if (redoBtn) {
        redoBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          self.redo();
        });
      }

      // 全消去ボタン
      const clearAllBtn = self.controlBar.querySelector('#clear-all-btn');
      if (clearAllBtn) {
        clearAllBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (confirm('すべての描画を削除しますか？この操作は元に戻せません。')) {
            self.clearAllCanvas();
          }
        });
      }

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
      
      // パネル内の透明度スライダーのイベント
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

      // ペンサイズボタンをクリックしてもカラーパネルを表示
      const penSizeBtns = self.controlBar.querySelectorAll('.pen-size-btn');
      penSizeBtns.forEach(btn => {
        btn.addEventListener('dblclick', (e) => {
          e.preventDefault();
          e.stopPropagation();
          self.showColorPanel();
        });
      });

      // カラーパネルを表示する専用ボタンがある場合
      const showColorPanelBtn = self.controlBar.querySelector('#show-color-panel-btn');
      if (showColorPanelBtn) {
        showColorPanelBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          self.showColorPanel();
        });
      }
    }

    showColorPanel() {
      const colorPanel = this.controlBar.querySelector('#color-panel');
      const overlay = this.controlBar.querySelector('#overlay');
      const colorPanelBtns = this.controlBar.querySelectorAll('.color-panel-btn');
      const opacitySliderPanel = this.controlBar.querySelector('#opacity-slider-panel');
      const opacityValuePanel = this.controlBar.querySelector('#opacity-value-panel');
      
      if (!colorPanel || !overlay) {
        console.log('カラーパネルまたはオーバーレイが見つかりません');
        return;
      }
      
      // 現在の色を選択状態にする
      colorPanelBtns.forEach(btn => {
        const isSelected = btn.dataset.color === this.canvasManager.currentColor;
        btn.classList.toggle('selected', isSelected);
        
        // デバッグ用
        if (isSelected) {
          console.log('選択された色:', btn.dataset.color);
        }
      });
      
      // 現在の透明度を設定
      if (opacitySliderPanel && opacityValuePanel) {
        opacitySliderPanel.value = this.canvasManager.currentOpacity;
        opacityValuePanel.textContent = Math.round(this.canvasManager.currentOpacity * 100) + '%';
        console.log('透明度設定:', this.canvasManager.currentOpacity);
      }
      
      // パネルを表示
      overlay.classList.add('show');
      colorPanel.classList.add('show');
      this.colorPanelVisible = true;
      
      console.log('カラーパネルを表示しました');
    }

    hideColorPanel() {
      const colorPanel = this.controlBar.querySelector('#color-panel');
      const overlay = this.controlBar.querySelector('#overlay');
      
      if (!colorPanel || !overlay) return;
      
      overlay.classList.remove('show');
      colorPanel.classList.remove('show');
      this.colorPanelVisible = false;
      
      console.log('カラーパネルを非表示にしました');
    }

    async changeTool(tool) {
      this.currentTool = tool;
      this.canvasManager.setTool(tool);
      
      try {
        await chrome.storage.local.set({ currentTool: tool });
      } catch (error) {
        console.log('ストレージ保存エラー (拡張機能コンテキスト無効化):', error);
      }
      
      this.updateBarState();
      
      // ツール変更を他のクライアントに通知
      if (this.wsManager.isConnected()) {
        this.wsManager.send({
          action: 'settingsUpdate',
          roomId: this.currentRoom,
          settings: {
            penSize: this.currentPenSize,
            color: this.canvasManager.currentColor,
            opacity: this.canvasManager.currentOpacity,
            tool: tool
          }
        });
      }
    }

    async changePenSize(size) {
      this.currentPenSize = size;
      this.canvasManager.setPenSize(size);
      
      // Chrome拡張のストレージに安全に保存
      try {
        await chrome.storage.local.set({ currentPenSize: size });
      } catch (error) {
        console.log('ストレージ保存エラー (拡張機能コンテキスト無効化):', error);
      }
      
      this.updateBarState();
      
      // 太さ変更を他のクライアントに通知（簡単な方法）
      if (this.wsManager.isConnected()) {
        this.wsManager.send({
          action: 'settingsUpdate',
          roomId: this.currentRoom,
          settings: {
            penSize: size,
            color: this.canvasManager.currentColor,
            opacity: this.canvasManager.currentOpacity,
            tool: this.currentTool
          }
        });
      }
    }

    saveToHistory() {
      this.drawingHistory = this.drawingHistory.slice(0, this.historyIndex + 1);
      
      const canvasData = this.canvasManager.getCanvasData();
      this.drawingHistory.push(canvasData);
      this.historyIndex++;
      
      if (this.drawingHistory.length > this.maxHistorySize) {
        this.drawingHistory.shift();
        this.historyIndex--;
      }
      
      this.updateBarState();
    }

    undo() {
      if (this.historyIndex >= 0) {
        this.historyIndex--;
        if (this.historyIndex >= 0) {
          this.canvasManager.restoreCanvasData(this.drawingHistory[this.historyIndex]);
        } else {
          this.canvasManager.clear();
        }
        this.updateBarState();
        
        if (this.wsManager.isConnected()) {
          this.wsManager.send({
            action: 'undo',
            roomId: this.currentRoom
          });
        }
      }
    }

    redo() {
      if (this.historyIndex < this.drawingHistory.length - 1) {
        this.historyIndex++;
        this.canvasManager.restoreCanvasData(this.drawingHistory[this.historyIndex]);
        this.updateBarState();
        
        if (this.wsManager.isConnected()) {
          this.wsManager.send({
            action: 'redo',
            roomId: this.currentRoom
          });
        }
      }
    }

    setupChromeListeners() {
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
          case 'CHANGE_TOOL':
            this.changeTool(message.tool);
            break;
          case 'UNDO':
            this.undo();
            break;
          case 'REDO':
            this.redo();
            break;
        }
      });
    }

    handleLocalDraw(drawData) {
      this.saveToHistory();
      
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
          penSize: drawData.stroke.penSize,
          tool: drawData.stroke.tool,
          startTime: drawData.stroke.startTime
        };
        
        console.log('送信データ詳細:', {
          points: payload.points.length,
          color: payload.color,
          opacity: payload.opacity,
          penSize: payload.penSize,
          tool: payload.tool
        });
        
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
            console.log('線描画開始:', strokeData.points.length, '点', '太さ:', strokeData.penSize, '色:', strokeData.color);
            
            // 受信したデータの太さを使用（重要！）
            const penSize = strokeData.penSize || 4;
            const color = strokeData.color || '#000000';
            const opacity = strokeData.opacity !== undefined ? strokeData.opacity : 1.0;
            const tool = strokeData.tool || 'pen';
            
            if (tool === 'eraser') {
              for (let i = 0; i < strokeData.points.length; i++) {
                this.canvasManager.eraseAtPoint(
                  strokeData.points[i], 
                  penSize
                );
              }
            } else {
              // 線描画を1つずつ丁寧に処理
              for (let i = 1; i < strokeData.points.length; i++) {
                this.canvasManager.drawLineWithSettings(
                  strokeData.points[i-1], 
                  strokeData.points[i], 
                  color,
                  opacity,
                  penSize
                );
              }
            }
            console.log('線描画完了 - 適用した太さ:', penSize);
          }
          break;

        case 'settingsUpdate':
          console.log('設定更新受信:', message.settings);
          if (message.settings) {
            // 太さ更新
            if (message.settings.penSize !== undefined) {
              this.currentPenSize = message.settings.penSize;
              this.canvasManager.setPenSize(message.settings.penSize);
            }
            
            // 色更新
            if (message.settings.color !== undefined) {
              this.canvasManager.setColor(message.settings.color);
              const colorPanelBtns = this.controlBar.querySelectorAll('.color-panel-btn');
              colorPanelBtns.forEach(btn => {
                btn.classList.toggle('selected', btn.dataset.color === message.settings.color);
              });
            }
            
            // 透明度更新
            if (message.settings.opacity !== undefined) {
              this.canvasManager.setOpacity(message.settings.opacity);
              const opacitySliderPanel = this.controlBar.querySelector('#opacity-slider-panel');
              const opacityValuePanel = this.controlBar.querySelector('#opacity-value-panel');
              if (opacitySliderPanel && opacityValuePanel) {
                opacitySliderPanel.value = message.settings.opacity;
                opacityValuePanel.textContent = Math.round(message.settings.opacity * 100) + '%';
              }
            }
            
            // ツール更新
            if (message.settings.tool !== undefined) {
              this.currentTool = message.settings.tool;
              this.canvasManager.setTool(message.settings.tool);
            }
            
            this.updateBarState();
          }
          break;

        case 'clearCanvas':
          console.log('キャンバスクリア受信');
          this.canvasManager.clear();
          break;

        case 'undo':
          console.log('アンドゥ受信');
          this.undo();
          break;

        case 'redo':
          console.log('リドゥ受信');
          this.redo();
          break;

        default:
          console.log('未知のメッセージタイプ:', message.type);
      }
    }

    async joinRoom(roomCode) {
      if (roomCode.length !== 8) {
        alert('8桁のコードを入力してください');
        return;
      }
      
      this.currentRoom = roomCode;
      
      try {
        await chrome.storage.local.set({ currentRoom: roomCode });
      } catch (error) {
        console.log('ストレージ保存エラー (拡張機能コンテキスト無効化):', error);
      }
      
      this.wsManager.connect(roomCode);
      this.updateBarState();
    }

    async leaveRoom() {
      this.wsManager.disconnect();
      this.currentRoom = null;
      this.userCount = 0;
      
      try {
        await chrome.storage.local.remove(['currentRoom']);
      } catch (error) {
        console.log('ストレージ削除エラー (拡張機能コンテキスト無効化):', error);
      }
      
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

    async changeColor(color) {
      this.canvasManager.setColor(color);
      
      try {
        await chrome.storage.local.set({ currentColor: color });
      } catch (error) {
        console.log('ストレージ保存エラー (拡張機能コンテキスト無効化):', error);
      }
      
      this.updateBarState();
      
      const colorPanelBtns = this.controlBar.querySelectorAll('.color-panel-btn');
      colorPanelBtns.forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.color === color);
      });
      
      // 色変更を他のクライアントに通知
      if (this.wsManager.isConnected()) {
        this.wsManager.send({
          action: 'settingsUpdate',
          roomId: this.currentRoom,
          settings: {
            penSize: this.currentPenSize,
            color: color,
            opacity: this.canvasManager.currentOpacity,
            tool: this.currentTool
          }
        });
      }
    }

    async changeOpacity(opacity) {
      this.canvasManager.setOpacity(opacity);
      
      try {
        await chrome.storage.local.set({ currentOpacity: opacity });
      } catch (error) {
        console.log('ストレージ保存エラー (拡張機能コンテキスト無効化):', error);
      }
      
      this.updateBarState();
      
      const opacitySliderPanel = this.controlBar.querySelector('#opacity-slider-panel');
      const opacityValuePanel = this.controlBar.querySelector('#opacity-value-panel');
      if (opacitySliderPanel && opacityValuePanel) {
        opacitySliderPanel.value = opacity;
        opacityValuePanel.textContent = Math.round(opacity * 100) + '%';
      }
      
      // 透明度変更を他のクライアントに通知
      if (this.wsManager.isConnected()) {
        this.wsManager.send({
          action: 'settingsUpdate',
          roomId: this.currentRoom,
          settings: {
            penSize: this.currentPenSize,
            color: this.canvasManager.currentColor,
            opacity: opacity,
            tool: this.currentTool
          }
        });
      }
    }

    async toggleDrawing(enabled) {
      this.canvasManager.setEnabled(enabled);
      
      try {
        await chrome.storage.local.set({ isDrawing: enabled });
      } catch (error) {
        console.log('ストレージ保存エラー (拡張機能コンテキスト無効化):', error);
      }
      
      this.updateBarState();
    }

    clearCanvas() {
      this.canvasManager.clear();
      this.saveToHistory();
      
      if (this.wsManager.isConnected()) {
        this.wsManager.send({
          action: 'clearCanvas',
          roomId: this.currentRoom
        });
      }
    }

    clearAllCanvas() {
      this.canvasManager.clear();
      this.drawingHistory = [];
      this.historyIndex = -1;
      this.updateBarState();
      
      if (this.wsManager.isConnected()) {
        this.wsManager.send({
          action: 'clearAll',
          roomId: this.currentRoom
        });
      }
    }

    async toggleBarVisibility(visible) {
      this.isBarVisible = visible;
      
      try {
        await chrome.storage.local.set({ isBarVisible: visible });
      } catch (error) {
        console.log('ストレージ保存エラー (拡張機能コンテキスト無効化):', error);
      }

      if (visible) {
        this.createControlBar();
      } else {
        if (this.controlBar) {
          this.controlBar.remove();
          this.controlBar = null;
        }
      }

      this.canvasManager.updatePosition(visible);
      this.updateBodyPadding();

      if (this.controlBar) {
        this.updateBarState();
      }
    }

    saveToLocalStorage(data) {
      const key = `drawing_${this.currentRoom}`;
      
      try {
        chrome.storage.local.get([key], (result) => {
          const drawings = result[key] || [];
          drawings.push({ ...data, timestamp: Date.now() });
          
          if (drawings.length > 1000) {
            drawings.splice(0, drawings.length - 1000);
          }
          
          chrome.storage.local.set({ [key]: drawings });
        });
      } catch (error) {
        console.log('ローカルストレージ保存エラー (拡張機能コンテキスト無効化):', error);
      }
    }
  }

  // 初期化処理
  const initializeExtension = () => {
    if (!window.sharedDrawingInstance) {
      window.sharedDrawingInstance = new DrawingApp();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExtension);
    setTimeout(initializeExtension, 1000);
  } else {
    initializeExtension();
  }

})();