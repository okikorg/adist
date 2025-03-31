# Adist

A powerful CLI tool for indexing, searching, and having AI-powered conversations about your projects.

Developed by [okik.ai](https://okik.ai).

## Contributing

Contributions are welcome! Feel free to submit issues and pull requests to help improve Adist.

The repository is hosted at [github.com/okikorg/adist](https://github.com/okikorg/adist.git).



> **⚠️ IMPORTANT**: This is an active development project. Breaking changes may occur between versions as we continue to improve the tool. Please check the changelog when updating.

## Features

- 🔍 Fast document indexing and semantic searching
- 📁 Support for multiple projects
- 🎯 Project-specific search
- 🧩 Block-based indexing for more precise document analysis
- 🤖 LLM-powered document summarization using Anthropic's Claude or local Ollama models
- 🗣️ Interactive chat with AI about your codebase
- 📊 Project statistics and file analysis
- 🔄 Easy project switching and reindexing
- ⚡ Real-time streaming responses for chat and queries

## Installation

```bash
npm install -g adist
```

## Usage

### Initialize a Project

```bash
adist init <project-name>
```

This will:
1. Create a new project configuration
2. Index all supported files in the current directory
3. Optionally generate LLM summaries if you have the ANTHROPIC_API_KEY set

### Search Documents

```bash
adist get "<query>"
```

Search for documents in the current project using natural language queries.

### Query Your Project with AI

```bash
adist query "<question>"
```

Ask questions about your project and get AI-powered answers. The AI analyzes relevant documents from your codebase to provide contextual answers with proper code highlighting.

For real-time streaming responses (note that code highlighting may be limited):

```bash
adist query "<question>" --stream
```

### Chat with AI About Your Project

```bash
adist chat
```

Start an interactive chat session with AI about your project. This mode provides:
- Persistent conversation history within the session
- Context awareness across multiple questions
- Code syntax highlighting for better readability
- Automatic retrieval of relevant documents for each query

By default, chat mode displays a loading spinner while generating responses. For real-time streaming responses, use:

```bash
adist chat --stream
```

Note that code highlighting may be limited in streaming mode.

Type `/exit` to end the chat session.

### Switch Projects

```bash
adist switch <project-name>
```

Switch to a different project for searching.

### List Projects

```bash
adist list
```

View all configured projects.

### Reindex Project

```bash
adist reindex
```

Reindex the current project. Use `--summarize` to generate LLM summaries:

```bash
adist reindex --summarize
```

This will:
1. Show project statistics (total files, size, word count)
2. Ask for confirmation before proceeding with summarization
3. Generate summaries for each file
4. Create an overall project summary

### View Summaries

```bash
adist summary
```

View the overall project summary. To view a specific file's summary:

```bash
adist summary --file <filename>
```

### Configure LLM Provider

```bash
adist llm-config
```

Configure which LLM provider to use:
- Anthropic Claude (cloud-based, requires API key)
  - Claude 3 Opus 
  - Claude 3 Sonnet 
  - Claude 3 Haiku
- OpenAI (cloud-based, requires API key)
  - GPT-4o 
  - GPT-4 Turbo
  - GPT-3.5 Turbo
- Ollama (run locally, no API key needed)
  - Choose from any locally installed models

When using Ollama, you can select from your locally installed models and customize the API URL if needed.

## LLM Features

The tool supports several LLM-powered features using Anthropic's Claude models, OpenAI's GPT models, or Ollama models (local):

### Document Summarization

Generate summaries of your project files to help understand large codebases quickly.

### Question Answering

Get specific answers about your codebase without having to manually search through files.

### Interactive Chat

Have a natural conversation about your project, with the AI maintaining context between questions.

### Streaming Responses

AI interactions can be used in two modes:
- Default mode: Shows a loading spinner while generating responses with full code highlighting
- Streaming mode: Shows real-time responses as they're being generated (use `--stream` flag)

```bash
# Default mode with loading spinner and code highlighting
adist query "How does authentication work?"

# Streaming mode with real-time responses
adist query "How does authentication work?" --stream
```

## Setting Up

You have three options for using LLM features:

### Option 1: Anthropic Claude (Cloud)

1. Set your Anthropic API key in the environment:
   ```bash
   export ANTHROPIC_API_KEY='your-api-key-here'
   ```

2. Configure to use Anthropic and select your preferred model:
   ```bash
   adist llm-config
   ```

### Option 2: OpenAI (Cloud)

1. Set your OpenAI API key in the environment:
   ```bash
   export OPENAI_API_KEY='your-api-key-here'
   ```

2. Configure to use OpenAI and select your preferred model:
   ```bash
   adist llm-config
   ```

### Option 3: Ollama (Local)

1. Install Ollama from [ollama.com/download](https://ollama.com/download)

2. Run Ollama and pull a model (e.g., llama3):
   ```bash
   ollama pull llama3
   ```

3. Configure adist to use Ollama:
   ```bash
   adist llm-config
   ```

4. Select Ollama and choose your preferred model from the list.

### Initialize Your Project

After setting up your preferred LLM provider:

1. Initialize your project:
   ```bash
   adist init <project-name>
   ```

2. Start interacting with your codebase:
   ```bash
   adist query "How does the authentication system work?"
   # or
   adist chat
   ```

## Supported File Types

The tool indexes a wide range of file types including:
- Markdown (.md)
- Text (.txt)
- Code files (.js, .ts, .py, .go, etc.)
- Documentation (.rst, .asciidoc)
- Configuration files (.json, .yaml, .toml)
- And many more

## Configuration

The tool stores its configuration in:
- macOS: `~/Library/Application Support/adist`
- Linux: `~/.config/adist`
- Windows: `%APPDATA%\adist`

## Recent Updates

- Improved chat and query commands with better code highlighting in non-streaming mode (default)
- Added `--stream` flag to chat and query commands for real-time streaming responses
- Added support for OpenAI models (GPT-4o, GPT-4 Turbo, GPT-3.5 Turbo)
- Added support for all Claude 3 models (Opus, Sonnet, Haiku)
- Added block-based indexing as the default method for faster and more precise document analysis
- Made block-based search the default search method for better contextual understanding
- Legacy indexing and search methods are still available under `legacy-reindex` and `legacy-get`
- Added support for Ollama to run LLM features locally without an API key
- Added LLM provider configuration command for easy switching between Anthropic, OpenAI, and Ollama
- Enhanced document relevance ranking for more accurate results
- Added automatic related document discovery for richer context
- Optimized token usage to reduce API costs

## Block-Based Indexing

The latest version of adist uses block-based indexing by default, which:

1. Splits documents into semantic blocks (functions, sections, paragraphs)
2. Indexes each block individually with its metadata
3. Allows for more precise searching and better context understanding
4. Improves AI interactions by providing more relevant code snippets

The previous full-document indexing method is still available as `legacy-reindex` and `legacy-get` commands.

## License

MIT 