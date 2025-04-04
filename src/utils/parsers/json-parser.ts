import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { BlockHierarchy, BlockType, DocumentBlock, IndexedDocument } from '../../types.js';
import { Parser, getDocumentTitle, BlockMetadata } from './base-parser.js';

/**
 * Parser for JSON files
 * Creates a structured view of JSON content with blocks for each root property
 */
export class JsonParser implements Parser {
  canParse(filePath: string, content?: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.json';
  }

  async parse(
    filePath: string,
    content: string,
    stats: { size: number; mtime: Date }
  ): Promise<IndexedDocument> {
    const blocks: DocumentBlock[] = [];
    const blockHierarchy: BlockHierarchy = {
      root: '',
      blockMap: {},
    };
    
    // Create the root block
    const rootBlock: DocumentBlock = {
      id: uuidv4(),
      type: 'document',
      content,
      startLine: 1,
      endLine: content.split('\n').length,
      path: filePath,
      title: getDocumentTitle(filePath),
      children: [],
    };
    blocks.push(rootBlock);
    blockHierarchy.root = rootBlock.id;
    blockHierarchy.blockMap[rootBlock.id] = {
      block: rootBlock.id,
      children: [],
    };
    
    try {
      // Parse JSON
      const jsonData = JSON.parse(content);
      
      // Process root level properties
      if (typeof jsonData === 'object' && jsonData !== null) {
        const jsonEntries = Object.entries(jsonData);
        
        for (const [key, value] of jsonEntries) {
          this.processJsonProperty(
            key, 
            value, 
            content, 
            filePath, 
            blocks, 
            blockHierarchy, 
            rootBlock.id
          );
        }
      }
    } catch (error) {
      console.warn(`Error parsing JSON file ${filePath}: ${error}`);
      // Just keep the root block if parsing fails
    }

    return {
      path: filePath,
      blocks,
      title: getDocumentTitle(filePath),
      lastModified: stats.mtime.getTime(),
      size: stats.size,
      language: 'json',
      blockHierarchy,
    };
  }
  
  /**
   * Process a JSON property and create a block for it
   */
  private processJsonProperty(
    key: string,
    value: any,
    content: string,
    filePath: string,
    blocks: DocumentBlock[],
    blockHierarchy: BlockHierarchy,
    parentId: string
  ): void {
    // Find the key in the content to determine line numbers
    const keyPattern = new RegExp(`"${key}"\\s*:`, 'g');
    const match = keyPattern.exec(content);
    
    if (!match || match.index === undefined) {
      return; // Can't find this key in the content (shouldn't happen, but just in case)
    }
    
    // Determine the type of the value
    let valueType: string;
    let valuePreview: string;
    
    if (Array.isArray(value)) {
      valueType = 'array';
      valuePreview = `[${value.length} items]`;
    } else if (typeof value === 'object' && value !== null) {
      valueType = 'object';
      valuePreview = `{${Object.keys(value).length} properties}`;
    } else {
      valueType = typeof value;
      valuePreview = String(value).substring(0, 50);
      if (String(value).length > 50) {
        valuePreview += '...';
      }
    }
    
    // Calculate start line
    const beforeKey = content.substring(0, match.index);
    const startLine = beforeKey.split('\n').length;
    
    // Calculate end line
    const propertyValue = JSON.stringify(value, null, 2);
    const endLine = startLine + propertyValue.split('\n').length;
    
    // Create block for this property
    const block: DocumentBlock = {
      id: uuidv4(),
      type: 'variable' as BlockType,
      content: this.extractContent(content, startLine, endLine),
      startLine,
      endLine,
      path: filePath,
      title: `"${key}": ${valuePreview}`,
      parent: parentId,
      children: [],
      metadata: {
        name: key
      } as BlockMetadata,
    };
    
    blocks.push(block);
    
    // Add to parent's children
    const parent = blocks.find(b => b.id === parentId);
    if (parent) {
      parent.children = parent.children || [];
      parent.children.push(block.id);
    }
    
    // Update block map
    blockHierarchy.blockMap[block.id] = {
      block: block.id,
      children: [],
    };
    
    // Recursively process nested objects
    if (valueType === 'object') {
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        this.processJsonProperty(
          nestedKey,
          nestedValue,
          content,
          filePath,
          blocks,
          blockHierarchy,
          block.id
        );
      }
    }
  }
  
  /**
   * Extract content from line numbers
   */
  private extractContent(content: string, startLine: number, endLine: number): string {
    const lines = content.split('\n');
    return lines.slice(startLine - 1, endLine).join('\n');
  }
} 