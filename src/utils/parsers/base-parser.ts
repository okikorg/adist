import { DocumentBlock, IndexedDocument } from '../../types.js';

/**
 * Base interface for all parser implementations
 */
export interface Parser {
  /**
   * Detect if this parser can handle the given file
   * @param filePath Path to the file
   * @param content File content
   */
  canParse(filePath: string, content: string): boolean;
  
  /**
   * Parse the file content into a tree of blocks
   * @param filePath Path to the file
   * @param content File content
   * @param stats File stats (for metadata)
   * @returns Parsed document with blocks
   */
  parse(
    filePath: string, 
    content: string, 
    stats: { size: number; mtime: Date }
  ): Promise<IndexedDocument>;
}

/**
 * Utility function to get the document title from the path
 */
export function getDocumentTitle(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1];
}

/**
 * Generate a unique ID for a block
 */
export function generateBlockId(path: string, type: string, startLine: number): string {
  return `${path}:${type}:${startLine}`;
} 