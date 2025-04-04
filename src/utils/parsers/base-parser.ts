import * as path from 'path';
import { DocumentBlock, IndexedDocument } from '../../types.js';

/**
 * Base interface for document parsers
 */
export interface Parser {
  /**
   * Checks if this parser can handle a specific file
   * @param filePath The path to the file
   * @param content The file content (optional)
   * @returns true if this parser can handle the file
   */
  canParse(filePath: string, content?: string): boolean;
  
  /**
   * Parse a file into a document
   * @param filePath The path to the file
   * @param content The file content
   * @param stats The file stats (size, modified date)
   * @returns The parsed document
   */
  parse(
    filePath: string,
    content: string,
    stats: { size: number; mtime: Date }
  ): Promise<IndexedDocument>;
}

/**
 * Get a document title from its path
 */
export function getDocumentTitle(filePath: string): string {
  const basename = path.basename(filePath);
  return basename;
}

/**
 * Document block metadata types
 */
export interface BlockMetadata {
  name?: string;
  signature?: string;
  dependencies?: string[];
  src?: string;
  type?: string;
  level?: number;
}

/**
 * Generate a unique ID for a block
 */
export function generateBlockId(path: string, type: string, startLine: number): string {
  return `${path}:${type}:${startLine}`;
} 