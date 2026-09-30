import json
import os


class ConfigError(Exception):
    pass


def default_config_path(env=os.environ):
    if env.get("CHUB_CONFIG_FILE"):
        return env["CHUB_CONFIG_FILE"]
    base = env.get("LOCALAPPDATA") or os.path.expanduser("~")
    return os.path.join(base, "chub-team-status", "config.json")


def load_config(path=None, env=os.environ):
    path = path or default_config_path(env)
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError:
        raise ConfigError("設定ファイルを読めません。置き場所: %s" % path)
    try:
        cfg = json.loads(text)
    except ValueError:
        # 例外文字列に中身（キー）が入りうるので、理由だけ伝える
        raise ConfigError("設定ファイルの JSON が壊れています: %s" % path)
    if not isinstance(cfg, dict):
        raise ConfigError("設定ファイルの形式が違います: %s" % path)
    base_url = str(cfg.get("base_url") or "").strip().rstrip("/")
    api_key = str(cfg.get("api_key") or "").strip()
    if not api_key:
        raise ConfigError("api_key が空です: %s" % path)
    if not base_url.startswith("https://"):
        raise ConfigError("base_url は https:// で始まる必要があります（C-HUB は HTTPS のみ）")
    return {"base_url": base_url, "api_key": api_key}
