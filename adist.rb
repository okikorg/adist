class Adist < Formula
  desc "A powerful CLI tool for indexing, searching, and having AI-powered conversations about projects"
  homepage "https://github.com/okikorg/adist"
  url "https://github.com/okikorg/adist/archive/refs/tags/v1.0.17.tar.gz"
  sha256 "d5558cd419c8d46bdc958064cb97f963d1ea793866414c025906ec15033512ed"
  license "MIT"
  
  depends_on "node@20"

  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    output = shell_output("#{bin}/adist --version")
    assert_match "1.0.17", output
  end
end 