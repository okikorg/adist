import pc from 'picocolors';
import config from '../config.js';
import { Command } from 'commander';
import Conf from 'conf';
import path from 'path';
import os from 'os';

export const pathsCommand = new Command('paths')
  .description('Show storage locations for indexes and summaries')
  .action(async () => {
    try {
      const currentProjectId = await config.get('currentProject') as string;
      if (!currentProjectId) {
        console.error(pc.bold(pc.red('✘ No project is currently selected.')));
        console.log(pc.dim('Use "adist switch <projectName>" to select a project.'));
        process.exit(1);
      }

      const projects = await config.get('projects') as Record<string, any>;
      const currentProject = projects[currentProjectId];

      if (!currentProject) {
        console.error(pc.bold(pc.red('✘ Current project not found.')));
        process.exit(1);
      }

      // Create a new Conf instance to get the path
      const conf = new Conf({ projectName: 'adist' });

      console.log(pc.bold(pc.cyan('Storage Locations:')));
      console.log(pc.dim('Config File:'), pc.green(conf.path));
      console.log(pc.dim('Project Path:'), pc.green(currentProject.path));
      console.log(pc.dim('Project ID:'), pc.green(currentProjectId));
      
      // Check if project has indexes
      const indexes = await config.get(`indexes.${currentProjectId}`) as any[] | undefined;
      console.log(pc.dim('Indexed Files:'), pc.green(indexes ? indexes.length : 0));
      
      // Check if project has summaries
      const overallSummary = await config.get(`summaries.${currentProjectId}.overall`) as string | undefined;
      console.log(pc.dim('Has Overall Summary:'), pc.green(overallSummary ? 'Yes' : 'No'));

      // Show physical storage locations
      console.log(pc.bold(pc.cyan('\nPhysical Storage:')));
      console.log(pc.dim('Config Directory:'), pc.green(path.dirname(conf.path)));
      console.log(pc.dim('Data Directory:'), pc.green(path.join(os.homedir(), '.config', 'adist')));
      
      // Show summary storage details
      if (overallSummary) {
        const summarySize = Buffer.byteLength(overallSummary, 'utf8');
        console.log(pc.dim('Overall Summary Size:'), pc.green(`${(summarySize / 1024).toFixed(2)} KB`));
      }

      // Show index storage details
      if (indexes) {
        const totalIndexSize = indexes.reduce((acc, index) => {
          return acc + Buffer.byteLength(JSON.stringify(index), 'utf8');
        }, 0);
        console.log(pc.dim('Total Index Size:'), pc.green(`${(totalIndexSize / 1024).toFixed(2)} KB`));
      }
      
      process.exit(0);
    } catch (error) {
      console.error(pc.bold(pc.red('✘ Error showing paths:')), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }); 