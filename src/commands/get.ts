import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import pc from 'picocolors';
import config from '../config.js';
import { BlockSearchEngine } from '../utils/block-indexer.js';
import { highlight } from 'cli-highlight';

// Helper to truncate long content
const truncateContent = (content: string, maxLines = 15, maxLineLength = 100): string => {
  const lines = content.split('\n');
  let truncated = lines.slice(0, maxLines).map(line => 
    line.length > maxLineLength ? line.slice(0, maxLineLength) + '...' : line
  ).join('\n');
  
  if (lines.length > maxLines) {
    truncated += `\n${pc.dim(`... and ${lines.length - maxLines} more lines`)}`; 
  }
  
  return truncated;
};

export const getCommand = new Command('get')
  .description('Search for documents in the current project using block-based search. Supports advanced operators:\n' +
               '  - AND: "theme style AND color palette" - finds documents containing both terms\n' +
               '  - OR: "theme OR style" - finds documents containing either term')
  .argument('<query>', 'Search query (use "term1 AND term2" or "term1 OR term2" for advanced searching)')
  .option('-d, --debug', 'Show debug information')
  .option('-n, --max-results <number>', 'Maximum number of results to show', '10')
  .option('-l, --limit-lines <number>', 'Limit the number of content lines shown per block', '20')
  .action(async (query: string, options: { debug?: boolean; maxResults?: string; limitLines?: string }) => {
    if (!query) {
      console.error(pc.bold(pc.red('✘ Please provide a search query.')));
      console.error(pc.yellow('Usage: adist get <query>'));
      process.exit(1);
    }

    try {
      // Get current project
      const currentProjectId = await config.get('currentProject') as string;
      if (!currentProjectId) {
        console.error(pc.bold(pc.red('✘ No project is currently selected.')));
        console.error(pc.yellow('Run "adist init" or "adist switch" first.'));
        process.exit(1);
      }

      const projects = await config.get('projects') as Record<string, { 
        path: string; 
        name: string; 
        hasSummaries?: boolean 
      }>;
      const project = projects[currentProjectId];
      if (!project) {
        console.error(pc.bold(pc.red('✘ Current project not found.')));
        process.exit(1);
      }

      console.log(`${pc.bold('Project:')} ${pc.cyan(project.name)}`);
      console.log(`${pc.bold('Query:')} ${pc.yellow('"' + query + '"')}`);
      
      // Show what kind of search is being performed
      if (query.includes(' AND ')) {
        const terms = query.split(' AND ').map(term => term.trim());
        console.log(`${pc.bold('Search type:')} ${pc.magenta('Advanced AND')} (${terms.length} terms)`);
      } else if (query.includes(' OR ')) {
        const terms = query.split(' OR ').map(term => term.trim());
        console.log(`${pc.bold('Search type:')} ${pc.magenta('Advanced OR')} (${terms.length} terms)`);
      }

      // Debug info
      if (options.debug) {
        console.log(pc.dim('Debug info:'));
        console.log(`Project ID: ${currentProjectId}`);
        console.log(`Project Path: ${project.path}`);
        try {
          const indexes = await config.get(`block-indexes.${currentProjectId}`) as Array<any>;
          console.log(`Total indexed files: ${indexes ? indexes.length : 0}`);
        } catch (e) {
          console.log(`Indexed files: Error retrieving`);
        }
      }

      // Use BlockSearchEngine for searching
      const searchEngine = new BlockSearchEngine();
      const results = await searchEngine.searchBlocks(query);
      
      if (results.length === 0) {
        console.log(pc.yellow('⚠ No documents found matching your query.'));
        process.exit(0);
      }

      const maxResults = options.maxResults ? parseInt(options.maxResults, 10) : 10;
      const limitLines = options.limitLines ? parseInt(options.limitLines, 10) : 20;

      console.log(`\n${pc.bold(pc.green('✓ Search Results:'))} ${pc.gray(`(${results.length} matches)`)}`);
      
      for (const result of results.slice(0, maxResults)) {
        console.log(`\n${pc.bold(pc.blue(`File: ${result.document}`))}`);
        
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
      console.error(pc.bold(pc.red('✘ Error searching documents:')), error);
      process.exit(1);
    }
  });