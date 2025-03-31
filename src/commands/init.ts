import fs from 'fs/promises';
import path from 'path';
import pc from 'picocolors';
import config from '../config.js';
import { initializeIndices } from '../utils/indexer.js';
import { BlockIndexer } from '../utils/block-indexer.js';
import readline from 'readline';

interface Project {
    name: string;
    path: string;
    indexed: boolean;
    lastIndexed?: Date;
    hasSummaries?: boolean;
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query: string): Promise<string> => {
    return new Promise((resolve) => {
        rl.question(query, resolve);
    });
};

export const init = async (projectName: string) => {
    try {
        if (!projectName) {
            console.error(pc.bold(pc.red('✘ Project name is required.')));
            console.error(pc.yellow('Usage: adist init <projectName>'));
            process.exit(1);
        }

        // Create project with current directory as path
        const projectPath = process.cwd();
        console.log(pc.bold(pc.cyan('🚀 Initializing project...')));
        console.log(`${pc.bold('Name:')} ${pc.green(projectName)}`);
        console.log(`${pc.bold('Path:')} ${pc.dim(projectPath)}`);

        // Get existing projects or initialize empty object
        const projects = (await config.get('projects') || {}) as Record<string, Project>;

        // Check if project with same name already exists
        for (const [id, project] of Object.entries(projects)) {
            if (project.name === projectName) {
                console.error(pc.bold(pc.red(`✘ Project with name "${projectName}" already exists.`)));
                console.error(pc.yellow('Please choose a different name or use "adist switch" to select it.'));
                process.exit(1);
            }
        }

        // Ask about summarization
        const useSummarization = await question(pc.yellow('Would you like to enable LLM summarization? (y/N): '));
        let hasSummaries = false;

        if (useSummarization.toLowerCase() === 'y') {
            if (!process.env.ANTHROPIC_API_KEY) {
                console.error(pc.bold(pc.red('✘ ANTHROPIC_API_KEY environment variable is required for summarization.')));
                console.log(pc.dim('Please set your Anthropic API key in the environment variables.'));
                console.log(pc.dim('You can set it with:'));
                console.log(pc.cyan('export ANTHROPIC_API_KEY="your-api-key"'));
                process.exit(1);
            }
            console.log(pc.yellow('⚠️ Summarization enabled - this will incur API costs'));
            hasSummaries = true;
        }

        // Generate a unique project ID
        const projectId = Date.now().toString();

        // Add new project
        projects[projectId] = {
            name: projectName,
            path: projectPath,
            indexed: true,
            lastIndexed: new Date(),
            hasSummaries
        };

        // Update config
        await config.set('projects', projects);
        await config.set('currentProject', projectId);

        console.log(pc.dim('Indexing project files...'));

        // Load indices for the project with summarization if enabled
        await initializeIndices({ withSummaries: hasSummaries, projectId });
        
        // Initialize block indexing as well
        const blockIndexer = new BlockIndexer();
        await blockIndexer.indexProject(projectId, { withSummaries: hasSummaries });

        console.log(pc.bold(pc.green('\n✓ Project initialized successfully!')));
        console.log(pc.dim(`Run ${pc.cyan('adist get "<query>"')} to search for documents.`));
        if (hasSummaries) {
            console.log(pc.dim(`Run ${pc.cyan('adist summary')} to view project summaries.`));
        }

        rl.close();
        process.exit(0);
    } catch (error) {
        console.error(pc.bold(pc.red('✘ Error initializing project:')), error instanceof Error ? error.message : String(error));
        rl.close();
        process.exit(1);
    }
};