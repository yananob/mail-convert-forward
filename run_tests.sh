#!/bin/bash

# node_modules が存在しない場合は npm install を実行
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# テストを実行
echo "Running tests..."
npm test
