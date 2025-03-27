import pc from 'picocolors';
import { Command } from 'commander';
import config from '../config.js';

export const summaryCommand = new Command('summary')
  .description('View file and project summaries')
  .argument('[projectName]', 'Optional project name to view summaries for')
  .option('-f, --file <filePath>', 'View summary for a specific file')
  .action(async (projectNameArg: string | undefined, options: { file?: string }) => {
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

      if (options.file) {
        // View specific file summary
        const indexes = await config.get(`indexes.${targetProjectId}`) as Array<{ path: string; summary?: string }> | undefined;
        if (!indexes) {
          console.error(pc.bold(pc.red('✘ Project has not been indexed.')));
          process.exit(1);
        }

        const fileIndex = indexes.find(index => index.path === options.file);
        if (!fileIndex) {
          console.error(pc.bold(pc.red(`✘ File "${options.file}" not found in project.`)));
          process.exit(1);
        }

        if (!fileIndex.summary) {
          console.error(pc.bold(pc.yellow(`⚠️ No summary available for "${options.file}".`)));
          process.exit(1);
        }

        console.log(pc.bold(pc.cyan(`Summary for ${options.file}`)));
        console.log(fileIndex.summary);
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
        process.exit(0);
      }
    } catch (error) {
      console.error(pc.bold(pc.red('✘ Error viewing summary:')), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }); 