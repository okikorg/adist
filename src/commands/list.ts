// import pc from 'picocolors';
// import config from '../config.js';
// import Table from 'cli-table3';

// interface Project {
//   name: string;
//   path: string;
//   indexed?: boolean;
//   lastIndexed?: Date;
//   hasSummaries?: boolean;
// }

// export const list = async (options?: { debug?: boolean }) => {
//   try {
//     const projects = await config.get('projects') as Record<string, Project>;
//     const currentProjectId = await config.get('currentProject') as string;

//     if (!projects || Object.keys(projects).length === 0) {
//       console.log(pc.yellow('No projects found. Use "adist init <projectName>" to create one.'));
//       return;
//     }

//     const table = new Table({
//       head: ['Name', 'ID', 'Path', 'Indexed', 'Summaries'],
//       style: {
//         head: ['cyan', 'bold'],
//         border: ['gray'],
//       },
//       colWidths: [25, 20, 40, 10, 10],
//     });

//     for (const [id, project] of Object.entries(projects)) {
//       const isCurrent = id === currentProjectId;
//       const name = isCurrent ? pc.green(`> ${project.name}`) : project.name;
//       const projectId = pc.dim(id);
//       const path = pc.dim(project.path);
//       const indexed = project.indexed ? pc.green('✓') : pc.red('✗');
//       const hasSummaries = project.hasSummaries ? pc.green('✓') : pc.red('✗');

//       table.push([name, projectId, path, indexed, hasSummaries]);

//       if (options?.debug) {
//         console.log(pc.dim(`Project ID: ${id}`));
//         try {
//           const indexes = await config.get(`indexes.${id}`) as Array<any> | undefined;
//           console.log(pc.dim(`Indexed files: ${indexes ? indexes.length : 0}`));
//         } catch (e) {
//           console.log(pc.dim(`Indexed files: Error retrieving`));
//         }
//       }
//     }

//     console.log(table.toString());
//   } catch (error) {
//     console.error(pc.bold(pc.red('✘ Error listing projects:')), error instanceof Error ? error.message : String(error));
//     process.exit(1);
//   }
// }; 


import pc from 'picocolors';
import config from '../config.js';

interface Project {
  name: string;
  path: string;
  indexed?: boolean;
  lastIndexed?: Date;
  hasSummaries?: boolean;
}

interface ListOptions {
  debug?: boolean;
}

export const list = async (options: ListOptions = {}) => {
  try {
    const projects = await config.get('projects') as Record<string, Project>;
    const currentProjectId = await config.get('currentProject') as string;
    
    if (!projects || Object.keys(projects).length === 0) {
      console.log(pc.yellow('No projects found. Use "adist init <projectName>" to create one.'));
      return;
    }

    // Print header
    console.log();
    console.log(pc.bold('Projects:'));
    console.log();

    // Print each project with better formatting
    for (const [id, project] of Object.entries(projects)) {
      const isCurrent = id === currentProjectId;
      const prefix = isCurrent ? pc.green('→ ') : '  ';
      const nameDisplay = pc.bold(project.name);
      
      // First line with name and status indicators
      console.log(`${prefix}${nameDisplay} ${getStatusIndicators(project)}`);
      
      // Second line with ID and path
      console.log(`  ${pc.dim('ID:')} ${pc.dim(id)}`);
      console.log(`  ${pc.dim('Path:')} ${project.path}`);
      
      // Debug info if requested
      if (options?.debug) {
        try {
          const indexes = await config.get(`indexes.${id}`) as Array<any> | undefined;
          console.log(`  ${pc.dim(`Indexed files: ${indexes ? indexes.length : 0}`)}`);
        } catch (e) {
          console.log(`  ${pc.dim('Indexed files: Error retrieving')}`);
        }
      }
      
      // Add space between projects
      console.log();
    }
  } catch (error) {
    console.error(
      pc.bold(pc.red('✘ Error listing projects:')), 
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
};

// Helper function to generate status indicators
const getStatusIndicators = (project: Project): string => {
  const indicators = [];
  
  if (project.indexed) {
    indicators.push(pc.green('indexed'));
  } else {
    indicators.push(pc.red('not-indexed'));
  }
  
  if (project.hasSummaries) {
    indicators.push(pc.green('summaries'));
  } else {
    indicators.push(pc.red('no-summaries'));
  }
  
  return indicators.map(i => `[${i}]`).join(' ');
};