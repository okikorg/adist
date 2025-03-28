import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import { Parent, Root, Heading, Paragraph, List, Code, Table, BlockContent } from 'mdast';
import { v4 as uuidv4 } from 'uuid';
import { BlockHierarchy, BlockMetadata, BlockType, DocumentBlock, IndexedDocument } from '../../types.js';
import { Parser, getDocumentTitle } from './base-parser.js';

// Extended metadata for markdown-specific properties
interface MarkdownBlockMetadata extends BlockMetadata {
  ordered?: boolean; // For lists
}

/**
 * Parser for Markdown documents
 */
export class MarkdownParser implements Parser {
  canParse(filePath: string): boolean {
    return /\.(md|markdown)$/i.test(filePath);
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

    // Parse the markdown document
    const processor = unified()
      .use(remarkParse)
      .use(remarkGfm);
    
    const ast = await processor.parse(content);
    
    // Keep track of the current heading stack for hierarchy
    const headingStack: DocumentBlock[] = [rootBlock];
    
    // Track headings with their levels and line numbers for content extraction
    const headings: { id: string; level: number; startLine: number; endLine: number }[] = [];

    // Process the AST
    visit(ast, (node, index, parent) => {
      if (!parent) {
        return;
      }

      // Calculate line numbers
      const startLine = this.getStartLine(node);
      const endLine = this.getEndLine(node);
      
      if (!startLine || !endLine) {
        return;
      }

      let block: DocumentBlock | null = null;

      if (node.type === 'heading') {
        const heading = node as Heading;
        const level = heading.depth;
        const text = this.getTextFromNode(heading);
        
        // First, update the endLine of the previous heading of the same or lower level
        for (let i = headings.length - 1; i >= 0; i--) {
          const prevHeading = headings[i];
          if (prevHeading.level <= level) {
            prevHeading.endLine = startLine - 1;
            break;
          }
        }
        
        // Create block with just the heading line initially
        // We'll update the content later to include the content under this heading
        block = {
          id: uuidv4(),
          type: 'heading',
          content: this.extractContent(content, startLine, endLine, true),
          startLine,
          endLine,
          path: filePath,
          title: text,
          children: [],
          metadata: {
            level,
          },
        };
        
        // Add this heading to our tracking array
        headings.push({ 
          id: block.id, 
          level, 
          startLine, 
          endLine: content.split('\n').length // Default to end of document
        });
        
        // Update heading stack based on heading level
        // Pop headings of same or lower level
        while (
          headingStack.length > 1 && 
          headingStack[headingStack.length - 1].type === 'heading' && 
          headingStack[headingStack.length - 1].metadata && 
          typeof headingStack[headingStack.length - 1].metadata?.level === 'number' && 
          (headingStack[headingStack.length - 1].metadata?.level ?? 0) >= level
        ) {
          headingStack.pop();
        }
        
        // Add this heading to its parent
        const currentParent = headingStack[headingStack.length - 1];
        if (block && currentParent) {
          block.parent = currentParent.id;
          currentParent.children = currentParent.children || [];
          currentParent.children.push(block.id);
          
          // Update block map
          blockHierarchy.blockMap[block.id] = {
            block: block.id,
            children: [],
          };
          
          // Push this heading to the stack
          headingStack.push(block);
        }
      } else if (node.type === 'paragraph') {
        const paragraph = node as Paragraph;
        const text = this.getTextFromNode(paragraph);
        
        block = {
          id: uuidv4(),
          type: 'paragraph',
          content: this.extractContent(content, startLine, endLine),
          startLine,
          endLine,
          path: filePath,
          title: text.length > 50 ? text.substring(0, 50) + '...' : text,
          parent: headingStack[headingStack.length - 1].id,
        };
        
        // Add to parent
        const currentParent = headingStack[headingStack.length - 1];
        if (currentParent && block) {
          currentParent.children = currentParent.children || [];
          currentParent.children.push(block.id);
          
          // Update block map
          blockHierarchy.blockMap[block.id] = {
            block: block.id,
            children: [],
          };
        }
      } else if (node.type === 'list') {
        const list = node as List;
        
        block = {
          id: uuidv4(),
          type: 'list',
          content: this.extractContent(content, startLine, endLine),
          startLine,
          endLine,
          path: filePath,
          parent: headingStack[headingStack.length - 1].id,
          metadata: {
            ordered: list.ordered === null ? undefined : list.ordered,
            spread: list.spread === null ? undefined : list.spread,
          },
        };
        
        // Add to parent
        const currentParent = headingStack[headingStack.length - 1];
        if (currentParent && block) {
          currentParent.children = currentParent.children || [];
          currentParent.children.push(block.id);
          
          // Update block map
          blockHierarchy.blockMap[block.id] = {
            block: block.id,
            children: [],
          };
        }
      } else if (node.type === 'code') {
        const code = node as Code;
        
        block = {
          id: uuidv4(),
          type: 'codeblock',
          content: this.extractContent(content, startLine, endLine),
          startLine,
          endLine,
          path: filePath,
          parent: headingStack[headingStack.length - 1].id,
          metadata: {
            language: code.lang || undefined,
          },
        };
        
        // Add to parent
        const currentParent = headingStack[headingStack.length - 1];
        if (currentParent && block) {
          currentParent.children = currentParent.children || [];
          currentParent.children.push(block.id);
          
          // Update block map
          blockHierarchy.blockMap[block.id] = {
            block: block.id,
            children: [],
          };
        }
      } else if (node.type === 'table') {
        const table = node as Table;
        
        block = {
          id: uuidv4(),
          type: 'table',
          content: this.extractContent(content, startLine, endLine),
          startLine,
          endLine,
          path: filePath,
          parent: headingStack[headingStack.length - 1].id,
        };
        
        // Add to parent
        const currentParent = headingStack[headingStack.length - 1];
        if (currentParent && block) {
          currentParent.children = currentParent.children || [];
          currentParent.children.push(block.id);
          
          // Update block map
          blockHierarchy.blockMap[block.id] = {
            block: block.id,
            children: [],
          };
        }
      }

      if (block) {
        blocks.push(block);
      }
    });

    // After processing all nodes, update heading blocks with their content
    for (const heading of headings) {
      const block = blocks.find(b => b.id === heading.id);
      if (block) {
        // Extract content from the heading line (startLine) to the end of the section (endLine)
        const lines = content.split('\n');
        if (heading.startLine <= heading.endLine && heading.startLine <= lines.length) {
          // Include the complete section content
          block.content = lines.slice(heading.startLine - 1, heading.endLine).join('\n');
        }
      }
    }

    return {
      path: filePath,
      blocks,
      title: getDocumentTitle(filePath),
      lastModified: stats.mtime.getTime(),
      size: stats.size,
      language: 'markdown',
      blockHierarchy,
    };
  }

  /**
   * Extract text from a node
   */
  private getTextFromNode(node: any): string {
    let text = '';
    
    if (node.value) {
      text = node.value;
    } else if (node.children) {
      visit(node, (child) => {
        if (child.type === 'text' && child.value) {
          text += child.value;
        }
      });
    }
    
    return text;
  }

  /**
   * Extract content from line numbers
   */
  private extractContent(content: string, startLine: number, endLine: number, isHeading: boolean = false): string {
    const lines = content.split('\n');
    return lines.slice(startLine - 1, endLine).join('\n');
  }

  /**
   * Get start line for a node
   */
  private getStartLine(node: any): number | null {
    return node.position?.start?.line || null;
  }

  /**
   * Get end line for a node
   */
  private getEndLine(node: any): number | null {
    return node.position?.end?.line || null;
  }
} 