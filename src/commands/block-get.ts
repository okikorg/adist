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
  .description('Search for blocks matching a query (default search method). Supports advanced operators:\n' +
               '  - AND: "theme style AND color palette" - finds blocks containing both terms\n' +
               '  - OR: "theme OR style" - finds blocks containing either term')
  .argument('<query>', 'The search query (use "term1 AND term2" or "term1 OR term2" for advanced searching)')
  .option('-n, --max-results <number>', 'Maximum number of results to show', '10')
  .option('-l, --limit-lines <number>', 'Limit the number of content lines shown per block', '20')
  .action(async (query: string, options: { maxResults?: number; limitLines?: number }) => {
    try {
      const maxResults = options.maxResults ? parseInt(String(options.maxResults), 10) : 10;
      const limitLines = options.limitLines ? parseInt(String(options.limitLines), 10) : 20;

      console.log(pc.cyan(`🔍 Searching for blocks matching: ${pc.bold(query)}`));

      // Show what kind of search is being performed
      if (query.includes(' AND ')) {
        const terms = query.split(' AND ').map(term => term.trim());
        console.log(pc.cyan(`📋 Using advanced AND search with ${terms.length} terms`));
      } else if (query.includes(' OR ')) {
        const terms = query.split(' OR ').map(term => term.trim());
        console.log(pc.cyan(`📋 Using advanced OR search with ${terms.length} terms`));
      }

      const searchEngine = new BlockSearchEngine();
      const results = await searchEngine.searchBlocks(query);

      // Check if the query is about summaries or descriptions
      const isSummaryQuery = 
        query.toLowerCase().includes('summary') || 
        query.toLowerCase().includes('overview') || 
        query.toLowerCase().includes('describe') ||
        query.toLowerCase().includes('what is') ||
        query.toLowerCase().includes('what does') ||
        query.toLowerCase().includes('explain');

      if (results.length === 0) {
        // Check if the project has a summary available
        const currentProjectId = await config.get('currentProject') as string;
        if (!currentProjectId) {
          console.log(pc.yellow('No matching blocks found.'));
          process.exit(0);
        }
        
        const projects = await config.get('projects') as Record<string, { hasSummaries?: boolean }>;
        const project = projects[currentProjectId];
        
        if (project?.hasSummaries) {
          // Try to get block-based summaries first
          const blockIndexes = await config.get(`block-indexes.${currentProjectId}`) as any[] | undefined;
          
          if (blockIndexes && Array.isArray(blockIndexes) && blockIndexes.length > 0 && isSummaryQuery) {
            // Extract files with summaries
            const filesWithSummaries = blockIndexes
              .map(doc => {
                // Find document block with summary
                const documentBlock = Array.isArray(doc.blocks) 
                  ? doc.blocks.find((block: any) => block.type === 'document' && block.summary)
                  : null;
                
                if (documentBlock && documentBlock.summary) {
                  return {
                    path: doc.path,
                    summary: documentBlock.summary
                  };
                }
                return null;
              })
              .filter(Boolean);
            
            if (filesWithSummaries && filesWithSummaries.length > 0) {
              console.log(pc.yellow('No specific blocks matching your query were found.'));
              console.log(pc.cyan('However, file summaries are available:'));
              console.log();
              
              // Show at most 3 file summaries
              const filesToShow = filesWithSummaries.slice(0, 3);
              filesToShow.forEach((file: any) => {
                console.log(pc.bold(pc.cyan(`${file.path}:`)));
                console.log(file.summary);
                console.log();
              });
              
              if (filesWithSummaries.length > 3) {
                console.log(pc.dim(`... and ${filesWithSummaries.length - 3} more files with summaries`));
              }
              
              console.log(pc.dim('To view all file summaries:'));
              console.log(pc.cyan('  adist summary --list'));
              process.exit(0);
            }
          }
          
          const overallSummary = await config.get(`summaries.${currentProjectId}.overall`) as string | undefined;
          
          if (overallSummary) {
            console.log(pc.yellow('No specific code blocks matching your query were found.'));
            console.log(pc.cyan('However, a project summary is available:'));
            console.log('\n' + overallSummary + '\n');
            console.log(pc.dim('For more specific results, try another search query or use:'));
            console.log(pc.cyan('  adist summary --list'));
            process.exit(0);
          }
        }
        
        console.log(pc.yellow('No matching blocks found.'));
        process.exit(0);
      }

      // Display the results
      console.log(pc.green(`Found ${results.length} document${results.length > 1 ? 's' : ''} with matching blocks:`));
      
      for (const result of results.slice(0, maxResults)) {
        console.log(pc.bold(pc.blue(`\nFile: ${result.document}`)));
        
        // Check if there's a document block with a summary
        const documentBlock = result.blocks.find(block => 
          block.type === 'document' && 'summary' in block && block.summary
        );
        
        if (documentBlock && 'summary' in documentBlock && documentBlock.summary) {
          console.log(pc.cyan(`  Summary: ${documentBlock.summary}`));
        }
        
        // Sort blocks by line number
        const sortedBlocks = [...result.blocks].sort((a, b) => a.startLine - b.startLine);
        
        for (const block of sortedBlocks) {
          // Skip document blocks as we already showed the summary
          if (block.type === 'document' && 'summary' in block) {
            continue;
          }
          
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