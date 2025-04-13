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
 * Format block content with proper indentation and line breaking
 */
function formatBlockContent(
  content: string, 
  language: string | undefined, 
  lineWidth: number, 
  maxLines: number
): string {
  // Limit content to specified number of lines
  const lines = content.split('\n');
  const displayLines = lines.length > maxLines 
    ? [...lines.slice(0, maxLines), pc.dim(`... (${lines.length - maxLines} more lines)`)]
    : lines;
  
  const contentText = displayLines.join('\n');
  
  // Apply syntax highlighting if language is available
  if (language) {
    try {
      // Highlight and indent each line
      const highlightedContent = highlight(contentText, { language, ignoreIllegals: true });
      const contentLines = highlightedContent.split('\n').map(line => {
        if (line.length <= lineWidth) {
          return pc.dim(`  │ `) + line;
        } else {
          // Break long lines into chunks that fit width
          const chunks: string[] = [];
          let remainingText = line;
          let isFirstChunk = true;
          
          while (remainingText.length > 0) {
            const chunk = remainingText.slice(0, lineWidth);
            chunks.push(pc.dim(`  │ `) + (isFirstChunk ? '' : '  ') + chunk);
            remainingText = remainingText.slice(lineWidth);
            isFirstChunk = false;
          }
          
          return chunks.join('\n');
        }
      });
      
      return contentLines.join('\n');
    } catch (error) {
      // Fallback to non-highlighted if highlighting fails
      return formatPlainContent(contentText, lineWidth);
    }
  } else {
    return formatPlainContent(contentText, lineWidth);
  }
}

/**
 * Format plain text content without syntax highlighting
 */
function formatPlainContent(content: string, lineWidth: number): string {
  return content.split('\n').map(line => {
    if (line.length <= lineWidth) {
      return pc.dim(`  │ `) + line;
    } else {
      // Break long lines
      const chunks: string[] = [];
      let remainingText = line;
      let isFirstChunk = true;
      
      while (remainingText.length > 0) {
        const chunk = remainingText.slice(0, lineWidth);
        chunks.push(pc.dim(`  │ `) + (isFirstChunk ? '' : '  ') + chunk);
        remainingText = remainingText.slice(lineWidth);
        isFirstChunk = false;
      }
      
      return chunks.join('\n');
    }
  }).join('\n');
}

/**
 * Command for searching with the block-based indexer
 */
export const blockGetCommand = new Command('block-get')
  .description('Search for blocks matching a query (default search method for "adist get"). Supports advanced operators:\n' +
               '  - AND: "theme style AND color palette" - finds blocks containing both terms\n' +
               '  - OR: "theme OR style" - finds blocks containing either term\n' +
               'Output is concise by default. Use --detailed for comprehensive block views.')
  .argument('<query>', 'The search query (use "term1 AND term2" or "term1 OR term2" for advanced searching)')
  .option('-n, --max-results <number>', 'Maximum number of results to show', '10')
  .option('-l, --limit-lines <number>', 'Limit the number of content lines shown per block', '20')
  .option('-d, --detailed', 'Show blocks with detailed formatting, borders, and enhanced metadata', false)
  .option('--code-only', 'Show only code blocks (functions, methods, classes) in the results', false)
  .option('-g, --group-by-file', 'Group results by file rather than relevance ranking', false)
  .action(async (query: string, options: { 
    maxResults?: number; 
    limitLines?: number; 
    detailed?: boolean;
    codeOnly?: boolean;
    groupByFile?: boolean;
  }) => {
    try {
      const maxResults = options.maxResults ? parseInt(String(options.maxResults), 10) : 10;
      const limitLines = options.limitLines ? parseInt(String(options.limitLines), 10) : 20;
      const isDetailed = !!options.detailed;
      const codeOnly = !!options.codeOnly;
      const groupByFile = !!options.groupByFile;

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
      
      if (codeOnly) {
        console.log(`${pc.bold('Filter:')} ${pc.yellow('Code blocks only')}`);
      }
      
      if (groupByFile) {
        console.log(`${pc.bold('Display:')} ${pc.yellow('Grouped by file')}`);
      }
      
      if (isDetailed) {
        console.log(`${pc.bold('Display:')} ${pc.yellow('Detailed output')}`);
      }
      
      console.log(pc.cyan('─'.repeat(borderWidth)));

      const searchEngine = new BlockSearchEngine();
      let results = await searchEngine.searchBlocks(query);

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
              console.log(pc.dim('Or try a more specific search:'));
              console.log(pc.cyan('  adist get --detailed "<query>"'));
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
            console.log(pc.cyan('  adist get --detailed "<query>"'));
            process.exit(0);
          }
        }
        
        console.log(pc.yellow('\n⚠ No matching blocks found.'));
        console.log(pc.dim('Try a different search query or reindex with enhanced block indexing:'));
        console.log(pc.cyan('  adist reindex --with-summaries'));
        process.exit(0);
      }

      // Filter for code blocks only if requested
      if (codeOnly) {
        const codeBlockTypes = ['function', 'method', 'class', 'interface', 'type'];
        results = results.map(result => ({
          ...result,
          blocks: result.blocks.filter(block => codeBlockTypes.includes(block.type))
        })).filter(result => result.blocks.length > 0);
      }
      
      // Group results by file if requested
      if (groupByFile) {
        const fileMap = new Map<string, { blocks: DocumentBlock[], score: number }>();
        
        // Group blocks by file
        for (const result of results) {
          if (!fileMap.has(result.document)) {
            fileMap.set(result.document, { blocks: [], score: result.score });
          }
          
          const fileEntry = fileMap.get(result.document);
          if (fileEntry) {
            fileEntry.blocks.push(...result.blocks);
          }
        }
        
        // Convert back to results array
        results = Array.from(fileMap.entries()).map(([document, { blocks, score }]) => ({
          document,
          blocks,
          score
        }));
      }

      // Display the results
      const resultCount = results.reduce((count, r) => count + r.blocks.length, 0);
      console.log(pc.bold(pc.green(`\n✓ SEARCH RESULTS`)) + pc.gray(` (${resultCount} blocks in ${results.length} files)`));
      
      for (let i = 0; i < Math.min(results.length, maxResults); i++) {
        const result = results[i];
        
        // Show file header
        console.log(`\n${pc.bold(pc.bgBlue(` RESULT #${i+1} `))} ${pc.bold(pc.blue(`${result.document}`))}`);
        
        // Check if there's a document block with a summary
        const documentBlock = result.blocks.find(block => 
          block.type === 'document' && 'summary' in block && block.summary
        );
        
        if (documentBlock && 'summary' in documentBlock && documentBlock.summary && isDetailed) {
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
        const displayBlocks = sortedBlocks.filter(block => block.type !== 'document' || !('summary' in block));
        
        // Skip if no blocks to display
        if (displayBlocks.length === 0) {
          continue;
        }
        
        // Display blocks section header
        if (isDetailed) {
          console.log(pc.cyan(`  ┌${'─'.repeat(borderWidth - 4)}`));
          console.log(pc.cyan(`  │ ${pc.bold(`BLOCKS (${displayBlocks.length})`)}`));
        }
        
        for (let j = 0; j < displayBlocks.length; j++) {
          const block = displayBlocks[j];
          const isLastBlock = j === displayBlocks.length - 1;
          
          // Block header
          if (!isDetailed) {
            const locationText = `lines ${block.startLine}-${block.endLine}`;
            const blockTitle = block.title || '';
            console.log(
              pc.yellow(`  │ ${pc.bold(block.type.toUpperCase())} `) + 
              pc.dim(`(${locationText})`) + 
              (blockTitle ? `: ${pc.bold(blockTitle)}` : '')
            );
          } else {
            console.log(pc.yellow(`  │ ${pc.bold(block.type.toUpperCase())} (lines ${block.startLine}-${block.endLine})`));
            if (block.title) {
              console.log(pc.yellow(`  │ ${pc.bold('Title:')} ${pc.dim(block.title)}`));
            }
          }
          
          // Show enhanced metadata if detailed flag is enabled
          if (options.detailed) {
            // Show semantic summary if available
            if (block.metadata?.semanticSummary) {
              console.log(pc.yellow(`  │ ${pc.bold('Summary:')} ${pc.dim(block.metadata.semanticSummary)}`));
            }
            
            // Show code metrics for functions, methods, and classes
            if (block.metadata?.codeMetrics) {
              const metrics = block.metadata.codeMetrics;
              let metricsStr = [];
              
              if (metrics.cyclomaticComplexity !== undefined) {
                metricsStr.push(`complexity: ${metrics.cyclomaticComplexity}`);
              }
              if (metrics.lines !== undefined) {
                metricsStr.push(`lines: ${metrics.lines}`);
              }
              if (metrics.methods !== undefined) {
                metricsStr.push(`methods: ${metrics.methods}`);
              }
              if (metrics.size !== undefined) {
                metricsStr.push(`size: ${metrics.size}`);
              }
              
              if (metricsStr.length > 0) {
                console.log(pc.yellow(`  │ ${pc.bold('Metrics:')} ${pc.dim(metricsStr.join(', '))}`));
              }
            }
            
            // Show variables and API calls for functions and methods
            if (['function', 'method'].includes(block.type)) {
              // Show defined variables
              if (block.metadata?.variables?.defined?.length) {
                const vars = block.metadata.variables.defined.slice(0, 5);
                console.log(pc.yellow(`  │ ${pc.bold('Defines:')} ${pc.dim(vars.join(', ') + (block.metadata.variables.defined.length > 5 ? '...' : ''))}`));
              }
              
              // Show API calls
              if (block.metadata?.apiCalls?.length) {
                const calls = block.metadata.apiCalls.slice(0, 5);
                console.log(pc.yellow(`  │ ${pc.bold('Calls:')} ${pc.dim(calls.join(', ') + (block.metadata.apiCalls.length > 5 ? '...' : ''))}`));
              }
            }
            
            // Show related blocks
            if (block.relatedBlockIds && block.relatedBlockIds.length > 0) {
              // Find related block titles
              const relatedBlocks = block.relatedBlockIds.map(id => {
                const related = result.blocks.find(b => b.id === id);
                return related ? 
                  `${related.title || related.type} (lines ${related.startLine}-${related.endLine})` : 
                  'unknown';
              }).slice(0, 3); // Limit to 3 related blocks to avoid clutter
              
              console.log(pc.yellow(`  │ ${pc.bold('Related:')} ${pc.dim(relatedBlocks.join('; ') + (block.relatedBlockIds.length > 3 ? ' + ' + (block.relatedBlockIds.length - 3) + ' more' : ''))}`));
            }
          } else if (isDetailed) {
            // In non-detailed mode, just show a concise indicator if enhanced data is available
            const hasEnhancedData = !!(
              block.metadata?.semanticSummary || 
              block.metadata?.codeMetrics || 
              block.metadata?.variables || 
              block.metadata?.apiCalls || 
              (block.relatedBlockIds && block.relatedBlockIds.length > 0)
            );
            
            if (hasEnhancedData) {
              console.log(pc.yellow(`  │ ${pc.dim('Enhanced metadata available, use --detailed to view')}`));
            }
          }
          
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
          
          // Prevent cli-highlight error for unsupported languages like mermaid
          if (language === 'mermaid') {
            language = undefined;
          }

          // Display content with syntax highlighting
          if (block.content) {
            if (isDetailed) {
              console.log(pc.yellow(`  │ ${pc.bold('Content:')}`));
              console.log(pc.yellow(`  ┌${'─'.repeat(borderWidth - 4)}`));
            }
            
            // Format block content using the helper function
            const formattedContent = formatBlockContent(block.content, language, lineWidth, limitLines);
            console.log(formattedContent);
            
            if (isDetailed) {
              console.log(pc.yellow(`  └${'─'.repeat(borderWidth - 4)}`));
            }
          }
          
          // Add separator between blocks if not the last block
          if (!isLastBlock) {
            console.log(isDetailed ? pc.dim(`  ├${'─'.repeat(borderWidth - 4)}`) : '');
          }
        }
        
        // Close blocks section
        if (isDetailed && displayBlocks.length > 0) {
          console.log(pc.cyan(`  └${'─'.repeat(borderWidth - 4)}`));
        }
        
        // Add separator between results
        if (i < Math.min(results.length, maxResults) - 1) {
          console.log(pc.dim(`─${'─'.repeat(borderWidth - 1)}`));
        }
      }
      
      if (results.length > maxResults) {
        console.log(pc.dim(`\n! Showing ${maxResults} out of ${results.length} files with matches. Use ${pc.bold('--max-results')} to show more.`));
      }

      console.log(pc.cyan('\n' + '─'.repeat(borderWidth)));
      console.log(pc.dim(`Try these options for different views:`));
      console.log(pc.dim(`  --detailed (-d): Show blocks with comprehensive borders and metadata`));
      console.log(pc.dim(`  --code-only: Show only code blocks like functions and classes`));
      console.log(pc.dim(`  --group-by-file (-g): Group results by file rather than relevance`));
      process.exit(0);
    } catch (error) {
      console.error(pc.bold(pc.red('✘ Error searching blocks:')), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Block get function for programmatic use
 */
export const blockGet = async (query: string, options?: { 
  maxResults?: number; 
  limitLines?: number; 
  detailed?: boolean;
  codeOnly?: boolean;
  groupByFile?: boolean;
}): Promise<void> => {
  const args = [query];
  
  if (options?.maxResults) args.push('--max-results', options.maxResults.toString());
  if (options?.limitLines) args.push('--limit-lines', options.limitLines.toString());
  if (options?.detailed) args.push('--detailed');
  if (options?.codeOnly) args.push('--code-only');
  if (options?.groupByFile) args.push('--group-by-file');
  
  await blockGetCommand.parseAsync(args);
}; 