
// content.js
(function() {
  let socket;
  let canvas;
  let ctx;
  let drawing = false;
  let lastX = 0;
  let lastY = 0;
  let color = '#000000';
  let penSize = 3;
  
  // ページにキャンバスオーバーレイを追加
  function createCanvas() {
    // すでに存在する場合は削除
    if (canvas) {
      document.body.removeChild(canvas);
    }
    
    canvas = document.createElement('canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'auto';
    canvas.style.zIndex = '9999';
    canvas.style.cursor = 'crosshair';
    
    ctx = canvas.getContext('2d');
    
    document.body.appendChild(canvas);
    
    // イベントリスナーを設定
    setupEventListeners();
  }
  
  // イベントリスナーを設定
  function setupEventListeners() {
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);
  }
  
  // 描画開始
  function startDrawing(e) {
    drawing = true;
    lastX = e.clientX;
    lastY = e.clientY;
  }
  
  // 描画中
  function draw(e) {
    if (!drawing) return;
    
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(e.clientX, e.clientY);
    ctx.strokeStyle = color;
    ctx.lineWidth = penSize;
    ctx.lineCap = 'round';
    ctx.stroke();
    
    // 描画データをサーバーに送信
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'draw',
        from: lastX,
        fromY: lastY,
        toX: e.clientX,
        toY: e.clientY,
        color: color,
        penSize: penSize
      }));
    }
    
    lastX = e.clientX;
    lastY = e.clientY;
  }
  
  // 描画終了
  function stopDrawing() {
    drawing = false;
  }
  
  // WebSocket接続を設定
  function setupWebSocket(sessionId) {
    // 実際のWebSocketサーバーのURLに置き換えてください
    socket = new WebSocket(`wss://your-websocket-server.com/session/${sessionId}`);
    
    socket.onopen = function() {
      console.log('WebSocket接続が確立されました');
    };
    
    socket.onmessage = function(event) {
      const message = JSON.parse(event.data);
      
      if (message.type === 'draw') {
        // 他のユーザーの描画を反映
        ctx.beginPath();
        ctx.moveTo(message.fromX, message.fromY);
        ctx.lineTo(message.toX, message.toY);
        ctx.strokeStyle = message.color;
        ctx.lineWidth = message.penSize;
        ctx.lineCap = 'round';
        ctx.stroke();
      } else if (message.type === 'clear') {
        // キャンバスをクリア
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
    
    socket.onclose = function() {
      console.log('WebSocket接続が閉じられました');
    };
    
    socket.onerror = function(error) {
      console.error('WebSocketエラー:', error);
    };
  }
  
  // キャンバスをクリア
  function clearCanvas() {
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // クリアコマンドをサーバーに送信
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'clear'
        }));
      }
    }
  }
  
  // 拡張機能のメッセージを処理
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'startSession' || request.action === 'joinSession') {
      createCanvas();
      setupWebSocket(request.sessionId);
    } else if (request.action === 'endSession') {
      if (canvas) {
        document.body.removeChild(canvas);
        canvas = null;
      }
      if (socket) {
        socket.close();
        socket = null;
      }
    } else if (request.action === 'clearCanvas') {
      clearCanvas();
    } else if (request.action === 'changeColor') {
      color = request.color;
    } else if (request.action === 'changePenSize') {
      penSize = parseInt(request.size);
    }
  });
  
  // ウィンドウサイズ変更時にキャンバスをリサイズ
  window.addEventListener('resize', function() {
    if (canvas) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
  });
  
  // URLからセッションIDを取得
  function getSessionIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('session');
  }
  
  // URLにセッションIDがある場合、自動的に参加
  const sessionId = getSessionIdFromUrl();
  if (sessionId) {
    chrome.storage.local.set({
      activeSession: true,
      isHost: false,
      sessionId: sessionId,
      color: '#000000',
      penSize: 3
    }, function() {
      createCanvas();
      setupWebSocket(sessionId);
    });
  }
})();