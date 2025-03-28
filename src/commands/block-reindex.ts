import pc from 'picocolors';
import { Command } from 'commander';
import { BlockIndexer } from '../utils/block-indexer.js';
import config from '../config.js';

interface Project {
  name: string;
  path: string;
  indexed?: boolean;
  lastIndexed?: Date;
  hasSummaries?: boolean;
}

/**
 * Command for reindexing a project using the block-based indexer
 */
export const blockReindexCommand = new Command('block-reindex')
  .description('Reindex a project using block-based indexing (default reindex method)')
  .argument('[projectName]', 'Optional project name to reindex')
  .option('-a, --all', 'Reindex all projects')
  .option('-s, --summarize', 'Generate summaries using configured LLM provider')
  .action(async (projectName: string | undefined, options: { all?: boolean; summarize?: boolean }) => {
    try {
      const blockIndexer = new BlockIndexer();
      
      if (options.all) {
        // Reindex all projects
        console.log(pc.bold(pc.cyan('🔄 Reindexing all projects with block-based indexing')));
        if (options.summarize) {
          console.log(pc.yellow('⚠️ Summarization enabled'));
        }

        const allProjects = await config.get('projects') as Record<string, unknown> | undefined;
        if (!allProjects || typeof allProjects !== 'object' || Object.keys(allProjects).length === 0) {
          console.error(pc.bold(pc.yellow('⚠ No projects found to reindex.')));
          process.exit(0);
        }

        const validProjects = Object.entries(allProjects).filter(([_, project]) => {
          if (!project || typeof project !== 'object') return false;
          const p = project as Record<string, unknown>;
          return typeof p.name === 'string' && typeof p.path === 'string';
        });

        let reindexed = 0;
        for (const [projectId, projectData] of validProjects) {
          const project = projectData as Record<string, unknown>;
          console.log(pc.cyan(`\nReindexing: ${pc.bold(String(project.name))}`));
          
          try {
            await blockIndexer.indexProject(projectId, { withSummaries: options.summarize });
            reindexed++;
          } catch (error) {
            console.error(pc.red(`Error reindexing ${project.name}:`), error);
          }
        }

        console.log(pc.green(`\n✓ Successfully reindexed ${reindexed} project${reindexed === 1 ? '' : 's'}`));
        process.exit(0);
      }

      // Reindex specific project or current project
      if (projectName) {
        const projects = await config.get('projects') as Record<string, Project>;
        const project = Object.values(projects).find(p => p.name === projectName);

        if (!project) {
          console.error(pc.bold(pc.red('✘ Project not found.')));
          process.exit(1);
        }

        const projectId = Object.keys(projects).find(id => projects[id].name === projectName);
        if (!projectId) {
          console.error(pc.bold(pc.red('✘ Project ID not found.')));
          process.exit(1);
        }

        console.log(pc.bold(pc.cyan(`🔄 Reindexing project with block-based indexing: ${projectName}`)));
        if (options.summarize) {
          console.log(pc.yellow('⚠️ Summarization enabled'));
        }

        await blockIndexer.indexProject(projectId, { withSummaries: options.summarize });
        console.log(pc.green('✓ Project reindexed successfully!'));
        process.exit(0);
      }

      // Reindex current project
      console.log(pc.bold(pc.cyan('🔄 Reindexing current project with block-based indexing')));
      if (options.summarize) {
        console.log(pc.yellow('⚠️ Summarization enabled'));
      }
      
      await blockIndexer.indexCurrentProject({ withSummaries: options.summarize });
      console.log(pc.green('✓ Current project reindexed successfully!'));
      process.exit(0);
    } catch (error) {
      console.error(pc.bold(pc.red('✘ Error reindexing:')), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Block reindex function for programmatic use
 */
export const blockReindex = async (projectName?: string, options?: { all?: boolean; summarize?: boolean }): Promise<void> => {
  // This is just a wrapper function to maintain backward compatibility
  await blockReindexCommand.parseAsync([
    projectName, 
    ...(options?.all ? ['--all'] : []), 
    ...(options?.summarize ? ['--summarize'] : [])
  ].filter(Boolean) as string[]);
}; 