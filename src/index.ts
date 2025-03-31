#!/usr/bin/env node

import { program } from 'commander';
import pc from 'picocolors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

// Get the version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

// Run main function
async function main() {
  // Version and description
  program
    .name('adist')
    .description('A fast document search and management CLI tool')
    .version(packageJson.version);

  // Only import and setup other commands if not checking version
  if (!process.argv.includes('-V') && !process.argv.includes('--version')) {
    const config = await import('./config.js');
    const { getCommand } = await import('./commands/get.js');
    const { reindexCommand } = await import('./commands/reindex.js');
    const { summaryCommand } = await import('./commands/summary.js');
    const { queryCommand } = await import('./commands/query.js');
    const { chatCommand } = await import('./commands/chat.js');
    const { llmConfigCommand } = await import('./commands/llm-config.js');
    const { viewCommand } = await import('./commands/view.js');
    const { pathsCommand } = await import('./commands/paths.js');
    const { blockReindexCommand } = await import('./commands/block-reindex.js');
    const { blockGetCommand } = await import('./commands/block-get.js');

    // Import command handlers
    const init = async (projectName: string) => {
      const { init } = await import('./commands/init.js');
      return init(projectName);
    };

    const list = async (options: any) => {
      const { list } = await import('./commands/list.js');
      return list(options);
    };

    const switchProject = async (projectName?: string) => {
      const { switchProject } = await import('./commands/switch.js');
      return switchProject(projectName);
    };

    const removeIndexCmd = async (projectName: string) => {
      const { removeIndex } = await import('./commands/remove-index.js');
      return removeIndex(projectName);
    };

    const removeProjectCmd = async (projectName: string) => {
      const { removeProject } = await import('./commands/remove-project.js');
      return removeProject(projectName);
    };

    const removeProjectByIdCmd = async (projectId: string) => {
      const { removeProjectById } = await import('./commands/remove-project-id.js');
      return removeProjectById(projectId);
    };

    // Initialize a project
    program
      .command('init <projectName>')
      .description('Initialize adist for the current directory')
      .action(init);

    // Switch to a different project
    program
      .command('switch [projectName]')
      .description('Switch to a specific project by name or select from a list')
      .action(switchProject);

    // List all projects
    program
      .command('list')
      .description('List all indexed projects')
      .option('-d, --debug', 'Show debug information')
      .action((options) => list(options));

    // Rename the original get command to legacy-get and reindex to legacy-reindex
    const legacyGetCommand = getCommand.name('legacy-get');
    const legacyReindexCommand = reindexCommand.name('legacy-reindex');
    
    // Rename block commands to use the standard command names
    const defaultGetCommand = blockGetCommand.name('get');
    const defaultReindexCommand = blockReindexCommand.name('reindex');
    
    // Add commands to program
    program.addCommand(defaultGetCommand); // Block-based get as default 'get'
    program.addCommand(defaultReindexCommand); // Block-based reindex as default 'reindex'
    program.addCommand(legacyGetCommand); // Original get as 'legacy-get'
    program.addCommand(legacyReindexCommand); // Original reindex as 'legacy-reindex'

    // Summary command
    program.addCommand(summaryCommand);

    // Query command
    program.addCommand(queryCommand);

    // Chat command
    program.addCommand(chatCommand);

    // LLM Configuration command
    program.addCommand(llmConfigCommand);

    // View file with syntax highlighting
    program.addCommand(viewCommand);

    // Show storage locations
    program.addCommand(pathsCommand);

    // Remove index by project name
    program
      .command('remove-index <projectName>')
      .description('Remove the index for a specific project')
      .action(removeIndexCmd);

    // Remove project completely
    program
      .command('remove-project <projectName>')
      .description('Remove a project completely, including its index')
      .action(removeProjectCmd);

    // Remove project by ID (for troubleshooting)
    program
      .command('remove-project-id <projectId>')
      .description('Remove a project by its ID (for troubleshooting)')
      .action(removeProjectByIdCmd);
  }

  // Parse command line arguments
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    console.error(pc.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

// Run the main function
main().catch(error => {
  console.error(pc.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
  process.exit(1);
});