/* ============================================================
   Ad Generator — 創意檢視看板（Vue 3）
   讀 generate-creatives skill 產出的 data/creatives/，可檢視、編輯、刪除、
   複製 prompt，並顯示「agent 用 CDP 瀏覽器產出、回寫進 images[]」的生成圖。
   看板不打 API、不生圖；agent 產完圖後「重刷頁面」即可看到新圖。
   ============================================================ */
const { createApp } = Vue;

// 給生圖模型的使用說明：界定「哪些要畫進圖、哪些只是情境參考」
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
      // 圖片相簿瀏覽狀態，以 creative uid 索引：{ uid: { view（看相簿第幾張） } }
      // 用 uid 不用 index → 刪除/位移不需要重新對齊，其他卡的狀態完全不動
      gen: {},
      // 共用確認對話框（刪除 / 複製改圖共用，抽換內容）
      confirmBox: { show: false, title: '', message: '', okLabel: '確定', cancelLabel: '取消', danger: false },
      // 素材庫（使用者直接把圖丟進 data/materials/，檔名即名稱；生圖時附給模型）
      materials: [],
    };
  },

  async mounted() {
    await this.loadSets();
    this.loadMaterials();
  },

  computed: {
    // 只顯示「跟目前批次有關」的素材：品牌子資料夾（資料夾名=brand_name）
    // + 這批已引用的（防資料夾改名後勾選消失）。沒歸進資料夾的一律不列。
    visibleMaterials() {
      const foldered = this.materials.filter((m) => m.name.includes('/'));
      if (!this.current || !this.current.brief) return foldered;
      const brand = this.current.brief.brand_name || '';
      const referenced = new Set((this.current.creatives || []).flatMap((c) => c.materials || []));
      return foldered.filter((m) => m.name.slice(0, m.name.indexOf('/')) === brand || referenced.has(m.name));
    },

    // 素材依子資料夾分組（'' = 根目錄）
    materialGroups() {
      const groups = {};
      this.visibleMaterials.forEach((m) => {
        const i = m.name.lastIndexOf('/');
        const dir = i >= 0 ? m.name.slice(0, i) : '';
        (groups[dir] = groups[dir] || []).push(m);
      });
      return Object.keys(groups).sort().map((dir) => ({ dir, items: groups[dir] }));
    },
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

    async select(id) {
      this.selectedId = id;
      this.loading = true;
      this.current = null;
      this.gen = {};
      this.copiedUid = '';
      try {
        const r = await fetch('/api/creatives/' + encodeURIComponent(id));
        const data = await r.json();
        // 快速連切下拉時，慢的舊回應後到會把畫面蓋回舊批（下拉卻是新批）→ 過期就丟棄
        if (this.selectedId !== id) return;
        this.current = data;
        // 每組一個相簿瀏覽狀態（以 uid 索引）：view = 目前在看相簿第幾張（預設最新）。
        // 比例存進 creative（c.aspect）：可調、可存，生圖 skill 讀最新 JSON 的 aspect 來產圖。
        const briefAspect = (this.current.brief && this.current.brief.default_aspect) || '1:1';
        const gen = {};
        (this.current.creatives || []).forEach((c) => {
          if (!c.aspect) c.aspect = briefAspect;
          if (!c.pipeline_mode) c.pipeline_mode = 'chatgpt';  // 生圖路徑下拉的預設
          gen[c.uid] = { view: Math.max(0, ((c.images && c.images.length) || 1) - 1) };
        });
        this.gen = gen;
      } catch (e) {
        console.error('select', e);
      } finally {
        if (this.selectedId === id) this.loading = false;  // 過期請求別關掉新請求的載入中
      }
    },

    // ----- 素材庫（檔名即名稱；加素材 = 把圖丟進 data/materials/ 再按重新整理）-----
    async loadMaterials() {
      try {
        this.materials = (await (await fetch('/api/materials')).json()).materials || [];
      } catch (e) {
        console.error('materials', e);
      }
    },

    // 名稱可含子資料夾（Dutek/平衡車）→ 逐段編碼、保留斜線
    matSrc(name) { return '/api/materials/' + name.split('/').map(encodeURIComponent).join('/'); },
    matShort(name) { return name.split('/').pop(); },

    deleteMaterial(m) {
      this.askConfirm({
        title: '刪除素材「' + m.name + '」？',
        message: '素材檔會從 <code>data/materials</code> 刪除；卡片上殘留的引用會在生圖時自動略過。',
        okLabel: '刪除',
        cancelLabel: '取消',
        danger: true,
        onConfirm: async () => {
          await fetch(this.matSrc(m.name), { method: 'DELETE' });
          await this.loadMaterials();
        },
      });
    },

    // 勾選/取消這張卡的參考素材（記名稱；按「儲存」持久化，供生圖 agent 使用）
    toggleMaterial(c, name) {
      if (!Array.isArray(c.materials)) c.materials = [];
      const i = c.materials.indexOf(name);
      if (i >= 0) c.materials.splice(i, 1);
      else c.materials.push(name);
    },

    // 即時組出「使用說明 + {brief, creative}」（複製 prompt 用，反映目前編輯內容）。
    // 刻意瘦身：uid/images（系統欄位）、angle/hook/funnel（策略標籤）、copy 的 headline/cta
    // （與 content 重複）都對生圖無益，只留 primary_text 供語氣參考。
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
      // 有勾參考素材 → 提醒（貼到外部模型時要手動附圖）
      const names = c.materials || [];
      const note = names.length
        ? '⚠ 此 creative 搭配參考素材：' + names.join('、') +
          '（請把這些素材圖一併提供給生圖模型）\n\n'
        : '';
      return INSTRUCTION + note + JSON.stringify({ brief, creative }, null, 2);
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

    // 回存單組到 <id>.json（以 uid 指認；images 以磁碟為準，不會洗掉 agent 回寫的圖）
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
          // gen 以 uid 索引 → 本地移除即可，不必整批重載，其他卡的相簿狀態不受影響
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

    // ----- 圖片相簿（顯示 agent 回寫進 images[] 的生成圖；皆以 creative 物件操作，內部用 uid 查狀態） -----
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
  },
}).mount('#app');
