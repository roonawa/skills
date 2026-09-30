import json
import time
import urllib.error
import urllib.parse
import urllib.request


class ChubError(Exception):
    pass


class ChubHttpError(ChubError):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # 追いかけない（キーをリダイレクト先に送らない）


def _default_transport(url, headers):
    opener = urllib.request.build_opener(_NoRedirect)
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with opener.open(req, timeout=30) as r:
            return r.status, r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, ""


_MESSAGES = {
    401: "401: キーが違う・期限切れ・失効済み、または接続先の違い",
    403: "403: キーの権限不足（task-manager:read が必要）",
    429: "429: 回数上限に達しました（再試行後も解消せず）",
}


class Client:
    def __init__(self, base_url, api_key, transport=None, sleep=time.sleep, interval=0.5):
        self._base = base_url.rstrip("/")
        self._key = api_key
        self._transport = transport or _default_transport
        self._sleep = sleep
        self._interval = interval
        self._first = True

    def get(self, path, params=None):
        url = self._base + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        headers = {"Authorization": "Bearer " + self._key, "Accept": "application/json"}
        if not self._first:
            self._sleep(self._interval)
        self._first = False
        status, body = self._transport(url, headers)
        if status == 429:
            self._sleep(60)
            status, body = self._transport(url, headers)
        if status != 200:
            raise ChubHttpError(status, _MESSAGES.get(status, "HTTP %d" % status))
        try:
            return json.loads(body)
        except ValueError:
            raise ChubError("レスポンスが JSON ではありません")
