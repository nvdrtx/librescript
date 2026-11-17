#!/bin/zsh
# Runs the logic tests with macOS's built-in JavaScriptCore (no Node needed).
cd "${0:A:h}"
exec /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/model.test.mjs
