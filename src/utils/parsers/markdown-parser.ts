import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import { Parent, Root, Heading, Paragraph, List, Code, Table, BlockContent, ListItem } from 'mdast';
import { v4 as uuidv4 } from 'uuid';
import { BlockHierarchy, BlockMetadata, BlockType, DocumentBlock, IndexedDocument } from '../../types.js';
import { Parser, getDocumentTitle } from './base-parser.js';

// Extended metadata for markdown-specific properties
interface MarkdownBlockMetadata extends BlockMetadata {
  ordered?: boolean; // For lists
  checked?: boolean; // For task list items
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
    
    // Create the root block - only include minimal metadata, not the entire content
    const rootBlock: DocumentBlock = {
      id: uuidv4(),
      type: 'document',
      content: '', // Will be populated with a document summary if available
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

    // Keep track of processed nodes to avoid duplication
    const processedNodes = new Set<any>();
    
    // Keep track of processed line numbers to detect duplicate content
    const processedLines = new Set<number>();
    
    // Process the AST
    visit(ast, (node, index, parent) => {
      if (!parent || processedNodes.has(node)) {
        return;
      }
      
      const startLine = this.getStartLine(node);
      const endLine = this.getEndLine(node);
      
      if (!startLine || !endLine) {
        return;
      }
      
      // Skip processing nodes whose lines have already been processed by other nodes
      // This helps avoid duplication between lists, list items, and paragraphs
      let allLinesProcessed = true;
      for (let i = startLine; i <= endLine; i++) {
        if (!processedLines.has(i)) {
          allLinesProcessed = false;
          break;
        }
      }
      
      if (allLinesProcessed && node.type !== 'heading') {
        processedNodes.add(node);
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
        
        // Create block with just the heading text, not all content under it
        block = {
          id: uuidv4(),
          type: 'heading',
          content: this.extractContent(content, startLine, endLine),
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
        
        // Mark these lines as processed
        for (let i = startLine; i <= endLine; i++) {
          processedLines.add(i);
        }
      } else if (node.type === 'paragraph') {
        // Skip paragraphs inside list items
        if (parent.type === 'listItem') {
          // Mark paragraph as processed, but don't create a block for it
          processedNodes.add(node);
          
          // Mark these lines as processed
          for (let i = startLine; i <= endLine; i++) {
            processedLines.add(i);
          }
          
          return;
        }
        
        // Skip paragraphs that look like list items
        const text = this.getTextFromNode(node as Paragraph);
        const isListLike = /^\d+\.\s+/.test(text) || /^[-*+]\s+/.test(text);
        
        if (isListLike) {
          // This paragraph appears to be part of a list, so skip it
          processedNodes.add(node);
          
          // Mark these lines as processed
          for (let i = startLine; i <= endLine; i++) {
            processedLines.add(i);
          }
          
          return;
        }
        
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
        
        // Mark these lines as processed
        for (let i = startLine; i <= endLine; i++) {
          processedLines.add(i);
        }
      } else if (node.type === 'list') {
        const list = node as List;
        
        // Process the list as a whole
        block = {
          id: uuidv4(),
          type: 'list',
          content: this.extractContent(content, startLine, endLine),
          startLine,
          endLine,
          path: filePath,
          title: list.ordered ? "Ordered List" : "Unordered List",
          parent: headingStack[headingStack.length - 1].id,
          children: [],
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
          
          // Process list items
          if (list.children) {
            for (const item of list.children) {
              if (item.type === 'listItem') {
                processedNodes.add(item);
                
                const listItem = item as ListItem;
                const itemStartLine = this.getStartLine(listItem);
                const itemEndLine = this.getEndLine(listItem);
                
                if (!itemStartLine || !itemEndLine) continue;
                
                // Mark these lines as processed
                for (let i = itemStartLine; i <= itemEndLine; i++) {
                  processedLines.add(i);
                }
                
                // Extract content and text for list item
                const itemContent = this.extractContent(content, itemStartLine, itemEndLine);
                
                // Get text from the first paragraph or use the first line
                let itemText = '';
                if (listItem.children && listItem.children.length > 0) {
                  const firstChild = listItem.children[0];
                  if (firstChild.type === 'paragraph') {
                    // Mark paragraph as processed
                    processedNodes.add(firstChild);
                    itemText = this.getTextFromNode(firstChild);
                    
                    // Mark paragraph lines as processed
                    const paragraphStartLine = this.getStartLine(firstChild);
                    const paragraphEndLine = this.getEndLine(firstChild);
                    if (paragraphStartLine && paragraphEndLine) {
                      for (let i = paragraphStartLine; i <= paragraphEndLine; i++) {
                        processedLines.add(i);
                      }
                    }
                  }
                }
                
                if (!itemText) {
                  const lines = itemContent.split('\n');
                  itemText = lines[0].trim().replace(/^\d+\.\s+/, '').replace(/^[-*+]\s+/, '');
                }
                
                // Create list item block
                const listItemBlock: DocumentBlock = {
                  id: uuidv4(),
                  type: 'listItem' as BlockType,
                  content: itemContent,
                  startLine: itemStartLine,
                  endLine: itemEndLine,
                  path: filePath,
                  title: itemText.length > 50 ? itemText.substring(0, 50) + '...' : itemText,
                  parent: block.id,
                  children: [],
                  metadata: {
                    checked: 'checked' in listItem ? (listItem.checked === null ? undefined : listItem.checked) : undefined
                  }
                };
                
                // Add to list
                block.children = block.children || [];
                block.children.push(listItemBlock.id);
                
                // Update block map
                blockHierarchy.blockMap[listItemBlock.id] = {
                  block: listItemBlock.id,
                  children: [],
                };
                
                blocks.push(listItemBlock);
                
                // Process nested lists if any
                if (listItem.children) {
                  for (const child of listItem.children) {
                    if (child.type === 'list') {
                      this.processNestedList(child as List, listItemBlock, blocks, blockHierarchy, content, filePath, processedNodes, processedLines);
                    }
                  }
                }
              }
            }
          }
        }
        
        // Mark all list lines as processed
        for (let i = startLine; i <= endLine; i++) {
          processedLines.add(i);
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
        
        // Mark these lines as processed
        for (let i = startLine; i <= endLine; i++) {
          processedLines.add(i);
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
        
        // Mark these lines as processed
        for (let i = startLine; i <= endLine; i++) {
          processedLines.add(i);
        }
      }

      if (block) {
        blocks.push(block);
        processedNodes.add(node);
      }
    });

    // Update the root block with the first few lines as content
    const lines = content.split('\n');
    rootBlock.content = lines.slice(0, Math.min(5, lines.length)).join('\n') + 
                       (lines.length > 5 ? '\n...' : '');

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
   * Process a nested list recursively
   */
  private processNestedList(
    list: List, 
    parentBlock: DocumentBlock, 
    blocks: DocumentBlock[],
    blockHierarchy: BlockHierarchy,
    content: string,
    filePath: string,
    processedNodes: Set<any>,
    processedLines: Set<number>
  ): void {
    processedNodes.add(list);
    
    const startLine = this.getStartLine(list);
    const endLine = this.getEndLine(list);
    
    if (!startLine || !endLine) return;
    
    // Mark lines as processed
    for (let i = startLine; i <= endLine; i++) {
      processedLines.add(i);
    }
    
    // Create nested list block
    const nestedListBlock: DocumentBlock = {
      id: uuidv4(),
      type: 'list',
      content: this.extractContent(content, startLine, endLine),
      startLine,
      endLine,
      path: filePath,
      title: list.ordered ? "Ordered List" : "Unordered List",
      parent: parentBlock.id,
      children: [],
      metadata: {
        ordered: list.ordered === null ? undefined : list.ordered,
        spread: list.spread === null ? undefined : list.spread,
      },
    };
    
    // Add to parent
    parentBlock.children = parentBlock.children || [];
    parentBlock.children.push(nestedListBlock.id);
    
    // Update block map
    blockHierarchy.blockMap[nestedListBlock.id] = {
      block: nestedListBlock.id,
      children: [],
    };
    
    blocks.push(nestedListBlock);
    
    // Process list items for this nested list
    if (list.children && list.children.length > 0) {
      for (const listItemNode of list.children) {
        if (listItemNode.type !== 'listItem') continue;
        
        processedNodes.add(listItemNode);
        
        const listItem = listItemNode as ListItem;
        const itemStartLine = this.getStartLine(listItem);
        const itemEndLine = this.getEndLine(listItem);
        
        if (!itemStartLine || !itemEndLine) continue;
        
        // Mark lines as processed
        for (let i = itemStartLine; i <= itemEndLine; i++) {
          processedLines.add(i);
        }
        
        // Prepare item content and text
        const itemContent = this.extractContent(content, itemStartLine, itemEndLine);
        
        // Extract text for the title
        let itemText = '';
        if (listItem.children && listItem.children.length > 0) {
          const firstChild = listItem.children[0];
          if (firstChild.type === 'paragraph') {
            processedNodes.add(firstChild);
            itemText = this.getTextFromNode(firstChild);
            
            // Mark paragraph lines as processed
            const paragraphStartLine = this.getStartLine(firstChild);
            const paragraphEndLine = this.getEndLine(firstChild);
            if (paragraphStartLine && paragraphEndLine) {
              for (let i = paragraphStartLine; i <= paragraphEndLine; i++) {
                processedLines.add(i);
              }
            }
          } else {
            // Fallback to first line
            const lines = itemContent.split('\n');
            itemText = lines[0].trim().replace(/^\d+\.\s+/, '').replace(/^[-*+]\s+/, '');
          }
        }
        
        // Create list item block
        const listItemBlock: DocumentBlock = {
          id: uuidv4(),
          type: 'listItem' as BlockType,
          content: itemContent,
          startLine: itemStartLine,
          endLine: itemEndLine,
          path: filePath,
          title: itemText.length > 50 ? itemText.substring(0, 50) + '...' : itemText,
          parent: nestedListBlock.id,
          children: [],
          metadata: {
            checked: 'checked' in listItem ? (listItem.checked === null ? undefined : listItem.checked) : undefined
          }
        };
        
        // Add to parent list
        nestedListBlock.children = nestedListBlock.children || [];
        nestedListBlock.children.push(listItemBlock.id);
        
        // Update block map
        blockHierarchy.blockMap[listItemBlock.id] = {
          block: listItemBlock.id,
          children: [],
        };
        
        blocks.push(listItemBlock);
        
        // Handle further nested lists if any
        if (listItem.children) {
          for (const child of listItem.children) {
            if (child.type === 'list') {
              // Process nested list recursively
              this.processNestedList(child as List, listItemBlock, blocks, blockHierarchy, content, filePath, processedNodes, processedLines);
            }
          }
        }
      }
    }
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