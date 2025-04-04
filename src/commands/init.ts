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

export const init = async (projectName?: string, options?: { force?: boolean }) => {
    try {
        // Get current directory name as default project name
        const projectPath = process.cwd();
        const defaultName = path.basename(projectPath);
        
        // If no project name is provided or it's an empty string, ask the user
        if (!projectName) {
            console.log(pc.bold(pc.cyan('🚀 Initializing project...')));
            const useDefaultName = await question(pc.yellow(`Use current folder "${defaultName}" as project name? (Y/n): `));
            
            if (useDefaultName.toLowerCase() === 'n') {
                projectName = await question(pc.yellow('Enter project name: '));
                if (!projectName) {
                    console.error(pc.bold(pc.red('✘ Project name is required.')));
                    rl.close();
                    process.exit(1);
                }
            } else {
                projectName = defaultName;
            }
        }

        console.log(`${pc.bold('Name:')} ${pc.green(projectName)}`);
        console.log(`${pc.bold('Path:')} ${pc.dim(projectPath)}`);

        // Get existing projects or initialize empty object
        const projects = (await config.get('projects') || {}) as Record<string, Project>;

        // Check if project with same name already exists
        let existingProjectId: string | null = null;
        for (const [id, project] of Object.entries(projects)) {
            if (project.name === projectName) {
                if (options?.force) {
                    existingProjectId = id;
                    console.log(pc.yellow(`⚠️ Project "${projectName}" already exists. Overriding with --force option.`));
                    break;
                } else {
                    console.error(pc.bold(pc.red(`✘ Project with name "${projectName}" already exists.`)));
                    console.error(pc.yellow('Please choose a different name, use "adist switch" to select it, or use --force to override.'));
                    rl.close();
                    process.exit(1);
                }
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

        // Generate a unique project ID (or use existing one if force option is used)
        const projectId = existingProjectId || Date.now().toString();

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
        
        // Create .cursor/rules directory if it doesn't exist
        const cursorRulesDir = path.join(projectPath, '.cursor', 'rules');
        try {
            await fs.mkdir(cursorRulesDir, { recursive: true });
            
            // Create the adist-rule.mdc file
            const rulePath = path.join(cursorRulesDir, 'adist-rule.mdc');
            const ruleContent = `# Adist Project: ${projectName}

## Project Exploration

This project is indexed with Adist, a semantic search and AI assistant tool.

### For AI assistants

- Use \`adist get "query"\` to find relevant code
- Use \`adist get "term1 AND term2"\` for advanced searching (both terms must match)
- Use \`adist get "term1 OR term2"\` for advanced searching (either term can match)
- Use \`adist query "question"\` to get AI-powered answers
- Use \`adist chat\` for interactive conversations about the codebase
- Use \`adist summary\` to see project summaries
- Use \`adist inspect-file <file>\` to analyze file structure
- Use \`adist list\` to show all indexed projects
- Use \`adist switch <projectName>\` to switch between projects

### Commands to know

- Initialize: \`adist init [projectName]\` (use \`--force\` to override existing project)
- Search: \`adist get "<query>"\`
- Advanced Search: 
  - AND operator: \`adist get "term1 AND term2 AND term3"\` (all terms must match)
  - OR operator: \`adist get "term1 OR term2 OR term3"\` (any term can match)
- Query: \`adist query "<question>"\`
- Chat: \`adist chat\` (use /exit to end session)
- List projects: \`adist list\`
- Switch projects: \`adist switch <projectName>\`
- Reindex: \`adist reindex\`${hasSummaries ? '\n- View summaries: `adist summary`' : ''}

Adist splits documents into semantic blocks for more precise searching.`;

            await fs.writeFile(rulePath, ruleContent);
            console.log(pc.dim(`Created Cursor rule file at ${pc.cyan('.cursor/rules/adist-rule.mdc')}`));
        } catch (error) {
            console.log(pc.yellow(`Note: Could not create Cursor rule file: ${error instanceof Error ? error.message : String(error)}`));
        }

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