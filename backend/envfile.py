"""Minimal KEY=VALUE reader for the git-ignored .env file, so Windows users don't need extra tooling."""
import os

from dengue_ews.config import ROOT


def load_env_file(path=ROOT / ".env"):
    """Real environment variables win over the file."""
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                v = v.strip()
                if v[:1] in ('"', "'") and v[1:].find(v[0]) >= 0:   # quoted: keep everything inside the quotes
                    v = v[1:1 + v[1:].find(v[0])]
                elif " #" in v:                                    # unquoted: drop an inline comment
                    v = v.split(" #", 1)[0].rstrip()
                os.environ.setdefault(k.strip(), v)
    except FileNotFoundError:
        pass
