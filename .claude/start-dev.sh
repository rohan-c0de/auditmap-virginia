#!/bin/bash
export PATH="/opt/homebrew/bin:$PATH"
cd /Users/rohanupalekar/claudecode/auditmap-virginia
exec /opt/homebrew/bin/node node_modules/.bin/next dev "$@"
