// WebSocket通信を管理するクラス
class WebSocketManager {
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