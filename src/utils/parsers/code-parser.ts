import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { BlockHierarchy, BlockType, DocumentBlock, IndexedDocument } from '../../types.js';
import { Parser, getDocumentTitle } from './base-parser.js';

/**
 * Parser for code (TypeScript/JavaScript) files
 * Parses code into logical blocks like functions, classes, imports, etc.
 */
export class CodeParser implements Parser {
  private supportedExtensions = ['.js', '.jsx', '.ts', '.tsx'];

  canParse(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return this.supportedExtensions.includes(ext);
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
    
    // Function to add a block to the document
    const addBlock = (
      type: BlockType,
      startLine: number,
      endLine: number,
      title: string,
      metadata: any = {},
      parentId = rootBlock.id
    ): DocumentBlock => {
      const blockContent = this.extractContent(content, startLine, endLine);
      
      const block: DocumentBlock = {
        id: uuidv4(),
        type,
        content: blockContent,
        startLine,
        endLine,
        path: filePath,
        title,
        parent: parentId,
        children: [],
        metadata,
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
      
      return block;
    };
    
    // Use a simple regex-based approach for now, 
    // but in a real implementation, we would use tree-sitter or a similar parser
    
    // Parse imports
    const importRegex = /^import\s+.*?from\s+['"].*?['"]/gm;
    const importMatches = content.matchAll(importRegex);
    
    let importStartLine = -1;
    let lastImportEndLine = -1;
    
    for (const match of importMatches) {
      if (match.index !== undefined) {
        // Calculate line numbers
        const upToIndex = content.substring(0, match.index);
        const startLine = upToIndex.split('\n').length;
        const matchContent = match[0];
        const endLine = startLine + matchContent.split('\n').length - 1;
        
        if (importStartLine === -1) {
          importStartLine = startLine;
        }
        
        lastImportEndLine = endLine;
      }
    }
    
    // Add a single imports block if we found imports
    if (importStartLine !== -1 && lastImportEndLine !== -1) {
      const importBlock = addBlock(
        'imports',
        importStartLine,
        lastImportEndLine,
        'Imports'
      );
    }
    
    // Parse interface declarations
    const interfaceRegex = /^export\s+interface\s+(\w+)[\s\S]*?(?=^\})/gm;
    const interfaceMatches = content.matchAll(interfaceRegex);
    
    for (const match of interfaceMatches) {
      if (match.index !== undefined) {
        // Calculate line numbers
        const upToIndex = content.substring(0, match.index);
        const startLine = upToIndex.split('\n').length;
        
        // Find the closing brace to determine the end of the interface
        const matchText = match[0];
        const interfaceName = match[1];
        
        // Find the matching closing brace
        let braceCount = 0;
        let endIndex = match.index + matchText.length;
        
        for (let i = match.index; i < content.length; i++) {
          if (content[i] === '{') braceCount++;
          else if (content[i] === '}') {
            braceCount--;
            if (braceCount === 0) {
              endIndex = i + 1;
              break;
            }
          }
        }
        
        const interfaceContent = content.substring(match.index, endIndex);
        const endLine = startLine + interfaceContent.split('\n').length - 1;
        
        addBlock(
          'interface',
          startLine,
          endLine,
          `Interface: ${interfaceName}`,
          { name: interfaceName }
        );
      }
    }
    
    // Parse type declarations
    const typeRegex = /^export\s+type\s+(\w+)[\s\S]*?(?=;)/gm;
    const typeMatches = content.matchAll(typeRegex);
    
    for (const match of typeMatches) {
      if (match.index !== undefined) {
        // Calculate line numbers
        const upToIndex = content.substring(0, match.index);
        const startLine = upToIndex.split('\n').length;
        
        // Find the end of the type declaration
        const matchText = match[0];
        const typeName = match[1];
        
        // Find the semicolon that ends the type declaration
        let endIndex = match.index + matchText.length;
        
        for (let i = endIndex; i < content.length; i++) {
          if (content[i] === ';') {
            endIndex = i + 1;
            break;
          }
        }
        
        const typeContent = content.substring(match.index, endIndex);
        const endLine = startLine + typeContent.split('\n').length - 1;
        
        addBlock(
          'type',
          startLine,
          endLine,
          `Type: ${typeName}`,
          { name: typeName }
        );
      }
    }
    
    // Parse function declarations
    const functionRegex = /^(export\s+)?(async\s+)?function\s+(\w+)/gm;
    const functionMatches = content.matchAll(functionRegex);
    
    for (const match of functionMatches) {
      if (match.index !== undefined) {
        // Calculate line numbers
        const upToIndex = content.substring(0, match.index);
        const startLine = upToIndex.split('\n').length;
        
        const matchText = match[0];
        const functionName = match[3];
        const isExported = !!match[1];
        const isAsync = !!match[2];
        
        // Find the function body
        let braceCount = 0;
        let foundOpeningBrace = false;
        let endIndex = match.index + matchText.length;
        
        for (let i = match.index; i < content.length; i++) {
          if (content[i] === '{') {
            foundOpeningBrace = true;
            braceCount++;
          } else if (content[i] === '}') {
            braceCount--;
            if (foundOpeningBrace && braceCount === 0) {
              endIndex = i + 1;
              break;
            }
          }
        }
        
        const functionContent = content.substring(match.index, endIndex);
        const endLine = startLine + functionContent.split('\n').length - 1;
        
        // Add function block
        addBlock(
          'function',
          startLine,
          endLine,
          `Function: ${functionName}`,
          { 
            name: functionName,
            exported: isExported,
            async: isAsync
          }
        );
      }
    }
    
    // Parse class declarations
    const classRegex = /^(export\s+)?class\s+(\w+)/gm;
    const classMatches = content.matchAll(classRegex);
    
    for (const match of classMatches) {
      if (match.index !== undefined) {
        // Calculate line numbers
        const upToIndex = content.substring(0, match.index);
        const startLine = upToIndex.split('\n').length;
        
        const matchText = match[0];
        const className = match[2];
        const isExported = !!match[1];
        
        // Find the class body
        let braceCount = 0;
        let foundOpeningBrace = false;
        let endIndex = match.index + matchText.length;
        
        for (let i = match.index; i < content.length; i++) {
          if (content[i] === '{') {
            foundOpeningBrace = true;
            braceCount++;
          } else if (content[i] === '}') {
            braceCount--;
            if (foundOpeningBrace && braceCount === 0) {
              endIndex = i + 1;
              break;
            }
          }
        }
        
        const classContent = content.substring(match.index, endIndex);
        const endLine = startLine + classContent.split('\n').length - 1;
        
        // Add class block
        const classBlock = addBlock(
          'class',
          startLine,
          endLine,
          `Class: ${className}`,
          { 
            name: className,
            exported: isExported
          }
        );
        
        // Also parse methods inside the class
        const methodRegex = /(?:public|private|protected)?\s+(?:async\s+)?(\w+)\s*\(/g;
        const methodMatches = classContent.matchAll(methodRegex);
        
        for (const methodMatch of methodMatches) {
          if (methodMatch.index !== undefined) {
            // Calculate method line numbers relative to class
            const methodUpToIndex = classContent.substring(0, methodMatch.index);
            const methodStartLine = startLine + methodUpToIndex.split('\n').length - 1;
            
            const methodMatchText = methodMatch[0];
            const methodName = methodMatch[1];
            
            // Find the method body
            let methodBraceCount = 0;
            let methodFoundOpeningBrace = false;
            let methodEndIndex = methodMatch.index + methodMatchText.length;
            
            for (let i = methodMatch.index; i < classContent.length; i++) {
              if (classContent[i] === '{') {
                methodFoundOpeningBrace = true;
                methodBraceCount++;
              } else if (classContent[i] === '}') {
                methodBraceCount--;
                if (methodFoundOpeningBrace && methodBraceCount === 0) {
                  methodEndIndex = i + 1;
                  break;
                }
              }
            }
            
            const methodContent = classContent.substring(methodMatch.index, methodEndIndex);
            const methodEndLine = methodStartLine + methodContent.split('\n').length - 1;
            
            // Add method block as a child of the class block
            addBlock(
              'method',
              methodStartLine,
              methodEndLine,
              `Method: ${methodName}`,
              { 
                name: methodName, 
                class: className
              },
              classBlock.id
            );
          }
        }
      }
    }
    
    // Parse variable declarations
    const variableRegex = /^(?:export\s+)?(?:const|let|var)\s+(\w+)/gm;
    const variableMatches = content.matchAll(variableRegex);
    
    for (const match of variableMatches) {
      if (match.index !== undefined) {
        // Calculate line numbers
        const upToIndex = content.substring(0, match.index);
        const startLine = upToIndex.split('\n').length;
        
        const matchText = match[0];
        const varName = match[1];
        
        // Find the end of the variable declaration
        let endIndex = match.index + matchText.length;
        
        for (let i = endIndex; i < content.length; i++) {
          if (content[i] === ';' || content[i] === '\n') {
            endIndex = i + 1;
            break;
          }
        }
        
        const varContent = content.substring(match.index, endIndex);
        const endLine = startLine + varContent.split('\n').length - 1;
        
        // Add variable block
        addBlock(
          'variable',
          startLine,
          endLine,
          `Variable: ${varName}`,
          { name: varName }
        );
      }
    }
    
    // Parse JSX/TSX components (simplified, in real implementation we'd use tree-sitter)
    const jsxRegex = /^(?:export\s+)?(?:const|function)\s+(\w+)\s*=?\s*(?:\(|=>)/gm;
    const jsxMatches = content.matchAll(jsxRegex);
    
    for (const match of jsxMatches) {
      if (match.index !== undefined) {
        // Calculate line numbers
        const upToIndex = content.substring(0, match.index);
        const startLine = upToIndex.split('\n').length;
        
        const matchText = match[0];
        const componentName = match[1];
        
        // Check if it's likely a component (simple heuristic)
        // Component names usually start with uppercase
        if (componentName[0] !== componentName[0].toUpperCase()) {
          continue;
        }
        
        // Find the component body
        let braceCount = 0;
        let foundOpeningBrace = false;
        let endIndex = match.index + matchText.length;
        
        for (let i = match.index; i < content.length; i++) {
          if (content[i] === '{') {
            foundOpeningBrace = true;
            braceCount++;
          } else if (content[i] === '}') {
            braceCount--;
            if (foundOpeningBrace && braceCount === 0) {
              endIndex = i + 1;
              break;
            }
          }
        }
        
        const componentContent = content.substring(match.index, endIndex);
        const endLine = startLine + componentContent.split('\n').length - 1;
        
        // Add JSX component block
        addBlock(
          'jsx',
          startLine,
          endLine,
          `Component: ${componentName}`,
          { name: componentName }
        );
      }
    }
    
    // Parse comment blocks
    const commentRegex = /^\/\*\*[\s\S]*?\*\//gm;
    const commentMatches = content.matchAll(commentRegex);
    
    for (const match of commentMatches) {
      if (match.index !== undefined) {
        // Calculate line numbers
        const upToIndex = content.substring(0, match.index);
        const startLine = upToIndex.split('\n').length;
        
        const matchText = match[0];
        const endLine = startLine + matchText.split('\n').length - 1;
        
        // Add comment block
        addBlock(
          'comment',
          startLine,
          endLine,
          'Comment',
          {}
        );
      }
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
   * Extract content from line numbers
   */
  private extractContent(content: string, startLine: number, endLine: number): string {
    const lines = content.split('\n');
    return lines.slice(startLine - 1, endLine).join('\n');
  }
} 