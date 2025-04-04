import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { BlockHierarchy, BlockType, DocumentBlock, IndexedDocument } from '../../types.js';
import { Parser, getDocumentTitle, BlockMetadata } from './base-parser.js';

/**
 * Generic Code Parser
 * Parses various programming languages using common patterns
 */
export class GenericCodeParser implements Parser {
  // Supported languages with their file extensions
  private languagePatterns: Record<string, {
    extensions: string[];
    blockStartPatterns: RegExp[];
    commentPatterns: {
      singleLine: string;
      multiLineStart: string;
      multiLineEnd: string;
    };
    functionPattern?: RegExp;
    classPattern?: RegExp;
    methodPattern?: RegExp;
  }> = {
    python: {
      extensions: ['.py'],
      blockStartPatterns: [
        /^def\s+(\w+)\s*\(.*\):/,
        /^class\s+(\w+)(?:\(.*\))?:/,
        /^if\s+__name__\s*==\s*['"]__main__['"]:/ 
      ],
      commentPatterns: {
        singleLine: '#',
        multiLineStart: '"""',
        multiLineEnd: '"""'
      },
      functionPattern: /^def\s+(\w+)\s*\((.*)\):/,
      classPattern: /^class\s+(\w+)(?:\((.*)\))?:/
    },
    ruby: {
      extensions: ['.rb'],
      blockStartPatterns: [
        /^def\s+(\w+)/,
        /^class\s+(\w+)/,
        /^module\s+(\w+)/
      ],
      commentPatterns: {
        singleLine: '#',
        multiLineStart: '=begin',
        multiLineEnd: '=end'
      },
      functionPattern: /^def\s+(\w+)(?:\((.*)\))?/,
      classPattern: /^class\s+(\w+)(?:\s*<\s*(.*))?/
    },
    go: {
      extensions: ['.go'],
      blockStartPatterns: [
        /^func\s+(\w+)/,
        /^type\s+(\w+)\s+struct/,
        /^type\s+(\w+)\s+interface/
      ],
      commentPatterns: {
        singleLine: '//',
        multiLineStart: '/*',
        multiLineEnd: '*/'
      },
      functionPattern: /^func\s+(\w+)\s*\((.*)\)(?:\s*\(?(.*)\)?)?/,
      methodPattern: /^func\s+\((.*)\)\s+(\w+)(?:\((.*)\))?(?:\s*(.*)?)?/
    },
    java: {
      extensions: ['.java'],
      blockStartPatterns: [
        /^public\s+class\s+(\w+)/,
        /^public\s+interface\s+(\w+)/,
        /^public\s+enum\s+(\w+)/,
        /^public\s+(?:static\s+)?(?:final\s+)?(?:\w+)\s+(\w+)\s*\(/
      ],
      commentPatterns: {
        singleLine: '//',
        multiLineStart: '/*',
        multiLineEnd: '*/'
      },
      functionPattern: /^(?:public|private|protected)?\s+(?:static\s+)?(?:final\s+)?(?:\w+)\s+(\w+)\s*\((.*)\)/,
      classPattern: /^(?:public|private|protected)?\s+(?:static\s+)?(?:final\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/
    },
    c: {
      extensions: ['.c', '.h'],
      blockStartPatterns: [
        /^(?:\w+)\s+(\w+)\s*\(/,
        /^struct\s+(\w+)/,
        /^enum\s+(\w+)/,
        /^typedef\s+/
      ],
      commentPatterns: {
        singleLine: '//',
        multiLineStart: '/*',
        multiLineEnd: '*/'
      },
      functionPattern: /^(?:\w+)\s+(\w+)\s*\((.*)\)/
    },
    cpp: {
      extensions: ['.cpp', '.hpp', '.cc', '.cxx'],
      blockStartPatterns: [
        /^(?:\w+)\s+(\w+)\s*\(/,
        /^class\s+(\w+)/,
        /^struct\s+(\w+)/,
        /^namespace\s+(\w+)/,
        /^enum\s+(\w+)/,
        /^template\s+</
      ],
      commentPatterns: {
        singleLine: '//',
        multiLineStart: '/*',
        multiLineEnd: '*/'
      },
      functionPattern: /^(?:\w+)\s+(\w+)\s*\((.*)\)/,
      classPattern: /^class\s+(\w+)(?:\s*:\s*(?:public|private|protected)\s+(.*))?/
    },
    rust: {
      extensions: ['.rs'],
      blockStartPatterns: [
        /^fn\s+(\w+)/,
        /^struct\s+(\w+)/,
        /^enum\s+(\w+)/,
        /^trait\s+(\w+)/,
        /^impl(?:\s+<.*>)?\s+(?:\w+)/,
        /^mod\s+(\w+)/
      ],
      commentPatterns: {
        singleLine: '//',
        multiLineStart: '/*',
        multiLineEnd: '*/'
      },
      functionPattern: /^fn\s+(\w+)\s*(?:<.*>)?\s*\((.*)\)(?:\s*->\s*(.*))?/
    },
    csharp: {
      extensions: ['.cs'],
      blockStartPatterns: [
        /^(?:public|private|protected|internal)?\s+(?:static\s+)?(?:class|struct|interface|enum)\s+(\w+)/,
        /^(?:public|private|protected|internal)?\s+(?:static\s+)?(?:void|[\w<>]+)\s+(\w+)\s*\(/,
        /^namespace\s+(\w+)/
      ],
      commentPatterns: {
        singleLine: '//',
        multiLineStart: '/*',
        multiLineEnd: '*/'
      },
      functionPattern: /^(?:public|private|protected|internal)?\s+(?:static\s+)?(?:async\s+)?(?:void|[\w<>]+)\s+(\w+)\s*\((.*)\)/,
      classPattern: /^(?:public|private|protected|internal)?\s+(?:static\s+)?(?:sealed\s+)?(?:partial\s+)?(?:class|struct|interface)\s+(\w+)(?:<.*>)?(?:\s*:\s*(.*))?/
    },
    php: {
      extensions: ['.php'],
      blockStartPatterns: [
        /^function\s+(\w+)/,
        /^class\s+(\w+)/,
        /^interface\s+(\w+)/,
        /^trait\s+(\w+)/,
        /^namespace\s+(\w+)/
      ],
      commentPatterns: {
        singleLine: '//',
        multiLineStart: '/*',
        multiLineEnd: '*/'
      },
      functionPattern: /^function\s+(\w+)\s*\((.*)\)/,
      classPattern: /^class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/
    }
  };

  canParse(filePath: string, content?: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    // Check if this extension is in any of our supported languages
    return Object.values(this.languagePatterns).some(
      lang => lang.extensions.includes(ext)
    );
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
    
    // Determine the language based on file extension
    const ext = path.extname(filePath).toLowerCase();
    const language = this.getLanguageForExtension(ext);
    
    if (!language) {
      // Return just the document block if we don't recognize the language
      return {
        path: filePath,
        blocks,
        title: getDocumentTitle(filePath),
        lastModified: stats.mtime.getTime(),
        size: stats.size,
        language: ext.replace('.', ''),
        blockHierarchy,
      };
    }
    
    // Parse the content based on language patterns
    const languagePatterns = this.languagePatterns[language];
    const lines = content.split('\n');
    
    // Find blocks
    const foundBlocks: {
      type: BlockType;
      startLine: number;
      endLine: number;
      title: string;
      metadata: BlockMetadata;
      parentId: string;
    }[] = [];
    
    // Parse comment blocks
    this.findCommentBlocks(lines, languagePatterns, foundBlocks);
    
    // Parse function-like blocks
    this.findFunctionBlocks(lines, languagePatterns, foundBlocks);
    
    // Parse class-like blocks
    this.findClassBlocks(lines, languagePatterns, foundBlocks);
    
    // Sort blocks by start line
    foundBlocks.sort((a, b) => a.startLine - b.startLine);
    
    // Build block hierarchy
    const blockStack: {id: string, endLine: number}[] = [{id: rootBlock.id, endLine: lines.length}];
    
    for (const foundBlock of foundBlocks) {
      // Find the appropriate parent for this block
      while (blockStack.length > 1 && blockStack[blockStack.length - 1].endLine < foundBlock.startLine) {
        blockStack.pop();
      }
      
      const parentId = blockStack[blockStack.length - 1].id;
      
      // Create the block
      const block: DocumentBlock = {
        id: uuidv4(),
        type: foundBlock.type,
        content: lines.slice(foundBlock.startLine - 1, foundBlock.endLine).join('\n'),
        startLine: foundBlock.startLine,
        endLine: foundBlock.endLine,
        path: filePath,
        title: foundBlock.title,
        parent: parentId,
        children: [],
        metadata: foundBlock.metadata,
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
      
      // Add this block to the stack if it might contain other blocks
      if (foundBlock.type === 'class' || foundBlock.type === 'function' || foundBlock.type === 'method') {
        blockStack.push({id: block.id, endLine: foundBlock.endLine});
      }
    }

    return {
      path: filePath,
      blocks,
      title: getDocumentTitle(filePath),
      lastModified: stats.mtime.getTime(),
      size: stats.size,
      language,
      blockHierarchy,
    };
  }
  
  /**
   * Get the language for a given file extension
   */
  private getLanguageForExtension(ext: string): string | null {
    for (const [language, patterns] of Object.entries(this.languagePatterns)) {
      if (patterns.extensions.includes(ext)) {
        return language;
      }
    }
    return null;
  }
  
  /**
   * Find comment blocks in the code
   */
  private findCommentBlocks(
    lines: string[], 
    languagePatterns: any, 
    foundBlocks: any[]
  ): void {
    let inComment = false;
    let commentStart = 0;
    let commentContent = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (!inComment) {
        // Check for multi-line comment start
        if (line.startsWith(languagePatterns.commentPatterns.multiLineStart)) {
          inComment = true;
          commentStart = i + 1;
          commentContent = line;
        } 
        // Check for single-line comment with special meaning (like documentation)
        else if (line.startsWith(languagePatterns.commentPatterns.singleLine) && 
                 line.length > languagePatterns.commentPatterns.singleLine.length + 1) {
          // Only record substantial comments (more than just a short note)
          const commentText = line.substring(languagePatterns.commentPatterns.singleLine.length).trim();
          if (commentText.length > 15) {
            foundBlocks.push({
              type: 'comment' as BlockType,
              startLine: i + 1,
              endLine: i + 1,
              title: commentText.length > 30 ? commentText.substring(0, 30) + '...' : commentText,
              metadata: {},
              parentId: ''
            });
          }
        }
      } else {
        // Add line to comment content
        commentContent += '\n' + line;
        
        // Check for multi-line comment end
        if (line.endsWith(languagePatterns.commentPatterns.multiLineEnd)) {
          inComment = false;
          
          // Only include substantial comments
          if (commentContent.length > 30) {
            foundBlocks.push({
              type: 'comment' as BlockType,
              startLine: commentStart,
              endLine: i + 1,
              title: 'Comment',
              metadata: {},
              parentId: ''
            });
          }
          
          commentContent = '';
        }
      }
    }
  }
  
  /**
   * Find function blocks in the code
   */
  private findFunctionBlocks(
    lines: string[], 
    languagePatterns: any, 
    foundBlocks: any[]
  ): void {
    if (!languagePatterns.functionPattern) return;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      const match = line.match(languagePatterns.functionPattern);
      if (match) {
        const funcName = match[1];
        const params = match[2] || '';
        
        // Find the end of the function
        let endLine = i + 1;
        let braceCount = 0;
        let foundOpenBrace = false;
        let hasCloseBrace = false;
        
        // Different languages have different block styles
        if (languagePatterns.extensions.some((ext: string) => ['.py', '.rb'].includes(ext))) {
          // Indentation-based languages
          const baseIndentation = this.getIndentation(lines[i]);
          
          for (let j = i + 1; j < lines.length; j++) {
            const currentIndentation = this.getIndentation(lines[j]);
            
            // End of block is when indentation returns to base level or less
            // and the line isn't empty
            if (currentIndentation <= baseIndentation && lines[j].trim() !== '') {
              endLine = j;
              break;
            }
            
            endLine = j + 1;
          }
        } else {
          // Brace-based languages
          for (let j = i; j < lines.length; j++) {
            const currentLine = lines[j];
            
            for (let k = 0; k < currentLine.length; k++) {
              if (currentLine[k] === '{') {
                foundOpenBrace = true;
                braceCount++;
              } else if (currentLine[k] === '}') {
                braceCount--;
                
                if (braceCount === 0 && foundOpenBrace) {
                  endLine = j + 1;
                  hasCloseBrace = true;
                  break;
                }
              }
            }
            
            if (hasCloseBrace) break;
          }
          
          // If no braces were found, this might be a function declaration
          if (!foundOpenBrace) {
            // For function declarations, we just include the current line
            endLine = i + 1;
          }
        }
        
        // Create function block
        foundBlocks.push({
          type: 'function' as BlockType,
          startLine: i + 1,
          endLine,
          title: `Function: ${funcName}`,
          metadata: {
            name: funcName,
            signature: `${funcName}(${params})`
          } as BlockMetadata,
          parentId: ''
        });
        
        // Skip to the end of this function
        i = endLine - 1;
      }
    }
  }
  
  /**
   * Find class blocks in the code
   */
  private findClassBlocks(
    lines: string[], 
    languagePatterns: any, 
    foundBlocks: any[]
  ): void {
    if (!languagePatterns.classPattern) return;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      const match = line.match(languagePatterns.classPattern);
      if (match) {
        const className = match[1];
        
        // Find the end of the class
        let endLine = i + 1;
        let braceCount = 0;
        let foundOpenBrace = false;
        let hasCloseBrace = false;
        
        // Different languages have different block styles
        if (languagePatterns.extensions.some((ext: string) => ['.py', '.rb'].includes(ext))) {
          // Indentation-based languages
          const baseIndentation = this.getIndentation(lines[i]);
          
          for (let j = i + 1; j < lines.length; j++) {
            const currentIndentation = this.getIndentation(lines[j]);
            
            // End of block is when indentation returns to base level or less
            // and the line isn't empty
            if (currentIndentation <= baseIndentation && lines[j].trim() !== '') {
              endLine = j;
              break;
            }
            
            endLine = j + 1;
          }
        } else {
          // Brace-based languages
          for (let j = i; j < lines.length; j++) {
            const currentLine = lines[j];
            
            for (let k = 0; k < currentLine.length; k++) {
              if (currentLine[k] === '{') {
                foundOpenBrace = true;
                braceCount++;
              } else if (currentLine[k] === '}') {
                braceCount--;
                
                if (braceCount === 0 && foundOpenBrace) {
                  endLine = j + 1;
                  hasCloseBrace = true;
                  break;
                }
              }
            }
            
            if (hasCloseBrace) break;
          }
          
          // If no braces were found, this might be a class declaration
          if (!foundOpenBrace) {
            // For class declarations, we just include the current line
            endLine = i + 1;
          }
        }
        
        // Create class block
        foundBlocks.push({
          type: 'class' as BlockType,
          startLine: i + 1,
          endLine,
          title: `Class: ${className}`,
          metadata: {
            name: className
          } as BlockMetadata,
          parentId: ''
        });
        
        // Skip to the end of this class
        i = endLine - 1;
      }
    }
  }
  
  /**
   * Get the indentation level of a line
   */
  private getIndentation(line: string): number {
    const match = line.match(/^(\s*)/);
    return match ? match[1].length : 0;
  }
} 