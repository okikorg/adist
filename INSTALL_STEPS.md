# Making adist Available via Homebrew

This guide provides step-by-step instructions for packaging and distributing adist via Homebrew.

## What You Have Now

You now have all the necessary files to distribute adist via Homebrew:

1. `adist.rb` - The Homebrew formula for installing adist
2. `update-homebrew.sh` - A script to update the formula with new versions
3. `HOMEBREW_README.md` - Instructions for users on how to install adist via Homebrew
4. `HOMEBREW_TAP_SETUP.md` - A guide for setting up your Homebrew tap

## Step-by-Step Guide

### 1. Ensure Your Repository Is Ready

- Make sure your adist repository on GitHub is public
- Ensure your code is well-documented and has a proper README.md

### 2. Create a Release on GitHub

1. Go to your repository on GitHub
2. Click on "Releases" in the right sidebar
3. Click "Create a new release"
4. Enter tag version (e.g., `v1.0.17`) matching your package.json version
5. Write release notes
6. Publish the release

This will automatically generate a tarball that Homebrew can download.

### 3. Set Up Your Homebrew Tap Repository

Create a new repository on GitHub named `homebrew-tap`:

```bash
# Locally
mkdir homebrew-tap
cd homebrew-tap
git init
git remote add origin https://github.com/yourusername/homebrew-tap.git
```

### 4. Add Your Formula

Copy the formula file to your tap repository:

```bash
cp adist.rb homebrew-tap/
cp HOMEBREW_README.md homebrew-tap/README.md
cd homebrew-tap
```

### 5. Commit and Push

```bash
git add adist.rb README.md
git commit -m "Add adist formula"
git push -u origin main
```

### 6. Test Your Homebrew Tap

```bash
# Add your tap
brew tap yourusername/tap

# Install adist
brew install adist
```

### 7. When Updating to a New Version

1. Update the version in your package.json
2. Create a new GitHub release with matching tag
3. Run the update script:
   ```bash
   ./update-homebrew.sh
   ```
4. Push changes to your tap repository

## Different Installation Methods for Users

Users can install adist in three ways:

### Method 1: Directly from your tap

```bash
brew install yourusername/tap/adist
```

### Method 2: Tapping first, then installing

```bash
brew tap yourusername/tap
brew install adist
```

### Method 3: Manual installation (for development)

```bash
brew install --build-from-source ./adist.rb
```

## Submitting to Homebrew Core (Optional)

If adist becomes popular, you can submit it to Homebrew Core for easier installation:

1. Fork the Homebrew/homebrew-core repository
2. Add your formula to the `Formula` directory
3. Submit a pull request

Users would then be able to install simply with:

```bash
brew install adist
```

## Troubleshooting

- If the SHA256 checksum is incorrect, update it with `./update-homebrew.sh`
- If installation fails, check if all dependencies are correctly specified
- For Node.js packages, ensure the formula is using the correct Node.js version

## Additional Resources

- [Homebrew Formula Cookbook](https://docs.brew.sh/Formula-Cookbook)
- [Homebrew Node.js Formula Guide](https://docs.brew.sh/Node-for-Formula-Authors)
- [Homebrew Taps Documentation](https://docs.brew.sh/Taps) 