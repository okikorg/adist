import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { BlockHierarchy, BlockType, DocumentBlock, IndexedDocument } from '../../types.js';
import { Parser, getDocumentTitle } from './base-parser.js';

// Try to import tree-sitter, but don't fail if not available
let treeSitter: any;
try {
  // @ts-ignore - We're dynamically importing
  treeSitter = require('tree-sitter');
} catch (e) {
  // Tree-sitter not available, we'll fall back to regex
}

// Try to load language parsers 
let tsJs: any, tsTsx: any, tsTs: any;
try {
  // @ts-ignore
  tsJs = require('tree-sitter-javascript');
  // @ts-ignore
  tsTsx = require('tree-sitter-tsx');
  // @ts-ignore
  tsTs = require('tree-sitter-typescript').typescript;
} catch (e) {
  // Language parsers not available
}

/**
 * Parser for code (TypeScript/JavaScript) files
 * Parses code into logical blocks like functions, classes, imports, etc.
 */
export class CodeParser implements Parser {
  private supportedExtensions = ['.js', '.jsx', '.ts', '.tsx'];
  private parser: any = null;
  private jsParser: any = null;
  private tsParser: any = null;
  private tsxParser: any = null;
  
  constructor() {
    // Initialize tree-sitter parser if available
    if (treeSitter) {
      this.parser = new treeSitter();
      
      if (tsJs) {
        this.jsParser = tsJs;
      }
      
      if (tsTs) {
        this.tsParser = tsTs;
      }
      
      if (tsTsx) {
        this.tsxParser = tsTsx;
      }
    }
  }

  canParse(filePath: string, content?: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return this.supportedExtensions.includes(ext);
  }

  async parse(
    filePath: string,
    content: string,
    stats: { size: number; mtime: Date }
  ): Promise<IndexedDocument> {
    // Determine if we can use tree-sitter for this file
    const canUseTreeSitter = this.initTreeSitterForFile(filePath);
    
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
    
    if (canUseTreeSitter) {
      // Parse using tree-sitter
      try {
        await this.parseWithTreeSitter(content, filePath, blocks, blockHierarchy, rootBlock.id);
      } catch (error) {
        console.warn(`Tree-sitter parsing failed for ${filePath}, falling back to regex: ${error}`);
        await this.parseWithRegex(content, filePath, blocks, blockHierarchy, rootBlock.id);
      }
    } else {
      // Fall back to regex parsing
      await this.parseWithRegex(content, filePath, blocks, blockHierarchy, rootBlock.id);
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
   * Initialize the tree-sitter parser for a specific file type
   */
  private initTreeSitterForFile(filePath: string): boolean {
    if (!this.parser) return false;
    
    const ext = path.extname(filePath).toLowerCase();
    
    // Set the language based on file extension
    try {
      if (ext === '.js' || ext === '.jsx') {
        if (this.jsParser) {
          this.parser.setLanguage(this.jsParser);
          return true;
        }
      } else if (ext === '.ts') {
        if (this.tsParser) {
          this.parser.setLanguage(this.tsParser);
          return true;
        }
      } else if (ext === '.tsx') {
        if (this.tsxParser) {
          this.parser.setLanguage(this.tsxParser);
          return true;
        }
      }
    } catch (e) {
      console.warn(`Failed to set tree-sitter language for ${ext}: ${e}`);
    }
    
    return false;
  }
  
  /**
   * Parse code using tree-sitter (AST-based approach)
   */
  private async parseWithTreeSitter(
    content: string,
    filePath: string,
    blocks: DocumentBlock[],
    blockHierarchy: BlockHierarchy,
    rootId: string
  ): Promise<void> {
    // Parse the file
    const tree = this.parser.parse(content);
    const rootNode = tree.rootNode;
    
    // Create a block ID map for faster lookup
    const blockIdMap = new Map<string, DocumentBlock>();
    blocks.forEach(block => blockIdMap.set(block.id, block));
    
    // Function to create a block ID from a node
    const getNodeId = (node: any, type: string): string => {
      const startLine = node.startPosition.row + 1;
      const nodeText = content.substring(node.startIndex, node.endIndex);
      return `${filePath}:${type}:${startLine}:${nodeText.substring(0, 20).replace(/\s+/g, '_')}`;
    };
    
    // Process each child of the root node
    const processNode = (node: any, parentId: string = rootId): void => {
      if (!node) return;
      
      const startLine = node.startPosition.row + 1;
      const endLine = node.endPosition.row + 1;
      const nodeText = content.substring(node.startIndex, node.endIndex);
      
      let blockType: BlockType | null = null;
      let blockTitle = '';
      let metadata: any = {};
      
      // Determine the block type based on the node type
      switch (node.type) {
        case 'import_statement':
          blockType = 'imports';
          blockTitle = 'Import';
          
          // Extract imported modules
          const fromClause = node.children.find((c: any) => c.type === 'string');
          if (fromClause) {
            const moduleName = content.substring(fromClause.startIndex + 1, fromClause.endIndex - 1);
            metadata.dependencies = [moduleName];
          }
          break;
        
        case 'class_declaration':
          blockType = 'class';
          
          // Get class name
          const classNameNode = node.children.find((c: any) => c.type === 'identifier');
          if (classNameNode) {
            const className = content.substring(classNameNode.startIndex, classNameNode.endIndex);
            blockTitle = `Class: ${className}`;
            metadata.name = className;
          } else {
            blockTitle = 'Class';
          }
          break;
        
        case 'interface_declaration':
          blockType = 'interface';
          
          // Get interface name
          const interfaceNameNode = node.children.find((c: any) => c.type === 'identifier');
          if (interfaceNameNode) {
            const interfaceName = content.substring(interfaceNameNode.startIndex, interfaceNameNode.endIndex);
            blockTitle = `Interface: ${interfaceName}`;
            metadata.name = interfaceName;
          } else {
            blockTitle = 'Interface';
          }
          break;
        
        case 'function_declaration':
          blockType = 'function';
          
          // Get function name and parameters
          const funcNameNode = node.children.find((c: any) => c.type === 'identifier');
          const parameterNode = node.children.find((c: any) => c.type === 'formal_parameters');
          
          if (funcNameNode) {
            const funcName = content.substring(funcNameNode.startIndex, funcNameNode.endIndex);
            blockTitle = `Function: ${funcName}`;
            metadata.name = funcName;
            
            if (parameterNode) {
              const params = content.substring(parameterNode.startIndex, parameterNode.endIndex);
              metadata.signature = `${funcName}${params}`;
            }
          } else {
            blockTitle = 'Function';
          }
          break;
        
        case 'method_definition':
          blockType = 'method';
          
          // Get method name and parameters
          const methodNameNode = node.children.find((c: any) => 
            c.type === 'property_identifier' || c.type === 'identifier'
          );
          const methodParamsNode = node.children.find((c: any) => c.type === 'formal_parameters');
          
          if (methodNameNode) {
            const methodName = content.substring(methodNameNode.startIndex, methodNameNode.endIndex);
            blockTitle = `Method: ${methodName}`;
            metadata.name = methodName;
            
            if (methodParamsNode) {
              const params = content.substring(methodParamsNode.startIndex, methodParamsNode.endIndex);
              metadata.signature = `${methodName}${params}`;
            }
          } else {
            blockTitle = 'Method';
          }
          break;
        
        case 'export_statement':
          blockType = 'export';
          blockTitle = 'Export';
          
          // Check what's being exported
          const declaration = node.children.find((c: any) => 
            c.type === 'class_declaration' || 
            c.type === 'function_declaration' || 
            c.type === 'interface_declaration'
          );
          
          if (declaration) {
            // This is an export declaration, process the inner node instead
            processNode(declaration, parentId);
            return; // Skip creating a separate block for this export
          }
          
          // Regular export, extract what's being exported
          const exportedNames: string[] = [];
          node.children.forEach((child: any) => {
            if (child.type === 'identifier') {
              exportedNames.push(content.substring(child.startIndex, child.endIndex));
            }
          });
          
          if (exportedNames.length > 0) {
            metadata.exports = exportedNames;
            blockTitle = `Export: ${exportedNames.join(', ')}`;
          }
          break;
        
        case 'lexical_declaration':
        case 'variable_declaration':
          blockType = 'variable';
          
          // Extract variable name(s)
          const varNames: string[] = [];
          const declarators = node.children.filter((c: any) => c.type === 'variable_declarator');
          
          declarators.forEach((declarator: any) => {
            const nameNode = declarator.children.find((c: any) => c.type === 'identifier');
            if (nameNode) {
              varNames.push(content.substring(nameNode.startIndex, nameNode.endIndex));
            }
          });
          
          if (varNames.length > 0) {
            blockTitle = `Variable: ${varNames.join(', ')}`;
            metadata.name = varNames.join(', ');
          } else {
            blockTitle = 'Variable';
          }
          break;
        
        case 'type_alias_declaration':
          blockType = 'type';
          
          // Get type name
          const typeNameNode = node.children.find((c: any) => c.type === 'identifier');
          if (typeNameNode) {
            const typeName = content.substring(typeNameNode.startIndex, typeNameNode.endIndex);
            blockTitle = `Type: ${typeName}`;
            metadata.name = typeName;
          } else {
            blockTitle = 'Type';
          }
          break;
        
        case 'jsx_element':
        case 'jsx_self_closing_element':
          blockType = 'jsx';
          
          // Try to get component name
          const tagNameNode = node.children.find((c: any) => 
            c.type === 'jsx_opening_element' || c.type === 'jsx_self_closing_element'
          );
          
          if (tagNameNode) {
            const tagName = tagNameNode.children.find((c: any) => c.type === 'identifier');
            if (tagName) {
              const componentName = content.substring(tagName.startIndex, tagName.endIndex);
              blockTitle = `Component: ${componentName}`;
              metadata.name = componentName;
            } else {
              blockTitle = 'JSX Element';
            }
          } else {
            blockTitle = 'JSX Element';
          }
          break;
        
        case 'comment':
          blockType = 'comment';
          
          // Extract first line as title
          const commentText = content.substring(node.startIndex, node.endIndex);
          const firstLine = commentText.split('\n')[0].replace(/^\/\*+\s*|\s*\*+\/$/g, '').trim();
          blockTitle = firstLine || 'Comment';
          break;
      }
      
      // If we recognized this node type, create a block for it
      if (blockType) {
        const block: DocumentBlock = {
          id: uuidv4(),
          type: blockType,
          content: this.extractContent(content, startLine, endLine),
          startLine,
          endLine,
          path: filePath,
          title: blockTitle,
          parent: parentId,
          children: [],
          metadata,
        };
        
        blocks.push(block);
        blockIdMap.set(block.id, block);
        
        // Add to parent's children
        const parent = blockIdMap.get(parentId);
        if (parent) {
          parent.children = parent.children || [];
          parent.children.push(block.id);
        }
        
        // Update block map
        blockHierarchy.blockMap[block.id] = {
          block: block.id,
          children: [],
        };
        
        // Process children of this node (for classes, interfaces, etc.)
        if (node.children && (blockType === 'class' || blockType === 'interface')) {
          node.children.forEach((child: any) => {
            // Only process certain child types
            if (['method_definition', 'public_field_definition', 'method_signature'].includes(child.type)) {
              processNode(child, block.id);
            }
          });
        }
      } else {
        // If this node isn't a recognized block type, process its children at the same level
        if (node.children) {
          node.children.forEach((child: any) => {
            processNode(child, parentId);
          });
        }
      }
    };
    
    // Start processing from the root node's children
    rootNode.children.forEach((child: any) => {
      processNode(child);
    });
  }
  
  /**
   * Legacy regex-based parsing (fallback if tree-sitter isn't available)
   */
  private async parseWithRegex(
    content: string,
    filePath: string,
    blocks: DocumentBlock[],
    blockHierarchy: BlockHierarchy,
    rootId: string
  ): Promise<void> {
    // Function to add a block to the document
    const addBlock = (
      type: BlockType,
      startLine: number,
      endLine: number,
      title: string,
      metadata: any = {},
      parentId = rootId
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

    const lines = content.split('\n');
    let currentBlock: {
      type: BlockType;
      startLine: number;
      endLine: number;
      title: string;
      metadata: any;
      parentId: string;
    } | null = null;
    let braceCount = 0;

    // Helper to finalize current block
    const finalizeCurrentBlock = () => {
      if (currentBlock) {
        addBlock(
          currentBlock.type,
          currentBlock.startLine,
          currentBlock.endLine,
          currentBlock.title,
          currentBlock.metadata,
          currentBlock.parentId
        );
        currentBlock = null;
      }
    };

    // Process each line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineNumber = i + 1;

      // Skip empty lines
      if (!line) continue;

      // Check for imports block
      if (line.startsWith('import ')) {
        if (!currentBlock || currentBlock.type !== 'imports') {
          finalizeCurrentBlock();
          currentBlock = {
            type: 'imports',
            startLine: lineNumber,
            endLine: lineNumber,
            title: 'Imports',
            metadata: {},
            parentId: rootId
          };
        } else {
          currentBlock.endLine = lineNumber;
        }
        continue;
      }

      // Check for variable declarations
      if (line.startsWith('const ') || line.startsWith('let ') || line.startsWith('var ')) {
        finalizeCurrentBlock();
        const varName = line.split(' ')[1].split('=')[0].trim();
        currentBlock = {
          type: 'variable',
          startLine: lineNumber,
          endLine: lineNumber,
          title: `Variable: ${varName}`,
          metadata: { name: varName },
          parentId: rootId
        };
        continue;
      }

      // Check for function declarations
      if (line.startsWith('function ') || line.match(/^(export\s+)?(async\s+)?function\s+/)) {
        finalizeCurrentBlock();
        const funcName = line.match(/function\s+(\w+)/)?.[1] || 'anonymous';
        currentBlock = {
          type: 'function',
          startLine: lineNumber,
          endLine: lineNumber,
          title: `Function: ${funcName}`,
          metadata: { name: funcName },
          parentId: rootId
        };
        braceCount = 0;
        continue;
      }

      // Check for class declarations
      if (line.startsWith('class ') || line.match(/^(export\s+)?class\s+/)) {
        finalizeCurrentBlock();
        const className = line.match(/class\s+(\w+)/)?.[1] || 'anonymous';
        currentBlock = {
          type: 'class',
          startLine: lineNumber,
          endLine: lineNumber,
          title: `Class: ${className}`,
          metadata: { name: className },
          parentId: rootId
        };
        braceCount = 0;
        continue;
      }

      // Update current block if exists
      if (currentBlock) {
        // Count braces to determine block boundaries
        braceCount += (line.match(/{/g) || []).length;
        braceCount -= (line.match(/}/g) || []).length;

        // Update end line
        currentBlock.endLine = lineNumber;

        // Finalize block if we've closed all braces
        if (braceCount === 0 && (line.endsWith('}') || line.endsWith(';'))) {
          finalizeCurrentBlock();
        }
      }
    }

    // Finalize any remaining block
    finalizeCurrentBlock();
  }

  /**
   * Extract content from line numbers
   */
  private extractContent(content: string, startLine: number, endLine: number): string {
    const lines = content.split('\n');
    return lines.slice(startLine - 1, endLine).join('\n');
  }
} 