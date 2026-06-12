/* ============================================================
   Ad Generator — 創意檢視看板 + 生圖（Vue 3）
   讀 generate-creatives skill 產出的 data/creatives/，可複製 prompt，
   也可填入 OpenAI key（存後端 .env）後直接呼叫 gpt-image-2 生主視覺。
   ============================================================ */
const { createApp } = Vue;

// 給 GPT 的使用說明：界定「哪些要畫進圖、哪些只是情境參考」
const INSTRUCTION =
  '請依此 creative 的各欄位產生這張廣告主視覺圖：\n' +
  '・composition_prompt 為主；content 是「圖中要出現的文字」（對應 prompt 裡的 {{content.欄位}} 佔位）。\n' +
  '・primary_text 是貼文文案、brief 是品牌背景，都僅供訊息與語氣參考，不要當成圖中文字畫上去。\n' +
  '・若 brief 與 creative 內容衝突（如優惠數字、文字措辭），一律以 creative 為準——brief 是發想時的輸入，creative 才是現行版本。\n\n';

// 改圖模式前綴：使用者會把已生成的圖一併附給生圖模型，要求「基於附圖微調」而非重生
const IMAGE_EDIT_PREFIX =
  '【改圖模式】請依據附圖作如下改變、其他不變：\n' +
  '・以附圖為基底，僅調整與下方 creative 最新內容不符之處（如圖中文字、優惠數字、CTA）。\n' +
  '・構圖、風格、配色、元素一律延續附圖，不要重新發想。\n\n';

createApp({
  data() {
    return {
      sets: [],         // /api/creatives 清單
      selectedId: '',
      current: null,    // /api/creatives/<id> 完整內容（creatives 直接以 v-model 編輯）
      loading: false,
      // 暫態 UI 狀態，以 creative uid 指認（'' = 無）
      copiedUid: '',
      savingUid: '',
      savedUid: '',
      deletingUid: '',
      // 設定 / API key
      showSettings: false,
      apiKeyInput: '',
      keySet: false,
      savingKey: false,
      keyMsg: '',
      // 生圖狀態，以 creative 的 uid 索引：{ uid: { loading（由後端任務表同步）, error, view（看相簿第幾張） } }
      // 用 uid 不用 index → 刪除/位移不需要重新對齊，其他卡的狀態完全不動
      gen: {},
      // 共用確認對話框（刪除 / 大量生成共用，抽換內容）
      confirmBox: { show: false, title: '', message: '', okLabel: '確定', cancelLabel: '取消', danger: false },
    };
  },

  async mounted() {
    await this.loadSets();
    this.refreshKeyState();
  },

  computed: {
    // 「進行中」由後端任務表同步到 gen[uid].loading，這裡只是彙總
    runningCount() { return Object.values(this.gen).filter((g) => g.loading).length; },
    anyGenerating() { return this.runningCount > 0; },
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
      this.gen = {};
      this.copiedUid = '';
      try {
        const r = await fetch('/api/creatives/' + encodeURIComponent(id));
        this.current = await r.json();
        const creatives = this.current.creatives || [];
        // 每組一個「視圖狀態」（以 uid 索引）：view = 目前在看相簿第幾張（預設最新）；
        // aspect = 這組生圖用的比例（預設跟 brief，可逐卡改 → 同組生多種版位比例進同一相簿）。
        // loading 是領域狀態，真相在後端任務表，由 syncJobs() 同步進來。
        const briefAspect = (this.current.brief && this.current.brief.default_aspect) || '1:1';
        const gen = {};
        creatives.forEach((c) => {
          gen[c.uid] = {
            loading: false,
            error: '',
            view: Math.max(0, ((c.images && c.images.length) || 1) - 1),
            aspect: briefAspect,
          };
        });
        this.gen = gen;
        await this.syncJobs();   // 接回「進行中」→ 重整 / 切批再回來都不失憶
        if (this.anyGenerating) this.ensurePolling();
      } catch (e) {
        console.error('select', e);
      } finally {
        this.loading = false;
      }
    },

    // 即時組出「使用說明 + {brief, creative}」（複製 / 生圖共用，反映目前編輯內容）。
    // 送生圖的 payload 刻意瘦身：uid/images（系統欄位）、angle/hook/funnel（策略標籤）、
    // copy 的 headline/cta（與 content 重複）都對生圖無益，只留 primary_text 供語氣參考。
    buildPayload(c) {
      const brief = {};
      Object.entries((this.current && this.current.brief) || {}).forEach(([k, v]) => {
        if (v !== null && v !== '' && v !== undefined) brief[k] = v;
      });
      const creative = {
        content: c.content,
        composition_prompt: c.composition_prompt,
        primary_text: (c.copy && c.copy.primary_text) || undefined,
      };
      return INSTRUCTION + JSON.stringify({ brief, creative }, null, 2);
    },

    copy(c) {
      // 這組已有生成圖 → 問要「基於附圖改圖」還是「生新圖」；沒圖就照舊直接複製
      if (this.imgCount(c) > 0) {
        this.askConfirm({
          title: '要基於已生成的圖改圖嗎？',
          message:
            '・<b>基於附圖改圖</b>：prompt 會加上「請依據附圖作如下改變、其他不變」——' +
            '貼到生圖模型時，記得把目前顯示的那張圖<b>一併附上</b>。<br>' +
            '・<b>生新圖</b>：照原樣複製，讓模型自由發揮。',
          okLabel: '基於附圖改圖',
          cancelLabel: '生新圖',
          onConfirm: () => this._doCopy(c, true),
          onCancel: () => this._doCopy(c, false),
        });
      } else {
        this._doCopy(c, false);
      }
    },

    async _doCopy(c, basedOnImage) {
      try {
        const text = (basedOnImage ? IMAGE_EDIT_PREFIX : '') + this.buildPayload(c);
        await navigator.clipboard.writeText(text);
        this.copiedUid = c.uid;
        setTimeout(() => { if (this.copiedUid === c.uid) this.copiedUid = ''; }, 1500);
      } catch (e) {
        console.error('copy', e);
      }
    },

    // 回存單組到 <id>.json（以 uid 指認）
    async saveCreative(c) {
      this.savingUid = c.uid;
      try {
        const r = await fetch('/api/creatives/' + encodeURIComponent(this.selectedId) + '/' + encodeURIComponent(c.uid), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creative: c }),
        });
        if (r.ok) {
          this.savedUid = c.uid;
          setTimeout(() => { if (this.savedUid === c.uid) this.savedUid = ''; }, 1500);
        } else {
          const d = await r.json().catch(() => ({}));
          alert('儲存失敗：' + (d.error || r.status));
        }
      } catch (e) {
        console.error('save', e);
        alert('儲存失敗：' + e);
      } finally {
        this.savingUid = '';
      }
    },

    // ----- 共用確認對話框 -----
    // onCancel 可選：給「兩顆按鈕＝兩種動作」的對話框用（如複製的改圖/新圖）；
    // 點背景 = confirmDismiss = 什麼都不做。
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
      this._cancelAction = opts.onCancel || null;
    },
    confirmOk() {
      const fn = this._confirmAction;
      this.confirmDismiss();
      if (fn) fn();
    },
    confirmCancel() {
      const fn = this._cancelAction;
      this.confirmDismiss();
      if (fn) fn();
    },
    confirmDismiss() {
      this.confirmBox.show = false;
      this._confirmAction = null;
      this._cancelAction = null;
    },

    // 刪除單組（會直接從 JSON 移除，無法復原）
    deleteCreative(c) {
      this.askConfirm({
        title: '確定刪除這組創意？',
        message: '會直接從 <code>data/creatives</code> 的 JSON 移除這組，<b>無法復原</b>。',
        okLabel: '確定刪除',
        cancelLabel: '取消',
        danger: true,
        onConfirm: () => this._doDelete(c),
      });
    },

    async _doDelete(c) {
      this.deletingUid = c.uid;
      try {
        const r = await fetch('/api/creatives/' + encodeURIComponent(this.selectedId) + '/' + encodeURIComponent(c.uid), {
          method: 'DELETE',
        });
        if (r.ok) {
          const s = this.sets.find((x) => x.id === this.selectedId);
          if (s) s.count = Math.max(0, s.count - 1);
          // gen 以 uid 索引 → 本地移除即可，不必整批重載，其他卡的生圖/相簿狀態不受影響
          const pos = this.current.creatives.indexOf(c);
          if (pos >= 0) this.current.creatives.splice(pos, 1);
          delete this.gen[c.uid];
        } else {
          const d = await r.json().catch(() => ({}));
          alert('刪除失敗：' + (d.error || r.status));
        }
      } catch (e) {
        console.error('delete', e);
        alert('刪除失敗：' + e);
      } finally {
        this.deletingUid = '';
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

    // ----- 生圖 / 圖片切換（皆以 creative 物件操作，內部用 uid 查狀態） -----
    genOf(c) {
      return (c && this.gen[c.uid]) || {};   // 模板讀取用；查無時回空物件避免 undefined
    },

    imgCount(c) {
      return (c && Array.isArray(c.images) && c.images.length) || 0;
    },

    imgSrc(c) {
      const g = this.genOf(c);
      if (!this.imgCount(c)) return '';
      // 每張圖各自一個 uid（內容不變）→ 網址穩定、免 cache-bust；view 指目前看第幾張
      const v = Math.min(Math.max(g.view || 0, 0), c.images.length - 1);
      return '/api/images/' + c.images[v];
    },

    prevImg(c) {
      const g = this.gen[c.uid]; const n = this.imgCount(c);
      if (!g || !n) return;
      g.view = (g.view - 1 + n) % n;   // 環狀切換
    },
    nextImg(c) {
      const g = this.gen[c.uid]; const n = this.imgCount(c);
      if (!g || !n) return;
      g.view = (g.view + 1) % n;
    },

    // 下單即回（202）：真正的生圖在後端背景執行緒跑，進度靠 syncJobs 輪詢
    async generateImage(c) {
      if (!this.keySet) { this.openSettings(); return; }
      const g = c && this.gen[c.uid];
      if (!c || !g || g.loading) return;
      const reqId = this.selectedId;
      g.error = '';
      // 比例：用這張卡選的 aspect；與 brief 不同時在 prompt 補一句，蓋過 composition_prompt 裡寫死的比例
      const briefAspect = (this.current.brief && this.current.brief.default_aspect) || '1:1';
      const aspect = g.aspect || briefAspect;
      let prompt = this.buildPayload(c);
      if (aspect !== briefAspect) {
        prompt += '\n（本次輸出比例改為 ' + aspect + '，構圖請依此比例調整，忽略 composition_prompt 中提到的其他比例。）';
      }
      try {
        const r = await fetch('/api/images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // 送的就是「複製」那份：使用說明 + {brief, creative} JSON，讓 GPT 自行判讀 {{content.x}}
          body: JSON.stringify({ id: reqId, uid: c.uid, prompt, aspect }),
        });
        const d = await r.json();
        // 已切到別批 → 任務照跑（記在後端），切回來 syncJobs 會接手顯示
        if (this.selectedId !== reqId) return;
        if (r.status === 202 || r.status === 409) {  // 已登記（或本來就在跑）→ 進入進行中
          g.loading = true;
          this.ensurePolling();
        } else {
          g.error = d.error || '生圖失敗';
        }
      } catch (e) {
        g.error = '生圖失敗：' + e;
      }
    },

    // ----- 任務同步：「進行中」的真相在後端 _JOBS 表，前端只是讀取 -----
    async syncJobs() {
      if (!this.current) return;
      let jobs;
      try {
        jobs = (await (await fetch('/api/images/status')).json()).jobs || {};
      } catch (e) {
        console.error('syncJobs', e);
        return;
      }
      (this.current.creatives || []).forEach((c) => {
        const g = c && this.gen[c.uid];
        const job = c && c.uid ? jobs[c.uid] : null;
        if (!g || !job) return;
        if (job.status === 'running') {
          g.loading = true;                       // 重整 / 切回來也能接上進行中
        } else if (g.loading && job.status === 'done') {
          c.images = job.images || [];            // 後端先存 JSON 才標 done → 這份清單可信
          g.view = Math.max(0, c.images.length - 1);
          g.loading = false;
        } else if (g.loading && job.status === 'failed') {
          g.error = job.error || '生圖失敗';
          g.loading = false;
        }
      });
    },

    ensurePolling() {
      if (this._pollTimer) return;
      this._pollTimer = setInterval(async () => {
        await this.syncJobs();
        if (!this.anyGenerating) {               // 沒有進行中了 → 停止輪詢
          clearInterval(this._pollTimer);
          this._pollTimer = null;
        }
      }, 2500);
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
      // 每張都是「下單即回」（generateImage 自帶進行中防呆），排程與並發上限交給後端 semaphore 管
      for (const c of this.current.creatives || []) await this.generateImage(c);
    },
  },
}).mount('#app');
