/* ============================================================
   Ad Generator — 創意檢視看板 + 生圖（Vue 3）
   讀 generate-creatives skill 產出的 data/creatives/，可複製 prompt，
   也可填入 OpenAI key（存後端 .env）後直接呼叫 gpt-image-2 生主視覺。
   ============================================================ */
const { createApp } = Vue;

// 給 GPT 的使用說明：界定「哪些要畫進圖、哪些只是情境參考」
const INSTRUCTION =
  '請依此 creative 的各欄位產生這張廣告主視覺圖：\n' +
  '・composition_prompt 為主；content 是「圖中要出現的文字」（對應 prompt 裡的 {{content.欄位}} 佔位）；copy 供訊息與語氣參考。\n' +
  '・brief 僅作品牌背景情境參考。brief / copy 不要當成圖中文字額外畫上去。\n\n';

createApp({
  data() {
    return {
      sets: [],         // /api/creatives 清單
      selectedId: '',
      current: null,    // /api/creatives/<id> 完整內容（creatives 直接以 v-model 編輯）
      loading: false,
      copiedIdx: -1,
      savingIdx: -1,
      savedIdx: -1,
      deletingIdx: -1,
      // 設定 / API key
      showSettings: false,
      apiKeyInput: '',
      keySet: false,
      savingKey: false,
      keyMsg: '',
      // 生圖狀態（與 creatives 對齊）：{ loading, error, bust, shown }
      gen: [],
      // 共用確認對話框（刪除 / 大量生成共用，抽換內容）
      confirmBox: { show: false, title: '', message: '', okLabel: '確定', cancelLabel: '取消', danger: false },
      // 大量生成
      bulkRunning: false,
      bulkDone: 0,
    };
  },

  async mounted() {
    await this.loadSets();
    this.refreshKeyState();
  },

  methods: {
    async loadSets() {
      try {
        const r = await fetch('/api/creatives');
        const d = await r.json();
        this.sets = d.creatives || [];
        if (this.sets.length) this.select(this.sets[0].id);
      } catch (e) {
        console.error('loadSets', e);
      }
    },

    async refreshKeyState() {
      try {
        const d = await (await fetch('/api/settings')).json();
        this.keySet = !!d.openai_key_set;
      } catch (e) {
        console.error('settings', e);
      }
    },

    async select(id) {
      this.selectedId = id;
      this.loading = true;
      this.current = null;
      this.gen = [];
      this.copiedIdx = -1;
      try {
        const r = await fetch('/api/creatives/' + encodeURIComponent(id));
        this.current = await r.json();
        const creatives = this.current.creatives || [];
        // 每組一個狀態：view = 目前在看 images 清單的第幾張（預設看最新一張）
        this.gen = creatives.map((c) => ({
          loading: false,
          error: '',
          view: Math.max(0, ((c.images && c.images.length) || 1) - 1),
        }));
      } catch (e) {
        console.error('select', e);
      } finally {
        this.loading = false;
      }
    },

    // 即時組出「使用說明 + {brief, creative}」（複製 / 生圖共用，反映目前編輯內容）
    buildPayload(idx) {
      const brief = (this.current && this.current.brief) || {};
      const creative = (this.current.creatives || [])[idx];
      return INSTRUCTION + JSON.stringify({ brief, creative }, null, 2);
    },

    async copy(idx) {
      try {
        await navigator.clipboard.writeText(this.buildPayload(idx));
        this.copiedIdx = idx;
        setTimeout(() => { if (this.copiedIdx === idx) this.copiedIdx = -1; }, 1500);
      } catch (e) {
        console.error('copy', e);
      }
    },

    // 回存單組到 <id>.json
    async saveCreative(idx) {
      this.savingIdx = idx;
      try {
        const r = await fetch('/api/creatives/' + encodeURIComponent(this.selectedId) + '/' + idx, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creative: this.current.creatives[idx] }),
        });
        if (r.ok) {
          this.savedIdx = idx;
          setTimeout(() => { if (this.savedIdx === idx) this.savedIdx = -1; }, 1500);
        } else {
          const d = await r.json().catch(() => ({}));
          alert('儲存失敗：' + (d.error || r.status));
        }
      } catch (e) {
        console.error('save', e);
        alert('儲存失敗：' + e);
      } finally {
        this.savingIdx = -1;
      }
    },

    // ----- 共用確認對話框 -----
    askConfirm(opts) {
      this.confirmBox = {
        show: true,
        title: opts.title || '確認',
        message: opts.message || '',
        okLabel: opts.okLabel || '確定',
        cancelLabel: opts.cancelLabel || '取消',
        danger: !!opts.danger,
      };
      this._confirmAction = opts.onConfirm || null;   // 動作放實例屬性，不進 reactive data
    },
    confirmOk() {
      const fn = this._confirmAction;
      this.confirmBox.show = false;
      this._confirmAction = null;
      if (fn) fn();
    },
    confirmCancel() {
      this.confirmBox.show = false;
      this._confirmAction = null;
    },

    // 刪除單組（會直接從 JSON 移除，無法復原）
    deleteCreative(idx) {
      this.askConfirm({
        title: '確定刪除這組創意？',
        message: '會直接從 <code>data/creatives</code> 的 JSON 移除這組，<b>無法復原</b>。',
        okLabel: '確定刪除',
        cancelLabel: '取消',
        danger: true,
        onConfirm: () => this._doDelete(idx),
      });
    },

    async _doDelete(idx) {
      this.deletingIdx = idx;
      try {
        const r = await fetch('/api/creatives/' + encodeURIComponent(this.selectedId) + '/' + idx, {
          method: 'DELETE',
        });
        if (r.ok) {
          const s = this.sets.find((x) => x.id === this.selectedId);
          if (s) s.count = Math.max(0, s.count - 1);
          await this.select(this.selectedId);   // 重載 → index / 圖片重新對齊
        } else {
          const d = await r.json().catch(() => ({}));
          alert('刪除失敗：' + (d.error || r.status));
        }
      } catch (e) {
        console.error('delete', e);
        alert('刪除失敗：' + e);
      } finally {
        this.deletingIdx = -1;
      }
    },

    // ----- 設定（API key）-----
    openSettings() {
      this.apiKeyInput = '';
      this.keyMsg = '';
      this.showSettings = true;
    },

    async saveKey() {
      const key = this.apiKeyInput.trim();
      if (!key) { this.keyMsg = '請輸入 API key'; return; }
      this.savingKey = true;
      this.keyMsg = '';
      try {
        const r = await fetch('/api/settings/key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key }),
        });
        const d = await r.json();
        if (r.ok) {
          this.keySet = true;
          this.keyMsg = '✓ 已儲存到 .env';
          this.apiKeyInput = '';
          setTimeout(() => { this.showSettings = false; }, 800);
        } else {
          this.keyMsg = d.error || '儲存失敗';
        }
      } catch (e) {
        this.keyMsg = '儲存失敗：' + e;
      } finally {
        this.savingKey = false;
      }
    },

    // ----- 生圖 / 圖片切換 -----
    imgCount(idx) {
      const c = ((this.current && this.current.creatives) || [])[idx];
      return (c && Array.isArray(c.images) && c.images.length) || 0;
    },

    imgSrc(idx) {
      const c = ((this.current && this.current.creatives) || [])[idx];
      const g = this.gen[idx];
      if (!c || !Array.isArray(c.images) || !c.images.length || !g) return '';
      // 每張圖各自一個 uid（內容不變）→ 網址穩定、免 cache-bust；view 指目前看第幾張
      const v = Math.min(Math.max(g.view, 0), c.images.length - 1);
      return '/api/images/' + c.images[v];
    },

    prevImg(idx) {
      const g = this.gen[idx]; const n = this.imgCount(idx);
      if (!g || !n) return;
      g.view = (g.view - 1 + n) % n;   // 環狀切換
    },
    nextImg(idx) {
      const g = this.gen[idx]; const n = this.imgCount(idx);
      if (!g || !n) return;
      g.view = (g.view + 1) % n;
    },

    async generateImage(idx) {
      if (!this.keySet) { this.openSettings(); return; }
      const g = this.gen[idx];
      if (!g || g.loading) return;   // 防呆：已在生成中就忽略重複呼叫（擋同 tick 連點）
      g.loading = true;
      g.error = '';
      try {
        const r = await fetch('/api/images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // 送的就是「複製」那份：使用說明 + {brief, creative} JSON，讓 GPT 自行判讀 {{content.x}}
          body: JSON.stringify({ id: this.selectedId, index: idx, prompt: this.buildPayload(idx) }),
        });
        const d = await r.json();
        if (r.ok) {
          // 後端回傳更新後的 images 清單；append 不覆蓋，切到最新一張
          this.current.creatives[idx].images = d.images || [];
          g.view = Math.max(0, this.current.creatives[idx].images.length - 1);
        } else {
          g.error = d.error || '生圖失敗';
        }
      } catch (e) {
        g.error = '生圖失敗：' + e;
      } finally {
        g.loading = false;
      }
    },

    // ----- 大量生成 -----
    openBulkConfirm() {
      if (!this.keySet) { this.openSettings(); return; }
      const n = (this.current && this.current.creatives && this.current.creatives.length) || 0;
      if (!n) return;
      this.askConfirm({
        title: '確定要大量生成吼？',
        message: '這會對 OpenAI 逐張計費，這批共 <b>' + n + '</b> 張。<br>' +
          '如果不想多花錢，其實你也可以按各組的「複製」，把 prompt 自行貼到 <b>ChatGPT</b>、<b>Gemini</b> 等 AI 生圖。',
        okLabel: '確定全部生成',
        cancelLabel: '取消，我自己複製去生',
        onConfirm: () => this.runBulk(),
      });
    },

    async runBulk() {
      this.bulkRunning = true;
      this.bulkDone = 0;
      const n = (this.current.creatives || []).length;
      const CONCURRENCY = 5;   // 並發上限：一次最多同時生 5 張，避免撞 OpenAI rate limit
      let next = 0;
      const worker = async () => {
        while (next < n) {
          const i = next++;
          await this.generateImage(i);
          this.bulkDone++;
        }
      };
      // 開 min(CONCURRENCY, n) 條 worker，共享 next 指標把 n 張分著跑
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, n) }, worker));
      this.bulkRunning = false;
    },
  },
}).mount('#app');
