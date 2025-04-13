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
    
    // Track function definitions to link calls with their definitions
    const functionDefinitions = new Map<string, string>(); // name -> blockId
    
    // Track variable definitions
    const variableDefinitions = new Map<string, string>(); // name -> blockId
    
    // Track relationships between blocks (calling functions, using variables)
    const relationships = new Map<string, Set<string>>(); // blockId -> Set<relatedBlockId>
    
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
            
            // Store the class name for relationship tracking
            functionDefinitions.set(className, ''); // Temporarily store without blockId
          } else {
            blockTitle = 'Class';
          }
          
          // Advanced analysis for class complexity
          metadata.codeMetrics = {
            size: nodeText.split('\n').length,
            methods: 0, // Will be incremented as we process children
            variables: 0 // Will be incremented as we process children
          };
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
        case 'method_definition':
          blockType = node.type === 'function_declaration' ? 'function' : 'method';
          
          // Get function name and parameters
          const funcNameNode = node.children.find((c: any) => c.type === 'identifier');
          const parameterNode = node.children.find((c: any) => c.type === 'formal_parameters');
          
          if (funcNameNode) {
            const funcName = content.substring(funcNameNode.startIndex, funcNameNode.endIndex);
            blockTitle = `${blockType === 'function' ? 'Function' : 'Method'}: ${funcName}`;
            metadata.name = funcName;
            
            if (parameterNode) {
              const params = content.substring(parameterNode.startIndex, parameterNode.endIndex);
              metadata.signature = `${funcName}${params}`;
            }
            
            // Store the function name for relationship tracking
            functionDefinitions.set(funcName, ''); // Temporarily store without blockId
          } else {
            blockTitle = blockType === 'function' ? 'Function' : 'Method';
          }
          
          // Advanced analysis of function content
          const variablesDefined: string[] = [];
          const variablesUsed: string[] = [];
          const apiCalls: string[] = [];
          
          // Analyze function body for variables and API calls
          const bodyNode = node.children.find((c: any) => c.type === 'statement_block');
          if (bodyNode) {
            // Extract defined variables (variable declarations)
            const varDeclarations = this.findNodesOfType(bodyNode, 'variable_declaration');
            varDeclarations.forEach(varNode => {
              const declaratorNodes = this.findNodesOfType(varNode, 'variable_declarator');
              declaratorNodes.forEach(declarator => {
                const identifierNode = this.findNodesOfType(declarator, 'identifier')[0];
                if (identifierNode) {
                  const varName = content.substring(identifierNode.startIndex, identifierNode.endIndex);
                  variablesDefined.push(varName);
                  variableDefinitions.set(varName, ''); // Temporarily store without blockId
                }
              });
            });
            
            // Extract function calls
            const callExpressions = this.findNodesOfType(bodyNode, 'call_expression');
            callExpressions.forEach(callNode => {
              const functionIdNode = this.findNodesOfType(callNode, 'identifier')[0];
              if (functionIdNode) {
                const calledFunctionName = content.substring(functionIdNode.startIndex, functionIdNode.endIndex);
                apiCalls.push(calledFunctionName);
                variablesUsed.push(calledFunctionName); // Function name is used
              }
            });
            
            // Extract used variables
            const identifiers = this.findNodesOfType(bodyNode, 'identifier');
            identifiers.forEach(idNode => {
              // Skip if it's a function name or already in defined variables
              const idName = content.substring(idNode.startIndex, idNode.endIndex);
              const parentNode = idNode.parent;
              if (
                // Skip variable declarations (already handled)
                !(parentNode.type === 'variable_declarator' && parentNode.children[0].id === idNode.id) &&
                // Skip function name itself
                !(parentNode.type === 'function_declaration' && parentNode.children[0].id === idNode.id) &&
                // Skip method name itself
                !(parentNode.type === 'method_definition' && parentNode.children[0].id === idNode.id) &&
                // Skip property accesses (obj.prop - we only want obj)
                !(parentNode.type === 'property_access' && parentNode.children[1].id === idNode.id)
              ) {
                variablesUsed.push(idName);
              }
            });
          }
          
          // Add to metadata
          metadata.variables = {
            defined: Array.from(new Set(variablesDefined)),
            used: Array.from(new Set(variablesUsed))
          };
          
          metadata.apiCalls = Array.from(new Set(apiCalls));
          
          // Calculate simple cyclomatic complexity by counting decision points
          const decisionPoints = [
            ...this.findNodesOfType(node, 'if_statement'),
            ...this.findNodesOfType(node, 'for_statement'),
            ...this.findNodesOfType(node, 'while_statement'),
            ...this.findNodesOfType(node, 'switch_statement'),
            ...this.findNodesOfType(node, 'conditional_expression')
          ];
          
          metadata.codeMetrics = {
            cyclomaticComplexity: decisionPoints.length + 1, // Base complexity of 1
            lines: endLine - startLine + 1
          };
          
          // Generate a simple semantic summary
          metadata.semanticSummary = this.generateFunctionSummary(
            metadata.name || '',
            metadata.variables.defined || [],
            metadata.apiCalls || []
          );
          break;
        
        case 'variable_declaration':
          blockType = 'variable';
          
          // Get variable declarations
          const declarators = this.findNodesOfType(node, 'variable_declarator');
          const varNames: string[] = [];
          
          declarators.forEach(declarator => {
            const nameNode = declarator.children.find((c: any) => c.type === 'identifier');
            if (nameNode) {
              const varName = content.substring(nameNode.startIndex, nameNode.endIndex);
              varNames.push(varName);
              
              // Store the variable name for relationship tracking
              variableDefinitions.set(varName, '');
            }
          });
          
          if (varNames.length > 0) {
            blockTitle = `Variable: ${varNames.join(', ')}`;
            metadata.name = varNames.join(', ');
          } else {
            blockTitle = 'Variable';
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
      
      // If we identified a block type, create the block
      if (blockType) {
        // Generate a unique ID for this block
        const blockId = uuidv4();
        
        const block: DocumentBlock = {
          id: blockId,
          type: blockType,
          content: nodeText,
          startLine,
          endLine,
          path: filePath,
          title: blockTitle,
          parent: parentId,
          children: [],
          metadata
        };
        
        // Update function and variable maps with the block ID
        if (blockType === 'function' || blockType === 'method' || blockType === 'class') {
          if (metadata.name) {
            functionDefinitions.set(metadata.name, blockId);
          }
        } else if (blockType === 'variable') {
          if (metadata.name) {
            // Handle multiple variable declarations
            metadata.name.split(', ').forEach((name: string) => {
              variableDefinitions.set(name.trim(), blockId);
            });
          }
        }
        
        // Add the block to our array
        blocks.push(block);
        blockIdMap.set(blockId, block);
        
        // Add to block hierarchy
        if (!blockHierarchy.blockMap[blockId]) {
          blockHierarchy.blockMap[blockId] = {
            block: blockId,
            children: [],
          };
        }
        
        // Add to parent
        const parentBlock = blockIdMap.get(parentId);
        if (parentBlock) {
          if (!parentBlock.children) {
            parentBlock.children = [];
          }
          parentBlock.children.push(blockId);
          
          // Update block hierarchy
          if (blockHierarchy.blockMap[parentId]) {
            blockHierarchy.blockMap[parentId].children.push(blockId);
          }
        }
        
        // Process child nodes (recursive)
        if (node.children) {
          node.children.forEach((childNode: any) => {
            processNode(childNode, blockId);
          });
        }
      } else {
        // This node doesn't become a block, but process its children
        if (node.children) {
          node.children.forEach((childNode: any) => {
            processNode(childNode, parentId);
          });
        }
      }
    };
    
    // Start processing from the root
    if (rootNode.children) {
      rootNode.children.forEach((childNode: any) => {
        processNode(childNode);
      });
    }
    
    // Build relationships between blocks based on function calls and variable usage
    for (const block of blocks) {
      if (block.metadata?.apiCalls) {
        // Link function calls to their definitions
        for (const functionCall of block.metadata.apiCalls) {
          const targetBlockId = functionDefinitions.get(functionCall);
          if (targetBlockId && targetBlockId !== block.id) {
            // Create a relationship between this block and the called function
            if (!relationships.has(block.id)) {
              relationships.set(block.id, new Set());
            }
            relationships.get(block.id)!.add(targetBlockId);
          }
        }
      }
      
      // Link variable usages to their definitions
      if (block.metadata?.variables?.used) {
        for (const varUsed of block.metadata.variables.used) {
          const targetBlockId = variableDefinitions.get(varUsed);
          if (targetBlockId && targetBlockId !== block.id) {
            // Create a relationship between this block and the variable definition
            if (!relationships.has(block.id)) {
              relationships.set(block.id, new Set());
            }
            relationships.get(block.id)!.add(targetBlockId);
          }
        }
      }
    }
    
    // Apply the relationships to the blocks
    for (const [blockId, relatedBlockIds] of relationships.entries()) {
      const block = blockIdMap.get(blockId);
      if (block) {
        block.relatedBlockIds = Array.from(relatedBlockIds);
      }
    }
  }
  
  /**
   * Helper function to find nodes of a specific type within a parent node
   */
  private findNodesOfType(parentNode: any, type: string): any[] {
    const result: any[] = [];
    
    const traverseNode = (node: any) => {
      if (node.type === type) {
        result.push(node);
      }
      
      if (node.children) {
        node.children.forEach((childNode: any) => traverseNode(childNode));
      }
    };
    
    traverseNode(parentNode);
    return result;
  }
  
  /**
   * Generate a simple semantic summary for a function
   */
  private generateFunctionSummary(functionName: string, definedVars: string[], apiCalls: string[]): string {
    // In a real implementation, this would use an LLM or more sophisticated analysis
    let summary = `${functionName}`;
    
    // Add info about what it does based on variables and API calls
    if (definedVars.length > 0 || apiCalls.length > 0) {
      summary += " handles";
      
      if (definedVars.length > 0) {
        summary += ` ${definedVars.slice(0, 3).join(', ')}`;
        if (definedVars.length > 3) summary += ` and other variables`;
      }
      
      if (apiCalls.length > 0) {
        if (definedVars.length > 0) summary += " and";
        summary += ` calls ${apiCalls.slice(0, 3).join(', ')}`;
        if (apiCalls.length > 3) summary += ` and other functions`;
      }
    }
    
    return summary;
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