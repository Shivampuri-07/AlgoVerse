#!/bin/bash
# Local verification run: npm install, validate data, tests, typecheck, lint, production
# build, browser-bundle secret scan, then the production server on port 3123 (auto-stops
# after 20 minutes) — production, so the service worker / PWA install can be tried.
#
# Builds into .next-verify/ (NEXT_DIST_DIR, see next.config.mjs), so it never touches the
# .next/ folder of a `npm run dev` you already have running. Logs go to .verify/.
cd "$(dirname "$0")/.." || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
export NEXT_DIST_DIR=.next-verify
mkdir -p .verify
: > .verify/summary.log
log() { echo "$*" | tee -a .verify/summary.log; }
log "node $(node -v) npm $(npm -v)  $(date)"
# Stop the dev server a previous run of this script started (it uses .next-verify too).
if pkill -f "next (dev|start) -p 3123" 2>/dev/null; then sleep 2; log "stopped the previous verify server on port 3123"; fi
if pgrep -f "next dev" >/dev/null 2>&1; then log "note: another 'next dev' is running (left untouched; this script uses .next-verify)"; fi
run() { local name=$1; shift; "$@" > ".verify/$name.log" 2>&1; local rc=$?; log "$name: exit $rc"; return $rc; }
run install npm install --no-audit --no-fund
log "@google/genai installed: $(node -p "require('./node_modules/@google/genai/package.json').version" 2>/dev/null || echo NO)"
run validate npm run validate:data
run test npm test
run typecheck npm run typecheck
run lint npm run lint
run build npm run build
if [ -d .next-verify/static ]; then
  # The browser bundle must never contain the API key, its variable name, the Gemini
  # endpoint or the SDK — the browser only talks to /api/ai.
  for pat in GEMINI_API_KEY AIza generativelanguage.googleapis.com @google/genai OPENROUTER openrouter; do
    n=$(grep -rlF "$pat" .next-verify/static 2>/dev/null | wc -l | tr -d ' ')
    log "browser bundle files containing '$pat': $n"
  done
  keyval=$(grep -E '^GEMINI_API_KEY=' .env.local 2>/dev/null | cut -d= -f2-)
  keyhits=0
  if [ -n "$keyval" ] && [ "$keyval" != "your_key_here" ]; then keyhits=$(grep -rlF "$keyval" .next-verify/static 2>/dev/null | wc -l | tr -d ' '); fi
  log "browser bundle files containing the actual key value: $keyhits"
fi
if lsof -iTCP:3123 -sTCP:LISTEN >/dev/null 2>&1; then log "port 3123 already in use; not starting a server"; else
  nohup npx next start -p 3123 > .verify/server.log 2>&1 &
  SRV=$!; echo $SRV > .verify/server.pid
  ( sleep 1200; pkill -f "next start -p 3123" 2>/dev/null ) >/dev/null 2>&1 &
  log "production server started on http://localhost:3123 (pid $SRV, stops automatically in 20 min)"
fi
log "DONE"
