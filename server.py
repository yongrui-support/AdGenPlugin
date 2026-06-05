"""
Ad Generator — Backend（創意檢視看板 + 生圖）

負責：
1. 服務前端 index.html，並以唯讀方式提供 <data-dir>/creatives 底下的廣告素材 JSON 給 UI 檢視。
2. 設定：把使用者在看板填入的 OpenAI API key 寫進專案根目錄 .env（永不回傳前端、只綁 127.0.0.1）。
3. 生圖：用 OpenAI Responses API 的 image_generation 工具（gpt-image-2），把某組創意的
   composition_prompt（先把 {{content.x}} 換成實字）生成主視覺，存到 <data-dir>/images。

執行：
    uv run python server.py                         # 創意資料 = ./data，.env = ./
    uv run python server.py --data-dir /path/data   # 指定資料目錄（plugin 安裝後指向使用者專案）
接著開啟 http://localhost:5000
"""

import argparse
import base64
import glob
import json
import os
import re
import sys

# 強制 stdout/stderr 使用 UTF-8（避免 Windows cp950/cp1252 出現 UnicodeEncodeError）
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

from flask import Flask, jsonify, request, send_file
from flask_cors import CORS

ROOT = os.path.dirname(os.path.abspath(__file__))  # 前端靜態檔（index.html / frontend/）位置
# 創意資料目錄：預設 cwd/data（dev 在 repo 內跑時即 repo/data）；可用 DATA_DIR 環境變數或 --data-dir 覆寫。
DIR_CREATIVES = os.path.join(os.environ.get("DATA_DIR") or os.path.join(os.getcwd(), "data"), "creatives")
# API key 等機密放使用者專案根目錄的 .env（cwd = 使用者啟動 serve 的專案）
ENV_FILE = os.path.join(os.getcwd(), ".env")
# Responses 主模型（呼叫 image_generation 工具；底層用 gpt-image-2）。可用環境變數覆寫。
OPENAI_RESPONSES_MODEL = os.environ.get("OPENAI_RESPONSES_MODEL", "gpt-5.5")
# aspect → gpt-image-2 尺寸（邊長 16 倍數、比例 ≤3:1）
SIZE_BY_ASPECT = {"1:1": "1024x1024", "4:5": "1024x1280", "9:16": "720x1280", "16:9": "1280x720"}

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
CORS(app)


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
            with open(path, encoding="utf-8") as f:
                d = json.load(f)
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
    """單一創意產出的完整內容。"""
    d = _safe_read(DIR_CREATIVES, creative_id)
    if d is None:
        return jsonify({"error": "找不到該創意"}), 404
    return jsonify(d)


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


# ---------- 生圖（Responses API / image_generation 工具）----------


def _resolve_prompt(creative):
    """把 composition_prompt 裡的 {{content.欄位}} 換成該創意 content 的實字。"""
    content = creative.get("content") or {}
    return re.sub(
        r"\{\{content\.([A-Za-z0-9_]+)\}\}",
        lambda m: str(content.get(m.group(1), m.group(0))),
        creative.get("composition_prompt") or "",
    )


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


@app.route("/api/images", methods=["POST"])
def api_generate_image():
    """生成某批某組創意的主視覺，存檔並回傳可取用的 URL。body: {id, index, quality?}"""
    if not os.environ.get("OPENAI_API_KEY"):
        return jsonify({"error": "尚未設定 OpenAI API key，請先到右上『設定』填入"}), 400
    body = request.get_json(silent=True) or {}
    cid = body.get("id")
    idx = body.get("index")
    d = _safe_read(DIR_CREATIVES, cid)
    if d is None:
        return jsonify({"error": "找不到該創意"}), 404
    creatives = d.get("creatives") or []
    if not isinstance(idx, int) or idx < 0 or idx >= len(creatives):
        return jsonify({"error": "index 超出範圍"}), 400
    creative = creatives[idx]
    prompt = _resolve_prompt(creative)
    aspect = (d.get("brief") or {}).get("aspect", "1:1")
    size = SIZE_BY_ASPECT.get(aspect, "1024x1024")
    quality = body.get("quality") or "high"
    try:
        b64 = _generate_image_b64(prompt, size, quality)
    except Exception as e:
        return jsonify({"error": f"生圖失敗：{e}"}), 502
    if not b64:
        return jsonify({"error": "模型未回傳圖片"}), 502
    images_dir = _images_dir()
    os.makedirs(images_dir, exist_ok=True)
    with open(os.path.join(images_dir, f"{cid}__{idx}.png"), "wb") as f:
        f.write(base64.b64decode(b64))
    return jsonify({"ok": True, "url": f"/api/images/{cid}/{idx}"})


@app.route("/api/images/<cid>/<int:idx>")
def api_get_image(cid, idx):
    """取用已生成的主視覺 PNG。"""
    if not cid or cid != os.path.basename(cid) or ".." in cid:
        return jsonify({"error": "bad id"}), 404
    path = os.path.join(_images_dir(), f"{cid}__{idx}.png")
    if not os.path.isfile(path):
        return jsonify({"error": "尚未生成"}), 404
    return send_file(path, mimetype="image/png")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Ad Generator 看板 + 生圖")
    ap.add_argument("--data-dir", help="創意資料目錄（其下需有 creatives/），預設 ./data")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 5000)))
    args = ap.parse_args()
    if args.data_dir:
        DIR_CREATIVES = os.path.join(args.data_dir, "creatives")
    print(f"\nAd Generator server 執行中：http://localhost:{args.port}", flush=True)
    print(f"創意資料目錄：{DIR_CREATIVES}", flush=True)
    print(f"生圖輸出目錄：{_images_dir()}", flush=True)
    print(f".env：{ENV_FILE}（OpenAI key{'已' if os.environ.get('OPENAI_API_KEY') else '未'}設定）\n", flush=True)
    app.run(host="127.0.0.1", port=args.port, debug=False)
