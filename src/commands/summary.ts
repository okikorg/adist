import pc from 'picocolors';
import { Command } from 'commander';
import config from '../config.js';
import prompts, { Choice } from 'prompts';
import pkg from 'lodash';
const { truncate } = pkg;

export const summaryCommand = new Command('summary')
  .description('View file and project summaries')
  .argument('[projectName]', 'Optional project name to view summaries for')
  .option('-f, --file <filePath>', 'View summary for a specific file')
  .option('-l, --list', 'List all files with their summaries in a table')
  .action(async (projectNameArg: string | undefined, options: { file?: string; list?: boolean }) => {
    try {
      const projects = await config.get('projects') as Record<string, unknown> | undefined;
      if (!projects || typeof projects !== 'object') {
        console.error(pc.bold(pc.red('✘ No projects found.')));
        process.exit(1);
      }

      let targetProjectId: string | undefined;
      let targetProject: Record<string, unknown> | undefined;

      if (projectNameArg) {
        // Find project by name
        const projectEntry = Object.entries(projects).find(([_, project]) => {
          if (!project || typeof project !== 'object') return false;
          const p = project as Record<string, unknown>;
          return typeof p.name === 'string' && p.name === projectNameArg;
        });

        if (!projectEntry) {
          console.error(pc.bold(pc.red(`✘ Project "${projectNameArg}" not found.`)));
          console.log(pc.dim('Use "adist list" to see available projects.'));
          process.exit(1);
        }

        const [id, projectData] = projectEntry;
        if (!projectData || typeof projectData !== 'object') {
          console.error(pc.bold(pc.red('✘ Invalid project data.')));
          process.exit(1);
        }
        targetProjectId = id;
        targetProject = projectData as Record<string, unknown>;
      } else {
        // Use current project
        targetProjectId = await config.get('currentProject') as string;
        if (!targetProjectId) {
          console.error(pc.bold(pc.red('✘ No project is currently selected.')));
          console.error(pc.yellow('Run "adist init" or "adist switch" first.'));
          process.exit(1);
        }

        const projectData = projects[targetProjectId];
        if (!projectData || typeof projectData !== 'object') {
          console.error(pc.bold(pc.red('✘ Project data not found.')));
          process.exit(1);
        }
        targetProject = projectData as Record<string, unknown>;
      }

      if (!targetProject || typeof targetProject !== 'object') {
        console.error(pc.bold(pc.red('✘ Project not found.')));
        process.exit(1);
      }

      const project = targetProject as Record<string, unknown>;
      const projectName = String(project.name);

      if (!project.hasSummaries) {
        console.error(pc.bold(pc.yellow('⚠️ This project does not have summaries.')));
        console.log(pc.dim('Run "adist reindex --summarize" to generate summaries.'));
        process.exit(1);
      }

      if (options.list) {
        // Try to get the indexes - first check block-based indexes, then fall back to regular indexes
        let blockIndexes = await config.get(`block-indexes.${targetProjectId}`) as any[] | undefined;
        let regularIndexes = await config.get(`indexes.${targetProjectId}`) as Array<{ path: string; summary?: string }> | undefined;
        
        // For block-based indexes, we need to extract file summaries from document blocks
        let filesWithSummaries: Array<{ path: string; summary: string }> = [];
        
        if (blockIndexes && Array.isArray(blockIndexes)) {
          // Extract file summaries from document blocks
          filesWithSummaries = blockIndexes
            .map(doc => {
              // Find the document block which should contain the summary
              const documentBlock = Array.isArray(doc.blocks) 
                ? doc.blocks.find((block: any) => block.type === 'document' && block.summary)
                : null;
              
              if (documentBlock && documentBlock.summary && doc.path) {
                return {
                  path: doc.path,
                  summary: documentBlock.summary
                };
              }
              return null;
            })
            .filter(Boolean) as Array<{ path: string; summary: string }>; // Remove null values
        }
        
        // If no block-based summaries, try regular indexes
        if (filesWithSummaries.length === 0 && regularIndexes && Array.isArray(regularIndexes)) {
          filesWithSummaries = regularIndexes.filter(index => index.summary) as Array<{ path: string; summary: string }>;
        }
        
        if (filesWithSummaries.length === 0) {
          console.error(pc.bold(pc.yellow('⚠️ No files with summaries found in this project.')));
          process.exit(1);
        }
        
        // Create choices for the interactive prompt
        const choices = filesWithSummaries.map(index => ({
          title: index.path,
          description: truncate(index.summary || '', { length: 100 }),
          value: index.path,
          summary: index.summary
        }));

        console.log(pc.bold(pc.cyan(`\nFile Summaries for ${projectName}:`)));
        console.log(pc.dim('Navigation: Arrow keys to move, Enter to select'));
        console.log(pc.dim('Search: Type to filter files'));
        console.log(pc.dim('Exit: Press Esc, Ctrl+C, or q to quit\n'));

        try {
          while (true) {
            const response = await prompts({
              type: 'select',
              name: 'file',
              message: 'Select a file to view its summary:',
              choices: choices,
              hint: 'Type to search',
              warn: 'No matches found',
              onState: (state) => {
                if (state.aborted) {
                  process.exit(0); // Exit on Esc/Ctrl+C
                }
              }
            }, {
              onCancel: () => {
                process.exit(0);
              }
            });

            // Exit if no file selected (user pressed Esc/Ctrl+C)
            if (!response.file) {
              process.exit(0);
            }

            const selectedFile = filesWithSummaries.find(index => index.path === response.file);
            if (selectedFile) {
              console.clear();
              console.log(pc.bold(pc.cyan(`\nSummary for ${selectedFile.path}:`)));
              console.log(selectedFile.summary);
              console.log(pc.dim('\nPress Enter to continue, Esc/q to exit...'));
              
              const continueResponse = await prompts({
                type: 'text',
                name: 'action',
                message: '',
                validate: value => true
              }, {
                onCancel: () => {
                  process.exit(0);
                }
              });

              if (continueResponse.action === 'q') {
                process.exit(0);
              }

              console.clear();
            }
          }
        } catch (error) {
          // Handle any interrupts or errors gracefully
          process.exit(0);
        }
      }

      if (options.file) {
        // Try to get the indexes - first check block-based indexes, then fall back to regular indexes
        let blockIndexes = await config.get(`block-indexes.${targetProjectId}`) as any[] | undefined;
        let regularIndexes = await config.get(`indexes.${targetProjectId}`) as Array<{ path: string; summary?: string }> | undefined;
        
        // First try block indexes
        let fileSummary: string | undefined;
        
        if (blockIndexes && Array.isArray(blockIndexes)) {
          // Look for the file in block-based indexes
          const docEntry = blockIndexes.find(doc => doc.path === options.file);
          if (docEntry && Array.isArray(docEntry.blocks)) {
            // Find the document block which should contain the summary
            const documentBlock = docEntry.blocks.find((block: any) => block.type === 'document' && block.summary);
            if (documentBlock && documentBlock.summary) {
              fileSummary = documentBlock.summary;
            }
          }
        }
        
        // If no summary found in block indexes, try regular indexes
        if (!fileSummary && regularIndexes && Array.isArray(regularIndexes)) {
          const fileIndex = regularIndexes.find(index => index.path === options.file);
          if (fileIndex && fileIndex.summary) {
            fileSummary = fileIndex.summary;
          }
        }
        
        if (!fileSummary) {
          console.error(pc.bold(pc.yellow(`⚠️ No summary available for "${options.file}".`)));
          process.exit(1);
        }
        
        console.log(pc.bold(pc.cyan(`Summary for ${options.file}`)));
        console.log(fileSummary);
        process.exit(0);
      } else {
        // View project summary
        const overallSummary = await config.get(`summaries.${targetProjectId}.overall`) as string | undefined;
        if (!overallSummary) {
          console.error(pc.bold(pc.yellow('⚠️ No overall summary available for this project.')));
          process.exit(1);
        }

        console.log(pc.bold(pc.cyan(`Project Summary: ${projectName}`)));
        console.log(overallSummary);
        console.log(pc.dim('\nUse "adist summary --list" to view summaries for all files.'));
        process.exit(0);
      }
    } catch (error) {
      console.error(pc.bold(pc.red('✘ Error viewing summary:')), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }); 