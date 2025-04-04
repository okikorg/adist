import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import pc from 'picocolors';
import { highlight } from 'cli-highlight';
import { DocumentBlock, IndexedDocument, BlockHierarchy } from '../types.js';
import { ParserRegistry } from '../utils/parsers/parser-registry.js';
import config from '../config.js';

/**
 * Displays the block structure of a single file
 */
export const inspectFileCommand = new Command('inspect-file')
  .description('Inspect how a file is parsed into blocks')
  .argument('<filePath>', 'Path to the file to inspect')
  .option('-v, --verbose', 'Show detailed block information', false)
  .option('-t, --tree', 'Show block structure as a tree', false)
  .option('-c, --content', 'Show block content', false)
  .option('-s, --stats', 'Show block statistics', false)
  .option('-r, --relationships', 'Show block relationships', false)
  .option('-f, --filter <type>', 'Filter blocks by type (e.g., function, class, import)')
  .option('-l, --lines <range>', 'Filter blocks by line range (e.g., 1-10)')
  .action(async (filePath, options) => {
    try {
      await inspectFile(filePath, options);
    } catch (error) {
      console.error(pc.red(`Error inspecting file: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

/**
 * Inspects and displays the block structure of a file
 */
async function inspectFile(filePath: string, options: { 
  verbose?: boolean; 
  tree?: boolean; 
  content?: boolean; 
  stats?: boolean;
  relationships?: boolean;
  filter?: string;
  lines?: string;
}) {
  try {
    console.log(pc.cyan(`🔍 Inspecting file: ${filePath}`));

    // Check if file exists
    const fullPath = path.resolve(process.cwd(), filePath);
    try {
      await fs.access(fullPath);
    } catch (error) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Read the file
    const content = await fs.readFile(fullPath, 'utf-8');
    const stats = await fs.stat(fullPath);

    // Parse the file
    console.log(pc.cyan('Parsing file into blocks...'));
    const parserRegistry = new ParserRegistry();
    const document = await parserRegistry.parse(filePath, content, { 
      size: stats.size,
      mtime: stats.mtime
    });

    // Apply filters if specified
    let filteredBlocks = document.blocks;
    if (options.filter) {
      filteredBlocks = filteredBlocks.filter(block => 
        block.type.toLowerCase() === options.filter?.toLowerCase()
      );
    }
    if (options.lines) {
      const [start, end] = options.lines.split('-').map(Number);
      filteredBlocks = filteredBlocks.filter(block => 
        block.startLine >= start && block.endLine <= end
      );
    }

    // Display document info
    console.log('\n' + pc.bold('📄 Document Information:'));
    console.log(pc.dim('├─ ') + pc.white('Path: ') + document.path);
    console.log(pc.dim('├─ ') + pc.white('Title: ') + document.title);
    console.log(pc.dim('├─ ') + pc.white('Size: ') + formatBytes(document.size));
    console.log(pc.dim('├─ ') + pc.white('Last Modified: ') + new Date(document.lastModified).toLocaleString());
    console.log(pc.dim('├─ ') + pc.white('Language: ') + (document.language || 'unknown'));
    console.log(pc.dim('└─ ') + pc.white('Block Count: ') + filteredBlocks.length);

    // Show block statistics if requested
    if (options.stats) {
      displayBlockStatistics(filteredBlocks);
    }

    // Show block relationships if requested
    if (options.relationships) {
      displayBlockRelationships(document);
    }

    // Display blocks
    if (options.tree) {
      displayBlockTree(document, options);
    } else {
      displayBlockList(document, options);
    }

  } catch (error) {
    console.error(pc.red(`Error inspecting file: ${error instanceof Error ? error.message : String(error)}`));
    throw error;
  }
}

/**
 * Format bytes to human-readable format
 */
function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/**
 * Display blocks as a flat list
 */
function displayBlockList(document: IndexedDocument, options: { verbose?: boolean; content?: boolean }) {
  console.log('\n' + pc.bold('🧩 Blocks:'));

  // Sort blocks by start line
  const sortedBlocks = [...document.blocks].sort((a, b) => a.startLine - b.startLine);

  sortedBlocks.forEach((block, index) => {
    const isLast = index === sortedBlocks.length - 1;
    const prefix = isLast ? pc.dim('└─ ') : pc.dim('├─ ');
    
    // Basic block info with enhanced formatting
    console.log(`\n${prefix}${pc.bold(pc.green(block.type.toUpperCase()))} ${pc.cyan(block.title || `(Line ${block.startLine}-${block.endLine})`)}`);
    
    // Block details with better organization
    const detailPrefix = isLast ? pc.dim('   ') : pc.dim('│  ');
    console.log(`${detailPrefix}${pc.white('ID:')} ${block.id}`);
    console.log(`${detailPrefix}${pc.white('Lines:')} ${block.startLine}-${block.endLine}`);
    
    // Show content with better formatting
    if (options.content) {
      const contentPrefix = isLast ? pc.dim('   ') : pc.dim('│  ');
      
      // Determine language for syntax highlighting
      let language = 'plaintext';
      if (block.metadata?.language) {
        language = block.metadata.language;
      } else if (document.language) {
        language = document.language;
      }
      
      // Format and highlight the content
      const highlightedContent = highlight(block.content, { language });
      const contentLines = highlightedContent.split('\n');
      
      // Show content with line numbers
      console.log(`${contentPrefix}${pc.white('Content:')}`);
      for (let i = 0; i < contentLines.length; i++) {
        const lineNumber = block.startLine + i;
        console.log(`${contentPrefix}${pc.dim('   ')}${pc.dim(lineNumber.toString().padStart(4) + ' | ')}${contentLines[i]}`);
      }
    }
    
    // Show metadata with better organization
    if (options.verbose && block.metadata) {
      console.log(`${detailPrefix}${pc.white('Metadata:')}`);
      const metaPrefix = isLast ? pc.dim('   ├─ ') : pc.dim('│  ├─ ');
      const metaLastPrefix = isLast ? pc.dim('   └─ ') : pc.dim('│  └─ ');
      
      const metaEntries = Object.entries(block.metadata);
      metaEntries.forEach(([key, value], idx) => {
        const isMetaLast = idx === metaEntries.length - 1;
        const itemPrefix = isMetaLast ? metaLastPrefix : metaPrefix;
        
        if (Array.isArray(value)) {
          console.log(`${itemPrefix}${pc.white(key + ':')} ${value.join(', ')}`);
        } else if (typeof value === 'object' && value !== null) {
          console.log(`${itemPrefix}${pc.white(key + ':')}`);
          Object.entries(value).forEach(([subKey, subValue], subIdx) => {
            const isSubLast = subIdx === Object.entries(value).length - 1;
            const subPrefix = isSubLast ? pc.dim('   │  └─ ') : pc.dim('   │  ├─ ');
            console.log(`${subPrefix}${pc.white(subKey + ':')} ${subValue}`);
          });
        } else {
          console.log(`${itemPrefix}${pc.white(key + ':')} ${value}`);
        }
      });
    }
  });
}

/**
 * Display blocks as a hierarchical tree
 */
function displayBlockTree(document: IndexedDocument, options: { verbose?: boolean; content?: boolean }) {
  console.log('\n' + pc.bold('🌳 Block Hierarchy:'));
  
  // Create a map for easier lookup
  const blocksMap = new Map<string, DocumentBlock>();
  document.blocks.forEach(block => {
    blocksMap.set(block.id, block);
  });
  
  // Get the root block
  const rootId = document.blockHierarchy.root;
  const rootBlock = blocksMap.get(rootId);
  
  if (!rootBlock) {
    console.log(pc.yellow('No root block found in hierarchy'));
    return;
  }
  
  /**
   * Custom tree printing function
   */
  function customPrintTree(
    block: DocumentBlock, 
    prefix = '', 
    isLast = true
  ) {
    // Print current block
    console.log(
      `${prefix}${isLast ? '└─ ' : '├─ '}${pc.bold(pc.green(block.type))} ${pc.cyan(block.title || `(Line ${block.startLine}-${block.endLine})`)}`
    );
    
    // Block details like ID and lines
    const detailPrefix = prefix + (isLast ? '   ' : '│  ');
    console.log(`${detailPrefix}${pc.white('ID:')} ${block.id}`);
    console.log(`${detailPrefix}${pc.white('Lines:')} ${block.startLine}-${block.endLine}`);
    
    // Show content
    let language = 'plaintext';
    if (block.metadata?.language) {
      language = block.metadata.language;
    }
    
    // Format and highlight the content
    const highlightedContent = highlight(block.content, { language });
    const contentLines = highlightedContent.split('\n');
    
    // Show content
    console.log(`${detailPrefix}${pc.white('Content:')}`);
    for (let i = 0; i < contentLines.length; i++) {
      console.log(`${detailPrefix}${pc.dim('   ')}${contentLines[i]}`);
    }
    
    // Show metadata if verbose
    if (options.verbose && block.metadata) {
      console.log(`${detailPrefix}${pc.white('Metadata:')}`);
      const metaPrefix = isLast ? pc.dim('   ├─ ') : pc.dim('│  ├─ ');
      const metaLastPrefix = isLast ? pc.dim('   └─ ') : pc.dim('│  └─ ');
      
      const metaEntries = Object.entries(block.metadata);
      metaEntries.forEach(([key, value], idx) => {
        const isMetaLast = idx === metaEntries.length - 1;
        const itemPrefix = isMetaLast ? metaLastPrefix : metaPrefix;
        
        if (Array.isArray(value)) {
          console.log(`${itemPrefix}${pc.white(key + ':')} ${value.join(', ')}`);
        } else {
          console.log(`${itemPrefix}${pc.white(key + ':')} ${value}`);
        }
      });
    }
    
    // Prepare next prefix for children
    const childPrefix = prefix + (isLast ? '   ' : '│  ');
    
    // Get children
    const children = block.children || [];
    
    // Process children
    children.forEach((childId, index) => {
      const childBlock = blocksMap.get(childId);
      if (!childBlock) return;
      
      const isChildLast = index === children.length - 1;
      customPrintTree(childBlock, childPrefix, isChildLast);
    });
  }
  
  // Start printing the tree from the root
  customPrintTree(rootBlock);
}

/**
 * Display block statistics
 */
function displayBlockStatistics(blocks: DocumentBlock[]) {
  console.log('\n' + pc.bold('📊 Block Statistics:'));
  
  // Count blocks by type
  const typeCounts = new Map<string, number>();
  blocks.forEach(block => {
    typeCounts.set(block.type, (typeCounts.get(block.type) || 0) + 1);
  });
  
  // Calculate average block size
  const totalLines = blocks.reduce((sum, block) => sum + (block.endLine - block.startLine + 1), 0);
  const avgLines = totalLines / blocks.length;
  
  // Find largest and smallest blocks
  const sortedBySize = [...blocks].sort((a, b) => 
    (b.endLine - b.startLine) - (a.endLine - a.startLine)
  );
  const largestBlock = sortedBySize[0];
  const smallestBlock = sortedBySize[sortedBySize.length - 1];
  
  // Display statistics
  console.log(pc.dim('├─ ') + pc.white('Total Blocks: ') + blocks.length);
  console.log(pc.dim('├─ ') + pc.white('Average Lines per Block: ') + avgLines.toFixed(1));
  console.log(pc.dim('├─ ') + pc.white('Largest Block: ') + 
    `${largestBlock.type} (${largestBlock.endLine - largestBlock.startLine + 1} lines)`);
  console.log(pc.dim('├─ ') + pc.white('Smallest Block: ') + 
    `${smallestBlock.type} (${smallestBlock.endLine - smallestBlock.startLine + 1} lines)`);
  
  // Display block type distribution
  console.log(pc.dim('└─ ') + pc.white('Block Types:'));
  typeCounts.forEach((count, type) => {
    const percentage = ((count / blocks.length) * 100).toFixed(1);
    console.log(pc.dim('   ├─ ') + pc.white(`${type}: `) + 
      `${count} (${percentage}%)`);
  });
}

/**
 * Display block relationships
 */
function displayBlockRelationships(document: IndexedDocument) {
  console.log('\n' + pc.bold('🔗 Block Relationships:'));
  
  // Create a map for easier lookup
  const blocksMap = new Map<string, DocumentBlock>();
  document.blocks.forEach(block => {
    blocksMap.set(block.id, block);
  });
  
  // Analyze relationships
  const relationships = new Map<string, Set<string>>();
  document.blocks.forEach(block => {
    if (block.children) {
      block.children.forEach(childId => {
        const child = blocksMap.get(childId);
        if (child) {
          if (!relationships.has(block.id)) {
            relationships.set(block.id, new Set());
          }
          relationships.get(block.id)?.add(childId);
        }
      });
    }
  });
  
  // Display relationships
  relationships.forEach((children, parentId) => {
    const parent = blocksMap.get(parentId);
    if (!parent) return;
    
    console.log(pc.dim('├─ ') + pc.white(`${parent.type} ${parent.title || `(Line ${parent.startLine}-${parent.endLine})`}`));
    children.forEach(childId => {
      const child = blocksMap.get(childId);
      if (child) {
        console.log(pc.dim('│  └─ ') + pc.white(`${child.type} ${child.title || `(Line ${child.startLine}-${child.endLine})`}`));
      }
    });
  });
}

/**
 * Deduplicate blocks that have the same content and start/end lines
 */
function deduplicateBlocks(blocks: DocumentBlock[]): DocumentBlock[] {
  // Create a map of content + range to list of blocks
  const contentRangeMap = new Map<string, DocumentBlock[]>();
  
  // Group blocks by content and range
  for (const block of blocks) {
    const key = `${block.content}:${block.startLine}-${block.endLine}`;
    if (!contentRangeMap.has(key)) {
      contentRangeMap.set(key, []);
    }
    contentRangeMap.get(key)!.push(block);
  }
  
  // Create a set to store the IDs of blocks to keep
  const blocksToKeep = new Set<string>();
  
  // Process groups of blocks with the same content and range
  for (const [key, blockGroup] of contentRangeMap) {
    if (blockGroup.length === 1) {
      // If there's only one block with this content and range, keep it
      blocksToKeep.add(blockGroup[0].id);
      continue;
    }
    
    // For multiple blocks with same content and range, establish priority
    const typeOrder = {
      'document': 10,  // Highest priority
      'heading': 9,
      'codeblock': 8,
      'table': 7,
      'list': 6,
      'listItem': 5,
      'paragraph': 4   // Lowest priority
    };
    
    // Handle numbered list items and paragraphs with the same content
    const hasListOrListItem = blockGroup.some(b => b.type === 'list' || b.type === 'listItem');
    
    // If we have list items and paragraphs with the same content, only keep the list items
    if (hasListOrListItem) {
      for (const block of blockGroup) {
        if (block.type !== 'paragraph') {
          blocksToKeep.add(block.id);
        }
      }
    } else {
      // Otherwise keep the highest priority block
      blockGroup.sort((a, b) => {
        const aPriority = typeOrder[a.type as keyof typeof typeOrder] || 0;
        const bPriority = typeOrder[b.type as keyof typeof typeOrder] || 0;
        return bPriority - aPriority;
      });
      
      // Only keep the highest priority block
      blocksToKeep.add(blockGroup[0].id);
    }
  }
  
  // Filter the original blocks to keep only the ones we want
  const result = blocks.filter(block => blocksToKeep.has(block.id));
  return result;
}

/**
 * Rebuild block hierarchy after deduplication
 */
function rebuildBlockHierarchy(blocks: DocumentBlock[]): DocumentBlock[] {
  // First, clear all children arrays
  blocks.forEach(block => {
    block.children = [];
  });
  
  // Sort blocks by line number and then by size (larger blocks first)
  const sortedBlocks = [...blocks].sort((a, b) => {
    if (a.startLine !== b.startLine) {
      return a.startLine - b.startLine;
    }
    // If same start line, sort by size (larger blocks first)
    const aSize = a.endLine - a.startLine;
    const bSize = b.endLine - b.startLine;
    return bSize - aSize;
  });
  
  // Build a map of block IDs to blocks for easy lookup
  const blockMap = new Map<string, DocumentBlock>();
  for (const block of sortedBlocks) {
    blockMap.set(block.id, block);
  }
  
  // For each block, find its parent
  for (const block of sortedBlocks) {
    if (block.type === 'document') continue; // Skip document block
    
    // Find potential parent blocks
    const potentialParents = sortedBlocks.filter(parent => 
      // Parent must have a larger or equal range
      parent.id !== block.id &&
      parent.startLine <= block.startLine && 
      parent.endLine >= block.endLine
    );
    
    // Sort potential parents by size (smallest first)
    potentialParents.sort((a, b) => {
      const aSize = a.endLine - a.startLine;
      const bSize = b.endLine - b.startLine;
      return aSize - bSize;
    });
    
    // Find the smallest parent
    const parent = potentialParents[0];
    if (parent) {
      // Add this block as a child of its parent
      if (!parent.children) {
        parent.children = [];
      }
      parent.children.push(block.id);
    }
  }
  
  return sortedBlocks;
}

/**
 * Update block hierarchy to match deduplicated blocks
 */
function updateBlockHierarchy(hierarchy: BlockHierarchy, blocks: DocumentBlock[]): BlockHierarchy {
  const validIds = new Set(blocks.map(b => b.id));
  const validBlockMap: Record<string, { block: string; children: string[] }> = {};
  
  for (const [id, entry] of Object.entries(hierarchy.blockMap)) {
    if (validIds.has(id)) {
      validBlockMap[id] = {
        block: entry.block,
        children: entry.children.filter((childId: string) => validIds.has(childId))
      };
    }
  }
  
  return {
    root: hierarchy.root,
    blockMap: validBlockMap
  };
}

/**
 * Truncate a string to a maximum length and add ellipsis if truncated
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + '...';
} 