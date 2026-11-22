"""Approves the TV's pairing code as the stack's admin, as the /pair page would from a phone.

Usage: python3 dev/android-tcg/approve-pairing.py [CODE] [--url URL] [--email E] [--password P]

Without a code it waits for the only pending pairing. The defaults are the e2e stack's admin.
It signs in to Streamline, gets an app key from the player extension (authorization code with
PKCE, as a native app does) and calls the admin pairing endpoints with it.
"""

import argparse
import base64
import hashlib
import http.cookiejar
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

REDIRECT = "http://127.0.0.1:41999/cb"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("code", nargs="?")
    ap.add_argument("--url", default="http://127.0.0.1:8081")
    ap.add_argument("--email", default="e2e-admin@streamline.local")
    ap.add_argument("--password", default="e2e-Admin-Passw0rd!")
    args = ap.parse_args()
    mount = args.url + "/extensions/player"
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()), NoRedirect
    )

    def call(method, url, body=None, key=None):
        headers = {"Content-Type": "application/json"} if body is not None else {}
        if key:
            headers["X-API-Key"] = key
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            res = opener.open(req)
            return res.status, res.headers, res.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers, e.read()

    status, _, raw = call(
        "POST", args.url + "/auth/login", {"email": args.email, "password": args.password}
    )
    if status != 204:
        sys.exit(f"sign-in: {status} {raw[:200]!r}")
    verifier = base64.urlsafe_b64encode(os.urandom(32)).rstrip(b"=").decode()
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    query = urllib.parse.urlencode(
        {
            "redirect_uri": REDIRECT,
            "state": "s",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
    )
    status, headers, raw = call("GET", mount + "/authorize?" + query)
    if status != 302:
        sys.exit(f"authorize: {status} {raw[:200]!r}")
    code = urllib.parse.parse_qs(urllib.parse.urlparse(headers["Location"]).query)["code"][0]
    token = {
        "grant_type": "authorization_code",
        "code": code,
        "code_verifier": verifier,
        "redirect_uri": REDIRECT,
        "client_id": "android-tcg-approve",
        "name": "android-tcg approve",
        "platform": "linux",
    }
    status, _, raw = call("POST", mount + "/auth/token", token)
    if status != 200:
        sys.exit(f"token: {status} {raw[:200]!r}")
    key = json.loads(raw)["api_key"]

    user_code = args.code
    for _ in range(60):
        if user_code:
            break
        _, _, raw = call("GET", mount + "/admin/pairings", key=key)
        items = json.loads(raw).get("items", [])
        if len(items) == 1:
            user_code = items[0]["user_code"]
            print(f"pending: {user_code} from {items[0]['name']} ({items[0]['platform']})")
        else:
            time.sleep(5)
    if not user_code:
        sys.exit("no single pending pairing after 5 minutes")
    status, _, raw = call(
        "POST",
        f"{mount}/admin/pairings/{urllib.parse.quote(user_code)}/approve",
        {"user_id": 1},
        key=key,
    )
    print(f"approve {user_code}: {status} {raw.decode()[:200]}")
    sys.exit(0 if status == 204 else 1)


if __name__ == "__main__":
    main()
