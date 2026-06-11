"""
Ad Generator — Backend（創意檢視看板 + 生圖）

負責：
1. 服務前端 index.html，提供 <data-dir>/creatives 底下的廣告素材 JSON 給 UI 檢視 / 編輯 / 刪除。
2. 設定：把使用者在看板填入的 OpenAI API key 寫進專案根目錄 .env（永不回傳前端、只綁 127.0.0.1）。
3. 生圖（非同步任務）：POST 登記後立即回 202，背景執行緒用 OpenAI Responses API 的
   image_generation 工具（gpt-image-2）生主視覺，存到 <data-dir>/images；前端輪詢 status。

執行：
    uv run python server.py                         # 創意資料 = ./data，.env = ./
    uv run python server.py --data-dir /path/data   # 指定資料目錄（plugin 安裝後指向使用者專案）
接著開啟 http://localhost:5050
"""

import argparse
import base64
import glob
import json
import os
import sys
import threading
import uuid

import migrations  # schema 版本化遷移（與 server.py 同目錄；sys.path[0] = script 所在處，plugin 場景也找得到）

# 強制 stdout/stderr 使用 UTF-8（避免 Windows cp950/cp1252 出現 UnicodeEncodeError）
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

from flask import Flask, jsonify, request, send_file

ROOT = os.path.dirname(os.path.abspath(__file__))  # 前端靜態檔（index.html / frontend/）位置
# 創意資料目錄：預設 cwd/data（dev 在 repo 內跑時即 repo/data）；可用 DATA_DIR 環境變數或 --data-dir 覆寫。
DIR_CREATIVES = os.path.join(os.environ.get("DATA_DIR") or os.path.join(os.getcwd(), "data"), "creatives")
# API key 等機密放使用者專案根目錄的 .env（cwd = 使用者啟動 serve 的專案）
ENV_FILE = os.path.join(os.getcwd(), ".env")
# Responses 主模型（呼叫 image_generation 工具；底層用 gpt-image-2）。可用環境變數覆寫。
OPENAI_RESPONSES_MODEL = os.environ.get("OPENAI_RESPONSES_MODEL", "gpt-5.5")
# aspect → gpt-image-2 尺寸（邊長 16 倍數、比例 ≤3:1）
SIZE_BY_ASPECT = {"1:1": "1024x1024", "4:5": "1024x1280", "9:16": "720x1280", "16:9": "1280x720"}
# creatives JSON 的讀改寫鎖：threaded=True 下並行生圖/編輯/刪除都動同一份檔，
# 不加鎖會「舊快照整份覆寫」洗掉別人剛寫入的結果（圖生好了但 JSON 沒記到）。
_JSON_LOCK = threading.Lock()

# 啟動時載入 .env（dotenv 可能尚未安裝 → 容錯）
try:
    from dotenv import load_dotenv

    load_dotenv(ENV_FILE)
except Exception:
    pass

# 繞過 Jinja：template_folder=None，完全不呼叫 render_template。
# index.html 以原始檔案形式透過 send_file 提供（UTF-8）。
app = Flask(__name__, static_folder=ROOT, static_url_path="", template_folder=None)
app.jinja_env.auto_reload = False  # 不需要 — 沒有使用 template
# 註：不需要 CORS — 前端由本 server 同源服務（瀏覽器同源請求不受限）


def _images_dir():
    """生圖輸出目錄 = <data 根>/images（data 根 = creatives 的上一層）。"""
    return os.path.join(os.path.dirname(DIR_CREATIVES), "images")


@app.route("/")
def index():
    return send_file(os.path.join(ROOT, "index.html"), mimetype="text/html")


@app.route("/api/health")
def health():
    return jsonify({"ok": True})


def _safe_read(directory, item_id):
    """讀 directory/<item_id>.json，擋掉路徑穿越。找不到回 None。"""
    if not item_id or item_id != os.path.basename(item_id) or ".." in item_id:
        return None
    path = os.path.join(directory, item_id + ".json")
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


@app.route("/api/creatives")
def api_creatives_list():
    """列出所有創意產出（id + brief + 組數）。"""
    items = []
    for path in glob.glob(os.path.join(DIR_CREATIVES, "*.json")):
        try:
            with _JSON_LOCK:
                with open(path, encoding="utf-8") as f:
                    d = json.load(f)
                if _ensure_schema(d):  # 順手做 schema 遷移（含 brief 欄位改名），下拉才讀得到新欄位
                    _save_batch(os.path.splitext(os.path.basename(path))[0], d)
            items.append(
                {
                    "id": os.path.splitext(os.path.basename(path))[0],
                    "brief": d.get("brief"),
                    "mode": d.get("mode"),
                    "count": len(d.get("creatives") or []),
                }
            )
        except Exception:
            continue
    items.sort(key=lambda x: x["id"], reverse=True)
    return jsonify({"creatives": items})


@app.route("/api/creatives/<creative_id>")
def api_creatives_get(creative_id):
    """單一創意產出的完整內容（順手補齊每組的 uid，生成圖以 uid 命名）。"""
    with _JSON_LOCK:
        d = _safe_read(DIR_CREATIVES, creative_id)
        if d is None:
            return jsonify({"error": "找不到該創意"}), 404
        if _ensure_schema(d):
            _save_batch(creative_id, d)
    return jsonify(d)


@app.route("/api/creatives/<creative_id>/<creative_uid>", methods=["PUT", "DELETE"])
def api_creatives_modify(creative_id, creative_uid):
    """編輯回存（PUT）或刪除（DELETE）單一組創意，存回 <id>.json。以 uid 指認該組（穩定，不受刪除位移影響）。"""
    with _JSON_LOCK:
        d = _safe_read(DIR_CREATIVES, creative_id)  # 同時驗證 id 合法（穿越則回 None）
        if d is None:
            return jsonify({"error": "找不到該創意"}), 404
        creatives = d.get("creatives") or []
        pos = next((i for i, c in enumerate(creatives) if isinstance(c, dict) and c.get("uid") == creative_uid), None)
        if pos is None:
            return jsonify({"error": "找不到該組（uid 不存在）"}), 404

        if request.method == "DELETE":
            removed = creatives.pop(pos)
            d["creatives"] = creatives
            _save_batch(creative_id, d)
            for u in removed.get("images") or []:  # 連同該組所有生成圖一起刪
                _remove_image(u)
            _remove_image(removed.get("uid"))  # 保險：清舊版單張
            return jsonify({"ok": True, "count": len(creatives)})

        # PUT：回存編輯後的內容。uid / images 以磁碟為準（前端快照可能比剛生好的圖舊，
        # 直接覆寫會把新圖的 uid 洗掉），只接受文字欄位的修改。
        body = request.get_json(silent=True) or {}
        creative = body.get("creative")
        if not isinstance(creative, dict):
            return jsonify({"error": "creative 需為物件"}), 400
        old = creatives[pos]
        creative["uid"] = old.get("uid")
        creative["images"] = old.get("images") if isinstance(old.get("images"), list) else []
        creatives[pos] = creative
        d["creatives"] = creatives
        _save_batch(creative_id, d)
        return jsonify({"ok": True, "images": creative["images"]})


def _save_batch(creative_id, d):
    with open(os.path.join(DIR_CREATIVES, creative_id + ".json"), "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)


def _ensure_schema(d):
    """讀取時把批次 JSON 升到目前 schema。回傳是否有變更（呼叫端據此寫回磁碟）。

    1) 版本化遷移（migrations.py）：一次性結構變動，依 schema_version 逐版補上。
    2) 不變量修補（每次都跑、與版號無關）：每組補 uid / images——skill 追加的新組
       本來就不帶這些系統欄位，不是一次性遷移能涵蓋的。
    """
    changed = migrations.migrate(d)

    images_dir = _images_dir()
    for c in d.get("creatives") or []:
        if not isinstance(c, dict):
            continue
        if not c.get("uid"):
            c["uid"] = uuid.uuid4().hex[:12]
            changed = True
        if not isinstance(c.get("images"), list):
            imgs = []
            if c.get("uid") and os.path.isfile(os.path.join(images_dir, c["uid"] + ".png")):
                imgs.append(c["uid"])  # 舊版：單張圖以 creative uid 命名 → 納入清單
            c["images"] = imgs
            changed = True
    return changed


def _remove_image(uid):
    """刪除某 uid 的生成圖（其餘 uid 的圖不受影響）。"""
    if not uid:
        return
    try:
        p = os.path.join(_images_dir(), uid + ".png")
        if os.path.isfile(p):
            os.remove(p)
    except Exception:
        pass


# ---------- 設定（API key）----------


def _read_env_file():
    data = {}
    if os.path.isfile(ENV_FILE):
        with open(ENV_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                data[k.strip()] = v.strip()
    return data


def _write_env_var(key, value):
    data = _read_env_file()
    data[key] = value
    with open(ENV_FILE, "w", encoding="utf-8") as f:
        for k, v in data.items():
            f.write(f"{k}={v}\n")


@app.route("/api/settings")
def api_settings_get():
    """只回報「key 是否已設定」，永不回傳 key 本身。"""
    return jsonify({"openai_key_set": bool(os.environ.get("OPENAI_API_KEY"))})


@app.route("/api/settings/key", methods=["POST"])
def api_settings_set_key():
    """把 OpenAI API key 寫進 .env 並載入目前程序。"""
    body = request.get_json(silent=True) or {}
    key = (body.get("key") or "").strip()
    if not key:
        return jsonify({"error": "key 不可為空"}), 400
    _write_env_var("OPENAI_API_KEY", key)
    os.environ["OPENAI_API_KEY"] = key
    return jsonify({"ok": True, "openai_key_set": True})


# ---------- 生圖（非同步任務：POST 立即回應，背景執行緒慢慢生）----------

# 任務表：creative uid → {"status": "running|done|failed", "error": "", "images": [...]}
# 「進行中」是領域狀態，真相記在後端這裡（前端只是輪詢讀取）。放記憶體剛好：
# server 重啟時背景執行緒也跟著死，狀態與工作同生共死、不留殭屍。
_JOBS = {}
_JOBS_LOCK = threading.Lock()
_GEN_LIMIT = threading.Semaphore(5)  # 同時打 OpenAI 的上限（改由後端管，前端不再排程）


def _generate_image_b64(prompt, size, quality):
    """用 OpenAI Responses API 的 image_generation 工具生圖，回傳 base64 PNG。"""
    from openai import OpenAI

    client = OpenAI()  # 自動讀 OPENAI_API_KEY
    resp = client.responses.create(
        model=OPENAI_RESPONSES_MODEL,
        input=prompt,
        tools=[{"type": "image_generation", "size": size, "quality": quality}],
    )
    for o in resp.output:
        if getattr(o, "type", None) == "image_generation_call":
            return o.result
    return None


def _image_worker(cid, target_uid, prompt, size, quality):
    """背景執行緒：慢的 OpenAI 呼叫在這裡跑，完成後寫檔並更新任務表。"""
    try:
        with _GEN_LIMIT:  # 並發上限
            b64 = _generate_image_b64(prompt, size, quality)
        if not b64:
            raise RuntimeError("模型未回傳圖片")
        new_uid = uuid.uuid4().hex[:12]
        images_dir = _images_dir()
        os.makedirs(images_dir, exist_ok=True)
        with open(os.path.join(images_dir, new_uid + ".png"), "wb") as f:
            f.write(base64.b64decode(b64))
        # 寫回段（持鎖）：重讀最新 JSON、用 uid 找回該組再 append——不拿舊快照整份覆寫，
        # 並行生圖 / 期間的編輯刪除都不會被洗掉。
        with _JSON_LOCK:
            d = _safe_read(DIR_CREATIVES, cid)
            target = None
            for c in (d.get("creatives") or []) if d else []:
                if isinstance(c, dict) and c.get("uid") == target_uid:
                    target = c
                    break
            if target is None:  # 生圖期間該組被刪 → 捨棄這張孤兒圖
                _remove_image(new_uid)
                raise RuntimeError("該組創意已被刪除，這張圖已捨棄")
            target.setdefault("images", []).append(new_uid)
            _save_batch(cid, d)
            images = list(target["images"])
        with _JOBS_LOCK:  # 先存 JSON 再標 done → 前端看到 done 時，重讀批次一定有圖
            _JOBS[target_uid] = {"status": "done", "error": "", "images": images}
    except Exception as e:
        with _JOBS_LOCK:
            _JOBS[target_uid] = {"status": "failed", "error": f"生圖失敗：{e}", "images": []}


@app.route("/api/images", methods=["POST"])
def api_generate_image():
    """啟動背景生圖任務，立即回 202；進度用 GET /api/images/status 輪詢。body: {id, uid, prompt?, quality?}"""
    if not os.environ.get("OPENAI_API_KEY"):
        return jsonify({"error": "尚未設定 OpenAI API key，請先到右上『設定』填入"}), 400
    body = request.get_json(silent=True) or {}
    cid = body.get("id")
    target_uid = body.get("uid")
    # 讀取段（持鎖）：驗證、補欄位、以 uid 指認該組（穩定，不受刪除位移影響）
    with _JSON_LOCK:
        d = _safe_read(DIR_CREATIVES, cid)
        if d is None:
            return jsonify({"error": "找不到該創意"}), 404
        if _ensure_schema(d):
            _save_batch(cid, d)
        creatives = d.get("creatives") or []
        creative = next((c for c in creatives if isinstance(c, dict) and c.get("uid") == target_uid), None)
        if creative is None:
            return jsonify({"error": "找不到該組（uid 不存在）"}), 404
        # prompt 由前端帶來（= 複製鈕那份：使用說明 + {brief, creative} JSON），讓 GPT 自行依
        # composition_prompt 的 {{content.x}} 對應 content 判讀；直接呼叫 API 未帶 prompt 時，退用 JSON。
        prompt = body.get("prompt") or json.dumps({"brief": d.get("brief"), "creative": creative}, ensure_ascii=False)
        # 比例：body 可逐次覆寫（同一組可生多種版位比例，進同一本相簿），預設用 brief 的 default_aspect
        aspect = body.get("aspect") or (d.get("brief") or {}).get("default_aspect", "1:1")
    size = SIZE_BY_ASPECT.get(aspect, "1024x1024")
    quality = body.get("quality") or "high"
    with _JOBS_LOCK:
        job = _JOBS.get(target_uid)
        if job and job["status"] == "running":  # 後端防連點：同組已在生就拒絕
            return jsonify({"error": "這組正在生成中"}), 409
        _JOBS[target_uid] = {"status": "running", "error": "", "images": []}
    threading.Thread(target=_image_worker, args=(cid, target_uid, prompt, size, quality), daemon=True).start()
    return jsonify({"ok": True, "uid": target_uid, "status": "running"}), 202


@app.route("/api/images/status")
def api_images_status():
    """回報所有生圖任務狀態（uid → status/error/images），前端輪詢用。"""
    with _JOBS_LOCK:
        return jsonify({"jobs": dict(_JOBS)})


@app.route("/api/images/<uid>")
def api_get_image(uid):
    """取用已生成的主視覺 PNG（以 creative uid 命名）。"""
    if not uid or uid != os.path.basename(uid) or ".." in uid:
        return jsonify({"error": "bad uid"}), 404
    path = os.path.join(_images_dir(), uid + ".png")
    if not os.path.isfile(path):
        return jsonify({"error": "尚未生成"}), 404
    return send_file(path, mimetype="image/png")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Ad Generator 看板 + 生圖")
    ap.add_argument("--data-dir", help="創意資料目錄（其下需有 creatives/），預設 ./data")
    # 預設 5050：macOS 的 AirPlay 接收器佔 5000，避開它（可用 --port 或 PORT 環境變數覆寫）
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 5050)))
    ap.add_argument("--reload", action="store_true", help="開發用：改 server.py 存檔就自動重啟（仍 debug=False）")
    args = ap.parse_args()
    if args.data_dir:
        DIR_CREATIVES = os.path.join(args.data_dir, "creatives")
    print(f"\nAd Generator server 執行中：http://localhost:{args.port}", flush=True)
    print(f"創意資料目錄：{DIR_CREATIVES}", flush=True)
    print(f"生圖輸出目錄：{_images_dir()}", flush=True)
    print(f".env：{ENV_FILE}（OpenAI key{'已' if os.environ.get('OPENAI_API_KEY') else '未'}設定）\n", flush=True)
    # threaded=True：並行生圖時能同時處理多個 /api/images 請求（每請求各自呼叫 OpenAI）
    try:
        app.run(host="127.0.0.1", port=args.port, debug=False, threaded=True, use_reloader=args.reload)
    except OSError as e:
        print(f"\n啟動失敗：port {args.port} 無法綁定（{e}），請改用 --port 指定別的 port。", flush=True)
        sys.exit(1)
