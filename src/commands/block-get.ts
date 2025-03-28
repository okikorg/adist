import pc from 'picocolors';
import { Command } from 'commander';
import { highlight } from 'cli-highlight';
import { BlockSearchEngine } from '../utils/block-indexer.js';
import { DocumentBlock } from '../types.js';
import config from '../config.js';

/**
 * Command for searching with the block-based indexer
 */
export const blockGetCommand = new Command('block-get')
  .description('Search for blocks matching a query (default search method)')
  .argument('<query>', 'The search query')
  .option('-n, --max-results <number>', 'Maximum number of results to show', '10')
  .option('-l, --limit-lines <number>', 'Limit the number of content lines shown per block', '20')
  .action(async (query: string, options: { maxResults?: number; limitLines?: number }) => {
    try {
      const maxResults = options.maxResults ? parseInt(String(options.maxResults), 10) : 10;
      const limitLines = options.limitLines ? parseInt(String(options.limitLines), 10) : 20;

      console.log(pc.cyan(`🔍 Searching for blocks matching: ${pc.bold(query)}`));

      const searchEngine = new BlockSearchEngine();
      const results = await searchEngine.searchBlocks(query);

      if (results.length === 0) {
        console.log(pc.yellow('No matching blocks found.'));
        process.exit(0);
      }

      // Display the results
      console.log(pc.green(`Found ${results.length} document${results.length > 1 ? 's' : ''} with matching blocks:`));
      
      for (const result of results.slice(0, maxResults)) {
        console.log(pc.bold(pc.blue(`\nFile: ${result.document}`)));
        
        // Sort blocks by line number
        const sortedBlocks = [...result.blocks].sort((a, b) => a.startLine - b.startLine);
        
        for (const block of sortedBlocks) {
          console.log(pc.yellow(`  Block: ${block.type} (${block.startLine}-${block.endLine})`));
          if (block.title) {
            console.log(pc.bold(`  Title: ${block.title}`));
          }
          
          // Limit content to specified number of lines
          const lines = block.content.split('\n');
          const displayLines = lines.length > limitLines 
            ? [...lines.slice(0, limitLines), `... (${lines.length - limitLines} more lines)`]
            : lines;
          
          // Determine language for syntax highlighting
          let language: string | undefined;
          
          if (block.type === 'codeblock') {
            language = block.metadata?.language;
          } else if (result.document.endsWith('.js')) {
            language = 'javascript';
          } else if (result.document.endsWith('.ts')) {
            language = 'typescript';
          } else if (result.document.endsWith('.jsx')) {
            language = 'javascript';
          } else if (result.document.endsWith('.tsx')) {
            language = 'typescript';
          } else if (result.document.endsWith('.md')) {
            language = 'markdown';
          }
          
          // Display content with syntax highlighting
          if (displayLines.length > 0) {
            console.log(pc.dim('  Content:'));
            const content = displayLines.join('\n');
            
            if (language) {
              console.log(highlight(content, { language, ignoreIllegals: true }));
            } else {
              console.log(content);
            }
          }
          
          console.log(); // Empty line for separation
        }
      }
      
      if (results.length > maxResults) {
        console.log(pc.dim(`\nShowing ${maxResults} out of ${results.length} results. Use --max-results to show more.`));
      }

      process.exit(0);
    } catch (error) {
      console.error(pc.bold(pc.red('✘ Error searching blocks:')), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Block get function for programmatic use
 */
export const blockGet = async (query: string, options?: { maxResults?: number; limitLines?: number }): Promise<void> => {
  await blockGetCommand.parseAsync([
    query,
    ...(options?.maxResults ? ['--max-results', options.maxResults.toString()] : []),
    ...(options?.limitLines ? ['--limit-lines', options.limitLines.toString()] : [])
  ]);
}; 