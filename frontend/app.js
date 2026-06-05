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
      // 設定 / API key
      showSettings: false,
      apiKeyInput: '',
      keySet: false,
      savingKey: false,
      keyMsg: '',
      // 生圖狀態（與 creatives 對齊）：{ loading, error, bust, shown }
      gen: [],
      // 大量生成
      showBulkConfirm: false,
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
        // 探測既有圖：img 一律掛載、用 @load/@error 決定是否顯示
        this.gen = creatives.map(() => ({ loading: false, error: '', bust: 0, shown: false }));
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

    // ----- 生圖 -----
    imgSrc(idx) {
      const g = this.gen[idx];
      if (!g) return '';
      return '/api/images/' + encodeURIComponent(this.selectedId) + '/' + idx + '?v=' + g.bust;
    },

    async generateImage(idx) {
      if (!this.keySet) { this.openSettings(); return; }
      const g = this.gen[idx];
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
          g.bust++;       // cache-bust → 重新載入新圖
          g.shown = true;
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
      this.showBulkConfirm = true;
    },

    async runBulk() {
      this.showBulkConfirm = false;
      this.bulkRunning = true;
      this.bulkDone = 0;
      const n = (this.current.creatives || []).length;
      for (let i = 0; i < n; i++) {
        await this.generateImage(i);   // 逐張，避免一次轟炸 API
        this.bulkDone++;
      }
      this.bulkRunning = false;
    },
  },
}).mount('#app');
