import pc from 'picocolors';
import config from '../config.js';
import inquirer from 'inquirer';

export const switchProject = async (projectName?: string) => {
    try {
        const projects = await config.get('projects') as Record<string, { name: string }>;
        
        if (!projects || Object.keys(projects).length === 0) {
            console.error(pc.bold(pc.red('✘ No projects found.')));
            console.error(pc.yellow('Use "adist init <projectName>" to create a new project.'));
            process.exit(1);
        }

        // If project name is provided, switch directly
        if (projectName) {
            const projectEntry = Object.entries(projects).find(([_, project]) => project.name === projectName);
            
            if (!projectEntry) {
                console.error(pc.bold(pc.red(`✘ Project "${projectName}" not found.`)));
                
                // List available projects
                console.log(pc.bold(pc.cyan('📚 Available Projects:')));
                
                Object.values(projects).forEach(project => {
                    console.log(`  ${pc.white(project.name)}`);
                });
                
                process.exit(1);
            }

            const [projectId] = projectEntry;
            await config.set('currentProject', projectId);
            
            console.log(`${pc.bold(pc.green('✓ Switched to project:'))} ${pc.cyan(projectName)}`);
            console.log(pc.dim(`Run ${pc.cyan('adist get "<query>"')} to search for documents.`));
            
            process.exit(0);
        } 
        
        // If no project name is provided, show interactive selection
        const projectNames = Object.values(projects).map(project => project.name);
        
        const { selectedProject } = await inquirer.prompt([
            {
                type: 'list',
                name: 'selectedProject',
                message: 'Select a project:',
                choices: projectNames,
                pageSize: 10 // Show 10 projects at a time for easier scrolling
            }
        ]);
        
        const projectEntry = Object.entries(projects).find(([_, project]) => project.name === selectedProject);
        
        if (!projectEntry) {
            console.error(pc.bold(pc.red(`✘ Project "${selectedProject}" not found.`)));
            process.exit(1);
        }
        
        const [projectId] = projectEntry;
        await config.set('currentProject', projectId);
        
        console.log(`${pc.bold(pc.green('✓ Switched to project:'))} ${pc.cyan(selectedProject)}`);
        console.log(pc.dim(`Run ${pc.cyan('adist get "<query>"')} to search for documents.`));
        
        process.exit(0);
    } catch (error) {
        console.error(pc.bold(pc.red('✘ Error switching projects:')), error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}; 