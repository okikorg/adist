#!/bin/bash

# Script to update the Homebrew formula for adist

set -e # Exit on any errors

# Configuration
REPO_URL="https://github.com/okikorg/adist"
TAP_REPO="homebrew-tap"
FORMULA_NAME="adist"

# Get the current version from package.json
VERSION=$(node -e "console.log(require('./package.json').version)")

echo "Current version in package.json: v$VERSION"

# Create a temporary directory
TMP_DIR=$(mktemp -d)
cd $TMP_DIR

# Download the tarball to calculate the SHA256
echo "Downloading release tarball to calculate SHA256..."
curl -L "$REPO_URL/archive/refs/tags/v$VERSION.tar.gz" -o "$FORMULA_NAME-$VERSION.tar.gz"

if [ ! -f "$FORMULA_NAME-$VERSION.tar.gz" ]; then
    echo "Error: Failed to download tarball. Make sure the GitHub release exists."
    echo "Create a release on GitHub at: $REPO_URL/releases/new with tag v$VERSION"
    exit 1
fi

# Calculate SHA256
SHA256=$(shasum -a 256 "$FORMULA_NAME-$VERSION.tar.gz" | cut -d' ' -f1)
echo "SHA256: $SHA256"

# Clean up temp directory
cd -
rm -rf $TMP_DIR

# Update the formula
echo "Updating formula with new version and SHA256..."
sed -i '' "s|url \".*\"|url \"$REPO_URL/archive/refs/tags/v$VERSION.tar.gz\"|" $FORMULA_NAME.rb
sed -i '' "s|sha256 \".*\"|sha256 \"$SHA256\"|" $FORMULA_NAME.rb
sed -i '' "s|assert_match \".*\"|assert_match \"$VERSION\"|" $FORMULA_NAME.rb

echo "Formula updated successfully!"
echo ""
echo "Next steps:"
echo "1. Test the formula: brew install --build-from-source ./$FORMULA_NAME.rb"
echo "2. Push to your homebrew-tap repository:"
echo "   git add $FORMULA_NAME.rb"
echo "   git commit -m \"Update $FORMULA_NAME to version $VERSION\""
echo "   git push origin main"
echo ""
echo "Users can install with: brew install okikorg/tap/$FORMULA_NAME" 