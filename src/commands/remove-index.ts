import pc from 'picocolors';
import config from '../config.js';

export const removeIndex = async (projectName: string) => {
  try {
    if (!projectName) {
      console.error(pc.bold(pc.red('✘ Project name is required.')));
      console.error(pc.yellow('Usage: adist remove-index <projectName>'));
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
    
    console.log(`${pc.bold(pc.cyan('🗑️ Removing index:'))} ${pc.yellow(projectName)}`);

    // Remove the index for this project
    // Get all existing indexes
    const indexes = await config.get('indexes') as Record<string, unknown> || {};
    
    // Create a new object without the specific project's index
    const updatedIndexes: Record<string, unknown> = { ...indexes };
    if (projectId in updatedIndexes) {
      delete updatedIndexes[projectId];
    }
    
    // Set the updated indexes
    await config.set('indexes', updatedIndexes);
    
    // Mark project as not indexed
    const typedProject = project as Record<string, unknown>;
    typedProject.indexed = false;
    await config.set(`projects.${projectId}`, typedProject);

    console.log(pc.bold(pc.green('\n✓ Index removed successfully!')));
    console.log(pc.dim(`Run ${pc.cyan(`adist reindex ${projectName}`)} to rebuild the index.`));
    
    process.exit(0);
  } catch (error) {
    console.error(pc.bold(pc.red('✘ Error removing index:')), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}; 