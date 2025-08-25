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
          console.log('📨 WebSocket RAWメッセージ受信:', event.data);
          
          try {
            const data = JSON.parse(event.data);
            console.log('📨 JSONパース成功:', data);
            
            // AWS WebSocketの場合、メッセージがネストされている可能性がある
            let actualMessage = data;
            
            // AWS API Gatewayの場合のメッセージ構造を確認
            if (data.Records && Array.isArray(data.Records)) {
              console.log('AWS Records形式を検出');
              actualMessage = data.Records[0];
            } else if (data.body) {
              console.log('AWS body形式を検出');
              try {
                actualMessage = typeof data.body === 'string' ? JSON.parse(data.body) : data.body;
              } catch (e) {
                console.log('body解析に失敗、元のdataを使用');
                actualMessage = data;
              }
            } else if (data.message) {
              console.log('message プロパティを検出');
              actualMessage = data.message;
            }
            
            // データ構造の詳細ログ
            if (actualMessage.type === 'drawData') {
              console.log('🔍 drawDataの詳細構造:');
              console.log('  - actualMessage:', actualMessage);
              console.log('  - actualMessage type:', typeof actualMessage);
              
              // 全プロパティをチェック
              Object.keys(actualMessage).forEach(key => {
                console.log(`  - ${key}:`, actualMessage[key]);
              });
            }
            
            this.onMessage(actualMessage);
            
          } catch (error) {
            console.error('❌ メッセージ解析エラー:', error);
            console.error('問題のあるRAWデータ:', event.data);
            console.error('データ長:', event.data.length);
            console.error('データの最初の100文字:', event.data.substring(0, 100));
            
            // 解析に失敗した場合でも、可能な限り処理を続行
            try {
              // 文字列として直接解析を試行
              const fallbackData = { type: 'unknown', rawData: event.data };
              this.onMessage(fallbackData);
            } catch (fallbackError) {
              console.error('フォールバック処理も失敗:', fallbackError);
            }
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
      
      const jsonData = JSON.stringify(data);
      console.log('📤 WebSocketメッセージ送信:');
      console.log('  - 送信オブジェクト:', data);
      console.log('  - 送信JSON:', jsonData);
      
      this.ws.send(jsonData);
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
      this.currentColor = '#000000';
      this.currentOpacity = 0.7;
      this.currentPenSize = 4;
      this.currentTool = 'pen';
      this.onDraw = onDraw;
      this.currentStroke = null;
      this.lastPoint = null;
      
      console.log('🎨 CanvasDrawer初期化:', {
        color: this.currentColor,
        opacity: this.currentOpacity,
        penSize: this.currentPenSize,
        tool: this.currentTool
      });
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
        
        console.log('🖊️ 新しいストローク開始:', {
          color: this.currentColor,
          opacity: this.currentOpacity, 
          penSize: this.currentPenSize,
          tool: this.currentTool
        });
        
        if (this.currentTool === 'eraser') {
          this.eraseAtPoint(point, this.currentPenSize);
        } else {
          // 初期点を描画して色を確認
          this.ctx.save();
          this.ctx.globalAlpha = this.currentOpacity;
          this.ctx.strokeStyle = this.currentColor;
          this.ctx.lineWidth = this.currentPenSize;
          this.ctx.lineCap = 'round';
          this.ctx.lineJoin = 'round';
          this.ctx.globalCompositeOperation = 'source-over';
          
          // 点を描画（色が見えるように）
          this.ctx.beginPath();
          this.ctx.arc(point.x, point.y, this.currentPenSize / 2, 0, Math.PI * 2);
          this.ctx.fillStyle = this.currentColor;
          this.ctx.globalAlpha = this.currentOpacity;
          this.ctx.fill();
          
          console.log('初期点描画:', {
            x: point.x,
            y: point.y,
            color: this.ctx.fillStyle,
            opacity: this.ctx.globalAlpha,
            penSize: this.currentPenSize
          });
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
          // 直接色を指定して描画
          this.drawLineDirectly(this.lastPoint, point);
        }
        
        this.lastPoint = point;
      };

      const stopDrawing = (e) => {
        if (!this.isDrawing) return;
        
        this.isDrawing = false;
        
        // Canvas設定を復元
        if (this.currentTool !== 'eraser') {
          this.ctx.restore();
        }
        
        if (this.currentStroke && this.currentStroke.points.length > 0) {
          console.log('📤 描画完了 - 送信する stroke データ:', {
            pointsCount: this.currentStroke.points.length,
            color: this.currentStroke.color,
            opacity: this.currentStroke.opacity,
            penSize: this.currentStroke.penSize,
            tool: this.currentStroke.tool
          });
          
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

    // 新しい直接描画メソッド
    drawLineDirectly(startPoint, endPoint) {
      if (!this.ctx || !startPoint || !endPoint) return;
      
      console.log('直接描画:', {
        start: startPoint,
        end: endPoint,
        color: this.currentColor,
        opacity: this.currentOpacity,
        penSize: this.currentPenSize
      });
      
      this.ctx.globalAlpha = this.currentOpacity;
      this.ctx.strokeStyle = this.currentColor;
      this.ctx.lineWidth = this.currentPenSize;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.globalCompositeOperation = 'source-over';
      
      this.ctx.beginPath();
      this.ctx.moveTo(startPoint.x, startPoint.y);
      this.ctx.lineTo(endPoint.x, endPoint.y);
      this.ctx.stroke();
      
      console.log('実際の描画設定:', {
        strokeStyle: this.ctx.strokeStyle,
        lineWidth: this.ctx.lineWidth,
        globalAlpha: this.ctx.globalAlpha
      });
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
      
      // 現在の設定を保存
      this.ctx.save();
      
      // 新しい設定を適用
      this.ctx.globalAlpha = opacity || this.currentOpacity;
      this.ctx.strokeStyle = color || this.currentColor;
      this.ctx.lineWidth = penSize || this.currentPenSize;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.globalCompositeOperation = 'source-over';
      
      console.log('Canvas描画設定:', {
        penSize: this.ctx.lineWidth,
        color: this.ctx.strokeStyle,
        opacity: this.ctx.globalAlpha,
        startPoint: startPoint,
        endPoint: endPoint
      });
      
      this.ctx.beginPath();
      this.ctx.moveTo(startPoint.x, startPoint.y);
      this.ctx.lineTo(endPoint.x, endPoint.y);
      this.ctx.stroke();
      
      // 設定を復元
      this.ctx.restore();
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

    setColor(color) { 
      this.currentColor = color;
      console.log('🎨 色設定:', color);
    }
    setOpacity(opacity) { 
      this.currentOpacity = opacity;
      console.log('🎨 透明度設定:', opacity);
    }
    setPenSize(size) { 
      this.currentPenSize = size;
      console.log('🎨 太さ設定:', size);
    }
    setTool(tool) { 
      this.currentTool = tool;
      console.log('🎨 ツール設定:', tool);
    }

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
        // デフォルトをペンツールに設定
        this.currentTool = result.currentTool || 'pen';
        
        this.canvasManager.setEnabled(result.isDrawing !== false);
        this.canvasManager.setColor(result.currentColor || '#000000');
        this.canvasManager.setOpacity(result.currentOpacity !== undefined ? result.currentOpacity : 0.7);
        this.canvasManager.setPenSize(this.currentPenSize);
        this.canvasManager.setTool(this.currentTool);
        
        console.log('🎯 DrawingApp初期化完了:', {
          currentPenSize: this.currentPenSize,
          currentTool: this.currentTool,
          currentColor: this.canvasManager.currentColor,
          canvasManagerPenSize: this.canvasManager.currentPenSize,
          canvasManagerTool: this.canvasManager.currentTool
        });

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
        height: 40px !important;
        background: rgba(0, 0, 0, 0.795) !important;
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
      
      console.log('🔧 updateBarState実行:', {
        isBarVisible: this.isBarVisible,
        expandedContent: !!expandedContent,
        minimizedContent: !!minimizedContent
      });
      
      if (expandedContent && minimizedContent) {
        if (this.isBarVisible) {
          // バーが表示状態の場合は展開コンテンツを表示
          expandedContent.classList.remove('hidden');
          expandedContent.style.display = 'flex';
          minimizedContent.classList.add('hidden');
          minimizedContent.style.display = 'none';
          console.log('✅ 展開コンテンツを表示');
        } else {
          // バーが非表示状態の場合は両方とも非表示
          expandedContent.classList.add('hidden');
          expandedContent.style.display = 'none';
          minimizedContent.classList.add('hidden');
          minimizedContent.style.display = 'none';
          console.log('✅ すべてのコンテンツを非表示');
        }
      } else {
        console.warn('⚠️ expanded-content または minimized-content が見つかりません');
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
      
      const toolToggle = this.controlBar.querySelector('#tool-toggle');
      const toolIcon = this.controlBar.querySelector('#tool-icon');
      const toolText = this.controlBar.querySelector('#tool-text');
      
      if (toolToggle && toolIcon && toolText) {
        // ツールに応じて表示を切り替え
        if (this.currentTool === 'pen') {
          toolToggle.classList.remove('eraser');
          toolToggle.classList.add('active');
          toolToggle.dataset.tool = 'pen';
          toolIcon.textContent = '✏️';
          toolText.textContent = 'ペン';
        } else if (this.currentTool === 'eraser') {
          toolToggle.classList.add('eraser');
          toolToggle.classList.add('active');
          toolToggle.dataset.tool = 'eraser';
          toolIcon.textContent = '🗑️';
          toolText.textContent = '消しゴム';
        }
      }

      // 色選択ボタンの状態を更新
      const colorBtns = this.controlBar.querySelectorAll('.color-btn');
      const paletteBtn = this.controlBar.querySelector('.palette-btn');
      
      colorBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.color === this.canvasManager.currentColor);
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
      
      console.log('🔧 ボタン検索結果:', {
        expandBtn: !!expandBtn,
        minimizeBtn: !!minimizeBtn
      });
      
      if (expandBtn) {
        expandBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log('🔧 展開ボタンクリック');
          self.toggleBarVisibility(true);
        });
        console.log('✅ 展開ボタンのイベントリスナー設定完了');
      } else {
        console.warn('⚠️ 展開ボタン(#expand-btn)が見つかりません');
      }
      
      if (minimizeBtn) {
        minimizeBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log('🔧 最小化ボタンクリック');
          self.toggleBarVisibility(false);
        });
        console.log('✅ 最小化ボタンのイベントリスナー設定完了');
      } else {
        console.warn('⚠️ 最小化ボタン(#minimize-btn)が見つかりません');
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

      // ツール切り替えボタン
      const toolToggle = self.controlBar.querySelector('#tool-toggle');
      if (toolToggle) {
        toolToggle.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          // 現在のツールから切り替え
          const newTool = self.currentTool === 'pen' ? 'eraser' : 'pen';
          self.changeTool(newTool);
        });
      }

      // 色選択ボタン（基本カラー）
      const colorBtns = self.controlBar.querySelectorAll('.color-btn');
      colorBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          self.changeColor(btn.dataset.color);
        });
      });

      // パレットボタン（カラーパネル表示）
      const paletteBtn = self.controlBar.querySelector('.palette-btn');
      if (paletteBtn) {
        paletteBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          self.showColorPanel();
        });
      }

      // 透明度スライダー（メインバー）
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
      const penSizeSliderPanel = self.controlBar.querySelector('#pen-size-slider-panel');
      const penSizeValuePanel = self.controlBar.querySelector('#pen-size-value-panel');
      
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

      // パネル内のペンサイズスライダーのイベント
      if (penSizeSliderPanel) {
        penSizeSliderPanel.addEventListener('input', (e) => {
          const penSize = parseInt(e.target.value);
          self.changePenSize(penSize);
          
          // パネル内の表示も更新
          if (penSizeValuePanel) {
            penSizeValuePanel.textContent = penSize + 'px';
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

    showColorPanel() {
      const colorPanel = this.controlBar.querySelector('#color-panel');
      const overlay = this.controlBar.querySelector('#overlay');
      const colorPanelBtns = this.controlBar.querySelectorAll('.color-panel-btn');
      const opacitySliderPanel = this.controlBar.querySelector('#opacity-slider-panel');
      const opacityValuePanel = this.controlBar.querySelector('#opacity-value-panel');
      const penSizeSliderPanel = this.controlBar.querySelector('#pen-size-slider-panel');
      const penSizeValuePanel = this.controlBar.querySelector('#pen-size-value-panel');
      
      if (!colorPanel || !overlay) {
        console.log('カラーパネルまたはオーバーレイが見つかりません');
        return;
      }
      
      // 現在の色を選択状態にする
      colorPanelBtns.forEach(btn => {
        const isSelected = btn.dataset.color === this.canvasManager.currentColor;
        btn.classList.toggle('selected', isSelected);
      });
      
      // 現在の透明度を設定
      if (opacitySliderPanel && opacityValuePanel) {
        opacitySliderPanel.value = this.canvasManager.currentOpacity;
        opacityValuePanel.textContent = Math.round(this.canvasManager.currentOpacity * 100) + '%';
      }

      // 現在のペンサイズを設定
      if (penSizeSliderPanel && penSizeValuePanel) {
        penSizeSliderPanel.value = this.currentPenSize;
        penSizeValuePanel.textContent = this.currentPenSize + 'px';
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
      
      // 太さ変更を他のクライアントに通知
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
        
        console.log('📤 太さ変更通知送信:', size);
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
        console.log('🔧 Chrome拡張メッセージ受信:', message);
        
        switch (message.type) {
          case 'PING':
            sendResponse({ status: 'ok' });
            break;
          case 'TOGGLE_BAR_VISIBILITY':
            console.log('🔧 拡張機能からバー表示切り替え:', message.visible);
            this.toggleBarVisibility(message.visible);
            break;
          case 'SHOW_BAR':
            // 拡張機能アイコンクリック時にバーを表示
            console.log('🔧 拡張機能アイコンからバー表示要求');
            this.toggleBarVisibility(true);
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

    // 修正版のhandleLocalDraw - 1枚目と2枚目の両方の形式に対応
    handleLocalDraw(drawData) {
      this.saveToHistory();
      
      if (!this.wsManager.isConnected()) {
        console.log('📡 WebSocket未接続のためローカルストレージに保存');
        this.saveToLocalStorage(drawData);
        return;
      }

      if (drawData.type === 'stroke' && drawData.stroke) {
        // データの検証を追加
        const stroke = drawData.stroke;
        
        console.log('🔍 送信前データ検証:');
        console.log('  - stroke:', stroke);
        console.log('  - stroke.points:', stroke.points);
        console.log('  - stroke.points length:', stroke.points ? stroke.points.length : 'undefined');
        
        if (!stroke.points || !Array.isArray(stroke.points) || stroke.points.length === 0) {
          console.error('❌ 送信データが無効:', stroke);
          return;
        }
        
        // 各ポイントを検証
        const validPoints = stroke.points.filter(point => {
          const isValid = point && 
                         typeof point.x === 'number' && 
                         typeof point.y === 'number' &&
                         !isNaN(point.x) && 
                         !isNaN(point.y);
          
          if (!isValid) {
            console.warn('⚠️ 無効なポイントを除外:', point);
          }
          
          return isValid;
        });
        
        if (validPoints.length === 0) {
          console.error('❌ 有効なポイントが存在しない');
          return;
        }
        
        console.log(`✅ 有効ポイント: ${validPoints.length}/${stroke.points.length}`);
        
        // より互換性の高い送信形式を選択
        // AWS WebSocketの場合は、actionプロパティが必要
        const payload = {
          action: 'drawData',
          type: 'drawData',
          roomId: this.currentRoom,
          points: validPoints,
          color: stroke.color || this.canvasManager.currentColor || '#000000',
          opacity: stroke.opacity !== undefined ? stroke.opacity : 
                  this.canvasManager.currentOpacity !== undefined ? this.canvasManager.currentOpacity : 0.7,
          penSize: stroke.penSize !== undefined ? stroke.penSize : 
                  this.currentPenSize !== undefined ? this.currentPenSize : 4,
          tool: stroke.tool || this.currentTool || 'pen',
          startTime: stroke.startTime || Date.now(),
          timestamp: Date.now()
        };
        
        console.log('📤 送信データ構造確認（互換形式）:');
        console.log('  - action:', payload.action);
        console.log('  - type:', payload.type);
        console.log('  - roomId:', payload.roomId);
        console.log('  - points.length:', payload.points.length);
        console.log('  - penSize:', payload.penSize);
        console.log('  - color:', payload.color);
        console.log('  - opacity:', payload.opacity);
        console.log('  - tool:', payload.tool);
        console.log('  - 最初のpoint:', payload.points[0]);
        console.log('  - 最後のpoint:', payload.points[payload.points.length - 1]);
        console.log('  - 送信JSON:', JSON.stringify(payload));
        
        const success = this.wsManager.send(payload);
        if (success) {
          console.log('✅ データ送信成功');
        } else {
          console.error('❌ データ送信失敗');
        }
      } else {
        console.error('❌ drawDataの構造が不正:', drawData);
        console.error('  - drawData.type:', drawData.type);
        console.error('  - drawData.stroke:', drawData.stroke);
      }
    }

    handleConnectionStatusChange(status) {
      console.log('接続ステータス変更:', status);
      this.updateBarState();
    }

    // 修正版のWebSocketメッセージ処理 - 1枚目と2枚目の両方の形式に対応
    handleWebSocketMessage(message) {
      console.log('📥 受信メッセージ全体:', message);
      
      switch (message.type) {
        case 'roomJoined':
          console.log('🎉 部屋参加成功！');
          if (message.userCount !== undefined) {
            this.userCount = message.userCount;
            this.updateBarState();
          }
          break;

        case 'userLeft':
          console.log('👋 ユーザー退出');
          if (message.userCount !== undefined) {
            this.userCount = message.userCount;
            this.updateBarState();
          }
          break;

        case 'drawData':
          console.log('📥 線データ受信開始');
          console.log('📥 受信メッセージの完全構造:', JSON.stringify(message, null, 2));
          
          // データの取得方法を改善 - 複数パターンに対応
          let strokeData = null;
          
          // パターン1: 1枚目の形式（直接プロパティ）
          if (message.points && Array.isArray(message.points) && message.points.length > 0) {
            strokeData = {
              points: message.points,
              color: message.color,
              opacity: message.opacity,
              penSize: message.penSize,
              tool: message.tool
            };
            console.log('📥 1枚目形式（直接プロパティ）から取得:', strokeData);
          }
          // パターン2: 2枚目の形式（dataプロパティ）
          else if (message.data && message.data.points && Array.isArray(message.data.points) && message.data.points.length > 0) {
            strokeData = message.data;
            console.log('📥 2枚目形式（data内）から取得:', strokeData);
          }
          // パターン3: strokeプロパティ
          else if (message.stroke && message.stroke.points && Array.isArray(message.stroke.points) && message.stroke.points.length > 0) {
            strokeData = message.stroke;
            console.log('📥 strokeプロパティから取得:', strokeData);
          }
          // パターン4: AWS API Gateway形式（Lambdaレスポンス）
          else if (message.body) {
            try {
              const bodyData = typeof message.body === 'string' ? JSON.parse(message.body) : message.body;
              if (bodyData.points && Array.isArray(bodyData.points) && bodyData.points.length > 0) {
                strokeData = bodyData;
                console.log('📥 AWS API Gateway形式（body内）から取得:', strokeData);
              }
            } catch (e) {
              console.log('body解析エラー:', e);
            }
          }
          
          // デバッグ用：すべてのプロパティをチェック
          console.log('🔍 メッセージプロパティチェック:');
          console.log('  - message.points:', message.points);
          console.log('  - message.data:', message.data);
          console.log('  - message.stroke:', message.stroke);
          console.log('  - message.body:', message.body);
          console.log('  - message keys:', Object.keys(message));
          
          if (!strokeData) {
            console.error('❌ strokeDataが見つからない - 全プロパティ:', message);
            console.error('❌ データ構造が予期しない形式です');
            break;
          }
          
          // データ検証を強化
          if (!strokeData) {
            console.error('❌ strokeDataがnullまたはundefined');
            break;
          }
          
          if (!strokeData.points) {
            console.error('❌ strokeData.pointsが存在しない:', strokeData);
            break;
          }
          
          if (!Array.isArray(strokeData.points)) {
            console.error('❌ strokeData.pointsが配列ではない:', typeof strokeData.points, strokeData.points);
            break;
          }
          
          if (strokeData.points.length === 0) {
            console.warn('⚠️ strokeData.pointsが空配列');
            break;
          }
          
          // 各ポイントの構造を検証
          const validPoints = strokeData.points.filter(point => {
            if (!point || typeof point !== 'object') {
              console.warn('⚠️ 無効なpoint:', point);
              return false;
            }
            if (typeof point.x !== 'number' || typeof point.y !== 'number') {
              console.warn('⚠️ point.x または point.y が数値ではない:', point);
              return false;
            }
            if (isNaN(point.x) || isNaN(point.y)) {
              console.warn('⚠️ point.x または point.y がNaN:', point);
              return false;
            }
            return true;
          });
          
          if (validPoints.length === 0) {
            console.error('❌ 有効なポイントが存在しない');
            break;
          }
          
          if (validPoints.length !== strokeData.points.length) {
            console.warn('⚠️ 無効なポイントを除外しました', 
              `${strokeData.points.length} → ${validPoints.length}`);
            strokeData.points = validPoints;
          }
          
          console.log('🔍 受信データ詳細:');
          console.log('  - points数:', strokeData.points.length);
          console.log('  - 最初のpoint:', strokeData.points[0]);
          console.log('  - 最後のpoint:', strokeData.points[strokeData.points.length - 1]);
          console.log('  - penSize:', strokeData.penSize);
          console.log('  - color:', strokeData.color);
          console.log('  - opacity:', strokeData.opacity);
          console.log('  - tool:', strokeData.tool);
          
          // デフォルト値の設定
          const penSize = strokeData.penSize !== undefined ? strokeData.penSize : 
                         this.currentPenSize !== undefined ? this.currentPenSize : 4;
          const color = strokeData.color || this.canvasManager.currentColor || '#000000';
          const opacity = strokeData.opacity !== undefined ? strokeData.opacity : 
                         this.canvasManager.currentOpacity !== undefined ? this.canvasManager.currentOpacity : 1.0;
          const tool = strokeData.tool || this.currentTool || 'pen';
          
          console.log('🎨 描画に使用する最終値:');
          console.log('  - penSize:', penSize);
          console.log('  - color:', color);
          console.log('  - opacity:', opacity);
          console.log('  - tool:', tool);
          
          // 描画実行
          try {
            if (tool === 'eraser') {
              console.log('🗑️ 消しゴム描画開始');
              for (let i = 0; i < strokeData.points.length; i++) {
                this.canvasManager.eraseAtPoint(strokeData.points[i], penSize);
              }
              console.log('✅ 消しゴム描画完了');
            } else {
              console.log('✏️ ペン描画開始');
              
              // 単一ポイントの場合は点として描画
              if (strokeData.points.length === 1) {
                const point = strokeData.points[0];
                this.canvasManager.ctx.save();
                this.canvasManager.ctx.globalAlpha = opacity;
                this.canvasManager.ctx.fillStyle = color;
                this.canvasManager.ctx.beginPath();
                this.canvasManager.ctx.arc(point.x, point.y, penSize / 2, 0, Math.PI * 2);
                this.canvasManager.ctx.fill();
                this.canvasManager.ctx.restore();
                console.log('✅ 単一点描画完了');
              } else {
                // 線として描画
                for (let i = 1; i < strokeData.points.length; i++) {
                  this.canvasManager.drawLineWithSettings(
                    strokeData.points[i-1], 
                    strokeData.points[i], 
                    color,
                    opacity,
                    penSize
                  );
                }
                console.log('✅ 線描画完了');
              }
            }
          } catch (drawError) {
            console.error('❌ 描画エラー:', drawError);
            console.error('エラー時のstrokeData:', strokeData);
          }
          
          break;

        case 'settingsUpdate':
          console.log('⚙️ 設定更新受信:', message.settings);
          if (message.settings) {
            if (message.settings.penSize !== undefined) {
              this.currentPenSize = message.settings.penSize;
              this.canvasManager.setPenSize(message.settings.penSize);
            }
            
            if (message.settings.color !== undefined) {
              this.canvasManager.setColor(message.settings.color);
            }
            
            if (message.settings.opacity !== undefined) {
              this.canvasManager.setOpacity(message.settings.opacity);
            }
            
            if (message.settings.tool !== undefined) {
              this.currentTool = message.settings.tool;
              this.canvasManager.setTool(message.settings.tool);
            }
            
            this.updateBarState();
          }
          break;

        case 'clearCanvas':
          console.log('🗑️ キャンバスクリア受信');
          this.canvasManager.clear();
          break;

        case 'undo':
          console.log('↶ アンドゥ受信');
          this.undo();
          break;

        case 'redo':
          console.log('↷ リドゥ受信');
          this.redo();
          break;

        default:
          console.log('❓ 未知のメッセージタイプ:', message.type);
          console.log('メッセージ内容:', message);
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

    async toggleBarVisibility(visible) {
      console.log('🔧 toggleBarVisibility実行:', { 
        before: this.isBarVisible, 
        after: visible,
        controlBarExists: !!this.controlBar 
      });
      
      this.isBarVisible = visible;
      
      try {
        await chrome.storage.local.set({ isBarVisible: visible });
      } catch (error) {
        console.log('ストレージ保存エラー (拡張機能コンテキスト無効化):', error);
      }

      if (visible) {
        // 表示状態：バーが存在しなければ作成、存在すれば表示
        if (!this.controlBar) {
          console.log('🔧 controlBarが存在しないため作成します');
          this.createControlBar();
        } else {
          console.log('🔧 既存のcontrolBarを表示します');
          this.controlBar.style.display = 'block';
          this.updateBarState();
        }
        
        // キャンバス位置を調整（バー分だけ下に）
        this.canvasManager.updatePosition(true);
        
        // body paddingを設定
        if (document.body) {
          document.body.style.paddingTop = '40px';
        }
        
        console.log('✅ バーを表示しました');
      } else {
        // 非表示状態：バーを完全に非表示
        if (this.controlBar) {
          console.log('🔧 controlBarを非表示にします');
          this.controlBar.style.display = 'none';
        }
        
        // キャンバスを画面全体に表示
        this.canvasManager.updatePosition(false);
        
        // body paddingをリセット
        if (document.body) {
          document.body.style.paddingTop = '';
        }
        
        console.log('✅ バーを非表示にしました');
      }
      
      console.log('🔧 toggleBarVisibility完了:', {
        isBarVisible: this.isBarVisible,
        controlBarDisplay: this.controlBar ? this.controlBar.style.display : 'none'
      });
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