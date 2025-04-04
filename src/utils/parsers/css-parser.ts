import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { BlockHierarchy, BlockType, DocumentBlock, IndexedDocument } from '../../types.js';
import { Parser, getDocumentTitle, BlockMetadata } from './base-parser.js';

/**
 * Parser for CSS files
 * Identifies selectors, rule groups, and media queries
 */
export class CssParser implements Parser {
  canParse(filePath: string, content?: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.css' || ext === '.scss' || ext === '.less';
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
    
    // Process the CSS file
    const cssBlocks = this.processCssContent(content, filePath);
    
    // Add all CSS blocks
    for (const cssBlock of cssBlocks) {
      // Find parent
      let parentId = rootBlock.id;
      
      // If this is a nested block, find its parent
      if (cssBlock.level > 0) {
        // Find appropriate parent based on levels
        const possibleParents = blocks
          .filter(b => b !== rootBlock)
          .filter(b => {
            const blockLevel = b.metadata?.level !== undefined ? b.metadata.level : 0;
            return blockLevel < cssBlock.level;
          })
          .sort((a, b) => {
            const aLevel = a.metadata?.level !== undefined ? a.metadata.level : 0;
            const bLevel = b.metadata?.level !== undefined ? b.metadata.level : 0;
            return (bLevel - aLevel) || (b.startLine - a.startLine);
          });
        
        if (possibleParents.length > 0) {
          // Use the closest parent
          parentId = possibleParents[0].id;
        }
      }
      
      // Create metadata object that conforms to BlockMetadata
      const metadata: BlockMetadata = {
        level: cssBlock.level,
        name: cssBlock.selector,
        type: cssBlock.blockType
      };
      
      // Create block
      const block: DocumentBlock = {
        id: uuidv4(),
        type: cssBlock.type as BlockType,
        content: cssBlock.content,
        startLine: cssBlock.startLine,
        endLine: cssBlock.endLine,
        path: filePath,
        title: cssBlock.title,
        parent: parentId,
        children: [],
        metadata
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

    return {
      path: filePath,
      blocks,
      title: getDocumentTitle(filePath),
      lastModified: stats.mtime.getTime(),
      size: stats.size,
      language: path.extname(filePath).replace('.', ''),
      blockHierarchy,
    };
  }
  
  /**
   * Process CSS content into blocks
   */
  private processCssContent(
    content: string,
    filePath: string
  ): {
    type: string;
    content: string;
    startLine: number;
    endLine: number;
    title: string;
    level: number;
    selector: string;
    blockType: string;
  }[] {
    const blocks: {
      type: string;
      content: string;
      startLine: number;
      endLine: number;
      title: string;
      level: number;
      selector: string;
      blockType: string;
    }[] = [];
    
    // Track comments
    const comments: {
      startLine: number;
      endLine: number;
      content: string;
    }[] = [];
    
    // Find all comments first
    this.findCssComments(content, comments);
    
    // Find rule blocks and media queries
    let inComment = false;
    let braceStack: number[] = [];
    let currentBlock: {
      type: string;
      selector: string;
      startLine: number;
      startCol: number;
      level: number;
      blockType: string;
    } | null = null;
    
    const lines = content.split('\n');
    
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      
      // Skip if inside comment
      if (comments.some(c => lineNum + 1 >= c.startLine && lineNum + 1 <= c.endLine)) {
        continue;
      }
      
      // Process each character in the line
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        // Opening brace - might be start of a rule block
        if (char === '{') {
          braceStack.push(lineNum);
          
          if (currentBlock === null) {
            // Extract selector
            let selectorText = '';
            let j = i - 1;
            
            // Find the start of the selector by going backwards
            while (j >= 0) {
              if (line[j] === '}' || line[j] === ';') {
                break;
              }
              j--;
            }
            j++;
            
            // Extract the selector text
            selectorText = line.substring(j, i).trim();
            
            // If selector spans multiple lines, include previous lines
            if (selectorText === '') {
              let prevLineNum = lineNum - 1;
              while (prevLineNum >= 0 && selectorText === '') {
                selectorText = lines[prevLineNum].trim();
                prevLineNum--;
              }
            }
            
            // Determine block type
            let blockType = 'rule';
            let type = 'variable'; // Use variable type for CSS rules
            
            if (selectorText.startsWith('@media')) {
              blockType = 'media';
              type = 'variable';
            } else if (selectorText.startsWith('@keyframes')) {
              blockType = 'keyframes';
              type = 'interface';
            } else if (selectorText.startsWith('@')) {
              blockType = 'at-rule';
              type = 'variable';
            }
            
            currentBlock = {
              type,
              selector: selectorText,
              startLine: lineNum + 1,
              startCol: i,
              level: braceStack.length,
              blockType
            };
          }
        }
        
        // Closing brace - end of a rule block
        else if (char === '}' && braceStack.length > 0) {
          const openingLine = braceStack.pop();
          
          if (currentBlock !== null && braceStack.length === currentBlock.level - 1) {
            // End of a block matching the current level
            const blockContent = this.extractBlock(
              lines,
              currentBlock.startLine - 1,
              lineNum,
              currentBlock.startCol,
              i
            );
            
            // Create a title from the selector
            let title = currentBlock.selector.trim();
            if (title.length > 40) {
              title = title.substring(0, 37) + '...';
            }
            
            // If this is a non-rule block, prefix the title
            if (currentBlock.blockType === 'media') {
              title = `Media Query: ${title}`;
            } else if (currentBlock.blockType === 'keyframes') {
              title = `Keyframes: ${title}`;
            } else if (currentBlock.blockType === 'at-rule') {
              title = `At-Rule: ${title}`;
            } else {
              title = `Selector: ${title}`;
            }
            
            blocks.push({
              type: currentBlock.type,
              content: blockContent,
              startLine: currentBlock.startLine,
              endLine: lineNum + 1,
              title,
              level: currentBlock.level,
              selector: currentBlock.selector,
              blockType: currentBlock.blockType
            });
            
            currentBlock = null;
          }
        }
      }
    }
    
    // Add comments as blocks
    for (const comment of comments) {
      if (comment.content.length > 10) { // Only add substantial comments
        blocks.push({
          type: 'comment',
          content: comment.content,
          startLine: comment.startLine,
          endLine: comment.endLine,
          title: comment.content.substring(0, 30).replace(/\n/g, ' ') + (comment.content.length > 30 ? '...' : ''),
          level: 0,
          selector: '',
          blockType: 'comment'
        });
      }
    }
    
    // Sort blocks by start line
    blocks.sort((a, b) => a.startLine - b.startLine);
    
    return blocks;
  }
  
  /**
   * Find CSS comments in the content
   */
  private findCssComments(
    content: string,
    comments: {startLine: number; endLine: number; content: string;}[]
  ): void {
    const lines = content.split('\n');
    let inComment = false;
    let commentStart = 0;
    let commentContent = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      for (let j = 0; j < line.length; j++) {
        if (!inComment && j < line.length - 1 && line[j] === '/' && line[j + 1] === '*') {
          inComment = true;
          commentStart = i + 1;
          commentContent = line.substring(j);
          j++;
        } else if (inComment && j < line.length - 1 && line[j] === '*' && line[j + 1] === '/') {
          inComment = false;
          commentContent += line.substring(0, j + 2);
          
          comments.push({
            startLine: commentStart,
            endLine: i + 1,
            content: commentContent
          });
          
          commentContent = '';
          j++;
        } else if (inComment) {
          if (j === 0) {
            commentContent += '\n' + line;
            break;
          }
        }
      }
    }
  }
  
  /**
   * Extract a block from the content
   */
  private extractBlock(
    lines: string[],
    startLine: number,
    endLine: number,
    startCol: number,
    endCol: number
  ): string {
    if (startLine === endLine) {
      return lines[startLine].substring(0, endCol + 1);
    }
    
    let result = lines[startLine];
    
    for (let i = startLine + 1; i < endLine; i++) {
      result += '\n' + lines[i];
    }
    
    result += '\n' + lines[endLine].substring(0, endCol + 1);
    
    return result;
  }
} 