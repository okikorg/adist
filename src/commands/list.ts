import pc from 'picocolors';
import config from '../config.js';
import Table from 'cli-table3';

interface Project {
  name: string;
  path: string;
  indexed?: boolean;
  lastIndexed?: Date;
  hasSummaries?: boolean;
}

export const list = async (options?: { debug?: boolean }) => {
  try {
    const projects = await config.get('projects') as Record<string, Project>;
    const currentProjectId = await config.get('currentProject') as string;

    if (!projects || Object.keys(projects).length === 0) {
      console.log(pc.yellow('No projects found. Use "adist init <projectName>" to create one.'));
      return;
    }

    const table = new Table({
      head: ['Name', 'ID', 'Path', 'Indexed', 'Summaries'],
      style: {
        head: ['cyan', 'bold'],
        border: ['gray'],
      },
      colWidths: [25, 20, 40, 10, 10],
    });

    for (const [id, project] of Object.entries(projects)) {
      const isCurrent = id === currentProjectId;
      const name = isCurrent ? pc.green(`> ${project.name}`) : project.name;
      const projectId = pc.dim(id);
      const path = pc.dim(project.path);
      const indexed = project.indexed ? pc.green('✓') : pc.red('✗');
      const hasSummaries = project.hasSummaries ? pc.green('✓') : pc.red('✗');

      table.push([name, projectId, path, indexed, hasSummaries]);

      if (options?.debug) {
        console.log(pc.dim(`Project ID: ${id}`));
        try {
          const indexes = await config.get(`indexes.${id}`) as Array<any> | undefined;
          console.log(pc.dim(`Indexed files: ${indexes ? indexes.length : 0}`));
        } catch (e) {
          console.log(pc.dim(`Indexed files: Error retrieving`));
        }
      }
    }

    console.log(table.toString());
  } catch (error) {
    console.error(pc.bold(pc.red('✘ Error listing projects:')), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}; 