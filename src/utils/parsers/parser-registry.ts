import { BlockHierarchy, DocumentBlock, IndexedDocument } from '../../types.js';
import path from 'path';
import { Parser } from './base-parser.js';
import { MarkdownParser } from './markdown-parser.js';
import { CodeParser } from './code-parser.js';
import crypto from 'crypto';

// Try to dynamically import optional parsers
let JsonParser, YamlParser, CssParser, HtmlParser, GenericCodeParser;

// Process utilities for command execution
const executeCommand = async (command: string, args: string[] = [], options: any = {}): Promise<string> => {
  console.log(`Would execute: ${command} ${args.join(' ')}`);
  return '';
};

const isCommandAvailable = async (command: string): Promise<boolean> => {
  return false;
};

/**
 * Registry for document parsers
 * Manages different parser types and determines which parser to use for a given file
 */
export class ParserRegistry {
  private parsers: Parser[] = [];
  private cachedParsers: Map<string, Parser> = new Map();
  private parserCache: Map<string, IndexedDocument> = new Map();
  private readonly languageDetectors: LanguageDetector[] = [];
  
  constructor() {
    // Register built-in parsers
    this.registerParser(new MarkdownParser());
    this.registerParser(new CodeParser());
    
    // Try to register optional parsers
    try {
      // Dynamically import if needed
      // Using require would work in Node.js, but for browser compatibility
      // we'd need proper dynamic imports
      // For now, we'll stub this out since the optional parsers don't exist yet
      
      // this.registerParser(new JsonParser());
      // this.registerParser(new YamlParser());
      // this.registerParser(new CssParser());
      // this.registerParser(new HtmlParser());
      // this.registerParser(new GenericCodeParser());
    } catch (e) {
      console.warn("Optional parsers not available:", e);
    }
    
    // Initialize language detectors
    this.initializeLanguageDetectors();
  }

  /**
   * Register a new parser
   */
  registerParser(parser: Parser): void {
    this.parsers.push(parser);
  }
  
  /**
   * Find an appropriate parser for a file
   */
  findParser(filePath: string, content: string = ''): Parser | null {
    const ext = path.extname(filePath).toLowerCase();
    
    // Check cache first
    if (this.cachedParsers.has(ext)) {
      return this.cachedParsers.get(ext) || null;
    }
    
    // Find parser based on file extension
    for (const parser of this.parsers) {
      if (parser.canParse(filePath, content)) {
        // Cache this parser for this extension
        this.cachedParsers.set(ext, parser);
        return parser;
      }
    }
    
    return null;
  }
  
  /**
   * Initialize language detectors for files without specific extensions
   */
  private async initializeLanguageDetectors(): Promise<void> {
    // Check if we have the 'file' command available (for mime-type detection)
    try {
      const hasFileCommand = await isCommandAvailable('file');
      
      if (hasFileCommand) {
        this.languageDetectors.push({
          detect: async (filePath: string) => {
            try {
              const output = await executeCommand('file', ['--mime-type', '-b', filePath]);
              return output.trim();
            } catch (e) {
              return null;
            }
          }
        });
      }
    } catch (e) {
      console.warn("Language detection not available:", e);
    }
  }
  
  /**
   * Detect file language using available detectors
   */
  private async detectFileLanguage(filePath: string, content: string): Promise<string | null> {
    // Try each detector in sequence
    for (const detector of this.languageDetectors) {
      try {
        const result = await detector.detect(filePath);
        if (result) {
          return result;
        }
      } catch (e) {
        // Continue to next detector
      }
    }
    
    return null;
  }
  
  /**
   * Calculate a hash for file content
   */
  private calculateFileHash(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }
  
  /**
   * Parse a file into a document with blocks
   */
  async parse(
    filePath: string,
    content: string,
    stats: { size: number; mtime: Date }
  ): Promise<IndexedDocument> {
    try {
      // Check if we can use a cached version based on file hash
      const fileHash = this.calculateFileHash(content);
      const cacheKey = `${filePath}:${fileHash}`;
      
      if (this.parserCache.has(cacheKey)) {
        return this.parserCache.get(cacheKey)!;
      }

      // Try to find a parser
      const parser = this.findParser(filePath, content);
      
      if (parser) {
        try {
          // Parse the document
          const doc = await parser.parse(filePath, content, stats);
          
          // Cache result
          this.parserCache.set(cacheKey, doc);
          
          // Cache parser based on file extension
          const ext = path.extname(filePath).toLowerCase();
          if (!this.cachedParsers.has(ext)) {
            this.cachedParsers.set(ext, parser);
          }
          
          return doc;
        } catch (error) {
          console.error(`Error parsing ${filePath}:`, error);
        }
      }
    } catch (e) {
      console.warn("Error during parse caching:", e);
    }
    
    // If no parser is found or parsing fails, create a fallback document
    const blocks: DocumentBlock[] = [{
      id: 'root',
      type: 'document',
      content,
      startLine: 1,
      endLine: content.split('\n').length,
      path: filePath,
      title: path.basename(filePath),
      children: [],
    }];
    
    const blockHierarchy: BlockHierarchy = {
      root: 'root',
      blockMap: {
        root: {
          block: 'root',
          children: [],
        },
      },
    };
    
    const fallbackDoc = {
      path: filePath,
      blocks,
      title: path.basename(filePath),
      lastModified: stats.mtime.getTime(),
      size: stats.size,
      language: path.extname(filePath).replace('.', ''),
      blockHierarchy,
    };
    
    try {
      // Cache the fallback document
      const fileHash = this.calculateFileHash(content);
      const cacheKey = `${filePath}:${fileHash}`;
      this.parserCache.set(cacheKey, fallbackDoc);
    } catch (e) {
      console.warn("Error caching fallback document:", e);
    }
    
    return fallbackDoc;
  }
}

/**
 * Interface for language detectors
 */
interface LanguageDetector {
  detect(filePath: string): Promise<string | null>;
} 