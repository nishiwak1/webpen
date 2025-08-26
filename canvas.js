// Canvas描画を管理するクラス（CSS Transform方式）
class CanvasManager {
  constructor(onDrawCallback) {
    this.canvas = null;
    this.ctx = null;
    this.isDrawing = false;
    this.isEnabled = true;
    this.currentColor = '#000000';
    this.currentOpacity = 1;
    this.lastPos = { x: 0, y: 0 }; // キャンバス座標
    this.onDraw = onDrawCallback;

    // 履歴管理用（キャンバス座標で統一）
    this.currentStroke = null;
    this.strokes = []; // 全ての描画履歴（キャンバス座標）

    // 個人履歴管理用
    this.myStrokeIds = new Set(); // 自分が描いたストロークのIDを管理
    this.strokeIdCounter = 0; // ストロークID生成用
  }

  updatePosition(isBarVisible) {
    if (this.canvas) {
      // ページ全体の高さを再取得
      const pageHeight = Math.max(
        document.body.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.clientHeight,
        document.documentElement.scrollHeight,
        document.documentElement.offsetHeight
      );

      this.canvas.style.top = isBarVisible ? '32px' : '0px';
      this.canvas.style.height = `${pageHeight - (isBarVisible ? 32 : 0)}px`;
      this.resize(isBarVisible);
    }
  }

  create(isBarVisible = true) {
    // 既存のキャンバスを削除
    const existingCanvas = document.getElementById('webpen-canvas');
    if (existingCanvas) {
      existingCanvas.remove();
    }

    // 新しいキャンバスを作成
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'webpen-canvas';

    // ページ全体の高さを取得
    const pageHeight = Math.max(
      document.body.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.clientHeight,
      document.documentElement.scrollHeight,
      document.documentElement.offsetHeight
    );

    const canvasStyles = `
      position: fixed !important;
      top: ${isBarVisible ? '32px' : '0px'} !important;
      left: 0 !important;
      width: 100vw !important;
      height: ${pageHeight - (isBarVisible ? 32 : 0)}px !important;
      z-index: 2147483646 !important;
      pointer-events: none !important;
      background: transparent !important;
      cursor: default !important;
      touch-action: manipulation !important;
      user-select: none !important;
      will-change: transform !important;
      transform-origin: 0 0 !important;
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

    // スクロールイベントを設定
    this.setupScrollListener();

    // 初期位置を設定
    this.updateCanvasTransform();

    // ページコンテンツの変化を監視
    this.observePageChanges(isBarVisible);
  }

  setupScrollListener() {
    const scrollHandler = () => {
      // キャンバス全体をtransformで移動（即座に反映）
      this.updateCanvasTransform();
    };

    // パッシブリスナーとして設定（パフォーマンス向上）
    window.addEventListener('scroll', scrollHandler, { passive: true });
    document.addEventListener('scroll', scrollHandler, { passive: true });
  }

  updateCanvasTransform() {
    if (!this.canvas) return;

    const scrollX = window.scrollX || document.documentElement.scrollLeft;
    const scrollY = window.scrollY || document.documentElement.scrollTop;

    // キャンバス全体をスクロール量の逆方向に移動
    this.canvas.style.transform = `translate(-${scrollX}px, -${scrollY}px)`;
  }

  // 画面座標をキャンバス座標に変換（transform考慮）
  screenToCanvas(screenX, screenY) {
    const rect = this.canvas.getBoundingClientRect();

    // transformされたキャンバス上での座標を計算
    // getBoundingClientRectはtransform後の位置を返すので、
    // 単純にrect.leftとrect.topを引くだけで正しい座標が得られる
    return {
      x: screenX - rect.left,
      y: screenY - rect.top
    };
  }

  resize(isBarVisible) {
    // ページ全体の高さを取得
    const pageHeight = Math.max(
      document.body.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.clientHeight,
      document.documentElement.scrollHeight,
      document.documentElement.offsetHeight
    );

    this.canvas.width = window.innerWidth;
    // ページ全体の高さに設定（バーの高さを考慮）
    this.canvas.height = pageHeight - (isBarVisible ? 32 : 0);

    this.setupContext();

    // リサイズ後に全ての線を再描画
    this.redrawAllStrokes();

    // 位置を更新
    this.updateCanvasTransform();
  }

  setupContext() {
    if (!this.ctx) return;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.lineWidth = 3;
    this.ctx.strokeStyle = this.currentColor;
    this.ctx.globalAlpha = this.currentOpacity;
  }

  redrawAllStrokes() {
    if (!this.ctx) return;

    // キャンバスをクリア
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 全ての線をそのままの座標で再描画
    this.strokes.forEach(stroke => {
      this.drawStroke(stroke);
    });
  }

  drawStroke(stroke) {
    if (!stroke.points || stroke.points.length < 2) return;

    const previousAlpha = this.ctx.globalAlpha;
    const previousStroke = this.ctx.strokeStyle;

    this.ctx.strokeStyle = stroke.color;
    this.ctx.globalAlpha = stroke.opacity;
    this.ctx.beginPath();

    // キャンバス座標をそのまま使用（座標変換不要）
    for (let i = 0; i < stroke.points.length; i++) {
      const point = stroke.points[i];

      if (i === 0) {
        this.ctx.moveTo(point.x, point.y);
      } else {
        this.ctx.lineTo(point.x, point.y);
      }
    }

    this.ctx.stroke();

    this.ctx.globalAlpha = previousAlpha;
    this.ctx.strokeStyle = previousStroke;
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

    // 画面座標をキャンバス座標に変換
    const canvasPos = this.screenToCanvas(e.clientX, e.clientY);
    this.lastPos = canvasPos;

    // 一意のIDを生成
    const strokeId = `stroke_${Date.now()}_${this.strokeIdCounter++}`;

    // 線の開始：キャンバス座標で管理
    this.currentStroke = {
      id: strokeId,
      startTime: Date.now(),
      color: this.currentColor,
      opacity: this.currentOpacity,
      points: [canvasPos], // キャンバス座標
      isLocal: true // 自分が描いた線であることを示すフラグ
    };
  }

  draw(e) {
    if (!this.isDrawing || !this.isEnabled) return;

    // 画面座標をキャンバス座標に変換
    const canvasPos = this.screenToCanvas(e.clientX, e.clientY);

    // キャンバス上で線を描画（そのままの座標で）
    this.drawLine(this.lastPos, canvasPos, this.currentColor, this.currentOpacity);

    // キャンバス座標を履歴に追加
    if (this.currentStroke) {
      this.currentStroke.points.push(canvasPos);
    }

    this.lastPos = canvasPos;
  }

  stopDrawing() {
    if (!this.isDrawing) return;
    this.isDrawing = false;

    console.log('=== stopDrawing デバッグ ===');
    console.log('currentStroke:', this.currentStroke);
    console.log('currentStroke.points:', this.currentStroke?.points);
    console.log('currentStroke.points.length:', this.currentStroke?.points?.length);

    if (this.currentStroke && this.currentStroke.points.length > 1) {
      // 自分が描いた線として記録
      this.myStrokeIds.add(this.currentStroke.id);

      // 履歴に追加
      this.strokes.push({ ...this.currentStroke });

      // そのまま送信（キャンバス座標で統一）
      console.log('線データを送信します:', this.currentStroke);
      this.onDraw({
        type: 'stroke',
        stroke: this.currentStroke
      });
      this.currentStroke = null;
    } else {
      console.log('currentStrokeが存在しないか、点が1つ以下です');
    }

    // 描画モード終了
    this.canvas.style.pointerEvents = 'none';
    document.body.style.overflow = '';
    document.body.style.userSelect = '';

    // 無効化していた要素を復元
    const disabledElements = document.querySelectorAll('[data-drawing-disabled]');
    disabledElements.forEach(el => {
      el.style.pointerEvents = '';
      el.removeAttribute('data-drawing-disabled');
    });
  }

  // 他のユーザーからの線データを受信した時の処理
  drawReceivedStroke(strokeData) {
    if (!strokeData.points || strokeData.points.length < 2) return;

    console.log('受信した線データを描画:', strokeData);

    // 受信したデータもキャンバス座標として扱う
    const stroke = {
      id: strokeData.id || `remote_${Date.now()}_${Math.random()}`,
      startTime: strokeData.startTime,
      color: strokeData.color || '#000000',
      opacity: strokeData.opacity || 1.0,
      points: strokeData.points, // キャンバス座標として保存
      isLocal: false // 他のユーザーが描いた線
    };

    // 履歴に追加（他のユーザーの線なのでmyStrokeIdsには追加しない）
    this.strokes.push(stroke);

    // そのままの座標で描画
    this.drawStroke(stroke);
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
    // 履歴もクリア
    this.strokes = [];
    this.myStrokeIds.clear(); // 自分のストロークIDもクリア
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
    
    #webpen-control-bar,
    #webpen-control-bar * {
      pointer-events: auto !important;
    }
    
    #webpen-canvas {
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

  observePageChanges(isBarVisible) {
    // MutationObserverでページの高さ変化を監視
    const observer = new MutationObserver(() => {
      const currentHeight = Math.max(
        document.body.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.clientHeight,
        document.documentElement.scrollHeight,
        document.documentElement.offsetHeight
      );

      // 現在のキャンバス高さと比較
      if (this.canvas && Math.abs(this.canvas.height - (currentHeight - (isBarVisible ? 32 : 0))) > 10) {
        console.log('ページ高さ変化を検知:', currentHeight);
        this.resize(isBarVisible);
      }
    });

    // body要素の変化を監視
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: false
    });
  }

  // ========================================
  // 個人履歴管理用のUndo/Redo機能
  // ========================================

  // 自分の最後のストロークを削除してUndoスタックに返す
  undoMyLastStroke() {
    // 自分が描いた最後のストロークを探す
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const stroke = this.strokes[i];

      // 自分が描いた線かチェック
      if (this.myStrokeIds.has(stroke.id)) {
        // 配列から削除
        const removedStroke = this.strokes.splice(i, 1)[0];

        // IDセットからも削除
        this.myStrokeIds.delete(stroke.id);

        // キャンバスを再描画
        this.redrawAllStrokes();

        console.log('自分のストロークを削除:', removedStroke.id);
        return removedStroke;
      }
    }

    console.log('削除できる自分のストロークがありません');
    return null;
  }

  // Undoしたストロークを復元
  redoStroke(stroke) {
    if (!stroke) return;

    // 自分のストロークとして復元
    this.myStrokeIds.add(stroke.id);
    this.strokes.push(stroke);

    // 再描画
    this.redrawAllStrokes();

    console.log('ストロークを復元:', stroke.id);
  }

  // 現在のキャンバス状態を取得
  getCanvasState() {
    console.log('現在のストローク数:', this.strokes.length);
    console.log('自分のストローク数:', this.myStrokeIds.size);
    return {
      strokes: [...this.strokes],
      myStrokeIds: new Set(this.myStrokeIds)
    };
  }

  // キャンバス状態を復元（クリア操作のUndo用）
  restoreCanvasState(state) {
    if (state && state.strokes) {
      this.strokes = [...state.strokes];
      this.myStrokeIds = new Set(state.myStrokeIds || []);
      this.redrawAllStrokes();
      console.log('キャンバス状態を復元:', this.strokes.length, '個のストローク');
    }
  }

  // 自分が描いたストロークの数を取得
  getMyStrokeCount() {
    return this.myStrokeIds.size;
  }

  // デバッグ用：全ストロークの情報を出力
  debugStrokes() {
    console.log('=== ストローク情報 ===');
    console.log('全ストローク数:', this.strokes.length);
    console.log('自分のストローク数:', this.myStrokeIds.size);
    this.strokes.forEach((stroke, index) => {
      console.log(`[${index}] ID: ${stroke.id}, 自分の線: ${this.myStrokeIds.has(stroke.id)}, 点の数: ${stroke.points.length}`);
    });
  }
}

window.addEventListener('beforeunload', () => {
  console.log('ページアンロード中');
});