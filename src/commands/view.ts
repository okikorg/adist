import { Command } from 'commander';
import path from 'path';
import pc from 'picocolors';
import config from '../config.js';
import { highlightFile } from '../utils/code-highlighter.js';
import fs from 'fs/promises';

export const viewCommand = new Command('view')
  .description('View a file with syntax highlighting')
  .argument('<file>', 'Path to the file to view')
  .action(async (filePath: string) => {
    try {
      // First try to read the file from the current directory
      try {
        const currentDirPath = path.resolve(process.cwd(), filePath);
        await fs.access(currentDirPath);
        
        // Display file info
        console.log(`${pc.bold(pc.cyan('File:'))} ${pc.white(filePath)}`);
        console.log(`${pc.dim('Location:')} ${pc.dim(currentDirPath)}`);
        
        // Get the highlighted file content
        const highlightedContent = await highlightFile(currentDirPath);
        
        // Display the highlighted content
        console.log(highlightedContent);
        
        process.exit(0);
      } catch (error) {
        // If file doesn't exist in current directory, try project directory
        const currentProjectId = await config.get('currentProject') as string;
        if (!currentProjectId) {
          console.error(pc.red('No project is currently selected. Run "adist init" or "adist switch" first.'));
          process.exit(1);
        }

        const projects = await config.get('projects') as Record<string, { path: string; name: string }>;
        const project = projects[currentProjectId];
        if (!project) {
          console.error(pc.red('Current project not found.'));
          process.exit(1);
        }

        // Resolve the full path to the file in project directory
        const projectPath = path.resolve(project.path, filePath);
        
        // Display file info
        console.log(`${pc.bold(pc.cyan('File:'))} ${pc.white(filePath)}`);
        console.log(`${pc.dim('Location:')} ${pc.dim(projectPath)}`);
        
        // Get the highlighted file content
        const highlightedContent = await highlightFile(projectPath);
        
        // Display the highlighted content
        console.log(highlightedContent);
        
        process.exit(0);
      }
    } catch (error) {
      console.error(pc.bold(pc.red('✘ Error viewing file:')), error);
      process.exit(1);
    }
  }); 