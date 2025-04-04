# Adist Homebrew Formula

This repository contains a Homebrew formula for installing [Adist](https://github.com/okikorg/adist), a powerful CLI tool for indexing, searching, and having AI-powered conversations about your projects.

## Installation

### Option 1: Install directly from GitHub

```bash
brew install okikorg/tap/adist
```

### Option 2: Manual installation

1. Clone this repository:
```bash
git clone https://github.com/okikorg/homebrew-tap.git
cd homebrew-tap
```

2. Install using the formula:
```bash
brew install --build-from-source ./adist.rb
```

## Usage

After installation, you can use the `adist` command:

```bash
# Get help
adist --help

# Initialize a project
adist init my-project

# Search your codebase
adist get "how does authentication work"

# Have AI analyze your code
adist query "explain the authentication flow"

# Start an interactive chat session about your code
adist chat
```

## Updating

To update to the latest version:

```bash
brew update
brew upgrade adist
```

## Uninstalling

```bash
brew uninstall adist
```

## Creating Your Own Tap

If you're the maintainer of this formula, here are instructions for creating and maintaining your own tap:

1. Create a GitHub repository named `homebrew-tap`
2. Add this formula file to the repository
3. Ensure the URL in the formula points to a valid release tarball
4. Update the SHA256 checksum in the formula (you can calculate it with `shasum -a 256 <downloaded-tarball>`)
5. Update the version in the formula whenever you release a new version

Users will then be able to install using:
```bash
brew tap okikorg/tap
brew install adist
``` 