# Adist

A powerful CLI tool for indexing, searching, and having AI-powered conversations about your projects.

Developed by [okik.ai](https://okik.ai).

## Features

- 🔍 Fast document indexing and semantic searching
- 📁 Support for multiple projects
- 🎯 Project-specific search
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

Ask questions about your project and get AI-powered answers with real-time streaming responses. The AI analyzes relevant documents from your codebase to provide contextual answers.

### Chat with AI About Your Project

```bash
adist chat
```

Start an interactive chat session with AI about your project. This mode provides:
- Persistent conversation history within the session
- Context awareness across multiple questions
- Real-time streaming responses
- Automatic retrieval of relevant documents for each query

Type `exit` to end the chat session.

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
- Ollama (run locally, no API key needed)

When using Ollama, you can select from your locally installed models and customize the API URL if needed.

## LLM Features

The tool supports several LLM-powered features using either Anthropic's Claude model (cloud) or Ollama models (local):

### Document Summarization

Generate summaries of your project files to help understand large codebases quickly.

### Question Answering

Get specific answers about your codebase without having to manually search through files.

### Interactive Chat

Have a natural conversation about your project, with the AI maintaining context between questions.

### Streaming Responses

All AI interactions provide real-time streaming responses, showing the AI's answer as it's being generated instead of waiting for the complete response.

## Setting Up

You have two options for using LLM features:

### Option 1: Anthropic Claude (Cloud)

1. Set your Anthropic API key in the environment:
   ```bash
   export ANTHROPIC_API_KEY='your-api-key-here'
   ```

2. (Optional) Configure to use Anthropic explicitly:
   ```bash
   adist llm-config
   ```

### Option 2: Ollama (Local)

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

- Added support for Ollama to run LLM features locally without an API key
- Added LLM provider configuration command for easy switching between Anthropic and Ollama
- Added real-time streaming responses for chat and query commands
- Improved context caching for faster repeated queries on similar topics
- Enhanced document relevance ranking for more accurate results
- Added automatic related document discovery for richer context
- Optimized token usage to reduce API costs

## License

MIT 