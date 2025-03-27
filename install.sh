#!/bin/bash

echo "📦 Installing adist CLI tool..."

# Create necessary directories
mkdir -p src/commands
mkdir -p src/utils
mkdir -p bin

# Install dependencies
echo "📥 Installing dependencies..."
npm install
npm install --save-dev @types/node @types/react @types/node-notifier

# Build the project
echo "🔨 Building the project..."
if npm run build; then
  # Ensure executable permissions
  chmod +x bin/cli.js
  
  # Link the CLI tool globally
  echo "🔗 Linking adist globally..."
  npm link
  
  echo "✅ adist CLI tool has been installed successfully!"
  echo "You can now use 'adist' command from your terminal."
  echo ""
  echo "Try running 'adist --help' to see available commands."
else
  echo "❌ Build failed. Please check the errors above."
  echo "You might need to update the tsconfig.json file or fix type errors."
  echo ""
  echo "If you're having issues with module resolution, check that:"
  echo "1. tsconfig.json has moduleResolution set to 'NodeNext'"
  echo "2. module is set to 'NodeNext' in tsconfig.json"
  echo "3. All module declarations are in src/types.d.ts"
  exit 1
fi 