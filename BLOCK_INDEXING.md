# Enhanced Block Indexing in ADIST

This document explains the advanced block indexing features implemented in ADIST for improved code and documentation search.

## Key Improvements

### 1. Semantic Chunking

Instead of relying solely on syntactic structures (functions, classes, markdown headers), the indexer now uses semantic boundaries to create more meaningful blocks:

- **Adaptive Block Sizing**: Large blocks (e.g., very long paragraphs in markdown or complex functions) are automatically split into smaller, semantically coherent units.
- **Sentence Boundary Detection**: Markdown text is split along sentence boundaries to ensure coherent chunks.
- **Minimum/Maximum Size Limits**: Configurable constraints ensure blocks are neither too large nor too small.

### 2. Contextual Overlap

Blocks now include a small amount of contextual information from adjacent blocks:

- **Overlapping Content**: Each block includes a few sentences from neighboring blocks.
- **Prevents Context Loss**: Ensures that information spanning a boundary isn't lost when searching.
- **Improves Relevance**: Queries matching text near block boundaries will still find the right blocks.

### 3. Enhanced Metadata Extraction

Each block now contains richer metadata:

- **Semantic Summaries**: Concise descriptions of what a block contains or does.
- **Code Metrics**: Functions include cyclomatic complexity and size metrics.
- **API Calls**: Functions track what other functions they call.
- **Variable Usage**: Blocks track variables they define and use.

### 4. Intra-File Relationship Linking

Blocks are now linked to other related blocks within the same file:

- **Function Calls**: Function blocks link to the functions they call.
- **Variable Usage**: Blocks link to variable definition blocks they reference.
- **Split Block Relationships**: When large blocks are split, the resulting smaller blocks link to each other.

## Implementation Details

### For Markdown Files

- Headers establish the basic hierarchy
- Large paragraphs are split at sentence boundaries
- Overlapping content maintains context between blocks

### For Code Files

- Using tree-sitter for precise AST-based parsing
- Functions, methods, and classes are the primary block types
- Advanced code analysis tracks variable definitions/usage and function calls
- Each function gets a simple semantic summary based on its name and behavior

## How These Improvements Help

1. **More Precise Search Results**: Smaller, semantically coherent blocks lead to more precise search matches.
2. **Better Context Preservation**: Overlapping content ensures you don't miss information at block boundaries.
3. **Semantic Understanding**: Enhanced metadata helps the search engine understand the code's purpose and behavior.
4. **Related Block Discovery**: Relationship links help find related blocks that might not match the search terms directly.

## Configuration Options

The block indexer supports these configuration options:

- `MAX_BLOCK_SIZE`: Maximum number of lines a block should have before splitting (default: 50)
- `MIN_BLOCK_SIZE`: Minimum size for a standalone block (default: 5)
- `OVERLAP_SIZE`: Number of lines or sentences to overlap (default: 3)

---

These indexing improvements significantly enhance ADIST's ability to find relevant code and documentation, especially in large codebases with complex files. 