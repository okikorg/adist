// Declare modules without type definitions
declare module 'fuzzy';
declare module 'ink';
declare module 'ink-spinner';
declare module 'ink-select-input';
declare module 'ink-text-input';
declare module 'fast-glob';
declare module 'picocolors';
declare module 'conf';

// Node.js modules
declare module 'fs/promises';
declare module 'path';
declare module 'fs';

declare module 'cli-highlight' {
  export type Style = 'reset' | 'bold' | 'dim' | 'italic' | 'underline' | 'inverse' | 'hidden' | 'strikethrough' | 
    'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'gray' | 
    'bgBlack' | 'bgRed' | 'bgGreen' | 'bgYellow' | 'bgBlue' | 'bgMagenta' | 'bgCyan' | 'plain';
  
  export interface Tokens<T> {
    keyword?: T;
    built_in?: T;
    type?: T;
    literal?: T;
    number?: T;
    regexp?: T;
    string?: T;
    subst?: T;
    symbol?: T;
    class?: T;
    function?: T;
    title?: T;
    params?: T;
    comment?: T;
    doctag?: T;
    meta?: T;
    'meta-keyword'?: T;
    'meta-string'?: T;
    section?: T;
    tag?: T;
    name?: T;
    'builtin-name'?: T;
    attr?: T;
    attribute?: T;
    variable?: T;
    bullet?: T;
    code?: T;
    emphasis?: T;
    strong?: T;
    formula?: T;
    link?: T;
    quote?: T;
    'selector-tag'?: T;
    'selector-id'?: T;
    'selector-class'?: T;
    'selector-attr'?: T;
    'selector-pseudo'?: T;
    'template-tag'?: T;
    'template-variable'?: T;
    addition?: T;
    deletion?: T;
    default?: T;
  }
  
  export interface JsonTheme extends Tokens<Style | Style[]> {}
  
  export interface Theme extends Tokens<(codePart: string) => string> {
    default?: (codePart: string) => string;
  }
  
  export interface HighlightOptions {
    language?: string;
    ignoreIllegals?: boolean;
    languageSubset?: string[];
    theme?: Theme | JsonTheme;
  }
  
  export function highlight(code: string, options?: HighlightOptions): string;
  export const plain: (codePart: string) => string;
  export const DEFAULT_THEME: Theme;
  export function fromJson(json: JsonTheme): Theme;
}

export interface Project {
    path: string;
    name: string;
    indexed: boolean;
    lastIndexed?: Date;
    hasSummaries?: boolean;
}

export interface AdistConfig {
    projects: Record<string, Project>;
    currentProject?: string;
}

// Block-based indexing types
export interface DocumentBlock {
  id: string;             // Unique ID for the block
  type: BlockType;        // Type of block
  content: string;        // Content of the block
  startLine: number;      // Start line number (1-indexed)
  endLine: number;        // End line number (1-indexed)
  path: string;           // File path relative to project root
  title?: string;         // Block title (e.g., header text, function name)
  parent?: string;        // Parent block ID (for hierarchy)
  children?: string[];    // Child block IDs
  metadata?: BlockMetadata; // Additional metadata based on block type
  summary?: string;       // Optional summary of the block
}

export type BlockType = 
  // Document blocks
  'document' |            // The entire document
  'heading' |             // A markdown heading section
  'paragraph' |           // A paragraph of text
  'list' |                // A list in markdown
  'listItem' |            // An item within a list
  'codeblock' |           // A code block in markdown
  'table' |               // A table in markdown
  
  // Code blocks
  'imports' |             // Import statements section
  'interface' |           // Interface declaration
  'type' |                // Type declaration
  'class' |               // Class declaration
  'function' |            // Function declaration
  'method' |              // Class method
  'variable' |            // Variable declaration
  'export' |              // Export statement
  'comment' |             // Comment block
  'jsx' |                 // JSX/TSX component
  'unknown';              // Fallback type

export interface BlockMetadata {
  language?: string;      // For code blocks
  level?: number;         // For headings (h1, h2, etc.)
  tags?: string[];        // Extracted tags or keywords
  dependencies?: string[]; // For imports, what's being imported
  exports?: string[];     // For exports, what's being exported
  signature?: string;     // For functions, methods, etc.
  visibility?: 'public' | 'private' | 'protected'; // For class members
  ordered?: boolean;      // For ordered lists in markdown
  spread?: boolean;       // For spread lists in markdown
  checked?: boolean;      // For checkboxes in markdown
  name?: string;          // Name of the entity (function, class, variable, etc.)
}

export interface IndexedDocument {
  path: string;           // File path relative to project root
  blocks: DocumentBlock[]; // Blocks in the document
  title: string;          // Document title
  lastModified: number;   // Last modified timestamp
  size: number;           // File size in bytes
  language?: string;      // Detected language
  blockHierarchy: BlockHierarchy; // Hierarchical structure
}

export interface BlockHierarchy {
  root: string;           // Root block ID
  blockMap: Record<string, {
    block: string;        // Block ID
    children: string[];   // Child block IDs
  }>;
}

export interface SearchResult {
  document: string;       // Document path
  blocks: DocumentBlock[]; // Matching blocks
  score: number;          // Relevance score
} 