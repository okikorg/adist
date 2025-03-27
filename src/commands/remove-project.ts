import pc from 'picocolors';
import config from '../config.js';

export const removeProject = async (projectName: string) => {
  try {
    if (!projectName) {
      console.error(pc.bold(pc.red('✘ Project name is required.')));
      console.error(pc.yellow('Usage: adist remove-project <projectName>'));
      process.exit(1);
    }

    const rawProjects = await config.get('projects') as Record<string, unknown> | undefined;
    const projects: Record<string, unknown> = rawProjects || {};
    
    // Find project by name
    const projectEntry = Object.entries(projects).find(([_, project]) => {
      if (!project || typeof project !== 'object') return false;
      const p = project as Record<string, unknown>;
      return typeof p.name === 'string' && p.name === projectName;
    });

    if (!projectEntry) {
      console.error(pc.bold(pc.red(`✘ Project "${projectName}" not found.`)));
      console.log(pc.dim('Use "adist list" to see available projects.'));
      process.exit(1);
    }

    const [projectId, project] = projectEntry;
    const projectPath = (project as Record<string, unknown>).path;
    
    console.log(`${pc.bold(pc.red('🗑️ Removing project:'))} ${pc.yellow(projectName)}`);
    console.log(pc.dim(`Location: ${projectPath}`));

    // Remove project from projects list
    const updatedProjects = { ...projects };
    delete updatedProjects[projectId];
    await config.set('projects', updatedProjects);
    
    // Remove index for the project
    const indexes = await config.get('indexes') as Record<string, unknown> || {};
    const updatedIndexes = { ...indexes };
    if (projectId in updatedIndexes) {
      delete updatedIndexes[projectId];
      await config.set('indexes', updatedIndexes);
    }
    
    // Check if this was the current project
    const currentProjectId = await config.get('currentProject');
    if (currentProjectId === projectId) {
      // Find another project to set as current, or unset if none available
      const remainingProjectIds = Object.keys(updatedProjects);
      if (remainingProjectIds.length > 0) {
        await config.set('currentProject', remainingProjectIds[0]);
        const newCurrentProject = updatedProjects[remainingProjectIds[0]];
        const newProjectName = (newCurrentProject as Record<string, unknown>).name;
        console.log(pc.cyan(`Current project changed to: ${pc.bold(String(newProjectName))}`));
      } else {
        await config.set('currentProject', undefined);
        console.log(pc.yellow('No projects remain. Current project unset.'));
      }
    }

    console.log(pc.bold(pc.green('\n✓ Project removed successfully!')));
    
    process.exit(0);
  } catch (error) {
    console.error(pc.bold(pc.red('✘ Error removing project:')), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}; 