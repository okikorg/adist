import pc from 'picocolors';
import path from 'path';
import fg from 'fast-glob';
import config from '../config.js';

export const searchFiles = async (pattern: string): Promise<string[]> => {
  try {
    const currentProjectId = await config.get('currentProject') as string;
    if (!currentProjectId) {
      throw new Error('No project is currently selected. Run "adist init" or "adist switch" first.');
    }

    const projects = await config.get('projects') as Record<string, { path: string; name: string }>;
    const project = projects[currentProjectId];
    if (!project) {
      throw new Error('Current project not found.');
    }

    const files = await fg(pattern, {
      cwd: project.path,
      onlyFiles: true,
      dot: true,
      ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    });

    return files.map(file => path.relative(process.cwd(), path.join(project.path, file)));
  } catch (error) {
    console.error(pc.red(`Error searching files: ${error instanceof Error ? error.message : String(error)}`));
    return [];
  }
}; 