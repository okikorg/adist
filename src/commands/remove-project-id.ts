import pc from 'picocolors';
import config from '../config.js';

export const removeProjectById = async (projectId: string) => {
  try {
    if (!projectId) {
      console.error(pc.bold(pc.red('✘ Project ID is required.')));
      console.error(pc.yellow('Usage: adist remove-project-id <id>'));
      process.exit(1);
    }

    const rawProjects = await config.get('projects') as Record<string, unknown> | undefined;
    const projects: Record<string, unknown> = rawProjects || {};
    
    // Check if project exists
    if (!(projectId in projects)) {
      console.error(pc.bold(pc.red(`✘ Project with ID "${projectId}" not found.`)));
      console.log(pc.dim('Use "adist list" to see available project IDs.'));
      process.exit(1);
    }

    // Get project info for display if possible
    let projectName = 'Unknown';
    let projectPath = 'Unknown';
    
    const projectData = projects[projectId];
    if (projectData && typeof projectData === 'object') {
      const typed = projectData as Record<string, unknown>;
      if (typeof typed.name === 'string') {
        projectName = typed.name;
      }
      if (typeof typed.path === 'string') {
        projectPath = typed.path;
      }
    }
    
    console.log(`${pc.bold(pc.red('🗑️ Removing project by ID:'))} ${pc.yellow(projectId)}`);
    console.log(pc.dim(`Name: ${projectName}`));
    console.log(pc.dim(`Path: ${projectPath}`));

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
        let newProjectName = 'Unknown';
        if (newCurrentProject && typeof newCurrentProject === 'object') {
          const typed = newCurrentProject as Record<string, unknown>;
          if (typeof typed.name === 'string') {
            newProjectName = typed.name;
          }
        }
        console.log(pc.cyan(`Current project changed to: ${pc.bold(newProjectName)}`));
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