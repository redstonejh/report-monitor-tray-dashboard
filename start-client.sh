#!/usr/bin/env bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
nvm use 22 --silent
cd "$(dirname "$0")/status-monitor-client"
npm start
