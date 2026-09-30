import argparse
import json
import os
import shutil
import sys
from datetime import date, datetime, timedelta, timezone

from aggregate import aggregate
from chub_client import ChubError, Client
from chub_config import ConfigError, load_config
from fetch import fetch_all
from render_html import render


def prune(runs_dir, keep=5):
    if not os.path.isdir(runs_dir):
        return []
    names = sorted(n for n in os.listdir(runs_dir) if os.path.isdir(os.path.join(runs_dir, n)))
    removed = names[:-keep] if keep else names
    for n in removed:
        shutil.rmtree(os.path.join(runs_dir, n), ignore_errors=True)
    return removed


def _default_client(cfg):
    return Client(cfg["base_url"], cfg["api_key"])


def _dump(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1, default=str)


def main(argv=None, env=os.environ, client_factory=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", nargs="?", default="consult", choices=["consult", "report", "レポート"])
    ap.add_argument("--today")
    ap.add_argument("--stale-days", type=int, default=14)
    args = ap.parse_args(argv)
    try:
        cfg = load_config(env=env)
        print("接続先: %s" % cfg["base_url"])
        client = (client_factory or _default_client)(cfg)
        raw = fetch_all(client)
        jst_today = (datetime.now(timezone.utc) + timedelta(hours=9)).date()
        today = date.fromisoformat(args.today) if args.today else jst_today
        agg = aggregate(raw, today, args.stale_days)

        base = env.get("LOCALAPPDATA") or os.path.expanduser("~")
        runs = os.path.join(base, "chub-team-status", "runs")
        run_dir = os.path.join(runs, datetime.now().strftime("%Y%m%d-%H%M%S"))
        os.makedirs(run_dir, exist_ok=True)
        _dump(os.path.join(run_dir, "raw.json"), raw)
        _dump(os.path.join(run_dir, "aggregate.json"), agg)
        print("集計: %s" % os.path.join(run_dir, "aggregate.json"))
        if args.mode in ("report", "レポート"):
            html_path = os.path.join(run_dir, "dashboard.html")
            with open(html_path, "w", encoding="utf-8") as f:
                f.write(render(agg))
            print("HTML: %s" % html_path)
        prune(runs, keep=5)
        return 0
    except (ConfigError, ChubError) as e:
        print("エラー: %s" % e)
        return 1
    except Exception as e:  # キーが紛れ込む経路を断つため、種類名だけ出す
        print("想定外のエラー: %s" % type(e).__name__)
        return 1


if __name__ == "__main__":
    sys.exit(main())
