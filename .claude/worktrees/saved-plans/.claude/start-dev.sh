#!/bin/bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export NODE_OPTIONS=""
cd /Users/rohanupalekar/claudecode/auditmap-virginia
exec /opt/homebrew/bin/node node_modules/.bin/next dev -p 3007 "$@"
