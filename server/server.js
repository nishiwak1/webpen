// サーバーサイド実装例（Node.js + WebSocket）
// server.js
const WebSocket = require('ws');
const http = require('http');
const express = require('express');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// セッションごとにクライアントを管理
const sessions = new Map();

wss.on('connection', (ws, req) => {
  const sessionId = req.url.split('/').pop();
  
  // セッションが存在しない場合は作成
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, new Set());
  }
  
  // クライアントをセッションに追加
  sessions.get(sessionId).add(ws);
  
  ws.on('message', (message) => {
    // 同じセッション内の他のクライアントにメッセージを転送
    const clients = sessions.get(sessionId);
    clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });
  
  ws.on('close', () => {
    // セッションからクライアントを削除
    const clients = sessions.get(sessionId);
    clients.delete(ws);
    
    // セッションに誰もいなくなったら削除
    if (clients.size === 0) {
      sessions.delete(sessionId);
    }
  });
});

server.listen(8080, () => {
  console.log('サーバーがポート8080で起動しました');
});