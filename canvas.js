// Canvas描画を管理するクラス
class CanvasManager {
  constructor(onDrawCallback) {
    this.canvas = null;
    this.ctx = null;
    this.isDrawing = false;
    this.isEnabled = true;
    this.currentColor = '#000000';
    this.currentOpacity = 0.7;
    this.lastPos = { x: 0, y: 0 };
    this.onDraw = onDrawCallback;
    this.currentStroke = null; // 追加
  }

  updatePosition(isBarVisible) {
    if (this.canvas) {
      this.canvas.style.top = isBarVisible ? '60px' : '0px';
      this.canvas.style.height = isBarVisible ? 'calc(100vh - 60px)' : '100vh';
      this.resize(isBarVisible);
    }
  }

  create(isBarVisible = true) {
    // 既存のキャンバスを削除
    const existingCanvas = document.getElementById('shared-drawing-canvas');
    if (existingCanvas) {
      existingCanvas.remove();
    }

    // 新しいキャンバスを作成
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'shared-drawing-canvas';

    const canvasStyles = `
      position: fixed !important;
      top: ${isBarVisible ? '60px' : '0px'} !important;
      left: 0 !important;
      width: 100vw !important;
      height: ${isBarVisible ? 'calc(100vh - 60px)' : '100vh'} !important;
      z-index: 2147483646 !important;
      pointer-events: none !important;
      background: transparent !important;
      cursor: default !important;
      touch-action: manipulation !important;
      user-select: none !important;
    `;

    this.canvas.style.cssText = canvasStyles;

    this.resize(isBarVisible);
    this.ctx = this.canvas.getContext('2d');
    this.setupContext();
    document.body.appendChild(this.canvas);

    // イベントリスナーを設定
    this.setupEventListeners();

    // リサイズイベント
    window.addEventListener('resize', () => this.resize(isBarVisible));
  }

  resize(isBarVisible) {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight - (isBarVisible ? 60 : 20);
    this.setupContext();
  }

  setupContext() {
    if (!this.ctx) return;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.lineWidth = 3;
    this.ctx.strokeStyle = this.currentColor;
    this.ctx.globalAlpha = this.currentOpacity;
  }
  setupEventListeners() {
    let longPressTimer = null;
    let isLongPressActive = false;
    const LONG_PRESS_DURATION = 30;

    // マウスイベント
    document.addEventListener('mousedown', (e) => {
      if (!this.isEnabled) return;

      longPressTimer = setTimeout(() => {
        isLongPressActive = true;

        // 描画モード突入：この瞬間だけキャンバスをアクティブ化
        this.canvas.style.pointerEvents = 'auto';
        document.body.style.overflow = 'hidden';

        this.startDrawing(e);
      }, LONG_PRESS_DURATION);
    });

    document.addEventListener('mousemove', (e) => {
      if (isLongPressActive && this.isDrawing) {
        this.draw(e);
      }
    });

    document.addEventListener('mouseup', () => {
      clearTimeout(longPressTimer);
      if (isLongPressActive) {
        this.stopDrawing();
        isLongPressActive = false;
      }
    });

    // タッチイベント
    document.addEventListener('touchstart', (e) => {
      if (!this.isEnabled) return;

      longPressTimer = setTimeout(() => {
        isLongPressActive = true;

        // 描画モード突入
        this.canvas.style.pointerEvents = 'auto';
        document.body.style.overflow = 'hidden';
        document.body.style.userSelect = 'none';

        const interactiveElements = document.querySelectorAll('a, button, input, select, textarea');
        interactiveElements.forEach(el => {
          el.style.pointerEvents = 'none';
          el.setAttribute('data-drawing-disabled', 'true');
        });

        const touch = e.touches[0];
        this.startDrawing({
          clientX: touch.clientX,
          clientY: touch.clientY
        });
      }, LONG_PRESS_DURATION);
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (isLongPressActive && this.isDrawing) {
        e.preventDefault();
        const touch = e.touches[0];
        this.draw({
          clientX: touch.clientX,
          clientY: touch.clientY
        });
      }
    }, { passive: false });

    document.addEventListener('touchend', () => {
      clearTimeout(longPressTimer);
      if (isLongPressActive) {
        this.stopDrawing();
        isLongPressActive = false;
      }
    });

    // マウスが画面外に出た場合
    document.addEventListener('mouseleave', () => {
      clearTimeout(longPressTimer);
      if (isLongPressActive) {
        this.stopDrawing();
        isLongPressActive = false;
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

    // 線の開始：座標配列を初期化
    this.currentStroke = {
      startTime: Date.now(),
      color: this.currentColor,
      opacity: this.currentOpacity,
      points: [{ x: this.lastPos.x, y: this.lastPos.y }]
    };

    // start通知は削除（まとめて送信するため）
  }

  draw(e) {
    if (!this.isDrawing || !this.isEnabled) return;

    const rect = this.canvas.getBoundingClientRect();
    const currentPos = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };

    this.drawLine(this.lastPos, currentPos, this.currentColor, this.currentOpacity);

    // 描画中：座標を配列に追加（全ての点を記録）
    if (this.currentStroke) {
      this.currentStroke.points.push({ x: currentPos.x, y: currentPos.y });
    }

    this.lastPos = currentPos;
  }

  stopDrawing() {
    if (!this.isDrawing) return;
    this.isDrawing = false;

    // デバッグ：線データの確認
    console.log('=== stopDrawing デバッグ ===');
    console.log('currentStroke:', this.currentStroke);
    console.log('currentStroke.points:', this.currentStroke?.points);
    console.log('currentStroke.points.length:', this.currentStroke?.points?.length);

    if (this.currentStroke) {
      console.log('線データを送信します:', this.currentStroke);
      this.onDraw({
        type: 'stroke',
        stroke: this.currentStroke
      });
      this.currentStroke = null;
    } else {
      console.log('currentStrokeが存在しません！');
    }
  }

  drawLine(from, to, color, opacity = 1.0) {
    const previousAlpha = this.ctx.globalAlpha;
    const previousStroke = this.ctx.strokeStyle;

    this.ctx.strokeStyle = color;
    this.ctx.globalAlpha = opacity;
    this.ctx.beginPath();
    this.ctx.moveTo(from.x, from.y);
    this.ctx.lineTo(to.x, to.y);
    this.ctx.stroke();

    this.ctx.globalAlpha = previousAlpha;
    this.ctx.strokeStyle = previousStroke;
  }

  clear() {
    if (this.ctx) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  setColor(color) {
    this.currentColor = color;
    if (this.ctx) {
      this.ctx.strokeStyle = color;
    }
  }

  setOpacity(opacity) {
    this.currentOpacity = Math.max(0.1, Math.min(1.0, opacity));
    if (this.ctx) {
      this.ctx.globalAlpha = this.currentOpacity;
    }
  }
  setEnabled(enabled) {
    this.isEnabled = enabled;

    if (enabled) {
      // 描画ON時
      const pencilCursorUrl = chrome.runtime.getURL('images/pencil-cursor.png');
      document.body.style.cursor = `url("${pencilCursorUrl}") 0 16, crosshair`;

      if (this.canvas) {
        this.canvas.style.pointerEvents = 'auto';
      }

      if (!document.getElementById('drawing-mode-css')) {
        const style = document.createElement('style');
        style.id = 'drawing-mode-css';
        style.textContent = `
    /* レイアウトに影響しない要素のみ制限 */
    a, button, input, textarea, select, label, [onclick], [href] {
      user-select: none !important;
      pointer-events: none !important;
    }
    
    /* 必要な要素は除外 */
    html, body {
      pointer-events: auto !important;
      overflow: auto !important;
    }
    
    #shared-drawing-control-bar,
    #shared-drawing-control-bar * {
      pointer-events: auto !important;
    }
    
    #shared-drawing-canvas {
      pointer-events: auto !important;
    }
  `;
        document.head.appendChild(style);
      }

    } else {
      // 描画OFF時
      document.body.style.cursor = '';

      if (this.canvas) {
        this.canvas.style.pointerEvents = 'none';
      }

      const style = document.getElementById('drawing-mode-css');
      if (style) {
        style.remove();
      }

      document.body.style.pointerEvents = 'auto';
      document.body.style.userSelect = 'auto';
      document.body.style.overflow = 'auto';
    }
  }
}
window.addEventListener('beforeunload', () => {
  console.log('ページアンロード中');
});

window.addEventListener('load', () => {
  console.log('ページロード完了');
});