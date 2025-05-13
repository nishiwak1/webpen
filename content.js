(function() {
  let canvas;
  let ctx;
  let drawing = false;
  let lastX = 0;
  let lastY = 0;
  let color = '#000000';
  let penSize = 3;
  let sessionId = null;
  let drawingsRef = null;
  let myUserId = generateUserId();
  
  // ユーザーID生成
  function generateUserId() {
    return Math.random().toString(36).substring(2, 15);
  }
  
  // キャンバスオーバーレイ作成
  function createCanvas() {
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
  
  // イベントリスナー設定
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
    
    // 描画データを Firebase に送信
    if (drawingsRef) {
      drawingsRef.push({
        userId: myUserId,
        fromX: lastX,
        fromY: lastY,
        toX: e.clientX,
        toY: e.clientY,
        color: color,
        penSize: penSize,
        timestamp: firebase.database.ServerValue.TIMESTAMP
      });
    }
    
    lastX = e.clientX;
    lastY = e.clientY;
  }
  
  // 描画終了
  function stopDrawing() {
    drawing = false;
  }
  
  // Firebase セッション設定
  function setupFirebaseSession(newSessionId) {
    sessionId = newSessionId;
    
    // 既存のリスナーをクリーンアップ
    if (drawingsRef) {
      drawingsRef.off();
    }
    
    // 新しいセッションの参照を取得
    drawingsRef = firebase.database().ref(`sessions/${sessionId}/drawings`);
    
    // 以前のデータを読み込み
    drawingsRef.once('value', (snapshot) => {
      snapshot.forEach((childSnapshot) => {
        const draw = childSnapshot.val();
        if (draw.userId !== myUserId) { // 自分の描画ではない場合のみ
          ctx.beginPath();
          ctx.moveTo(draw.fromX, draw.fromY);
          ctx.lineTo(draw.toX, draw.toY);
          ctx.strokeStyle = draw.color;
          ctx.lineWidth = draw.penSize;
          ctx.lineCap = 'round';
          ctx.stroke();
        }
      });
    });
    
    // 新しい描画をリッスン
    drawingsRef.on('child_added', (snapshot) => {
      const draw = snapshot.val();
      // 自分の描画は既に表示されているので処理しない
      if (draw.userId !== myUserId) {
        ctx.beginPath();
        ctx.moveTo(draw.fromX, draw.fromY);
        ctx.lineTo(draw.toX, draw.toY);
        ctx.strokeStyle = draw.color;
        ctx.lineWidth = draw.penSize;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    });
    
    // クリアコマンドをリッスン
    firebase.database().ref(`sessions/${sessionId}/commands`).on('child_added', (snapshot) => {
      const command = snapshot.val();
      if (command.type === 'clear' && command.userId !== myUserId) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    });
    
    // 参加者リストに自分を追加
    firebase.database().ref(`sessions/${sessionId}/participants/${myUserId}`).set({
      joined: firebase.database.ServerValue.TIMESTAMP,
      lastActive: firebase.database.ServerValue.TIMESTAMP
    });
    
    // 切断時に参加者リストから削除するための設定
    firebase.database().ref(`sessions/${sessionId}/participants/${myUserId}`).onDisconnect().remove();
  }
  
  // キャンバスクリア
  function clearCanvas() {
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // クリアコマンドを Firebase に送信
      if (sessionId) {
        firebase.database().ref(`sessions/${sessionId}/commands`).push({
          type: 'clear',
          userId: myUserId,
          timestamp: firebase.database.ServerValue.TIMESTAMP
        });
      }
    }
  }
  
  // 拡張機能からのメッセージを処理
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'startSession') {
      createCanvas();
      setupFirebaseSession(request.sessionId);
    } else if (request.action === 'joinSession') {
      createCanvas();
      setupFirebaseSession(request.sessionId);
    } else if (request.action === 'endSession') {
      if (canvas) {
        document.body.removeChild(canvas);
        canvas = null;
      }
      if (drawingsRef) {
        drawingsRef.off();
      }
    } else if (request.action === 'clearCanvas') {
      clearCanvas();
    } else if (request.action === 'changeColor') {
      color = request.color;
    } else if (request.action === 'changePenSize') {
      penSize = parseInt(request.size);
    }
  });
  
  // ウィンドウサイズ変更時
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
  const urlSessionId = getSessionIdFromUrl();
  if (urlSessionId) {
    chrome.storage.local.set({
      activeSession: true,
      isHost: false,
      sessionId: urlSessionId,
      color: '#000000',
      penSize: 3
    }, function() {
      createCanvas();
      setupFirebaseSession(urlSessionId);
    });
  }
})();