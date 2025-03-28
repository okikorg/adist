import pc from 'picocolors';

// Mock block results for testing tree visualization
const blockResults = [
  {
    document: 'test-project/README.md',
    blocks: [
      { type: 'heading', title: 'Test Project', startLine: 1, endLine: 1, content: '# Test Project' },
      { type: 'document', startLine: 1, endLine: 2, content: 'This is a test project for adist summarization.' }
    ]
  },
  {
    document: 'src/utils/block-indexer.ts',
    blocks: [
      { type: 'method', title: 'Method: indexProject', startLine: 28, endLine: 29, content: 'public async indexProject' },
      { type: 'class', title: 'Class: BlockIndexer', startLine: 19, endLine: 140, content: 'export class BlockIndexer' },
      { type: 'document', startLine: 1, endLine: 325, content: '// Document content...' },
      { type: 'method', title: 'Another Method', startLine: 50, endLine: 60, content: 'public anotherMethod()' },
      { type: 'method', title: 'Yet Another', startLine: 70, endLine: 80, content: 'public yetAnother()' }
    ]
  },
  {
    document: 'src/types.d.ts',
    blocks: [
      { type: 'interface', title: 'Interface: Project', startLine: 85, endLine: 91, content: 'interface Project {}' },
      { type: 'document', startLine: 1, endLine: 171, content: '// Document content...' },
      { type: 'interface', title: 'Interface: AdistConfig', startLine: 93, endLine: 96, content: 'interface AdistConfig {}' }
    ]
  },
  {
    document: 'src/utils/anthropic.ts',
    blocks: [
      { type: 'method', title: 'Method: queryProject', startLine: 412, endLine: 416, content: 'public async queryProject' },
      { type: 'class', title: 'Class: AnthropicService', startLine: 19, endLine: 663, content: 'export class AnthropicService' },
      { type: 'document', startLine: 1, endLine: 663, content: '// Document content...' }
    ]
  },
  {
    document: 'billing/wallet_and_payment_workflow.md',
    blocks: [
      { type: 'document', title: 'Wallet Workflow', startLine: 1, endLine: 100, content: '# Wallet and Payment Workflow' }
    ]
  },
  {
    document: 'billing/test.md',
    blocks: [
      { type: 'document', title: 'Test Document', startLine: 1, endLine: 10, content: '# Test Document' }
    ]
  },
  {
    document: 'payment-sys/stripe-payment-arch.md',
    blocks: [
      { type: 'document', title: 'Stripe Architecture', startLine: 1, endLine: 50, content: '# Stripe Payment Architecture' }
    ]
  }
];

console.log(pc.bold(pc.cyan('\nDebug Info:')));
console.log(`Found ${blockResults.length} document(s) with ${blockResults.reduce((count, doc) => count + doc.blocks.length, 0)} relevant blocks`);

// Tree-like representation of search results
console.log('\nDocument tree:');

const projectStructure = new Map();
blockResults.forEach(doc => {
  // Split the document path to get directories and filename
  const pathParts = doc.document.split('/');
  const fileName = pathParts.pop() || '';
  
  // Build the tree structure
  let currentLevel = projectStructure;
  pathParts.forEach(part => {
    if (!currentLevel.has(part)) {
      currentLevel.set(part, new Map());
    }
    currentLevel = currentLevel.get(part);
  });
  
  // Add file with block info
  currentLevel.set(fileName, {
    isFile: true,
    blocks: doc.blocks,
    count: doc.blocks.length
  });
});

// Helper function to print the tree
const printTree = (structure, prefix = '', isLast = true) => {
  // Sort entries - directories first, then files
  const entries = [...structure.entries()].sort((a, b) => {
    const aIsDir = !a[1].isFile;
    const bIsDir = !b[1].isFile;
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;
    return a[0].localeCompare(b[0]);
  });
  
  entries.forEach(([key, value], index) => {
    const isLastEntry = index === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? '    ' : '│   ';
    
    if (value.isFile) {
      const fileNode = value;
      const blockInfo = fileNode.count > 0 ? pc.cyan(` (${fileNode.count} blocks)`) : '';
      console.log(`${prefix}${connector}${pc.bold(key)}${blockInfo}`);
      
      // Show block details with prettier formatting
      if (fileNode.count > 0) {
        const blocksToShow = fileNode.blocks.slice(0, 3);
        blocksToShow.forEach((block, blockIndex) => {
          const isLastBlock = blockIndex === blocksToShow.length - 1 && fileNode.count <= 3;
          const blockConnector = isLastBlock ? '└── ' : '├── ';
          let blockDesc = `${block.type}`;
          if (block.title) blockDesc += `: ${block.title}`;
          blockDesc += ` (lines ${block.startLine}-${block.endLine})`;
          console.log(`${prefix}${childPrefix}${blockConnector}${blockDesc}`);
        });
        
        if (fileNode.count > 3) {
          console.log(`${prefix}${childPrefix}└── ${pc.dim(`... and ${fileNode.count - 3} more blocks`)}`);
        }
      }
    } else {
      // It's a directory
      console.log(`${prefix}${connector}${pc.cyan(key)}`);
      printTree(value, `${prefix}${childPrefix}`, isLastEntry);
    }
  });
};

printTree(projectStructure); 