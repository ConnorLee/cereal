#!/bin/zsh
# Double-click to start Cereal in Terminal.
# The first time, macOS asks whether Terminal may read your Documents and Desktop folders.
# Allow it and Cereal can read the projects you approved there. Cereal only ever reads them.
cd "${0:A:h}/.."
export NVM_DIR="$HOME/.nvm"
[ -s /opt/homebrew/opt/nvm/nvm.sh ] && . /opt/homebrew/opt/nvm/nvm.sh
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null; then
  command -v nvm >/dev/null && nvm use 22 >/dev/null 2>&1
fi
lsof -ti tcp:${PORT:-4317} | xargs kill 2>/dev/null
echo "Starting Cereal at http://127.0.0.1:${PORT:-4317}  (close this window to stop it)"
exec node server.mjs
