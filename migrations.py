"""
批次 JSON 的 schema 版本化遷移 —— 這個檔案就是 schema 的演進史。

機制：
- 每次 schema 結構變動：SCHEMA_VERSION +1，新增一個 _migrate_<N>_to_<N+1>(d) 並掛進 _MIGRATIONS。
- server 讀取批次時呼叫 migrate(d)：schema_version 缺視為 0，從該版起「逐版」套用（v→v+1）——
  使用者停在舊版很久後一次更新，中間每一版的增量改動都會依序補上（如 1→5 會跑 1→2→3→4→5）。
- 遷移函式必須「冪等」：skill 新產的檔可能已是新格式但沒帶版號（會從 0 跑起），重跑要安全跳過。
- 這裡只放「一次性結構變動」（純 dict 轉換）；每次讀取都要做的不變量修補（補 uid/images）在 server.py。
"""

SCHEMA_VERSION = 2  # 目前批次 JSON 的 schema 版本


def _migrate_0_to_1(d):
    """0（尚無版號的舊資料）→ 1：brief 欄位改名 offer→default_offer、aspect→default_aspect。"""
    brief = d.get("brief")
    if isinstance(brief, dict):
        for old, new in (("offer", "default_offer"), ("aspect", "default_aspect")):
            if old in brief and new not in brief:
                brief[new] = brief.pop(old)


def _migrate_1_to_2(d):
    """1 → 2：每組 creative 補 materials（參考素材的名稱清單＝檔名，生圖時會把這些圖附給模型）。"""
    for c in d.get("creatives") or []:
        if isinstance(c, dict) and not isinstance(c.get("materials"), list):
            c["materials"] = []


# from-version → 該版到下一版的增量遷移
_MIGRATIONS = {0: _migrate_0_to_1, 1: _migrate_1_to_2}


def migrate(d):
    """把批次 dict 逐版升到 SCHEMA_VERSION。回傳是否有變更（呼叫端據此寫回磁碟）。
    防禦：skill 跨程序寫檔，版號可能是字串/負數/垃圾——正規化後再跑（遷移皆冪等，從 0 重跑安全）；
    版號 >= 目前（含「來自未來」的檔）一律不動，不降級改寫。"""
    if not isinstance(d, dict):
        return False
    try:
        v = int(d.get("schema_version") or 0)
    except (TypeError, ValueError):
        v = 0
    if v >= SCHEMA_VERSION:
        return False
    v = max(0, v)
    old_v = v
    while v < SCHEMA_VERSION:
        _MIGRATIONS[v](d)
        v += 1
    d["schema_version"] = SCHEMA_VERSION
    # 一個檔案一生只會印一次（之後被版號擋住）；除錯時可確認遷移確實發生
    print(f"[migrate] {d.get('id', '?')}: schema {old_v} → {SCHEMA_VERSION}", flush=True)
    return True
