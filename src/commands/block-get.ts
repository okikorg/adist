import pc from 'picocolors';
import { Command } from 'commander';
import { highlight } from 'cli-highlight';
import { BlockSearchEngine } from '../utils/block-indexer.js';
import { DocumentBlock } from '../types.js';
import config from '../config.js';

/**
 * Get terminal width with fallback for environments where process.stdout is not available
 */
function getTerminalWidth(): number {
  try {
    // Get terminal width or default to 80 if not available
    return process.stdout.columns || 80;
  } catch (e) {
    return 80; // Fallback width
  }
}

/**
 * Calculate line width for content based on terminal size
 */
function getContentLineWidth(): number {
  const termWidth = getTerminalWidth();
  // Leave some margin for the vertical bars and indentation
  return Math.max(termWidth - 10, 60);
}

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

      // Get line width based on terminal size
      const lineWidth = getContentLineWidth();
      const borderWidth = lineWidth + 4; // Adding some space for borders

      // Create a nice header
      console.log();
      console.log(pc.bold(pc.bgCyan(pc.black(' ADIST SEARCH '))));
      console.log(pc.cyan('─'.repeat(borderWidth)));
      console.log(`${pc.bold('Query:')} ${pc.yellow(query)}`);

      // Show what kind of search is being performed
      if (query.includes(' AND ')) {
        const terms = query.split(' AND ').map(term => term.trim());
        console.log(`${pc.bold('Search type:')} ${pc.magenta('Advanced AND')} (${terms.length} terms)`);
      } else if (query.includes(' OR ')) {
        const terms = query.split(' OR ').map(term => term.trim());
        console.log(`${pc.bold('Search type:')} ${pc.magenta('Advanced OR')} (${terms.length} terms)`);
      } else {
        console.log(`${pc.bold('Search type:')} ${pc.magenta('Simple')}`);
      }
      console.log(pc.cyan('─'.repeat(borderWidth)));

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
          console.log(pc.yellow('\n⚠ No matching blocks found.'));
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
              console.log(pc.yellow('\n⚠ No specific blocks matching your query were found.'));
              console.log(pc.cyan('However, file summaries are available:'));
              console.log();
              
              // Show at most 3 file summaries
              const filesToShow = filesWithSummaries.slice(0, 3);
              filesToShow.forEach((file: any) => {
                console.log(pc.bold(pc.cyan(`${file.path}:`)));
                console.log(pc.dim('┌' + '─'.repeat(borderWidth - 2) + '┐'));
                
                // Break summary text to fit width
                const summaryLines = file.summary.split('\n');
                for (const line of summaryLines) {
                  if (line.length <= lineWidth) {
                    console.log(pc.dim('│') + ` ${line}`.padEnd(borderWidth - 2) + pc.dim('│'));
                  } else {
                    // Handle line wrapping for long lines
                    let remainingText = line;
                    while (remainingText.length > 0) {
                      const chunk = remainingText.slice(0, lineWidth);
                      console.log(pc.dim('│') + ` ${chunk}`.padEnd(borderWidth - 2) + pc.dim('│'));
                      remainingText = remainingText.slice(lineWidth);
                    }
                  }
                }
                
                console.log(pc.dim('└' + '─'.repeat(borderWidth - 2) + '┘'));
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
            console.log(pc.yellow('\n⚠ No specific code blocks matching your query were found.'));
            console.log(pc.cyan('However, a project summary is available:'));
            console.log(pc.dim('┌' + '─'.repeat(borderWidth - 2) + '┐'));
            
            // Break summary into lines that fit width
            const summaryLines = overallSummary.split('\n');
            for (const line of summaryLines) {
              if (line.length <= lineWidth) {
                console.log(pc.dim('│') + ` ${line}`.padEnd(borderWidth - 2) + pc.dim('│'));
              } else {
                // Handle line wrapping for long lines
                let remainingText = line;
                while (remainingText.length > 0) {
                  const chunk = remainingText.slice(0, lineWidth);
                  console.log(pc.dim('│') + ` ${chunk}`.padEnd(borderWidth - 2) + pc.dim('│'));
                  remainingText = remainingText.slice(lineWidth);
                }
              }
            }
            
            console.log(pc.dim('└' + '─'.repeat(borderWidth - 2) + '┘'));
            console.log(pc.dim('\nFor more specific results, try another search query or use:'));
            console.log(pc.cyan('  adist summary --list'));
            process.exit(0);
          }
        }
        
        console.log(pc.yellow('\n⚠ No matching blocks found.'));
        process.exit(0);
      }

      // Display the results
      console.log(pc.bold(pc.green(`\n✓ SEARCH RESULTS`)) + pc.gray(` (${results.length} documents with matching blocks)`));
      
      for (let i = 0; i < Math.min(results.length, maxResults); i++) {
        const result = results[i];
        // Show result number with better styling
        console.log(`\n${pc.bold(pc.bgBlue(` RESULT #${i+1} `))} ${pc.bold(pc.blue(`${result.document}`))}`);
        
        // Check if there's a document block with a summary
        const documentBlock = result.blocks.find(block => 
          block.type === 'document' && 'summary' in block && block.summary
        );
        
        if (documentBlock && 'summary' in documentBlock && documentBlock.summary) {
          console.log(pc.cyan(`  ┌${'─'.repeat(borderWidth - 4)}`));
          console.log(pc.cyan(`  │ ${pc.bold('SUMMARY')}`));
          
          // Format summary text with proper wrapping based on terminal width
          const summaryLines = documentBlock.summary.split('\n');
          
          for (const line of summaryLines) {
            // Handle long lines by breaking them into chunks
            if (line.length <= lineWidth) {
              console.log(pc.cyan(`  │ `) + line);
            } else {
              // Break long lines into multiple lines
              let remainingText = line;
              while (remainingText.length > 0) {
                const chunk = remainingText.slice(0, lineWidth);
                console.log(pc.cyan(`  │ `) + chunk);
                remainingText = remainingText.slice(lineWidth);
              }
            }
          }
          
          console.log(pc.cyan(`  └${'─'.repeat(borderWidth - 4)}`));
        }
        
        // Sort blocks by line number
        const sortedBlocks = [...result.blocks].sort((a, b) => a.startLine - b.startLine);
        
        for (const block of sortedBlocks) {
          // Skip document blocks as we already showed the summary
          if (block.type === 'document' && 'summary' in block) {
            continue;
          }
          
          console.log(pc.yellow(`  │ ${pc.bold(block.type.toUpperCase())} (lines ${block.startLine}-${block.endLine})`));
          if (block.title) {
            console.log(pc.yellow(`  │ ${pc.bold('Title:')} ${pc.dim(block.title)}`));
          }
          
          // Limit content to specified number of lines
          const lines = block.content.split('\n');
          const displayLines = lines.length > limitLines 
            ? [...lines.slice(0, limitLines), pc.dim(`... (${lines.length - limitLines} more lines)`)]
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
          
          // Display content with syntax highlighting - use indentation and vertical bar instead of box
          if (displayLines.length > 0) {
            console.log(pc.yellow(`  │ ${pc.bold('Content:')}`));
            console.log(pc.yellow(`  ┌${'─'.repeat(borderWidth - 4)}`));
            
            const content = displayLines.join('\n');
            
            if (language) {
              // Add vertical bar with indent to each line of highlighted content
              const highlightedContent = highlight(content, { language, ignoreIllegals: true });
              const contentLines = highlightedContent.split('\n');
              
              for (const line of contentLines) {
                if (line.length <= lineWidth) {
                  console.log(pc.dim(`  │ `) + line);
                } else {
                  // Break long lines if needed
                  let remainingText = line;
                  let isFirstChunk = true;
                  
                  while (remainingText.length > 0) {
                    const chunk = remainingText.slice(0, lineWidth);
                    console.log(pc.dim(`  │ `) + (isFirstChunk ? '' : '  ') + chunk);
                    remainingText = remainingText.slice(lineWidth);
                    isFirstChunk = false;
                  }
                }
              }
            } else {
              // Add vertical bar with indent to each line of non-highlighted content
              const contentLines = content.split('\n');
              
              for (const line of contentLines) {
                if (line.length <= lineWidth) {
                  console.log(pc.dim(`  │ `) + line);
                } else {
                  // Break long lines if needed
                  let remainingText = line;
                  let isFirstChunk = true;
                  
                  while (remainingText.length > 0) {
                    const chunk = remainingText.slice(0, lineWidth);
                    console.log(pc.dim(`  │ `) + (isFirstChunk ? '' : '  ') + chunk);
                    remainingText = remainingText.slice(lineWidth);
                    isFirstChunk = false;
                  }
                }
              }
            }
            console.log(pc.dim(`  └${'─'.repeat(borderWidth - 4)}`));
          }
          
          // Add separator between blocks
          if (sortedBlocks.indexOf(block) < sortedBlocks.length - 1) {
            console.log(pc.dim(`  ├${'─'.repeat(borderWidth - 4)}`));
          }
        }
        
        // Add separator between results
        if (i < Math.min(results.length, maxResults) - 1) {
          console.log(pc.dim(`──${'─'.repeat(borderWidth - 2)}`));
        }
      }
      
      if (results.length > maxResults) {
        console.log(pc.dim(`\n! Showing ${maxResults} out of ${results.length} results. Use ${pc.bold('--max-results')} to show more.`));
      }

      console.log(pc.cyan('\n' + '─'.repeat(borderWidth)));
      console.log(pc.dim(`Search completed in adist`));
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