"""
Ad Generator — Backend（創意檢視看板）

負責：
1. 服務前端 index.html，提供 <data-dir>/creatives 底下的廣告素材 JSON 給 UI 檢視 / 編輯 / 刪除。
2. 服務 <data-dir>/materials 參考素材、<data-dir>/images 生成圖（供看板顯示）。

生圖「不再由 server 打 API」——改由 agent（Claude）用 CDP 瀏覽器在 ChatGPT 產圖，
存進 <data-dir>/images/<批次id>/<uid>.png，並回寫創意 JSON 的 images[] 與精修後的
composition_prompt（見 generate-images skill）。看板只負責檢視/編輯/刪除；
產完圖「重刷頁面」即可看到新圖。

執行：
    uv run python server.py                         # 創意資料 = ./data
    uv run python server.py --data-dir /path/data   # 指定資料目錄（plugin 安裝後指向使用者專案）
接著開啟 http://localhost:5050
"""

import argparse
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
# creatives JSON 的讀改寫鎖：threaded=True 下並行編輯/刪除都動同一份檔，
# 不加鎖會「舊快照整份覆寫」洗掉別人剛寫入的結果。
_JSON_LOCK = threading.Lock()

# 繞過 Jinja：template_folder=None，完全不呼叫 render_template。
# index.html 以原始檔案形式透過 send_file 提供（UTF-8）。
app = Flask(__name__, static_folder=ROOT, static_url_path="", template_folder=None)
app.jinja_env.auto_reload = False  # 不需要 — 沒有使用 template
# 註：不需要 CORS — 前端由本 server 同源服務（瀏覽器同源請求不受限）


def _images_dir():
    """生圖輸出目錄 = <data 根>/images（data 根 = creatives 的上一層）。agent 把圖存這裡。"""
    return os.path.join(os.path.dirname(DIR_CREATIVES), "images")


MATERIAL_EXTS = (".png", ".jpg", ".jpeg", ".webp")


def _materials_dir():
    """參考素材目錄 = <data 根>/materials。檔名即名稱即身分（使用者直接丟圖進來即可）；
    index.json 是可選的描述附加層 {名稱: 外觀描述}，由對話端的 Claude 看圖撰寫。"""
    return os.path.join(os.path.dirname(DIR_CREATIVES), "materials")


def _load_mat_desc():
    """讀素材描述 {名稱: 描述}；無檔回空 dict。"""
    p = os.path.join(_materials_dir(), "index.json")
    if not os.path.isfile(p):
        return {}
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _scan_materials():
    """遞迴掃描素材資料夾 → [{name, ext, description}]，依修改時間新到舊。
    name = 相對路徑（含子資料夾，如「Dutek/平衡車實照」）→ 使用者可用資料夾分品牌/分類。"""
    d = _materials_dir()
    if not os.path.isdir(d):
        return []
    desc = _load_mat_desc()
    items = []
    for root, _dirs, files in os.walk(d):
        for f in files:
            stem, ext = os.path.splitext(f)
            if ext.lower() not in MATERIAL_EXTS:
                continue
            rel = os.path.relpath(os.path.join(root, stem), d).replace(os.sep, "/")
            try:
                mtime = os.path.getmtime(os.path.join(root, f))
            except OSError:
                continue  # 掃描瞬間檔案被刪（如 UI 刪除鈕）→ 跳過，別讓整個列表 500
            items.append({
                "name": rel,
                "ext": ext.lstrip("."),
                "description": desc.get(rel, ""),
                "_mtime": mtime,
            })
    items.sort(key=lambda x: x.pop("_mtime"), reverse=True)
    return items


def _material_path(name):
    """以名稱（可含子資料夾，如 Dutek/平衡車實照）找素材檔路徑；擋路徑穿越；找不到回 None。"""
    if not name:
        return None
    name = name.replace("\\", "/")
    if name.startswith("/") or ":" in name or ".." in name.split("/"):
        return None
    base = os.path.realpath(_materials_dir())
    for ext in MATERIAL_EXTS:
        p = os.path.realpath(os.path.join(base, name + ext))
        if p.startswith(base + os.sep) and os.path.isfile(p):
            return p
    return None


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
            d = json.load(f)
        return d if isinstance(d, dict) else None  # 頂層不是物件的怪檔 → 視為不可讀（404 而非 500）
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
                if not isinstance(d, dict):
                    raise ValueError("頂層不是 JSON 物件")
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
        except Exception as e:
            # 別默默吞掉——壞檔會從看板「憑空消失」，使用者以為資料不見了
            print(f"[list] 跳過無法讀取的批次 {os.path.basename(path)}：{e}", flush=True)
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

        # PUT：回存編輯後的內容。uid / images 以磁碟為準（前端快照可能比 agent 剛回寫的圖舊，
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
    """原子寫入：先寫 .tmp 再 os.replace（Windows 也原子）——寫到一半程序被殺，
    也不會留下半截 JSON 把整批毀掉（檔案即資料庫，這是耐久性底線）。"""
    path = os.path.join(DIR_CREATIVES, creative_id + ".json")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


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
        if not isinstance(c.get("materials"), list):
            c["materials"] = []
            changed = True
        # 生圖平台/模型/思考（看板下拉可改）：rename 舊 pipeline_mode、補缺、非法回平台預設
        old_plat = c.pop("pipeline_mode", None)
        plat = c.get("ai_platform") or old_plat
        if plat not in ("chatgpt", "gemini"):
            plat = "chatgpt"
        if old_plat is not None or c.get("ai_platform") != plat:
            c["ai_platform"] = plat
            changed = True
        dm, dt = migrations.platform_defaults(plat)
        if not c.get("model"):
            c["model"] = dm
            changed = True
        if not c.get("thinking_effort"):
            c["thinking_effort"] = dt
            changed = True
    return changed


def _find_image(uid):
    """以圖 uid 找檔案：先試舊版扁平路徑（images/<uid>.png），再掃各批次子資料夾
    （images/<批次id>/<uid>.png——存法，資料夾給人翻、uid 給程式引用）。"""
    if not uid or uid != os.path.basename(uid) or ".." in uid:
        return None
    flat = os.path.join(_images_dir(), uid + ".png")
    if os.path.isfile(flat):
        return flat
    hits = glob.glob(os.path.join(_images_dir(), "*", uid + ".png"))
    return hits[0] if hits else None


def _remove_image(uid):
    """刪除某 uid 的生成圖（其餘 uid 的圖不受影響）；批次子資料夾空了就順手收掉。"""
    p = _find_image(uid)
    if not p:
        return
    try:
        os.remove(p)
        parent = os.path.dirname(p)
        if os.path.realpath(parent) != os.path.realpath(_images_dir()) and not os.listdir(parent):
            os.rmdir(parent)
    except Exception:
        pass


# ---------- 參考素材（使用者直接把圖丟進 data/materials/，檔名即名稱）----------


@app.route("/api/materials")
def api_materials_list():
    """即時掃描素材資料夾（不用上傳——把圖丟進 data/materials/ 即可）。"""
    return jsonify({"materials": _scan_materials()})


@app.route("/api/materials/<path:name>", methods=["GET", "DELETE"])
def api_material_item(name):
    """取素材圖（GET）／刪除素材檔（DELETE，連同描述）。以「相對路徑名」指認（可含子資料夾）。"""
    path = _material_path(name)
    if request.method == "GET":
        if not path:
            return jsonify({"error": "找不到素材"}), 404
        ext = os.path.splitext(path)[1].lstrip(".").lower()
        return send_file(path, mimetype="image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}")
    # DELETE（冪等；creatives 裡殘留的引用無害）
    if path:
        try:
            os.remove(path)
            parent = os.path.dirname(path)  # 子資料夾空了就順手收掉
            if os.path.realpath(parent) != os.path.realpath(_materials_dir()) and not os.listdir(parent):
                os.rmdir(parent)
        except Exception:
            pass
        with _JSON_LOCK:
            desc = _load_mat_desc()
            if name in desc:
                desc.pop(name)
                with open(os.path.join(_materials_dir(), "index.json"), "w", encoding="utf-8") as f:
                    json.dump(desc, f, ensure_ascii=False, indent=2)
    return jsonify({"ok": True})


# ---------- 生成圖服務（agent 產出、存於 data/images/<批次id>/<uid>.png）----------


@app.route("/api/images/<uid>")
def api_get_image(uid):
    """取用已生成的主視覺 PNG（以圖 uid 指認；批次子資料夾、舊版扁平檔皆可）。"""
    path = _find_image(uid)
    if not path:
        return jsonify({"error": "尚未生成"}), 404
    return send_file(path, mimetype="image/png")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Ad Generator 看板")
    ap.add_argument("--data-dir", help="創意資料目錄（其下需有 creatives/），預設 ./data")
    # 預設 5050：macOS 的 AirPlay 接收器佔 5000，避開它（可用 --port 或 PORT 環境變數覆寫）
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 5050)))
    ap.add_argument("--reload", action="store_true", help="開發用：改 server.py 存檔就自動重啟（仍 debug=False）")
    args = ap.parse_args()
    if args.data_dir:
        DIR_CREATIVES = os.path.join(args.data_dir, "creatives")
    print(f"\nAd Generator server 執行中：http://localhost:{args.port}", flush=True)
    print(f"創意資料目錄：{DIR_CREATIVES}", flush=True)
    print(f"生成圖目錄：{_images_dir()}（由 agent 用 CDP 瀏覽器產圖後寫入）\n", flush=True)
    try:
        app.run(host="127.0.0.1", port=args.port, debug=False, threaded=True, use_reloader=args.reload)
    except OSError as e:
        print(f"\n啟動失敗：port {args.port} 無法綁定（{e}），請改用 --port 指定別的 port。", flush=True)
        sys.exit(1)
