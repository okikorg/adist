import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import pc from 'picocolors';
import config from '../config.js';
import { searchDocuments } from '../utils/indexer.js';
import { searchFiles } from '../utils/files.js';

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
  .description('Search for documents in the current project (legacy method, use default get for block-based search)')
  .argument('<query>', 'Search query')
  .option('-d, --debug', 'Show debug information')
  .action(async (query: string, options: { debug?: boolean }) => {
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


      // Debug info
      if (options.debug) {
        console.log(pc.dim('Debug info:'));
        console.log(`Project ID: ${currentProjectId}`);
        console.log(`Project Path: ${project.path}`);
        try {
          const indexes = await config.get(`indexes.${currentProjectId}`) as Array<any>;
          console.log(`Total indexed files: ${indexes ? indexes.length : 0}`);
        } catch (e) {
          console.log(`Indexed files: Error retrieving`);
        }
      }

      // If query contains '.' or '/', treat it as a file search
      if (query.includes('.') || query.includes('/')) {
        const files = await searchFiles(query);
        if (files.length === 0) {
          console.log(pc.yellow('⚠ No files found matching your query.'));
          process.exit(0);
        }
        
        console.log(`\n${pc.bold(pc.green('✓ Found files:'))} ${pc.gray(`(${files.length})`)}`);
        files.forEach((file: string, index: number) => {
          // Get full path
          const fullPath = path.resolve(project.path, file);
          console.log(`  ${pc.dim(String(index + 1).padStart(2, ' ') + '.')} ${pc.cyan(file)}`);
          console.log(`    ${pc.dim('Location:')} ${pc.dim(fullPath)}`);
        });
        process.exit(0);
      }

      // Otherwise, search through indexed content
      const results = await searchDocuments(query);
      
      // Check if the query is about summaries or descriptions
      const isSummaryQuery = 
        query.toLowerCase().includes('summary') || 
        query.toLowerCase().includes('overview') || 
        query.toLowerCase().includes('describe') ||
        query.toLowerCase().includes('what is') ||
        query.toLowerCase().includes("what's") ||
        query.toLowerCase().includes('what does') ||
        query.toLowerCase().includes('explain');
      
      // For direct summary queries, check if we have a project summary available
      const isExplicitSummaryRequest = 
        query.toLowerCase() === 'summary' ||
        query.toLowerCase() === 'what is the summary' ||
        query.toLowerCase() === "what's the summary" ||
        query.toLowerCase() === 'project summary' ||
        query.toLowerCase() === 'show summary' ||
        query.toLowerCase() === 'show project summary';
        
      if (isExplicitSummaryRequest && project?.hasSummaries) {
        const overallSummary = await config.get(`summaries.${currentProjectId}.overall`) as string | undefined;
        
        if (overallSummary) {
          console.log(pc.bold(pc.cyan('Project Summary:')));
          console.log('\n' + overallSummary + '\n');
          console.log(pc.dim('To view file summaries:'));
          console.log(pc.cyan('  adist summary --list'));
          process.exit(0);
        }
      }
      
      if (results.length === 0) {
        // Check if the project has a summary available
        if (project?.hasSummaries) {
          // Try to get block-based summaries first
          const blockIndexes = await config.get(`block-indexes.${currentProjectId}`) as any[] | undefined;
          
          if (blockIndexes && Array.isArray(blockIndexes) && blockIndexes.length > 0) {
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
              console.log(pc.yellow('No specific documents matching your query were found.'));
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
            console.log(pc.yellow('No specific documents matching your query were found.'));
            console.log(pc.cyan('However, a project summary is available:'));
            console.log('\n' + overallSummary + '\n');
            console.log(pc.dim('For more specific results, try another search query or use:'));
            console.log(pc.cyan('  adist summary --list'));
            process.exit(0);
          }
        }
        
        console.log(pc.yellow('⚠ No documents found matching your query.'));
        process.exit(0);
      }

      console.log(`\n${pc.bold(pc.green('✓ Search Results:'))} ${pc.gray(`(${results.length} matches)`)}`);
      
      results.forEach((result: { path: string; content: string }, index: number) => {
        console.log(`  ${pc.bold(pc.cyan(`${index + 1}. ${result.path}`))}`);
        
        // Display full file path
        const fullPath = path.resolve(project.path, result.path);
        console.log(`  ${pc.dim('Location:')} ${pc.dim(fullPath)}`);
        
        // Highlight the query term in the content
        const searchTerms = query.split(/\s+/).filter(term => term.length > 2);
        const highlightRegex = searchTerms.length
          ? new RegExp(`(${searchTerms.join('|')})`, 'gi')
          : new RegExp(`(${query})`, 'gi');
          
        const highlightedContent = truncateContent(result.content).replace(
          highlightRegex, 
          pc.bold(pc.yellow('$1'))
        );
        
        console.log();
        console.log(highlightedContent);
      });
      
      process.exit(0);
    } catch (error) {
      console.error(pc.bold(pc.red('✘ Error searching documents:')), error);
      process.exit(1);
    }
  });