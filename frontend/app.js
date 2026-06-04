/* ============================================================
   Ad Generator — 創意檢視看板（Vue 3，唯讀）
   讀 generate-creatives skill 產出的 data/creatives/，
   每組以可編輯 textarea 顯示「使用說明 + brief + creative」，可微調後複製。
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
      current: null,    // /api/creatives/<id> 完整內容
      texts: [],        // 每組對應的可編輯文字（使用說明 + brief + creative）
      loading: false,
      copiedIdx: -1,
    };
  },

  async mounted() {
    await this.loadSets();
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
      this.texts = [];
      this.copiedIdx = -1;
      try {
        const r = await fetch('/api/creatives/' + encodeURIComponent(id));
        this.current = await r.json();
        const brief = (this.current && this.current.brief) || {};
        this.texts = (this.current.creatives || []).map(
          (c) => INSTRUCTION + JSON.stringify({ brief, creative: c }, null, 2)
        );
      } catch (e) {
        console.error('select', e);
      } finally {
        this.loading = false;
      }
    },

    async copy(idx) {
      try {
        await navigator.clipboard.writeText(this.texts[idx]);
        this.copiedIdx = idx;
        setTimeout(() => { if (this.copiedIdx === idx) this.copiedIdx = -1; }, 1500);
      } catch (e) {
        console.error('copy', e);
      }
    },
  },
}).mount('#app');
