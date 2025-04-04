import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { BlockHierarchy, BlockType, DocumentBlock, IndexedDocument } from '../../types.js';
import { Parser, getDocumentTitle, BlockMetadata } from './base-parser.js';

// Try to import yaml parser, but don't fail if not available
let yamlParser: any;
try {
  // @ts-ignore - We're dynamically importing
  yamlParser = require('js-yaml');
} catch (e) {
  // yaml parser not available
}

/**
 * Parser for YAML files
 * Creates a structured view of YAML content with blocks for each section
 */
export class YamlParser implements Parser {
  canParse(filePath: string, content?: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.yml' || ext === '.yaml';
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
      if (yamlParser) {
        // Parse YAML using js-yaml if available
        const yamlData = yamlParser.load(content);
        this.processYamlWithParser(yamlData, content, filePath, blocks, blockHierarchy, rootBlock.id);
      } else {
        // Fall back to regex-based approach
        this.processYamlWithRegex(content, filePath, blocks, blockHierarchy, rootBlock.id);
      }
    } catch (error) {
      console.warn(`Error parsing YAML file ${filePath}: ${error}`);
      // Just keep the root block if parsing fails
    }

    return {
      path: filePath,
      blocks,
      title: getDocumentTitle(filePath),
      lastModified: stats.mtime.getTime(),
      size: stats.size,
      language: 'yaml',
      blockHierarchy,
    };
  }
  
  /**
   * Process YAML file using js-yaml parser
   */
  private processYamlWithParser(
    yamlData: any,
    content: string,
    filePath: string,
    blocks: DocumentBlock[],
    blockHierarchy: BlockHierarchy,
    parentId: string
  ): void {
    if (typeof yamlData !== 'object' || yamlData === null) {
      return;
    }
    
    const lines = content.split('\n');
    
    // Process top-level sections of the YAML file
    for (const [key, value] of Object.entries(yamlData)) {
      // Find the key in the content to determine line numbers
      let startLine = -1;
      let endLine = -1;
      
      // Try to find the key in the YAML content
      for (let i = 0; i < lines.length; i++) {
        const lineContent = lines[i].trim();
        if (lineContent.startsWith(key + ':')) {
          startLine = i + 1;
          
          // Find the end of this section
          endLine = lines.length;
          const keyIndentation = lines[i].indexOf(key);
          
          for (let j = i + 1; j < lines.length; j++) {
            // If we hit a line with same or less indentation, we've reached the end
            if (lines[j].trim() !== '' && 
                lines[j].indexOf(lines[j].trim()[0]) <= keyIndentation) {
              endLine = j;
              break;
            }
          }
          
          break;
        }
      }
      
      if (startLine === -1) {
        continue; // Couldn't find the key for some reason
      }
      
      // Determine value type
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
      
      // Create block for this section
      const block: DocumentBlock = {
        id: uuidv4(),
        type: 'variable' as BlockType,
        content: lines.slice(startLine - 1, endLine).join('\n'),
        startLine,
        endLine,
        path: filePath,
        title: `${key}: ${valuePreview}`,
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
        this.processNestedYaml(value, content, filePath, blocks, blockHierarchy, block.id, startLine);
      }
    }
  }
  
  /**
   * Process nested YAML objects
   */
  private processNestedYaml(
    nestedData: any,
    content: string,
    filePath: string,
    blocks: DocumentBlock[],
    blockHierarchy: BlockHierarchy,
    parentId: string,
    baseStartLine: number
  ): void {
    if (typeof nestedData !== 'object' || nestedData === null) {
      return;
    }
    
    const lines = content.split('\n').slice(baseStartLine);
    
    for (const [key, value] of Object.entries(nestedData)) {
      // Find the key in the nested content
      let startLine = -1;
      let endLine = -1;
      
      for (let i = 0; i < lines.length; i++) {
        const lineContent = lines[i].trim();
        if (lineContent.startsWith(key + ':')) {
          startLine = baseStartLine + i + 1;
          
          // Find the end of this section
          endLine = lines.length + baseStartLine;
          const keyIndentation = lines[i].indexOf(key);
          
          for (let j = i + 1; j < lines.length; j++) {
            // If we hit a line with same or less indentation, we've reached the end
            if (lines[j].trim() !== '' && 
                lines[j].indexOf(lines[j].trim()[0]) <= keyIndentation) {
              endLine = baseStartLine + j;
              break;
            }
          }
          
          break;
        }
      }
      
      if (startLine === -1) {
        continue; // Couldn't find the key
      }
      
      // Create block for this nested property
      const block: DocumentBlock = {
        id: uuidv4(),
        type: 'variable' as BlockType,
        content: content.split('\n').slice(startLine - 1, endLine).join('\n'),
        startLine,
        endLine,
        path: filePath,
        title: key,
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
    }
  }
  
  /**
   * Process YAML file using regex (fallback if js-yaml is not available)
   */
  private processYamlWithRegex(
    content: string,
    filePath: string,
    blocks: DocumentBlock[],
    blockHierarchy: BlockHierarchy,
    parentId: string
  ): void {
    const lines = content.split('\n');
    
    // Find top-level entries (no indentation)
    let currentBlock: {
      key: string;
      startLine: number;
      endLine: number;
      level: number;
    } | null = null;
    
    const topLevelBlocks: {
      key: string;
      startLine: number;
      endLine: number;
      level: number;
    }[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // Skip empty lines and comments
      if (trimmed === '' || trimmed.startsWith('#')) {
        continue;
      }
      
      // Check if this is a top-level entry
      if (!line.startsWith(' ') && !line.startsWith('\t')) {
        // If there was a previous block, finalize it
        if (currentBlock) {
          currentBlock.endLine = i;
          topLevelBlocks.push(currentBlock);
        }
        
        // Check if this line has a key
        const keyMatch = trimmed.match(/^(\w+):/);
        if (keyMatch) {
          currentBlock = {
            key: keyMatch[1],
            startLine: i + 1,
            endLine: lines.length, // Default to end of file
            level: 0
          };
        }
      }
    }
    
    // Add the last block if exists
    if (currentBlock) {
      topLevelBlocks.push(currentBlock);
    }
    
    // Process each top-level block
    for (const block of topLevelBlocks) {
      // Create block
      const docBlock: DocumentBlock = {
        id: uuidv4(),
        type: 'variable' as BlockType,
        content: lines.slice(block.startLine - 1, block.endLine).join('\n'),
        startLine: block.startLine,
        endLine: block.endLine,
        path: filePath,
        title: block.key,
        parent: parentId,
        children: [],
        metadata: {
          name: block.key
        } as BlockMetadata,
      };
      
      blocks.push(docBlock);
      
      // Add to parent's children
      const parent = blocks.find(b => b.id === parentId);
      if (parent) {
        parent.children = parent.children || [];
        parent.children.push(docBlock.id);
      }
      
      // Update block map
      blockHierarchy.blockMap[docBlock.id] = {
        block: docBlock.id,
        children: [],
      };
    }
  }
} 