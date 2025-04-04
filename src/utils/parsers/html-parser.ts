import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { BlockHierarchy, BlockType, DocumentBlock, IndexedDocument } from '../../types.js';
import { Parser, getDocumentTitle, BlockMetadata } from './base-parser.js';

/**
 * Parser for HTML files
 * Identifies semantic sections, components, and important elements
 */
export class HtmlParser implements Parser {
  canParse(filePath: string, content?: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.html' || ext === '.htm';
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
    
    // Parse the HTML document
    this.parseHtmlDocument(content, filePath, blocks, blockHierarchy, rootBlock.id);

    return {
      path: filePath,
      blocks,
      title: getDocumentTitle(filePath),
      lastModified: stats.mtime.getTime(),
      size: stats.size,
      language: 'html',
      blockHierarchy,
    };
  }
  
  /**
   * Parse HTML document structure
   */
  private parseHtmlDocument(
    content: string,
    filePath: string,
    blocks: DocumentBlock[],
    blockHierarchy: BlockHierarchy,
    rootId: string
  ): void {
    const lines = content.split('\n');
    
    // First, find the core sections
    this.findHtmlSections(lines, filePath, blocks, blockHierarchy, rootId);
    
    // Then find important elements
    this.findImportantElements(lines, filePath, blocks, blockHierarchy, rootId);
    
    // Find scripts
    this.findScriptBlocks(lines, filePath, blocks, blockHierarchy, rootId);
    
    // Find styles
    this.findStyleBlocks(lines, filePath, blocks, blockHierarchy, rootId);
  }
  
  /**
   * Find major HTML sections (head, body, main, header, footer, etc.)
   */
  private findHtmlSections(
    lines: string[],
    filePath: string,
    blocks: DocumentBlock[],
    blockHierarchy: BlockHierarchy,
    rootId: string
  ): void {
    const content = lines.join('\n');
    
    // Define sections to find
    const sections = [
      { tag: 'head', title: 'Head' },
      { tag: 'body', title: 'Body' },
      { tag: 'header', title: 'Header' },
      { tag: 'main', title: 'Main Content' },
      { tag: 'footer', title: 'Footer' },
      { tag: 'nav', title: 'Navigation' }
    ];
    
    for (const section of sections) {
      const regex = new RegExp(`<${section.tag}[^>]*>(.*?)</${section.tag}>`, 'is');
      const match = content.match(regex);
      
      if (match && match.index !== undefined) {
        // Calculate line numbers
        const beforeTag = content.substring(0, match.index);
        const startLine = beforeTag.split('\n').length;
        const sectionContent = match[0];
        const endLine = startLine + sectionContent.split('\n').length - 1;
        
        // Create block
        const block: DocumentBlock = {
          id: uuidv4(),
          type: 'document' as BlockType,
          content: sectionContent,
          startLine,
          endLine,
          path: filePath,
          title: section.title,
          parent: rootId,
          children: [],
        };
        
        blocks.push(block);
        
        // Add to parent's children
        const parent = blocks.find(b => b.id === rootId);
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
  }
  
  /**
   * Find important elements (forms, tables, divs with ids/classes)
   */
  private findImportantElements(
    lines: string[],
    filePath: string,
    blocks: DocumentBlock[],
    blockHierarchy: BlockHierarchy,
    rootId: string
  ): void {
    const content = lines.join('\n');
    
    // Find forms
    this.findTagWithAttributes(content, 'form', 'Form', filePath, blocks, blockHierarchy, rootId);
    
    // Find tables
    this.findTagWithAttributes(content, 'table', 'Table', filePath, blocks, blockHierarchy, rootId);
    
    // Find divs with id or class
    const divRegex = /<div[^>]+(?:id|class)=['"]([^'"]+)['"][^>]*>(.*?)<\/div>/gis;
    let match;
    
    while ((match = divRegex.exec(content)) !== null) {
      const idOrClass = match[1];
      const divContent = match[0];
      const beforeTag = content.substring(0, match.index);
      const startLine = beforeTag.split('\n').length;
      const endLine = startLine + divContent.split('\n').length - 1;
      
      // Create block
      const block: DocumentBlock = {
        id: uuidv4(),
        type: 'jsx' as BlockType, // Using jsx as a generic component type
        content: divContent,
        startLine,
        endLine,
        path: filePath,
        title: `Component: ${idOrClass}`,
        parent: rootId,
        children: [],
        metadata: {
          name: idOrClass
        } as BlockMetadata
      };
      
      blocks.push(block);
      
      // Add to parent's children
      const parent = blocks.find(b => b.id === rootId);
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
   * Find script blocks
   */
  private findScriptBlocks(
    lines: string[],
    filePath: string,
    blocks: DocumentBlock[],
    blockHierarchy: BlockHierarchy,
    rootId: string
  ): void {
    const content = lines.join('\n');
    
    const scriptRegex = /<script[^>]*>(.*?)<\/script>/gis;
    let match;
    
    while ((match = scriptRegex.exec(content)) !== null) {
      const scriptContent = match[0];
      const scriptInner = match[1];
      const beforeTag = content.substring(0, match.index);
      const startLine = beforeTag.split('\n').length;
      const endLine = startLine + scriptContent.split('\n').length - 1;
      
      // Try to determine script type (external, inline, type)
      const typeMatch = scriptContent.match(/type=['"]([^'"]+)['"]/);
      const srcMatch = scriptContent.match(/src=['"]([^'"]+)['"]/);
      
      let title = 'Script';
      
      if (srcMatch) {
        title = `Script: ${srcMatch[1]}`;
      } else if (typeMatch) {
        title = `Script (${typeMatch[1]})`;
      } else if (scriptInner.trim().length > 0) {
        // For inline scripts, show a preview
        const firstLine = scriptInner.trim().split('\n')[0];
        title = `Script: ${firstLine.substring(0, 30)}${firstLine.length > 30 ? '...' : ''}`;
      }
      
      // Create block
      const block: DocumentBlock = {
        id: uuidv4(),
        type: 'function' as BlockType, // Using function as a generic code type
        content: scriptContent,
        startLine,
        endLine,
        path: filePath,
        title,
        parent: rootId,
        children: [],
        metadata: {
          src: srcMatch ? srcMatch[1] : undefined,
          type: typeMatch ? typeMatch[1] : undefined
        } as BlockMetadata
      };
      
      blocks.push(block);
      
      // Add to parent's children
      const parent = blocks.find(b => b.id === rootId);
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
   * Find style blocks
   */
  private findStyleBlocks(
    lines: string[],
    filePath: string,
    blocks: DocumentBlock[],
    blockHierarchy: BlockHierarchy,
    rootId: string
  ): void {
    const content = lines.join('\n');
    
    const styleRegex = /<style[^>]*>(.*?)<\/style>/gis;
    let match;
    
    while ((match = styleRegex.exec(content)) !== null) {
      const styleContent = match[0];
      const beforeTag = content.substring(0, match.index);
      const startLine = beforeTag.split('\n').length;
      const endLine = startLine + styleContent.split('\n').length - 1;
      
      // Create block
      const block: DocumentBlock = {
        id: uuidv4(),
        type: 'variable' as BlockType, // Using variable as a CSS container type
        content: styleContent,
        startLine,
        endLine,
        path: filePath,
        title: 'CSS Styles',
        parent: rootId,
        children: [],
      };
      
      blocks.push(block);
      
      // Add to parent's children
      const parent = blocks.find(b => b.id === rootId);
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
   * Find an HTML tag with attributes and create blocks
   */
  private findTagWithAttributes(
    content: string,
    tag: string,
    title: string,
    filePath: string,
    blocks: DocumentBlock[],
    blockHierarchy: BlockHierarchy,
    rootId: string
  ): void {
    const regex = new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, 'gis');
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      const tagContent = match[0];
      const beforeTag = content.substring(0, match.index);
      const startLine = beforeTag.split('\n').length;
      const endLine = startLine + tagContent.split('\n').length - 1;
      
      // Try to find id or name
      const idMatch = tagContent.match(/id=['"]([^'"]+)['"]/);
      const nameMatch = tagContent.match(/name=['"]([^'"]+)['"]/);
      
      let blockTitle = title;
      if (idMatch) {
        blockTitle = `${title}: #${idMatch[1]}`;
      } else if (nameMatch) {
        blockTitle = `${title}: ${nameMatch[1]}`;
      }
      
      // Create block
      const block: DocumentBlock = {
        id: uuidv4(),
        type: 'jsx' as BlockType, // Using jsx as a generic component type
        content: tagContent,
        startLine,
        endLine,
        path: filePath,
        title: blockTitle,
        parent: rootId,
        children: [],
      };
      
      blocks.push(block);
      
      // Add to parent's children
      const parent = blocks.find(b => b.id === rootId);
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
} 