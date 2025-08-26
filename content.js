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
      // グローバル設定を読み込み（UI表示状態 + 描画モード）
      const result = await chrome.storage.local.get(['isBarVisible', 'isDrawingEnabled']);

      this.isBarVisible = result.isBarVisible !== false;
      this.isDrawingEnabled = result.isDrawingEnabled !== false;

      // UIが非表示なら描画をOFF
      if (!this.isBarVisible) {
        this.isDrawingEnabled = false;
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

      // ★ ツール色をロード（保存された色を復元）
      await this.loadToolColors();

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

    const expandedContent = this.controlBar.querySelector('#expanded-content');
    const minimizedContent = this.controlBar.querySelector('#minimized-content');
    const currentRoomCode = this.controlBar.querySelector('#current-room-code');

    // 展開/最小化の表示切り替え
    if (expandedContent && minimizedContent) {
      if (this.isBarVisible) {
        expandedContent.classList.remove('hidden');
        minimizedContent.classList.add('hidden');
      } else {
        expandedContent.classList.add('hidden');
        minimizedContent.classList.add('hidden');
      }
    }

    // ★ ツールボタンの状態更新（修正版：ツールIDベースで判定）
    const toolBtns = this.controlBar.querySelectorAll('.slot-tool');
    toolBtns.forEach(btn => {
      const toolId = btn.dataset.tool;
      const toolType = this.getSlotToolType(toolId);
      let isActive = false;

      if (toolType === 'cursor') {
        // カーソルツールは描画が無効の時にアクティブ
        isActive = !this.isDrawingEnabled && this.activeToolId === toolId;
      } else {
        // ペンツールは描画が有効で、かつそのツールがアクティブな時にアクティブ
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

    try {
      await chrome.storage.local.set({ isBarVisible: visible });
    } catch (error) {
      console.error('ストレージ保存エラー:', error);
    }

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

  async syncUIState(isBarVisible) {
    console.log('UI状態同期受信:', this.isBarVisible, '->', isBarVisible);

    try {
      const result = await chrome.storage.local.get(['isDrawingEnabled']);
      const latestDrawingMode = result.isDrawingEnabled !== false;

      if (this.isBarVisible !== isBarVisible || this.isDrawingEnabled !== latestDrawingMode) {
        this.isBarVisible = isBarVisible;
        this.isDrawingEnabled = latestDrawingMode;

        if (!this.isBarVisible) {
          this.isDrawingEnabled = false;
        }

        this.canvasManager.setEnabled(this.isDrawingEnabled);

        if (isBarVisible) {
          this.createControlBar();
          if (this.drawingStateBeforeMinimize !== null) {
            await this.toggleDrawing(this.drawingStateBeforeMinimize);
            this.drawingStateBeforeMinimize = null;
          }
        } else {
          this.drawingStateBeforeMinimize = this.isDrawingEnabled;
          await this.toggleDrawing(false);
          if (this.controlBar) {
            this.controlBar.remove();
            this.controlBar = null;
          }
        }

        this.updateBodyPadding();

        if (this.controlBar) {
          this.updateBarState();
        }

        console.log('UI状態同期完了:', isBarVisible);
      }
    } catch (error) {
      console.error('UI状態同期エラー:', error);
    }
  }

  // ----------------------------------------
  // 3. イベント設定
  // ----------------------------------------
  setupControlBarEvents() {
    const self = this;

    // ツールボタン（新しいツールパレットシステム）
    const toolBtns = self.controlBar.querySelectorAll('.slot-tool');
    toolBtns.forEach(btn => {
      // 左クリック処理（修正版）
      btn.addEventListener('click', async (e) => { // ★ asyncを追加
        e.preventDefault();
        e.stopPropagation();

        const toolId = btn.dataset.tool;

        // ★ 保存されているツールタイプを確認
        const currentToolType = this.getSlotToolType(toolId);
        console.log(`左クリック - ツール${toolId} - タイプ: ${currentToolType}`);

        if (currentToolType === 'cursor') {
          // カーソルツール：描画を無効にする
          self.setActiveTool(toolId);
          // setActiveToolで既に描画モード設定済み
        } else {
          // ペンツール：上書きされた色または初期色を使用
          const toolColor = await self.getToolColor(toolId);

          // アクティブツールを設定
          self.setActiveTool(toolId);
          // setActiveToolで既に描画モード設定済みだが、念のため色を再適用
          self.changeColor(toolColor);
        }
      });

      // 右クリック処理（既存のまま）
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // ★ 右クリック時に即座にそのスロットをアクティブ化
        const toolId = btn.dataset.tool;
        const toolType = this.getSlotToolType(toolId);

        // スロットをアクティブに設定
        this.setActiveTool(toolId);

        // ツールタイプに応じて描画モードを調整
        if (toolType === 'cursor') {
          this.toggleDrawing(false);
        } else {
          this.toggleDrawing(true);
          // ペンツールの場合は現在の色を適用
          this.getToolColor(toolId).then(color => {
            this.changeColor(color);
          });
        }

        // パレットを表示
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

    // 描画切り替えボタン
    const toggleDrawButton = self.controlBar.querySelector('#toggle-draw-btn');
    if (toggleDrawButton) {
      toggleDrawButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (!self.isBarVisible) {
          return;
        }

        self.toggleDrawing(!self.isDrawingEnabled);
      });
    }

    // 色選択ボタン
    const colorBtns = self.controlBar.querySelectorAll('.color-btn');
    colorBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        self.changeColor(btn.dataset.color);
      });
    });

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
        // バーを非表示にして、線も非表示に
        self.toggleBarVisibility(false);
      });
    }

    // キーボードショートカット
    document.addEventListener('keydown', (e) => {
      // Ctrl+Z または Cmd+Z でUndo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        self.handleUndo();
      }
      // Ctrl+Shift+Z または Cmd+Shift+Z でRedo
      else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        self.handleRedo();
      }
      // Ctrl+Y または Cmd+Y でもRedo
      else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        self.handleRedo();
      }
    });
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

    // カラースウォッチ選択（色変更実装 + ツール上書き）
    colorSwatches.forEach(swatch => {
      swatch.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const selectedColor = swatch.dataset.color;
        console.log('Color selected:', selectedColor);

        // ★ ペンツールの場合のみ色変更を適用
        if (this.currentEditingTool && this.getSlotToolType(this.currentEditingTool.dataset.tool) === 'pen') {
          // 既存の選択を解除
          colorSwatches.forEach(el => el.classList.remove('selected'));

          // 新しい選択を追加
          swatch.classList.add('selected');

          const toolId = this.currentEditingTool.dataset.tool;
          this.updateToolColor(this.currentEditingTool, selectedColor);

          // ★ そのツールをアクティブに設定
          this.setActiveTool(toolId);

          // 実際に色を変更
          this.changeColor(selectedColor);

          // 描画モードを有効にする（色を選択したら描画可能に）
          if (!this.isDrawingEnabled) {
            this.toggleDrawing(true);
          }

          // パレットを閉じる（色選択後）
          setTimeout(() => {
            this.hideColorPalette();
          }, 150);
        }
      });
    });

    // ★ ツールオプション選択（新機能）
    const toolOptions = palette.querySelectorAll('.tool-option');
    toolOptions.forEach(option => {
      option.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const toolType = option.dataset.toolType;
        console.log('Tool selected:', toolType);

        if (this.currentEditingTool) {
          const toolId = this.currentEditingTool.dataset.tool;

          // 既存の選択を解除
          toolOptions.forEach(el => el.classList.remove('selected'));

          // 新しい選択を追加
          option.classList.add('selected');

          // スロットのツールタイプを変更
          await this.setSlotToolType(toolId, toolType);

          // そのツールをアクティブに設定
          this.setActiveTool(toolId);

          // カーソルツールの場合は描画を無効に、ペンツールの場合は有効に
          if (toolType === 'cursor') {
            this.toggleDrawing(false);
          } else {
            this.toggleDrawing(true);
            // ペンツールの場合は現在の色を取得して適用
            const toolColor = await this.getToolColor(toolId);
            this.changeColor(toolColor);
          }

          // パレットを閉じる（ツール選択後）
          setTimeout(() => {
            this.hideColorPalette();
          }, 150);
        }
      });
    });

    // スライダー値の更新（表示のみ - 機能は実装しない）
    if (opacitySlider && opacityValue) {
      opacitySlider.addEventListener('input', () => {
        opacityValue.textContent = opacitySlider.value + '%';
        console.log('Opacity changed:', opacitySlider.value);
        // 透明度変更は実装しない
      });
    }

    if (penSizeSlider && penSizeValue) {
      penSizeSlider.addEventListener('input', () => {
        penSizeValue.textContent = penSizeSlider.value + 'px';
        console.log('Pen size changed:', penSizeSlider.value);
        // ペンサイズ変更は実装しない
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

  // ★ アクティブツールを設定
  setActiveTool(toolId) {
    console.log(`=== setActiveTool 呼び出し ===`);
    console.log(`設定対象ツール: ${toolId}`);
    console.log(`呼び出し元:`, new Error().stack.split('\n')[2]);

    this.activeToolId = toolId;

    // ★ ツールタイプを取得して描画モードを適切に設定
    const toolType = this.getSlotToolType(toolId);
    console.log(`ツールタイプ: ${toolType}`);

    if (toolType === 'cursor') {
      // カーソルツールの場合は描画を無効に
      this.toggleDrawing(false);
      console.log('カーソルツールのため描画モードOFF');
    } else {
      // ペンツールの場合は描画を有効にして色を適用
      this.toggleDrawing(true);
      this.getToolColor(toolId).then(color => {
        this.changeColor(color);
        console.log(`ペンツールのため描画モードON、色: ${color}`);
      });
    }

    console.log(`最終的なactiveToolId: ${this.activeToolId}`);

    // バー状態を更新（これによりアクティブ表示が変わる）
    this.updateBarState();

    // ★ アクティブツールの下線を更新
    this.updateActiveToolUnderline();

    console.log(`=== setActiveTool 完了 ===`);
  }

  // ★ アクティブツールの下線を更新
  async updateActiveToolUnderline() {
    if (!this.controlBar) return;

    const toolBtns = this.controlBar.querySelectorAll('.slot-tool');

    // 全ての下線をリセット
    toolBtns.forEach(btn => {
      btn.style.borderBottom = '';
      btn.style.boxShadow = '';
    });

    // アクティブツールに下線を表示
    if (this.activeToolId && this.activeToolId !== 'cursor' && this.isDrawingEnabled) {
      const activeBtn = this.controlBar.querySelector(`[data-tool="${this.activeToolId}"]`);
      if (activeBtn) {
        // そのツールの現在の色を取得
        const toolColor = await this.getToolColor(this.activeToolId);

        // 下線とシャドウで色を表示
        activeBtn.style.borderBottom = `3px solid ${toolColor}`;
        activeBtn.style.boxShadow = `inset 0 -3px 0 ${toolColor}`;

        console.log(`ツール ${this.activeToolId} に下線表示 (${toolColor})`);
      }
    }
  }

  // カラーパレットを表示
  showColorPalette(event, toolBtn) {
    const palette = this.controlBar.querySelector('#colorPalette');
    if (!palette) return;

    // 現在編集中のツールを記録
    this.currentEditingTool = toolBtn;

    palette.style.display = 'block';

    // クリック位置に表示（画面端での調整付き）
    let x = event.clientX;
    let y = event.clientY;

    // 画面右端チェック
    if (x + 280 > window.innerWidth) {
      x = window.innerWidth - 290;
    }

    // 画面下端チェック
    if (y + 350 > window.innerHeight) {  // ★ 高さを350pxに調整（TOOLセクション追加分）
      y = window.innerHeight - 360;
    }

    palette.style.position = 'fixed';
    palette.style.top = y + 'px';
    palette.style.left = x + 'px';

    // ★ 現在の選択状態を更新（色とツール両方）
    this.updatePaletteSelection();

    console.log('カラーパレット表示:', toolBtn.dataset.tool);
  }

  // カラーパレットを非表示
  hideColorPalette() {
    const palette = this.controlBar.querySelector('#colorPalette');
    if (palette) {
      palette.style.display = 'none';
    }
    // 編集中のツール情報をクリア
    this.currentEditingTool = null;
  }

  // ツールの色を更新（見た目とデータ）
  updateToolColor(toolElement, newColor) {
    const toolId = toolElement.dataset.tool;

    // ★ ペンツールの場合のみ色を更新
    if (this.getSlotToolType(toolId) === 'pen') {
      // ツール内のカラーインジケーターを更新
      const indicator = toolElement.querySelector('.tool-indicator');
      if (indicator) {
        indicator.style.background = newColor;

        // 白色の場合は枠を追加
        if (newColor === '#ffffff') {
          indicator.style.border = '1px solid #666';
        } else {
          indicator.style.border = 'none';
        }
      }

      // CSS変数を更新（アクティブ時の下線色）
      toolElement.style.setProperty('--tool-color', newColor);

      // ツール色データを保存（ローカルストレージ）
      this.saveToolColor(toolId, newColor);
    }

    // ★ 現在アクティブなツールの場合は下線も更新
    if (this.activeToolId === toolId) {
      this.updateActiveToolUnderline();
    }

    console.log(`ツール ${toolId} の色を ${newColor} に更新`);
  }

  // ★ スロットのツールタイプを取得
  getSlotToolType(slotId) {
    try {
      const slotElement = this.controlBar?.querySelector(`[data-tool="${slotId}"]`);
      if (!slotElement) {
        console.log(`getSlotToolType エラー: 要素が見つからない (${slotId})`);
        return 'pen';
      }

      const toolType = slotElement.dataset.toolType || 'pen';

      // ★ デバッグログ追加
      console.log(`getSlotToolType(${slotId}): ${toolType} [element:`, slotElement, ']');
      console.log(`data-tool-type属性値:`, slotElement.getAttribute('data-tool-type'));

      return toolType;
    } catch (error) {
      console.log(`getSlotToolType エラー (${slotId}):`, error);
      return 'pen';
    }
  }

  // ★ スロットのツールタイプを設定
  async setSlotToolType(slotId, toolType) {
    const slotElement = this.controlBar?.querySelector(`[data-tool="${slotId}"]`);
    if (!slotElement) return;

    // ★ データ属性を更新（重要：HTMLレベルで更新）
    slotElement.dataset.toolType = toolType;

    if (toolType === 'cursor') {
      // カーソルツールに変更
      slotElement.innerHTML = `
        <img src="${chrome.runtime.getURL('images/cursor.svg')}" class="slot-icon" alt="カーソル">
        <span class="key-hint">${this.getKeyHint(slotId)}</span>
      `;
      slotElement.title = `カーソルモード (${this.getKeyHint(slotId)})`;
    } else {
      // ペンツールに変更
      const savedColor = await this.getToolColor(slotId);
      slotElement.innerHTML = `
        <span class="tool-indicator" style="background: ${savedColor}${savedColor === '#ffffff' ? '; border: 1px solid #666' : ''};"></span>
        <span class="key-hint">${this.getKeyHint(slotId)}</span>
      `;
      slotElement.title = `${this.getColorName(savedColor)}ペン (${this.getKeyHint(slotId)})`;
    }

    // ローカルストレージに保存
    await this.saveSlotToolType(slotId, toolType);

    // ★ 保存確認ログ
    console.log(`スロット ${slotId} を ${toolType} に変更 - HTML更新完了`);
    console.log(`data-tool-type: ${slotElement.dataset.toolType}`);
  }

  // ★ キーヒントを取得
  getKeyHint(slotId) {
    const keyMap = {
      '0': '1', '1': '2', '2': '3', '3': '4', '4': '5',
      '5': '6', '6': '7', '7': '8', '8': '9', '9': '`'
    };
    return keyMap[slotId] || '';
  }

  // ★ 色の名前を取得
  getColorName(color) {
    const colorNames = {
      '#000000': '黒', '#ff0000': '赤', '#0000ff': '青',
      '#ffff00': '黄', '#ffffff': '白', '#00c000': '緑',
      '#00ffff': 'シアン', '#ff00ff': 'マゼンタ',
      '#ff8000': 'オレンジ', '#808080': 'グレー'
    };
    return colorNames[color] || '色付き';
  }

  // ★ スロットツールタイプを保存
  async saveSlotToolType(slotId, toolType) {
    try {
      const key = `slot_tool_type_${slotId}`;
      await chrome.storage.local.set({ [key]: toolType });
    } catch (error) {
      console.error('スロットツールタイプ保存エラー:', error);
    }
  }

  // ★ スロットツールタイプを読み込み
  async loadSlotToolTypes() {
    try {
      const slotIds = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
      const keys = slotIds.map(id => `slot_tool_type_${id}`);
      const result = await chrome.storage.local.get(keys);

      // 各スロットの保存されたツールタイプを適用
      for (const slotId of slotIds) {
        const key = `slot_tool_type_${slotId}`;
        let savedToolType = result[key];

        // ★ スロット0の初期設定：保存データがない場合はカーソルに設定
        if (slotId === '0' && !savedToolType) {
          savedToolType = 'cursor';
        } else if (!savedToolType) {
          savedToolType = 'pen'; // 他のスロットはデフォルトでペン
        }

        await this.setSlotToolType(slotId, savedToolType);
      }
    } catch (error) {
      console.error('スロットツールタイプ読み込みエラー:', error);
    }
  }

  // ツールの現在の色を取得（上書きされた色または初期色）
  async getToolColor(toolId) {
    try {
      const key = `tool_color_${toolId}`;
      const result = await chrome.storage.local.get([key]);

      // 上書きされた色があればそれを返す
      if (result[key]) {
        return result[key];
      }

      // なければ初期色を返す
      const defaultColors = {
        '0': '#000000',  // 黒
        '1': '#ff0000',  // 赤
        '2': '#0000ff',  // 青
        '3': '#ffff00',  // 黄
        '4': '#ffffff',  // 白
        '5': '#00c000',  // 緑
        '6': '#00ffff',  // シアン
        '7': '#ff00ff',  // マゼンタ
        '8': '#ff8000',  // オレンジ
        '9': '#808080'   // グレー
      };

      return defaultColors[toolId] || '#000000';
    } catch (error) {
      console.error('ツール色取得エラー:', error);
      // エラー時は初期色を返す
      const defaultColors = {
        '0': '#000000',  // 黒
        '1': '#ff0000',  // 赤
        '2': '#0000ff',  // 青
        '3': '#ffff00',  // 黄
        '4': '#ffffff',  // 白
        '5': '#00c000',  // 緑
        '6': '#00ffff',  // シアン
        '7': '#ff00ff',  // マゼンタ
        '8': '#ff8000',  // オレンジ
        '9': '#808080'   // グレー
      };
      return defaultColors[toolId] || '#000000';
    }
  }

  // ツール色をローカルストレージに保存
  async saveToolColor(toolId, color) {
    try {
      const key = `tool_color_${toolId}`;
      await chrome.storage.local.set({ [key]: color });
    } catch (error) {
      console.error('ツール色保存エラー:', error);
    }
  }

  // ツール色をローカルストレージから読み込み
  async loadToolColors() {
    try {
      const toolIds = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
      const keys = toolIds.map(id => `tool_color_${id}`);
      const result = await chrome.storage.local.get(keys);

      // 各ツールの保存された色を適用
      toolIds.forEach(toolId => {
        const key = `tool_color_${toolId}`;
        const savedColor = result[key];

        if (savedColor) {
          const toolElement = this.controlBar?.querySelector(`[data-tool="${toolId}"]`);
          if (toolElement) {
            this.updateToolColor(toolElement, savedColor);
          }
        }
      });
    } catch (error) {
      console.error('ツール色読み込みエラー:', error);
    }
  }

  // パレットの選択状態を更新
  updatePaletteSelection() {
    const palette = this.controlBar.querySelector('#colorPalette');
    if (!palette) return;

    const colorSwatches = palette.querySelectorAll('.color-swatch');
    const toolOptions = palette.querySelectorAll('.tool-option');

    // ★ 色の選択状態を更新（ペンツールの場合のみ）
    colorSwatches.forEach(swatch => swatch.classList.remove('selected'));

    if (this.currentEditingTool && this.getSlotToolType(this.currentEditingTool.dataset.tool) === 'pen') {
      const currentSwatch = palette.querySelector(`[data-color="${this.currentColor}"]`);
      if (currentSwatch) {
        currentSwatch.classList.add('selected');
      }
    }

    // ★ ツールの選択状態を更新
    toolOptions.forEach(option => option.classList.remove('selected'));

    if (this.currentEditingTool) {
      const currentToolType = this.getSlotToolType(this.currentEditingTool.dataset.tool);
      const currentToolOption = palette.querySelector(`[data-tool-type="${currentToolType}"]`);
      if (currentToolOption) {
        currentToolOption.classList.add('selected');
      }
    }

    // スライダーの値も更新（表示のみ）
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

    // ツールバーの状態を更新（既存ツールとのアクティブ連動は行わない）
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
            case 'SYNC_UI_STATE':
              this.syncUIState(message.isBarVisible);
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
  // 4. WebSocket関連
  // ----------------------------------------

  handleLocalDraw(drawData) {
    // 描画操作を履歴に追加（自分の操作のみ）
    if (drawData.type === 'stroke' && drawData.stroke) {
      this.addToHistory({
        type: 'stroke',
        stroke: drawData.stroke,
        timestamp: Date.now(),
        isLocal: true  // 自分の操作であることを明示
      });

      // Undo/Redoボタンの状態を更新
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
        id: drawData.stroke.id,  // ストロークIDを送信
        points: drawData.stroke.points,
        color: drawData.stroke.color,
        opacity: drawData.stroke.opacity,
        startTime: drawData.stroke.startTime
      };
      console.log('送信データ:', payload);
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
          console.log('線描画開始:', strokeData.points.length, '点');

          // 他のユーザーの描画として処理（履歴には追加しない）
          this.canvasManager.drawReceivedStroke(strokeData);
          console.log('線描画完了');
        }
        break;

      case 'removeStroke':
        console.log('ストローク削除受信:', message.strokeId);
        // 他のユーザーが自分の線を削除した場合の処理
        // 該当するストロークを探して削除（ただし、他人の線は削除しない）
        this.handleRemoteStrokeRemoval(message.strokeId);
        break;

      case 'clearCanvas':
        console.log('キャンバスクリア受信');
        // クリア前の状態を保存（自分の線も含めて全て消える）
        const previousState = this.canvasManager.getCanvasState();

        // 全員の線をクリア
        this.canvasManager.clear();

        // クリア操作を履歴に追加（Undo可能にする）
        this.addToHistory({
          type: 'clear',
          previousState: previousState,
          timestamp: Date.now(),
          fromRemote: true
        });
        break;

      default:
        console.log('未知のメッセージタイプ:', message.type);
    }
  }

  // ----------------------------------------
  // 5. 機能別メソッド
  // ----------------------------------------

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

  // 描画設定
  async changeOpacity(opacity) {
    this.currentOpacity = opacity;
    this.canvasManager.setOpacity(opacity);
    this.updateBarState();
    console.log(`タブ ${this.tabId} の透明度を ${opacity} に変更`);
  }

  async toggleDrawing(enabled) {
    this.isDrawingEnabled = enabled;
    this.canvasManager.setEnabled(enabled);

    try {
      await chrome.storage.local.set({ isDrawingEnabled: enabled });
    } catch (error) {
      console.error('描画設定保存エラー:', error);
    }

    // ★ 描画状態に応じてアクティブツールを調整（大幅簡略化）
    // 現在のアクティブツールはそのまま維持
    // ユーザーが選択したスロットを尊重する

    this.updateBarState();
    console.log(`描画モードを ${enabled ? 'ON' : 'OFF'} に変更（全タブ共通）`);
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

  // ★ 最初のペンスロットを探す
  findFirstPenSlot() {
    const slotIds = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    for (const slotId of slotIds) {
      if (this.getSlotToolType(slotId) === 'pen') {
        return slotId;
      }
    }
    return '1'; // 見つからない場合はスロット1をデフォルト
  }

  // ★ 最初のカーソルスロットを探す
  findFirstCursorSlot() {
    const slotIds = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    for (const slotId of slotIds) {
      if (this.getSlotToolType(slotId) === 'cursor') {
        return slotId;
      }
    }
    return '0'; // 見つからない場合はスロット0をデフォルト
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
    // 該当するストロークを履歴から探して削除
    let found = false;
    for (let i = 0; i < this.canvasManager.strokes.length; i++) {
      if (this.canvasManager.strokes[i].id === strokeId) {
        // 自分のストロークではない場合のみ削除
        if (!this.canvasManager.myStrokeIds.has(strokeId)) {
          this.canvasManager.strokes.splice(i, 1);
          found = true;
          break;
        }
      }
    }

    if (found) {
      // キャンバスを再描画
      this.canvasManager.redrawAllStrokes();
      console.log('リモートストローク削除完了:', strokeId);
    }
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