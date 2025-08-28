class SharedDrawing {
  constructor() {
    // 状態管理（タブ固有）
    this.controlBar = null;
    this.isBarVisible = true;
    this.currentRoom = null; // タブ固有
    this.userCount = 0;
    this.isInitialized = false;
    this.drawingStateBeforeMinimize = null;

    // 描画設定（タブ固有）
    this.isDrawingEnabled = true;
    this.currentColor = '#000000';
    this.currentOpacity = 1;

    // ★ アクティブなツールIDを直接管理
    this.activeToolId = 'cursor'; // 初期値はカーソル

    // ひとつ戻る・進む用の履歴管理
    this.history = []; // 全ての操作履歴（描画、クリアなど）
    this.historyIndex = -1; // 現在の履歴位置
    this.maxHistorySize = 50; // 履歴の最大サイズ
    this.redoStack = []; // Redo用のスタック

    // タブIDを生成（一意識別用）
    this.tabId = this.generateTabId();

    // WebSocketマネージャーを初期化
    this.wsManager = new WebSocketManager(
      (message) => this.handleWebSocketMessage(message),
      (status) => this.handleConnectionStatusChange(status)
    );

    // Canvasマネージャーを初期化
    this.canvasManager = new CanvasManager(
      (drawData) => this.handleLocalDraw(drawData)
    );

    this.init();
  }

  generateTabId() {
    return 'tab_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
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
      // タブ固有のデフォルト
      this.isBarVisible = false;
      this.isDrawingEnabled = false;

      // 白紙ページ検出
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('webpen') === 'true') {
        console.log('白紙ページを検出 - UIバーを自動表示');
        this.isBarVisible = true;
        await chrome.storage.local.set({ isBarVisible: true });
      }

      // ★ 初期アクティブツールを0番スロットに設定
      this.activeToolId = '0';

      // 描画設定はタブ固有のデフォルト値を使用
      this.canvasManager.setEnabled(this.isDrawingEnabled);
      this.canvasManager.setColor(this.currentColor);
      this.canvasManager.setOpacity(this.currentOpacity);

      // UI作成
      setTimeout(() => {
        this.createControlBar();
        this.canvasManager.create(this.isBarVisible);
        this.setupChromeListeners();
        this.isInitialized = true;
      }, 500);

    } catch (error) {
      console.error('初期化エラー:', error);
    }
  }

  // ----------------------------------------
  // 1. UI作成・管理
  // ----------------------------------------

  createControlBar() {
    const existingBar = document.getElementById('webpen-control-bar');
    if (existingBar) {
      existingBar.remove();
    }

    // 非表示状態の場合は作成しない
    if (!this.isBarVisible) {
      return;
    }

    if (!document.body) {
      setTimeout(() => this.createControlBar(), 100);
      return;
    }

    this.controlBar = document.createElement('div');
    this.controlBar.id = 'webpen-control-bar';

    const barStyles = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      width: 100% !important;
      height: 32px !important;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
      border-bottom: 1px solid rgba(255,255,255,0.2) !important;
      z-index: 2147483647 !important;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2) !important;
      transition: opacity 0.15s ease !important;
      overflow: hidden !important;
      box-sizing: border-box !important;
      pointer-events: auto !important;
      user-select: none !important;
      opacity: 0 !important;
      visibility: hidden !important;
    `;

    this.controlBar.style.cssText = barStyles;
    this.loadBarContent();
    document.body.insertBefore(this.controlBar, document.body.firstChild);

    this.updateBodyPadding();
  }

  async loadBarContent() {
    try {
      const htmlUrl = chrome.runtime.getURL('webpen.html');
      const response = await fetch(htmlUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const htmlContent = await response.text();
      this.controlBar.innerHTML = htmlContent;

      const iconMappings = {
        'arrow-back': 'images/arrow-back.svg',
        'arrow-forward': 'images/arrow-forward.svg',
        'cursor': 'images/cursor.svg',
        'pen': 'images/pen.svg',
        'pen-line': 'images/pen-line.svg',
        'eraser': 'images/eraser.svg',
        'eraser-line': 'images/eraser-line.svg',
        'trash': 'images/trash.svg',
        'whiteboard': 'images/whiteboard.svg',
        'settings': 'images/settings.svg',
        'close': 'images/close.svg',
      };

      // data-icon属性を持つ全ての画像要素を取得
      this.controlBar.querySelectorAll('[data-icon]').forEach(img => {
        const iconName = img.dataset.icon;
        if (iconMappings[iconName]) {
          img.src = chrome.runtime.getURL(iconMappings[iconName]);
        }
      });

      // ★ スロットツールタイプをロード（カーソル/ペンの配置を復元）
      await this.loadSlotToolTypes();

      // ★ ツール色をロード
      await this.loadSlotToolTypes();
      await this.loadToolColors();

      // ★ 新しい初期化も追加
      await this.initializeToolIcons();

      this.updateBarState();
      this.setupControlBarEvents();
      this.showBarIfNeeded();

    } catch (error) {
      console.error('HTMLコンテンツ読み込みエラー:', error);
    }
  }

  showBarIfNeeded() {
    if (this.controlBar && this.isBarVisible) {
      setTimeout(() => {
        if (this.controlBar) {
          this.controlBar.style.opacity = '1';
          this.controlBar.style.visibility = 'visible';
        }
      }, 50);
    }
  }

  hideBar() {
    if (this.controlBar) {
      this.controlBar.style.opacity = '0';
      this.controlBar.style.visibility = 'hidden';

      setTimeout(() => {
        if (this.controlBar) {
          this.controlBar.remove();
          this.controlBar = null;
        }
      }, 150);
    }
  }

  updateBarState() {
    if (!this.controlBar || !this.controlBar.innerHTML) return;
    const currentRoomCode = this.controlBar.querySelector('#current-room-code');
    // ツールボタンの状態更新
    const toolBtns = this.controlBar.querySelectorAll('.slot-tool');
    toolBtns.forEach(btn => {
      const toolId = btn.dataset.tool;
      const toolType = this.getSlotToolType(toolId);
      let isActive = false;

      if (toolType === 'cursor') {
        // カーソルツールは描画が無効の時にアクティブ
        isActive = !this.isDrawingEnabled && this.activeToolId === toolId;
      } else {
        // ペン/消しゴムツールは描画が有効で、かつそのツールがアクティブな時にアクティブ
        isActive = this.isDrawingEnabled && this.activeToolId === toolId;
      }

      btn.classList.toggle('active', isActive);
    });

    // 部屋関連
    const roomJoin = this.controlBar.querySelector('#room-join');
    const roomCurrent = this.controlBar.querySelector('#room-current');
    const roomInput = this.controlBar.querySelector('#room-input');

    // 部屋入力フィールドを常にクリア（タブ固有の動作）
    if (roomInput) {
      roomInput.value = '';
    }

    // 部屋状態の表示切り替え
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

    const joinBtn = this.controlBar.querySelector('#join-btn');
    const leaveBtn = this.controlBar.querySelector('#leave-btn');

    if (joinBtn && leaveBtn) {
      if (this.currentRoom) {
        // 参加後：LEAVEボタン表示、JOINボタン非表示
        joinBtn.classList.add('hidden');
        leaveBtn.classList.remove('hidden');
      } else {
        // 参加前：JOINボタン表示、LEAVEボタン非表示
        joinBtn.classList.remove('hidden');
        leaveBtn.classList.add('hidden');
      }
    }

    // Undo/Redoボタンの状態を更新
    this.updateUndoRedoButtons();

    // ★ 下線表示も更新
    this.updateActiveToolUnderline();
  }

  updateBodyPadding() {
    if (!document.body) return;

    if (this.isBarVisible) {
      document.body.style.paddingTop = '32px';
    } else {
      document.body.style.paddingTop = '';
    }
  }

  // ----------------------------------------
  // 2. UI状態制御
  // ----------------------------------------

  async toggleBarVisibility(visible) {
    this.isBarVisible = visible;
    if (visible) {
      this.createControlBar();
      if (this.drawingStateBeforeMinimize !== null) {
        await this.toggleDrawing(this.drawingStateBeforeMinimize);
        this.drawingStateBeforeMinimize = null;
      }
    } else {
      this.drawingStateBeforeMinimize = this.isDrawingEnabled;
      await this.toggleDrawing(false);
      this.hideBar();
    }

    this.updateBodyPadding();
  }

  // ----------------------------------------
  // 3. イベント設定
  // ----------------------------------------
  setupControlBarEvents() {
    const self = this;

    // ツールボタン
    const toolBtns = self.controlBar.querySelectorAll('.slot-tool');
    toolBtns.forEach(btn => {
      // 左クリック処理
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const toolId = btn.dataset.tool;
        const currentToolType = this.getSlotToolType(toolId);
        console.log(`左クリック - ツール${toolId} - タイプ: ${currentToolType}`);

        if (currentToolType === 'cursor') {
          self.setActiveTool(toolId);
        } else {
          const toolColor = await self.getToolColor(toolId);
          self.setActiveTool(toolId);
          self.changeColor(toolColor);
          // ペンツールの場合は色を再適用
          if (currentToolType === 'pen' || currentToolType === 'pen-line') {
            self.changeColor(toolColor);
          }
        }
      });

      // 右クリック処理
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const toolId = btn.dataset.tool;
        const toolType = this.getSlotToolType(toolId);

        this.setActiveTool(toolId);

        if (toolType === 'cursor') {
          this.toggleDrawing(false);
        } else {
          this.toggleDrawing(true);
          this.getToolColor(toolId).then(color => {
            this.changeColor(color);
          });

          // ペンツールの場合は現在の色を適用
          if (toolType === 'pen' || toolType === 'pen-line') {
            this.getToolColor(toolId).then(color => {
              this.changeColor(color);
            });
          }
        }

        this.showColorPalette(e, btn);
      });
    });

    // カラーパレット関連イベント
    this.setupColorPaletteEvents();

    // 新規ページ
    const whiteboardBtn = self.controlBar.querySelector('#whiteboard-btn');
    if (whiteboardBtn) {
      whiteboardBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        self.createNewPage();
      });
    }

    // 部屋関連ボタン
    const roomInput = self.controlBar.querySelector('#room-input');
    const joinBtn = self.controlBar.querySelector('#join-btn');
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

    if (leaveBtn) {
      leaveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        self.leaveRoom();
      });
    }

    // Undo/Redoボタン
    const undoBtn = self.controlBar.querySelector('#undo-btn');
    const redoBtn = self.controlBar.querySelector('#redo-btn');

    if (undoBtn) {
      undoBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        self.handleUndo();
      });
    }

    if (redoBtn) {
      redoBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        self.handleRedo();
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

    // 閉じるボタン
    const closeBtn = self.controlBar.querySelector('#close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        self.toggleBarVisibility(false);
      });
    }

    // キーボードショートカット
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        self.handleUndo();
      }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        self.handleRedo();
      }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        self.handleRedo();
      }
    });
  }
  async updateToolColor(toolElement, newColor) {
    const toolId = toolElement.dataset.tool;
    const toolType = this.getSlotToolType(toolId);

    console.log(`ツール色更新開始: ${toolId}, 新色: ${newColor}, タイプ: ${toolType}`);

    if (toolType === 'pen') {
      // 1. まず色をローカルストレージに保存（即座に反映）
      await this.saveToolColor(toolId, newColor);
      console.log(`色保存完了: ${toolId} = ${newColor}`);

      // 2. ペンアイコンを更新（非同期だが待機）
      await this.updateToolAppearance(toolElement, toolId);
      console.log(`アイコン更新完了: ${toolId}`);

      // 3. アクティブツールの場合は即座にペンカラーと下線を更新
      if (this.activeToolId === toolId) {
        this.changeColor(newColor);
        await this.updateActiveToolUnderline();
        console.log(`アクティブツール色適用完了: ${toolId} = ${newColor}`);
      }
    }

    console.log(`ツール色更新完了: ${toolId}`);
  }

  async handleColorSwatchClick(swatch, selectedColor) {
    console.log('Color selected:', selectedColor);

    if (this.currentEditingTool && this.getSlotToolType(this.currentEditingTool.dataset.tool) === 'pen') {
      // 既存の選択を解除
      const colorSwatches = this.controlBar.querySelectorAll('.color-swatch');
      colorSwatches.forEach(el => el.classList.remove('selected'));

      // 新しい選択を追加
      swatch.classList.add('selected');

      const toolId = this.currentEditingTool.dataset.tool;

      // ★ 重要：色更新を完全に待機してから次の処理
      await this.updateToolColor(this.currentEditingTool, selectedColor);

      // ★ アクティブツールに設定（色更新後）
      this.setActiveTool(toolId);

      // 描画モードを有効にする
      if (!this.isDrawingEnabled) {
        this.toggleDrawing(true);
      }

      // パレットを閉じる
      setTimeout(() => {
        this.hideColorPalette();
      }, 150);
    }
  }

  // カラーパレット関連のイベント設定
  setupColorPaletteEvents() {
    const palette = this.controlBar.querySelector('#colorPalette');
    if (!palette) return;

    const closeBtn = palette.querySelector('#paletteCloseBtn');
    const colorSwatches = palette.querySelectorAll('.color-swatch');
    const opacitySlider = palette.querySelector('#opacitySlider');
    const opacityValue = palette.querySelector('#opacityValue');
    const penSizeSlider = palette.querySelector('#penSizeSlider');
    const penSizeValue = palette.querySelector('#penSizeValue');

    // 閉じるボタン
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.hideColorPalette();
      });
    }

    // カラースウォッチ選択
    colorSwatches.forEach(swatch => {
      swatch.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const selectedColor = swatch.dataset.color;
        await this.handleColorSwatchClick(swatch, selectedColor);
      });
    });

    // ツールオプション選択
    const toolOptions = palette.querySelectorAll('.tool-option');
    toolOptions.forEach(option => {
      option.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const toolType = option.dataset.toolType;
        console.log('Tool selected:', toolType);

        if (this.currentEditingTool) {
          const toolId = this.currentEditingTool.dataset.tool;

          toolOptions.forEach(el => el.classList.remove('selected'));
          option.classList.add('selected');

          await this.setSlotToolType(toolId, toolType);
          this.setActiveTool(toolId);

          if (toolType === 'cursor') {
            this.toggleDrawing(false);
          } else {
            this.toggleDrawing(true);
            const toolColor = await this.getToolColor(toolId);
            this.changeColor(toolColor);
          }

          setTimeout(() => {
            this.hideColorPalette();
          }, 150);
        }
      });
    });

    // スライダー値の更新（表示のみ）
    if (opacitySlider && opacityValue) {
      opacitySlider.addEventListener('input', () => {
        opacityValue.textContent = opacitySlider.value + '%';
        console.log('Opacity changed:', opacitySlider.value);
      });
    }

    if (penSizeSlider && penSizeValue) {
      penSizeSlider.addEventListener('input', () => {
        penSizeValue.textContent = penSizeSlider.value + 'px';
        console.log('Pen size changed:', penSizeSlider.value);
      });
    }

    // パレット外クリックで閉じる
    document.addEventListener('click', (e) => {
      if (palette.style.display === 'block' && !palette.contains(e.target)) {
        this.hideColorPalette();
      }
    });

    // ESCキーで閉じる
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && palette.style.display === 'block') {
        this.hideColorPalette();
      }
    });
  }

  // ★ ペンツール判定のヘルパー関数
  isPenTool(toolType) {
    return toolType === 'pen' || toolType === 'pen-line';
  }

  // ★ 消しゴムツール判定のヘルパー関数
  isEraserTool(toolType) {
    return toolType === 'eraser' || toolType === 'eraser-line';
  }

  // ★ アクティブツールを設定
  setActiveTool(toolId) {
    console.log(`=== setActiveTool 呼び出し ===`);
    console.log(`設定対象ツール: ${toolId}`);

    this.activeToolId = toolId;
    const toolType = this.getSlotToolType(toolId);
    console.log(`ツールタイプ: ${toolType}`);

    if (toolType === 'cursor') {
      this.toggleDrawing(false);
      this.canvasManager.setEraserMode(false);
      console.log('カーソルツールのため描画モードOFF');
    } else if (toolType === 'eraser-line') {
      this.toggleDrawing(true);
      this.canvasManager.setEraserMode(true);
      console.log('消しゴムモード有効化');
    } else {
      this.toggleDrawing(true);
      this.canvasManager.setEraserMode(false);

      // getToolColor()で最新の保存済み色を取得
      this.getToolColor(toolId).then(color => {
        console.log(`最新の保存済み色を取得: ${toolId} = ${color}`);
        this.changeColor(color);
        console.log(`ペンツールのため描画モードON、色: ${color}`);
      });
      // ペン/消しゴムツールの場合は描画を有効に
      this.toggleDrawing(true);
      
      // ★ ツールタイプに応じて設定
      if (this.isPenTool(toolType)) {
        // ペンツールの場合は色を適用
        this.getToolColor(toolId).then(color => {
          this.changeColor(color);
          console.log(`ペンツールのため描画モードON、色: ${color}`);
        });
        // 通常の描画モードに設定
        if (typeof this.canvasManager.setEraserMode === 'function') {
          this.canvasManager.setEraserMode(false);
        }
      } else if (this.isEraserTool(toolType)) {
        // 消しゴムツールの場合は消しゴムモードに設定
        if (typeof this.canvasManager.setEraserMode === 'function') {
          this.canvasManager.setEraserMode(true, toolType === 'eraser-line');
          console.log(`消しゴムツール(${toolType})のため消しゴムモードON`);
        } else {
          console.warn('CanvasManager.setEraserModeメソッドが見つかりません');
        }
      } else {
        // その他のツールは通常の描画モード
        if (typeof this.canvasManager.setEraserMode === 'function') {
          this.canvasManager.setEraserMode(false);
        }
        console.log(`その他のツール(${toolType})のため通常描画モードON`);
      }
    }

    this.updateBarState();
    this.updateActiveToolUnderline();
    console.log(`=== setActiveTool 完了 ===`);
  }

  // ★ デバッグ用：色変更の全プロセス確認
  async debugColorChangeProcess(toolId, newColor) {
    console.log(`\n=== 色変更プロセス デバッグ ${toolId} → ${newColor} ===`);

    // 1. 変更前の状態
    const beforeColor = await this.getToolColor(toolId);
    console.log(`変更前の色: ${beforeColor}`);
    console.log(`現在のペンカラー: ${this.currentColor}`);

    // 2. 色変更実行
    const toolElement = this.controlBar?.querySelector(`[data-tool="${toolId}"]`);
    if (toolElement) {
      await this.updateToolColor(toolElement, newColor);
    }

    // 3. 変更後の状態確認
    const afterColor = await this.getToolColor(toolId);
    console.log(`変更後の色: ${afterColor}`);

    if (this.activeToolId === toolId) {
      console.log(`現在のペンカラー: ${this.currentColor}`);
      console.log(`ペンカラー同期: ${this.currentColor === newColor ? '✓' : '✗'}`);
    }

    console.log(`=== デバッグ完了 ===\n`);
  }

  // アクティブツールの下線を更新
  async updateActiveToolUnderline() {
    if (!this.controlBar) return;

    const toolBtns = this.controlBar.querySelectorAll('.slot-tool');

    // 全ての下線をリセット
    toolBtns.forEach(btn => {
      btn.style.borderBottom = '';
      btn.style.boxShadow = '';
    });

    // アクティブツールに下線を表示（ペンツールのみ）
    if (this.activeToolId && this.isDrawingEnabled) {
      const toolType = this.getSlotToolType(this.activeToolId);

      if (toolType === 'pen') {
        const activeBtn = this.controlBar.querySelector(`[data-tool="${this.activeToolId}"]`);
        if (activeBtn) {
          const toolColor = await this.getToolColor(this.activeToolId);
          activeBtn.style.borderBottom = `3px solid ${toolColor}`;
          activeBtn.style.boxShadow = `inset 0 -3px 0 ${toolColor}`;
          console.log(`ツール ${this.activeToolId} に下線表示 (${toolColor})`);
        }
      }
    }
  }

  // カラーパレットを表示
  showColorPalette(event, toolBtn) {
    const palette = this.controlBar.querySelector('#colorPalette');
    if (!palette) return;

    this.currentEditingTool = toolBtn;
    palette.style.display = 'block';

    let x = event.clientX;
    let y = event.clientY;

    if (x + 280 > window.innerWidth) {
      x = window.innerWidth - 290;
    }
    if (y + 350 > window.innerHeight) {
      y = window.innerHeight - 360;
    }

    palette.style.position = 'fixed';
    palette.style.top = y + 'px';
    palette.style.left = x + 'px';

    this.updatePaletteSelection();
    console.log('カラーパレット表示:', toolBtn.dataset.tool);
  }

  // カラーパレットを非表示
  hideColorPalette() {
    const palette = this.controlBar.querySelector('#colorPalette');
    if (palette) {
      palette.style.display = 'none';
    }
    this.currentEditingTool = null;
  }

  // スロットのツールタイプを取得
  getSlotToolType(slotId) {
    try {
      const slotElement = this.controlBar?.querySelector(`[data-tool="${slotId}"]`);
      if (!slotElement) {
        console.log(`getSlotToolType エラー: 要素が見つからない (${slotId})`);
        return 'pen';
      }

      const toolType = slotElement.dataset.toolType || 'pen';
      return toolType;
    } catch (error) {
      console.log(`getSlotToolType エラー (${slotId}):`, error);
      return 'pen';
    }
  }

  // スロットのツールタイプを設定
  async setSlotToolType(slotId, toolType) {
    const slotElement = this.controlBar?.querySelector(`[data-tool="${slotId}"]`);
    if (!slotElement) return;

    slotElement.dataset.toolType = toolType;
    await this.updateToolAppearance(slotElement, slotId);
    await this.saveSlotToolType(slotId, toolType);
  }

  // キーヒントを取得
  getKeyHint(slotId) {
    const keyMap = {
      '0': '1', '1': '2', '2': '3', '3': '4', '4': '5',
      '5': '6', '6': '7', '7': '8', '8': '9', '9': '`'
    };
    return keyMap[slotId] || '';
  }

  // 18色対応の色名取得
  getColorName(color) {
    const colorNames = {
      // 基本色
      '#0080ff': '青',
      '#00c000': '緑',
      '#ffff00': '黄',
      '#ff8000': 'オレンジ',
      '#ff0000': '赤',
      '#ff00ff': 'マゼンタ',

      // パステル調
      '#00ffff': 'シアン',
      '#80ff80': 'ライトグリーン',
      '#ffff80': 'ライトイエロー',
      '#ffcc99': 'ピーチ',
      '#ffcccc': 'ピンク',
      '#ffccff': 'ライトマゼンタ',

      // 無彩色
      '#ffffff': '白',
      '#cccccc': 'ライトグレー',
      '#999999': 'グレー',
      '#666666': 'ダークグレー',
      '#333333': 'チャコール',
      '#000000': '黒',

      // 既存のツールスロット用デフォルト色（後方互換）
      '#808080': 'グレー',
      '#0000ff': '青',
      '#00c000': '緑'
    };
    return colorNames[color] || '色付き';
  }

  // 18色SVGファイル名マッピング
  getColorSvgFileName(color) {
    const colorFileMap = {
      // 基本色
      '#0080ff': 'pen-blue.svg',
      '#00c000': 'pen-green.svg',
      '#ffff00': 'pen-yellow.svg',
      '#ff8000': 'pen-orange.svg',
      '#ff0000': 'pen-red.svg',
      '#ff00ff': 'pen-magenta.svg',

      // パステル調
      '#00ffff': 'pen-cyan.svg',
      '#80ff80': 'pen-lightgreen.svg',
      '#ffff80': 'pen-lightyellow.svg',
      '#ffcc99': 'pen-peach.svg',
      '#ffcccc': 'pen-pink.svg',
      '#ffccff': 'pen-lightmagenta.svg',

      // 無彩色
      '#ffffff': 'pen-white.svg',
      '#cccccc': 'pen-lightgray.svg',
      '#999999': 'pen-gray.svg',
      '#666666': 'pen-darkgray.svg',
      '#333333': 'pen-charcoal.svg',
      '#000000': 'pen-black.svg'
    };

    return colorFileMap[color] || 'pen-black.svg';
  }

  // 18色SVGファイル読み込み
  async createColoredPenElement(color) {
    try {
      const svgFileName = this.getColorSvgFileName(color);
      const penSvgUrl = chrome.runtime.getURL(`images/${svgFileName}`);

      console.log(`ペンアイコン読み込み開始: ${color} -> ${svgFileName}`);

      // 1. ファイル存在確認
      const response = await fetch(penSvgUrl, { method: 'HEAD' });
      if (!response.ok) {
        throw new Error(`SVGファイルが見つかりません: ${svgFileName} (${response.status})`);
      }

      // 2. 画像要素作成と読み込み完了まで待機
      return new Promise((resolve, reject) => {
        const img = document.createElement('img');

        // ★ キャッシュバスターを追加（重要な修正）
        const timestamp = Date.now();
        img.src = `${penSvgUrl}?t=${timestamp}`;

        img.className = 'pen-tool-icon';
        img.alt = `${this.getColorName(color)}ペン`;
        img.style.filter = 'none';

        // 3. 読み込み完了イベント
        img.onload = () => {
          console.log(`ペンアイコン読み込み完了: ${color} (${svgFileName})`);
          resolve(img);
        };

        // 4. 読み込み失敗イベント
        img.onerror = (error) => {
          console.warn(`ペンアイコン読み込み失敗: ${color} (${svgFileName})`, error);
          reject(new Error(`画像読み込みエラー: ${svgFileName}`));
        };

        // 5. タイムアウト設定（3秒）
        setTimeout(() => {
          if (!img.complete) {
            console.warn(`ペンアイコン読み込みタイムアウト: ${svgFileName}`);
            reject(new Error(`読み込みタイムアウト: ${svgFileName}`));
          }
        }, 3000);
      });

    } catch (error) {
      console.warn(`個別SVGファイル読み込み失敗: ${color}`, error);
      return this.createFallbackPenElement(color);
    }
  }
  async createColoredPenElementWithPreload(color) {
    try {
      const svgFileName = this.getColorSvgFileName(color);
      const penSvgUrl = chrome.runtime.getURL(`images/${svgFileName}`);

      console.log(`ペンアイコン事前読み込み開始: ${color} -> ${svgFileName}`);

      // 1. Imageオブジェクトで事前読み込み
      await new Promise((resolve, reject) => {
        const preloadImg = new Image();
        preloadImg.onload = () => resolve();
        preloadImg.onerror = () => reject(new Error(`事前読み込み失敗: ${svgFileName}`));
        preloadImg.src = penSvgUrl;

        setTimeout(() => reject(new Error(`事前読み込みタイムアウト: ${svgFileName}`)), 2000);
      });

      console.log(`事前読み込み完了: ${svgFileName}`);

      // 2. DOM要素作成（キャッシュ済みなので即座に表示）
      const img = document.createElement('img');
      img.src = penSvgUrl;
      img.className = 'pen-tool-icon';
      img.alt = `${this.getColorName(color)}ペン`;
      img.style.filter = 'none';

      console.log(`ペンアイコン作成完了: ${color}`);
      return img;

    } catch (error) {
      console.warn(`事前読み込み方式失敗: ${color}`, error);
      return this.createFallbackPenElement(color);
    }
  }


  // フォールバック用の色丸
  createFallbackPenElement(color) {
    console.log(`フォールバック色丸作成: ${color}`);

    const span = document.createElement('span');
    span.className = 'pen-tool-fallback';
    span.style.cssText = `
      display: inline-block;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: ${color};
      ${color === '#ffffff' ? 'border: 1px solid #666;' : ''}
    `;
    return span;
  }


  // ★ 実際の処理順序を完全に制御する修正版
  async updateToolColorSynchronized(toolElement, newColor) {
    const toolId = toolElement.dataset.tool;
    const toolType = this.getSlotToolType(toolId);

    console.log(`\n=== 同期化された色更新開始 ${toolId} → ${newColor} ===`);

    if (toolType === 'pen') {
      // 1. 色を保存
      console.log('ステップ1: 色保存');
      await this.saveToolColor(toolId, newColor);
      const savedColor = await this.getToolColor(toolId);
      console.log(`保存確認: ${savedColor}`);

      // 2. アクティブツールなら先にペンカラー更新
      if (this.activeToolId === toolId) {
        console.log('ステップ2: アクティブツールのペンカラー更新');
        this.changeColor(newColor);
        console.log(`ペンカラー更新: ${this.currentColor}`);
      }

      // 3. アイコン更新（最新の保存済み色を確実に使用）
      console.log('ステップ3: アイコン更新');
      await this.updateToolAppearanceForced(toolElement, toolId, newColor);

      // 4. 下線更新
      if (this.activeToolId === toolId) {
        console.log('ステップ4: 下線更新');
        await this.updateActiveToolUnderline();
      }
    }

    console.log(`=== 同期化された色更新完了 ===\n`);
  }

  // ★ 強制的に指定色でアイコンを更新
  async updateToolAppearanceForced(toolElement, toolId, forceColor = null) {
    const toolType = this.getSlotToolType(toolId);
    const keyHint = this.getKeyHint(toolId);

    console.log(`強制アイコン更新: ${toolId}, タイプ: ${toolType}, 強制色: ${forceColor}`);

    // 既存の内容をクリア
    toolElement.innerHTML = '';

    if (toolType === 'cursor') {
      const cursorImg = document.createElement('img');
      cursorImg.src = chrome.runtime.getURL('images/cursor.svg');
      cursorImg.className = 'slot-icon';
      cursorImg.alt = 'カーソル';

      toolElement.appendChild(cursorImg);
      toolElement.title = `カーソルモード (${keyHint})`;

    } else if (toolType === 'eraser-line') {
      const eraserImg = document.createElement('img');
      eraserImg.src = chrome.runtime.getURL('images/eraser-line.svg');
      eraserImg.className = 'slot-icon';
      eraserImg.alt = '消しゴム';

      toolElement.appendChild(eraserImg);
      toolElement.title = `消しゴム (${keyHint})`;

    } else {
      // ★ 重要：強制色が指定されていればそれを使用、なければ保存済み色
      const toolColor = forceColor || await this.getToolColor(toolId);
      console.log(`使用する色: ${toolColor} (強制: ${forceColor ? 'Yes' : 'No'})`);

      const penElement = await this.createColoredPenElement(toolColor);
      toolElement.appendChild(penElement);
      toolElement.title = `${this.getColorName(toolColor)}ペン (${keyHint})`;
    }

    // キーヒントを追加
    const hint = document.createElement('span');
    hint.className = 'key-hint';
    hint.textContent = keyHint;
    toolElement.appendChild(hint);

    console.log(`強制アイコン更新完了: ${toolId}`);
  }

  // ★ カラースウォッチクリック処理を完全同期版に置き換え
  async handleColorSwatchClick(swatch, selectedColor) {
    console.log('Color selected:', selectedColor);

    if (this.currentEditingTool && this.getSlotToolType(this.currentEditingTool.dataset.tool) === 'pen') {
      const colorSwatches = this.controlBar.querySelectorAll('.color-swatch');
      colorSwatches.forEach(el => el.classList.remove('selected'));
      swatch.classList.add('selected');

      const toolId = this.currentEditingTool.dataset.tool;

      // ★ 直接色指定版を使用
      await this.updateToolColorDirect(this.currentEditingTool, selectedColor);

      this.setActiveTool(toolId);

      if (!this.isDrawingEnabled) {
        this.toggleDrawing(true);
      }

      setTimeout(() => {
        this.hideColorPalette();
      }, 150);
    }
  }

  // ツール外観更新
  async updateToolAppearance(toolElement, toolId) {
    const toolType = this.getSlotToolType(toolId);
    const keyHint = this.getKeyHint(toolId);

    console.log(`ツール外観更新開始: ${toolId}, タイプ: ${toolType}`);

    toolElement.innerHTML = '';

    if (toolType === 'cursor') {
      const cursorImg = document.createElement('img');
      cursorImg.src = chrome.runtime.getURL('images/cursor.svg');
      cursorImg.className = 'slot-icon';
      cursorImg.alt = 'カーソル';

      toolElement.appendChild(cursorImg);
      toolElement.title = `カーソルモード (${keyHint})`;

    } else if (toolType === 'eraser-line') {
      const eraserImg = document.createElement('img');
      eraserImg.src = chrome.runtime.getURL('images/eraser-line.svg');
      eraserImg.className = 'slot-icon';
      eraserImg.alt = '消しゴム';

      toolElement.appendChild(eraserImg);
      toolElement.title = `消しゴム (${keyHint})`;

    } else {
      // ★ getToolColorを呼ぶ直前にログ出力
      console.log(`getToolColorを呼び出し直前: ${toolId}`);
      const toolColor = await this.getToolColor(toolId);
      console.log(`ペンツール ${toolId} の色: ${toolColor}`);

      const penElement = await this.createColoredPenElement(toolColor);
      toolElement.appendChild(penElement);
      toolElement.title = `${this.getColorName(toolColor)}ペン (${keyHint})`;
    }

    const hint = document.createElement('span');
    hint.className = 'key-hint';
    hint.textContent = keyHint;
    toolElement.appendChild(hint);

    console.log(`ツール外観更新完了: ${toolId}`);
  }

  // ツール色更新
  async updateToolColorDirect(toolElement, newColor) {
    const toolId = toolElement.dataset.tool;
    const toolType = this.getSlotToolType(toolId);

    console.log(`直接色指定更新開始: ${toolId}, 新色: ${newColor}, タイプ: ${toolType}`);

    if (toolType === 'pen') {
      // 1. 色を保存
      await this.saveToolColor(toolId, newColor);
      console.log(`色保存完了: ${toolId} = ${newColor}`);

      // 2. 色を直接指定してアイコン更新（getToolColorを使わない）
      await this.updateToolAppearanceWithColor(toolElement, toolId, newColor);
      console.log(`アイコン更新完了: ${toolId}`);

      // 3. アクティブツールの場合は下線も更新
      if (this.activeToolId === toolId) {
        await this.updateActiveToolUnderline();
      }

      console.log(`直接色指定更新完了: ${toolId} = ${newColor}`);
    }
  }
  async updateToolAppearanceWithColor(toolElement, toolId, specifiedColor) {
    const toolType = this.getSlotToolType(toolId);
    const keyHint = this.getKeyHint(toolId);

    console.log(`色指定外観更新: ${toolId}, 指定色: ${specifiedColor}, タイプ: ${toolType}`);

    toolElement.innerHTML = '';

    if (toolType === 'cursor') {
      const cursorImg = document.createElement('img');
      cursorImg.src = chrome.runtime.getURL('images/cursor.svg');
      cursorImg.className = 'slot-icon';
      cursorImg.alt = 'カーソル';

      toolElement.appendChild(cursorImg);
      toolElement.title = `カーソルモード (${keyHint})`;

    } else if (toolType === 'eraser-line') {
      const eraserImg = document.createElement('img');
      eraserImg.src = chrome.runtime.getURL('images/eraser-line.svg');
      eraserImg.className = 'slot-icon';
      eraserImg.alt = '消しゴム';

      toolElement.appendChild(eraserImg);
      toolElement.title = `消しゴム (${keyHint})`;

    } else {
      // ★ getToolColorを使わず、直接指定された色を使用
      console.log(`指定色でアイコン作成: ${specifiedColor}`);
      const penElement = await this.createColoredPenElement(specifiedColor);
      toolElement.appendChild(penElement);
      toolElement.title = `${this.getColorName(specifiedColor)}ペン (${keyHint})`;
    }

    const hint = document.createElement('span');
    hint.className = 'key-hint';
    hint.textContent = keyHint;
    toolElement.appendChild(hint);

    console.log(`色指定外観更新完了: ${toolId}`);
  }

  // カーソル用のペンSVG作成
  async createPenCursor() {
    try {
      const penSvgUrl = chrome.runtime.getURL('images/pen.svg');
      const response = await fetch(penSvgUrl);
      if (response.ok) {
        return penSvgUrl;
      } else {
        throw new Error('pen.svg not found');
      }
    } catch (error) {
      console.warn('ペンカーソル用pen.svgが見つかりません、デフォルトカーソルを使用:', error);
      return 'crosshair';
    }
  }

  // 初期化
  async initializeToolIcons() {
    console.log('ツールアイコン初期化開始');

    const toolElements = this.controlBar?.querySelectorAll('.slot-tool');

    if (toolElements) {
      for (const toolElement of toolElements) {
        const toolId = toolElement.dataset.tool;
        await this.updateToolAppearance(toolElement, toolId);
        console.log(`ツール ${toolId} 初期化完了`);
      }
    }

    console.log('全ツールアイコン初期化完了');
  }

  // スロットツールタイプ読み込み
  async loadSlotToolTypes() {
    console.log('スロットツールタイプ読み込み開始');

    try {
      const slotIds = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
      const keys = slotIds.map(id => `slot_tool_type_${id}`);
      const result = await chrome.storage.local.get(keys);

      for (const slotId of slotIds) {
        const key = `slot_tool_type_${slotId}`;
        let savedToolType = result[key];

        if (slotId === '0' && !savedToolType) {
          savedToolType = 'cursor';
        } else if (!savedToolType) {
          savedToolType = 'pen';
        }

        console.log(`スロット ${slotId}: ${savedToolType}`);

        const slotElement = this.controlBar?.querySelector(`[data-tool="${slotId}"]`);
        if (slotElement) {
          slotElement.dataset.toolType = savedToolType;
          await this.updateToolAppearance(slotElement, slotId);
        }

        await this.saveSlotToolType(slotId, savedToolType);
      }

      console.log('スロットツールタイプ読み込み完了');
    } catch (error) {
      console.error('スロットツールタイプ読み込みエラー:', error);
    }
  }

  // ツール色読み込み
  async loadToolColors() {
    console.log('ツール色読み込み開始');

    try {
      const toolIds = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

      for (const toolId of toolIds) {
        const toolElement = this.controlBar?.querySelector(`[data-tool="${toolId}"]`);
        if (toolElement) {
          await this.updateToolAppearance(toolElement, toolId);
          console.log(`ツール ${toolId} の色読み込み完了`);
        }
      }

      console.log('全ツール色読み込み完了');
    } catch (error) {
      console.error('ツール色読み込みエラー:', error);
    }
  }

  // スロットツールタイプ保存
  async saveSlotToolType(slotId, toolType) {
    try {
      const key = `slot_tool_type_${slotId}`;
      await chrome.storage.local.set({ [key]: toolType });
    } catch (error) {
      console.error('スロットツールタイプ保存エラー:', error);
    }
  }

  // ツール色取得
  async getToolColor(toolId) {
    try {
      const key = `tool_color_${toolId}`;
      const result = await chrome.storage.local.get([key]);

      if (result[key]) {
        return result[key];
      }

      const defaultColors = {
        '0': '#000000',  // 黒（パレット3行目6番目と一致）
        '1': '#ff0000',  // 赤（パレット1行目5番目と一致）
        '2': '#0080ff',  // 青（パレット1行目1番目と一致） ← 修正：#0000ff → #0080ff
        '3': '#ffff00',  // 黄（パレット1行目3番目と一致）
        '4': '#ffffff',  // 白（パレット3行目1番目と一致）
        '5': '#00c000',  // 緑（パレット1行目2番目と一致）
        '6': '#00ffff',  // シアン（パレット2行目1番目と一致）
        '7': '#ff00ff',  // マゼンタ（パレット1行目6番目と一致）
        '8': '#ff8000',  // オレンジ（パレット1行目4番目と一致）
        '9': '#808080'   // グレー → パレットにないため #999999に変更
      };

      return defaultColors[toolId] || '#000000';
    } catch (error) {
      console.error('ツール色取得エラー:', error);
      const defaultColors = {
        '0': '#000000',  '1': '#ff0000',  '2': '#0000ff',  '3': '#ffff00',  '4': '#ffffff',
        '5': '#00c000',  '6': '#00ffff',  '7': '#ff00ff',  '8': '#ff8000',  '9': '#808080'
      };
      return defaultColors[toolId] || '#000000';
    }
  }

  // ツール色保存
  async saveToolColor(toolId, color) {
    try {
      const key = `tool_color_${toolId}`;
      await chrome.storage.local.set({ [key]: color });
    } catch (error) {
      console.error('ツール色保存エラー:', error);
    }
  }

  // パレット選択状態更新
  updatePaletteSelection() {
    const palette = this.controlBar.querySelector('#colorPalette');
    if (!palette) return;

    const colorSwatches = palette.querySelectorAll('.color-swatch');
    const toolOptions = palette.querySelectorAll('.tool-option');

    colorSwatches.forEach(swatch => swatch.classList.remove('selected'));

    if (this.currentEditingTool && this.isPenTool(this.getSlotToolType(this.currentEditingTool.dataset.tool))) {
      const currentSwatch = palette.querySelector(`[data-color="${this.currentColor}"]`);
      if (currentSwatch) {
        currentSwatch.classList.add('selected');
      }
    }

    toolOptions.forEach(option => option.classList.remove('selected'));

    if (this.currentEditingTool) {
      const currentToolType = this.getSlotToolType(this.currentEditingTool.dataset.tool);
      const currentToolOption = palette.querySelector(`[data-tool-type="${currentToolType}"]`);
      if (currentToolOption) {
        currentToolOption.classList.add('selected');
      }
    }

    const opacitySlider = palette.querySelector('#opacitySlider');
    const opacityValue = palette.querySelector('#opacityValue');
    if (opacitySlider && opacityValue) {
      const opacityPercent = Math.round(this.currentOpacity * 100);
      opacitySlider.value = opacityPercent;
      opacityValue.textContent = opacityPercent + '%';
    }
  }

  // 色変更処理
  async changeColor(color) {
    this.currentColor = color;
    this.canvasManager.setColor(color);
    this.updateBarState();
    console.log(`タブ ${this.tabId} の色を ${color} に変更`);
  }

  setupChromeListeners() {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        try {
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
          }
        } catch (error) {
          console.error('メッセージ処理エラー:', error);
        }
      });
    }
  }

  // ----------------------------------------
  // デバッグ用メソッド（開発時のみ使用）
  // ----------------------------------------

  // 全SVGファイルの存在確認
  async checkAllPenSvgFiles() {
    const allColors = [
      '#0080ff', '#00c000', '#ffff00', '#ff8000', '#ff0000', '#ff00ff',
      '#00ffff', '#80ff80', '#ffff80', '#ffcc99', '#ffcccc', '#ffccff',
      '#ffffff', '#cccccc', '#999999', '#666666', '#333333', '#000000'
    ];

    const results = {};

    for (const color of allColors) {
      const fileName = this.getColorSvgFileName(color);
      const fileUrl = chrome.runtime.getURL(`images/${fileName}`);

      try {
        const response = await fetch(fileUrl, { method: 'HEAD' });
        results[color] = {
          fileName: fileName,
          exists: response.ok,
          status: response.status
        };
      } catch (error) {
        results[color] = {
          fileName: fileName,
          exists: false,
          error: error.message
        };
      }
    }

    console.table(results);
    return results;
  }

  // 必要なSVGファイル一覧出力
  generateSvgFileList() {
    const colors = [
      { color: '#0080ff', name: 'blue', fileName: 'pen-blue.svg' },
      { color: '#00c000', name: 'green', fileName: 'pen-green.svg' },
      { color: '#ffff00', name: 'yellow', fileName: 'pen-yellow.svg' },
      { color: '#ff8000', name: 'orange', fileName: 'pen-orange.svg' },
      { color: '#ff0000', name: 'red', fileName: 'pen-red.svg' },
      { color: '#ff00ff', name: 'magenta', fileName: 'pen-magenta.svg' },
      { color: '#00ffff', name: 'cyan', fileName: 'pen-cyan.svg' },
      { color: '#80ff80', name: 'lightgreen', fileName: 'pen-lightgreen.svg' },
      { color: '#ffff80', name: 'lightyellow', fileName: 'pen-lightyellow.svg' },
      { color: '#ffcc99', name: 'peach', fileName: 'pen-peach.svg' },
      { color: '#ffcccc', name: 'pink', fileName: 'pen-pink.svg' },
      { color: '#ffccff', name: 'lightmagenta', fileName: 'pen-lightmagenta.svg' },
      { color: '#ffffff', name: 'white', fileName: 'pen-white.svg' },
      { color: '#cccccc', name: 'lightgray', fileName: 'pen-lightgray.svg' },
      { color: '#999999', name: 'gray', fileName: 'pen-gray.svg' },
      { color: '#666666', name: 'darkgray', fileName: 'pen-darkgray.svg' },
      { color: '#333333', name: 'charcoal', fileName: 'pen-charcoal.svg' },
      { color: '#000000', name: 'black', fileName: 'pen-black.svg' }
    ];

    console.log('=== 作成が必要なSVGファイル一覧 ===');
    colors.forEach(({ color, name, fileName }) => {
      console.log(`${fileName} (${color}) - ${name}`);
    });

    return colors;
  }
  // ----------------------------------------
  // 4. WebSocket関連
  // ----------------------------------------

  handleLocalDraw(drawData) {
    // 描画操作を履歴に追加（自分の操作のみ）
    if (drawData.type === 'stroke' && drawData.stroke) {
      this.addToHistory({
        type: 'stroke',
        stroke: drawData.stroke,
        timestamp: Date.now(),
        isLocal: true
      });
      this.updateUndoRedoButtons();
    }

    // 消しゴム処理
    if (drawData.type === 'erase' && drawData.strokeId) {
      console.log('消しゴム操作を検出:', drawData.strokeId);

      this.addToHistory({
        type: 'erase',
        strokeId: drawData.strokeId,
        stroke: drawData.stroke,
        timestamp: Date.now(),
        isLocal: true
      });
      this.updateUndoRedoButtons();
    }

    if (!this.wsManager.isConnected()) {
      console.log('WebSocket未接続のためローカルストレージに保存');
      this.saveToLocalStorage(drawData);
      return;
    }

    if (drawData.type === 'stroke') {
      const payload = {
        action: 'drawData',
        roomId: this.currentRoom,
        id: drawData.stroke.id,
        points: drawData.stroke.points,
        color: drawData.stroke.color,
        opacity: drawData.stroke.opacity,
        startTime: drawData.stroke.startTime
      };
      console.log('描画データ送信:', payload);
      this.wsManager.send(payload);
    }

    // 既存のremoveStrokeアクションを使用（サーバー互換性）
    if (drawData.type === 'erase') {
      const payload = {
        action: 'removeStroke',  // removeStroke に変更
        roomId: this.currentRoom,
        strokeId: drawData.strokeId
      };
      console.log('消しゴムデータ送信（removeStroke）:', payload);
      this.wsManager.send(payload);
    }
  }

  // ★ デバッグ用：受信メッセージの詳細ログ
  handleWebSocketMessage(message) {
    console.log('=== 受信メッセージ詳細 ===');
    console.log('Type:', message.type);
    console.log('Full message:', message);
    console.log('========================');

    switch (message.type) {
      case 'roomJoined':
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
          console.log('線描画開始:', strokeData.points.length, '点');
          this.canvasManager.drawReceivedStroke(strokeData);
          console.log('線描画完了');
        }
        break;

      // ★ 修正：複数のメッセージタイプに対応
      case 'removeStroke':
      case 'eraseStroke':
      case 'strokeRemoved':  // サーバーによってはこの形式
        console.log('=== 消しゴムメッセージ受信 ===');
        console.log('Message type:', message.type);
        console.log('Message data:', message);

        const strokeId = message.strokeId || message.data?.strokeId || message.id;
        console.log('削除対象ストロークID:', strokeId);

        if (strokeId) {
          this.handleRemoteStrokeRemoval(strokeId);
        } else {
          console.warn('ストロークIDが見つかりません:', message);
        }
        console.log('=========================');
        break;

      case 'clearCanvas':
        console.log('キャンバスクリア受信');
        const previousState = this.canvasManager.getCanvasState();
        this.canvasManager.clear();
        this.addToHistory({
          type: 'clear',
          previousState: previousState,
          timestamp: Date.now(),
          fromRemote: true
        });
        break;

      default:
        console.warn('未知のメッセージタイプ:', message.type, message);
    }
  }


  handleConnectionStatusChange(status) {
    console.log('接続ステータス変更:', status);
    this.updateBarState();
  }
  // ----------------------------------------
  // 5. 機能別メソッド
  // ----------------------------------------

  // 描画設定
  async changeOpacity(opacity) {
    this.currentOpacity = opacity;
    this.canvasManager.setOpacity(opacity);
    this.updateBarState();
  }

  async toggleDrawing(enabled) {
    this.isDrawingEnabled = enabled;
    this.canvasManager.setEnabled(enabled);

    try {
      await chrome.storage.local.set({ isDrawingEnabled: enabled });
    } catch (error) {
    }

    this.updateBarState();
  }

  // 白紙ページ作成
  async createNewPage() {
    try {
      const webURL = 'https://nishiwak1.github.io/webpen/?webpen=true';

      chrome.runtime.sendMessage({
        type: 'CREATE_NEW_TAB',
        url: webURL
      });
    } catch (error) {
      console.error('新規ページ作成エラー:', error);
    }
  }

  clearCanvas() {
    // クリア前の状態を保存（全員の線が消える）
    const previousState = this.canvasManager.getCanvasState();

    // クリア操作を履歴に追加
    this.addToHistory({
      type: 'clear',
      previousState: previousState,
      timestamp: Date.now(),
      isLocal: true
    });

    // キャンバスをクリア（全員の線を削除）
    this.canvasManager.clear();

    // Redoスタックもクリア（クリア後は復元できない）
    this.redoStack = [];

    // ボタン状態を更新
    this.updateUndoRedoButtons();

    if (this.wsManager.isConnected()) {
      this.wsManager.send({
        action: 'clearCanvas',
        roomId: this.currentRoom
      });
    }
  }

  // 部屋管理
  async joinRoom(roomCode) {
    if (roomCode.length !== 8) {
      alert('8桁のコードを入力してください');
      return;
    }

    this.currentRoom = roomCode;
    this.wsManager.connect(roomCode);
    this.updateBarState();

    console.log(`タブ ${this.tabId} が部屋 ${roomCode} に参加`);
  }

  async leaveRoom() {
    this.wsManager.disconnect();
    this.currentRoom = null;
    this.userCount = 0;
    this.updateBarState();
    console.log(`タブ ${this.tabId} が部屋から退出`);
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // ----------------------------------------
  // 6. 履歴管理（Undo/Redo）
  // ----------------------------------------

  addToHistory(action) {
    // 現在の位置より後の履歴を削除（新しい分岐を作成）
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }

    // Redoスタックをクリア（新しい操作が入ったらRedoはリセット）
    this.redoStack = [];

    // 新しい操作を追加
    this.history.push(action);

    // 履歴サイズの制限
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    } else {
      this.historyIndex++;
    }

    // Undo/Redoボタンの状態を更新
    this.updateUndoRedoButtons();
  }

  // Undo処理（自分の操作のみ）
  handleUndo() {
    // 自分の最後のストロークを削除
    const removedStroke = this.canvasManager.undoMyLastStroke();

    if (removedStroke) {
      console.log('Undo実行: 自分のストロークを削除');

      // Redoスタックに追加
      this.redoStack.push({
        type: 'stroke',
        stroke: removedStroke
      });

      // 履歴からも削除（自分のストロークのみ）
      for (let i = this.history.length - 1; i >= 0; i--) {
        if (this.history[i].type === 'stroke' &&
          this.history[i].stroke.id === removedStroke.id) {
          this.history.splice(i, 1);
          if (this.historyIndex >= i) {
            this.historyIndex--;
          }
          break;
        }
      }

      // Undo/Redoボタンの状態を更新
      this.updateUndoRedoButtons();

      // 他のユーザーに通知（自分の線が消えたことを伝える）
      if (this.wsManager.isConnected()) {
        this.wsManager.send({
          action: 'removeStroke',
          roomId: this.currentRoom,
          strokeId: removedStroke.id
        });
      }
    } else {
      console.log('Undo: 削除できる自分のストロークがありません');
    }
  }

  // Redo処理（自分の操作のみ）
  handleRedo() {
    if (this.redoStack.length === 0) {
      console.log('Redo: Redoスタックが空です');
      return;
    }

    // Redoスタックから操作を取り出す
    const actionToRedo = this.redoStack.pop();
    console.log('Redo実行:', actionToRedo.type);

    if (actionToRedo.type === 'stroke' && actionToRedo.stroke) {
      // ストロークを復元
      this.canvasManager.redoStroke(actionToRedo.stroke);

      // 履歴に戻す
      this.history.push({
        type: 'stroke',
        stroke: actionToRedo.stroke,
        timestamp: Date.now()
      });
      this.historyIndex = this.history.length - 1;

      // 他のユーザーに通知（線が復活したことを伝える）
      if (this.wsManager.isConnected()) {
        this.wsManager.send({
          action: 'drawData',
          roomId: this.currentRoom,
          id: actionToRedo.stroke.id,
          points: actionToRedo.stroke.points,
          color: actionToRedo.stroke.color,
          opacity: actionToRedo.stroke.opacity,
          startTime: actionToRedo.stroke.startTime
        });
      }
    }

    // Undo/Redoボタンの状態を更新
    this.updateUndoRedoButtons();
  }

  // キャンバスを履歴から再構築
  rebuildCanvas() {
    console.log('キャンバス再構築開始 - 履歴位置:', this.historyIndex + 1);

    // キャンバスをクリア
    this.canvasManager.clear();

    // 現在の履歴位置までの操作を再実行
    for (let i = 0; i <= this.historyIndex; i++) {
      const action = this.history[i];

      switch (action.type) {
        case 'stroke':
          // ストロークを再描画
          this.canvasManager.drawReceivedStroke(action.stroke);
          break;
        case 'clear':
          // キャンバスをクリア
          this.canvasManager.clear();
          break;
      }
    }

    console.log('キャンバス再構築完了');
  }

  handleRemoteUndo() {
    // リモートからのUndoは単純に最後の操作を取り消す
    if (this.history.length > 0 && this.historyIndex >= 0) {
      const lastAction = this.history[this.historyIndex];

      // リモートからの操作の場合のみ処理
      if (lastAction.fromRemote) {
        this.redoStack.push(lastAction);
        this.historyIndex--;
        this.rebuildCanvas();
        this.updateUndoRedoButtons();
      }
    }
  }

  // リモートからのRedo処理
  handleRemoteRedo() {
    // リモートからのRedoはRedoスタックから復元
    if (this.redoStack.length > 0) {
      const actionToRedo = this.redoStack.pop();

      // リモートからの操作の場合のみ処理
      if (actionToRedo.fromRemote) {
        this.historyIndex++;
        this.history[this.historyIndex] = actionToRedo;

        switch (actionToRedo.type) {
          case 'stroke':
            this.canvasManager.drawReceivedStroke(actionToRedo.stroke);
            break;
          case 'clear':
            this.canvasManager.clear();
            break;
        }

        this.updateUndoRedoButtons();
      }
    }
  }

  // リモートからのストローク削除処理
  handleRemoteStrokeRemoval(strokeId) {
    console.log('=== リモートストローク削除開始 ===');
    console.log('削除対象ID:', strokeId);
    console.log('現在のストローク数:', this.canvasManager.strokes.length);
    console.log('自分のストローク数:', this.canvasManager.myStrokeIds.size);

    let found = false;
    let isMyStroke = false;

    // 削除前にストロークの詳細を確認
    for (let i = 0; i < this.canvasManager.strokes.length; i++) {
      const stroke = this.canvasManager.strokes[i];
      if (stroke.id === strokeId) {
        console.log('対象ストローク発見:', {
          id: stroke.id,
          color: stroke.color,
          points: stroke.points.length,
          isMyStroke: this.canvasManager.myStrokeIds.has(strokeId)
        });
        break;
      }
    }

    // キャンバスマネージャーのストローク配列から削除
    for (let i = this.canvasManager.strokes.length - 1; i >= 0; i--) {
      if (this.canvasManager.strokes[i].id === strokeId) {
        // 自分のストロークかどうか確認
        isMyStroke = this.canvasManager.myStrokeIds.has(strokeId);

        if (!isMyStroke) {
          const removedStroke = this.canvasManager.strokes.splice(i, 1)[0];
          console.log('リモートストローク削除実行:', {
            id: strokeId,
            removedStroke: removedStroke,
            remainingStrokes: this.canvasManager.strokes.length
          });
          found = true;
          break;
        } else {
          console.log('自分のストロークのため削除をスキップ:', strokeId);
          return; // 早期リターン
        }
      }
    }

    if (found) {
      // キャンバスを再描画
      console.log('キャンバス再描画実行');
      this.canvasManager.redrawAllStrokes();

      // 履歴に追加（リモートからの削除）
      this.addToHistory({
        type: 'remoteErase',
        strokeId: strokeId,
        timestamp: Date.now(),
        fromRemote: true
      });

      console.log('リモートストローク削除完了');
    } else {
      console.warn('削除対象ストロークが見つからない:', strokeId);
      console.log('現在のストロークID一覧:',
        this.canvasManager.strokes.map(s => s.id));
    }

    console.log('=== リモートストローク削除終了 ===');
  }

  // Undo/Redoボタンの有効/無効を更新
  updateUndoRedoButtons() {
    const undoBtn = this.controlBar?.querySelector('#undo-btn');
    const redoBtn = this.controlBar?.querySelector('#redo-btn');

    if (undoBtn) {
      const canUndo = this.historyIndex >= 0;
      undoBtn.disabled = !canUndo;
      undoBtn.style.opacity = canUndo ? '1' : '0.5';
      undoBtn.style.cursor = canUndo ? 'pointer' : 'not-allowed';

      // ツールチップを追加
      undoBtn.title = canUndo ? 'ひとつ戻る (Ctrl+Z)' : '戻る操作がありません';
    }

    if (redoBtn) {
      const canRedo = this.redoStack.length > 0;
      redoBtn.disabled = !canRedo;
      redoBtn.style.opacity = canRedo ? '1' : '0.5';
      redoBtn.style.cursor = canRedo ? 'pointer' : 'not-allowed';

      // ツールチップを追加
      redoBtn.title = canRedo ? 'やり直す (Ctrl+Shift+Z)' : 'やり直す操作がありません';
    }
  }

  // ----------------------------------------
  // 7. その他
  // ----------------------------------------

  // ローカルストレージ保存（タブ固有のキーを使用）
  saveToLocalStorage(data) {
    if (!this.currentRoom) return;

    try {
      const key = `drawing_${this.currentRoom}_${this.tabId}`;
      chrome.storage.local.get([key], (result) => {
        const drawings = result[key] || [];
        drawings.push({ ...data, timestamp: Date.now() });

        if (drawings.length > 1000) {
          drawings.splice(0, drawings.length - 1000);
        }

        chrome.storage.local.set({ [key]: drawings });
      });
    } catch (error) {
      console.error('ローカルストレージ保存エラー:', error);
    }
  }
}

// 初期化処理（重複宣言を防ぐ）
if (!window.sharedDrawingInstance) {
  const initializeExtension = () => {
    try {
      if (!window.sharedDrawingInstance) {
        window.sharedDrawingInstance = new SharedDrawing();
      }
    } catch (error) {
      console.error('拡張機能初期化エラー:', error);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExtension);
    setTimeout(initializeExtension, 1000);
  } else {
    initializeExtension();
  }
}