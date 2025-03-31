import { IndexedDocument } from '../../types.js';
import { Parser } from './base-parser.js';
import { MarkdownParser } from './markdown-parser.js';
import { CodeParser } from './code-parser.js';

/**
 * Registry for document parsers
 * Maintains a list of parsers and selects the appropriate one for each file
 */
export class ParserRegistry {
  private parsers: Parser[];
  
  constructor() {
    // Register all parsers
    this.parsers = [
      new MarkdownParser(),
      new CodeParser(),
      // Add more parsers here as needed
    ];
  }
  
  /**
   * Find a parser that can handle the given file
   */
  findParser(filePath: string, content: string): Parser | null {
    for (const parser of this.parsers) {
      if (parser.canParse(filePath, content)) {
        return parser;
      }
    }
    return null;
  }
  
  /**
   * Parse a file using the appropriate parser
   */
  async parse(
    filePath: string, 
    content: string, 
    stats: { size: number; mtime: Date }
  ): Promise<IndexedDocument | null> {
    const parser = this.findParser(filePath, content);
    
    if (!parser) {
      // Create a fallback document without structured blocks
      return {
        path: filePath,
        blocks: [{
          id: filePath,
          type: 'document',
          content,
          startLine: 1,
          endLine: content.split('\n').length,
          path: filePath,
          title: filePath.split('/').pop() || filePath,
        }],
        title: filePath.split('/').pop() || filePath,
        lastModified: stats.mtime.getTime(),
        size: stats.size,
        language: filePath.split('.').pop() || 'unknown',
        blockHierarchy: {
          root: filePath,
          blockMap: {
            [filePath]: {
              block: filePath,
              children: []
            }
          }
        }
      };
    }
    
    return await parser.parse(filePath, content, stats);
  }
} 