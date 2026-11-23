"""Run a command with variables from an env file layered over the current env.

Used for staging runs of the agents backend/CLI. Their own load_dotenv() calls
do not override variables that are already set, so the staging values win.

    python scripts/run-with-env.py agents/.env.staging -- python main.py
"""
import os
import subprocess
import sys

from dotenv import dotenv_values

if len(sys.argv) < 4 or sys.argv[2] != "--":
    sys.exit("usage: run-with-env.py <env-file> -- <command...>")

env = os.environ.copy()
env.update({k: v for k, v in dotenv_values(sys.argv[1]).items() if v is not None})
print(f"[run-with-env] {sys.argv[1]} -> SUPABASE ref {env.get('SUPABASE_PROJECT_REF', '?')}", flush=True)
sys.exit(subprocess.call(sys.argv[3:], env=env))
