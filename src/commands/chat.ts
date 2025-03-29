import { Command } from 'commander';
import pc from 'picocolors';
import config from '../config.js';
import { searchDocuments } from '../utils/indexer.js';
import { LLMServiceFactory } from '../utils/llm-service.js';
import readline from 'readline';
import { parseMessageWithCodeHighlighting, parseMessageWithMarkdownHighlighting, processStreamingChunk, formatMarkdownDocument } from '../utils/code-message-parser.js';
import { reindexCurrentProject } from '../utils/indexer.js';
import { BlockIndexer, BlockSearchEngine } from '../utils/block-indexer.js';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// Define available slash commands
const SLASH_COMMANDS = {
  help: 'Show available commands',
  exit: 'Exit the chat session',
  reset: 'Reset the chat history',
  clear: 'Clear the terminal screen',
  cost: 'Show total cost of the session',
  debug: 'Toggle debug information display',
  reindex: 'Reindex the project with summaries'
};

export const chatCommand = new Command('chat')
  .description('Start an interactive chat session about your project')
  .action(async () => {
    try {
      // Get current project
      const currentProjectId = await config.get('currentProject') as string;
      if (!currentProjectId) {
        console.error(pc.bold(pc.red('✘ No project is currently selected.')));
        console.error(pc.yellow('Run "adist init" or "adist switch" first.'));
        process.exit(1);
      }

      const projects = await config.get('projects') as Record<string, { name: string; hasSummaries?: boolean }>;
      const project = projects[currentProjectId];
      if (!project) {
        console.error(pc.bold(pc.red('✘ Current project not found.')));
        process.exit(1);
      }

      // Check if project has indexes
      const indexes = await config.get(`indexes.${currentProjectId}`) as any[] | undefined;
      const blockIndexes = await config.get(`block-indexes.${currentProjectId}`) as any[] | undefined;
      
      if ((!indexes || indexes.length === 0) && (!blockIndexes || blockIndexes.length === 0)) {
        console.error(pc.bold(pc.red('✘ Project has no indexed files.')));
        console.log(pc.yellow('Run "adist reindex" to index your project files.'));
        process.exit(1);
      }
      
      if (!blockIndexes || blockIndexes.length === 0) {
        console.log(pc.yellow('⚠️ Project does not have block-based indexes.'));
        console.log(pc.dim('Run "adist reindex" to create block-based indexes for better search results.'));
      }

      // Check if project has summaries
      const overallSummary = await config.get(`summaries.${currentProjectId}.overall`) as string | undefined;
      if (!project.hasSummaries || !overallSummary) {
        console.log(pc.yellow('⚠️ Project does not have summaries.'));
        console.log(pc.dim('Run "adist reindex --summarize" to generate summaries for better context.'));
      }

      try {
        // Get LLM service
        const llmService = await LLMServiceFactory.getLLMService();
        
        console.log(pc.bold(pc.cyan('Chat Session Started')));
        console.log(`${pc.bold('Project:')} ${pc.cyan(project.name)}`);
        console.log(pc.dim('Type "/help" to see available commands'));

        // Initialize chat interface
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
          completer: (line: string, callback: (err: Error | null, result?: readline.CompleterResult) => void) => {
            // Only complete if the line starts with '/'
            if (!line.startsWith('/')) {
              callback(null, [[], line]);
              return;
            }

            const command = line.slice(1).toLowerCase();
            const matches = Object.keys(SLASH_COMMANDS)
              .filter(cmd => cmd.startsWith(command))
              .map(cmd => `/${cmd}`);

            callback(null, [matches, line]);
          }
        });

        const question = (query: string): Promise<string> => {
          return new Promise((resolve) => {
            rl.question(query, resolve);
          });
        };

        // Initialize chat history
        const messages: Message[] = [];
        let totalCost = 0;
        let lastQuery = '';
        let lastTopicId = '';
        let isDisplayingResponse = false;
        let showDebugInfo = true;
        
        // For tracking code block state in streaming responses
        let responseBuffer = '';
        let inCodeBlock = false;

        const handleSlashCommand = async (input: string): Promise<boolean> => {
          const command = input.slice(1).toLowerCase();
          
          switch (command) {
            case 'help':
              console.log(pc.bold(pc.cyan('\nAvailable Commands:')));
              Object.entries(SLASH_COMMANDS).forEach(([cmd, desc]) => {
                console.log(pc.cyan(`/${cmd}`) + pc.dim(` - ${desc}`));
              });
              return true;
              
            case 'exit':
              return true;
              
            case 'reset':
              messages.length = 0;
              console.log(pc.green('✓ Chat history reset'));
              return true;
              
            case 'clear':
              console.clear();
              console.log(pc.bold(pc.cyan('Chat Session')));
              console.log(`${pc.bold('Project:')} ${pc.cyan(project.name)}`);
              return true;
              
            case 'cost':
              console.log(pc.dim(`\nTotal session cost: $${totalCost.toFixed(4)}`));
              return true;
              
            case 'debug':
              showDebugInfo = !showDebugInfo;
              console.log(pc.green(`✓ Debug information ${showDebugInfo ? 'enabled' : 'disabled'}`));
              return true;

            case 'reindex':
              console.log(pc.yellow('\nReindexing project with block-based indexing and summaries...'));
              console.log(pc.dim('This will take a few moments...'));
              
              // Temporarily pause the chat interface
              rl.pause();
              
              try {
                const blockIndexer = new BlockIndexer();
                await blockIndexer.indexCurrentProject({ withSummaries: true });
                console.log(pc.green('\n✓ Project reindexed successfully with block-based indexing!'));
              } catch (error) {
                console.error(pc.red('\nError during reindexing:'), error);
              } finally {
                // Resume the chat interface
                rl.resume();
                console.log(pc.dim('\nChat session resumed.'));
              }
              return true;
              
            default:
              console.log(pc.yellow(`Unknown command: ${input}. Type /help to see available commands.`));
              return true;
          }
        };

        while (true) {
          const userInput = await question(pc.cyan('\nYou: '));
          
          // Handle slash commands
          if (userInput.startsWith('/')) {
            if (await handleSlashCommand(userInput)) {
              if (userInput.toLowerCase() === '/exit') {
                break;
              }
              continue;
            }
          }

          // Reset the display flag for each new message
          isDisplayingResponse = false;
          responseBuffer = '';
          inCodeBlock = false;

          // Add user message to history
          messages.push({ role: 'user', content: userInput });
          
          // Check if this is a summary-related query
          const isSummaryQuery = 
            userInput.toLowerCase().includes('summary') || 
            userInput.toLowerCase().includes('overview') || 
            userInput.toLowerCase().includes('describe') ||
            userInput.toLowerCase().includes('what is') ||
            userInput.toLowerCase().includes("what's") ||
            userInput.toLowerCase().includes('what does') ||
            userInput.toLowerCase().includes('explain');
            
          // Check for explicit summary requests
          const isExplicitSummaryRequest = 
            userInput.toLowerCase() === 'summary' ||
            userInput.toLowerCase() === 'what is the summary' ||
            userInput.toLowerCase() === "what's the summary" ||
            userInput.toLowerCase() === 'project summary' ||
            userInput.toLowerCase() === 'show summary' ||
            userInput.toLowerCase() === 'show project summary';
          
          // For explicit summary requests, show summary directly if available
          if (isExplicitSummaryRequest && project.hasSummaries) {
            const projectSummary = await config.get(`summaries.${currentProjectId}.overall`) as string | undefined;
            
            if (projectSummary) {
              console.log(pc.bold(pc.cyan('\nAssistant:')));
              console.log(pc.cyan('Project Summary:'));
              console.log(projectSummary);
              console.log(pc.dim('\nTo view file summaries, use:'));
              console.log(pc.cyan('  adist summary --list'));
              
              // Add response to chat history
              messages.push({ 
                role: 'assistant', 
                content: `Project Summary:\n\n${projectSummary}\n\nTo view file summaries, use: adist summary --list` 
              });
              
              // Skip the regular LLM call
              continue;
            }
          }
          
          // Check if this query might be related to the previous one
          const isRelatedQuery = lastQuery && (
            userInput.toLowerCase().includes(lastQuery.toLowerCase()) ||
            lastQuery.toLowerCase().includes(userInput.toLowerCase()) ||
            (userInput.split(/\s+/).length <= 5) // Short follow-up questions are often related
          );

          // Search for relevant documents using block-based search
          const searchEngine = new BlockSearchEngine();
          const blockResults = await searchEngine.searchBlocks(userInput);
          
          // Check if we have a project summary available
          let hasSummary = false;
          let overallSummary: string | undefined;
          
          // Format results from block search
          const results = blockResults.map(result => {
            // Combine all block contents for the document
            const content = result.blocks.map(block => {
              let blockHeader = `--- ${block.type}`;
              if (block.title) blockHeader += `: ${block.title}`;
              blockHeader += ` (lines ${block.startLine}-${block.endLine}) ---`;
              return `${blockHeader}\n${block.content}`;
            }).join('\n\n');
            
            return {
              path: result.document,
              content: content
            };
          });
          
          // If it's a summary query or no results were found, check for project summary
          if ((isSummaryQuery || blockResults.length === 0) && project.hasSummaries) {
            overallSummary = await config.get(`summaries.${currentProjectId}.overall`) as string | undefined;
            hasSummary = Boolean(overallSummary);
            
            // For summary queries, add the project summary to the results
            if (isSummaryQuery && hasSummary && overallSummary) {
              results.push({
                path: "PROJECT_SUMMARY",
                content: `--- Project Summary ---\n${overallSummary}`
              });
            }
            
            // For explicit summary requests, prioritize the summary by making it the only result
            if (isExplicitSummaryRequest && hasSummary && overallSummary) {
              // Clear existing results and only use the summary
              results.length = 0;
              results.push({
                path: "PROJECT_SUMMARY",
                content: `--- Project Summary ---\n${overallSummary}`
              });
            }
          }
          
          // Debug logging
          if (showDebugInfo) {
            console.log(pc.bold(pc.cyan('\nDebug Info:')));
            console.log(`Found ${blockResults.length} document(s) with ${blockResults.reduce((count, doc) => count + doc.blocks.length, 0)} relevant blocks`);
            if (blockResults.length > 0) {
              // Tree-like representation of search results
              console.log('\nDocument tree:');
              
              // Define interfaces for our tree structure
              interface BlockInfo {
                type: string;
                title?: string;
                startLine: number;
                endLine: number;
                content: string;
              }
              
              interface FileNode {
                isFile: true;
                blocks: BlockInfo[];
                count: number;
                summary?: string;
              }
              
              interface DirectoryNode extends Map<string, DirectoryNode | FileNode> {}
              
              const projectStructure = new Map<string, DirectoryNode | FileNode>();
              
              // Check if we should fetch and include summaries
              let projectSummaryInfo = '';
              if (project.hasSummaries && blockResults.length === 0) {
                const overallSummary = await config.get(`summaries.${currentProjectId}.overall`) as string | undefined;
                if (overallSummary) {
                  projectSummaryInfo = pc.cyan('\nUsing project summary as context');
                }
              }
              
              blockResults.forEach(doc => {
                // Split the document path to get directories and filename
                const pathParts = doc.document.split('/');
                const fileName = pathParts.pop() || '';
                
                // Build the tree structure
                let currentLevel: DirectoryNode = projectStructure as DirectoryNode;
                pathParts.forEach(part => {
                  if (!currentLevel.has(part)) {
                    currentLevel.set(part, new Map<string, DirectoryNode | FileNode>());
                  }
                  currentLevel = currentLevel.get(part) as DirectoryNode;
                });
                
                // Add file with block info and look for summary if available
                let blockSummary: string | undefined;
                
                // Look for document block that might have summary
                const documentBlock = doc.blocks.find(block => block.type === 'document' && 'summary' in block);
                if (documentBlock && 'summary' in documentBlock) {
                  blockSummary = documentBlock.summary as string;
                }
                
                currentLevel.set(fileName, {
                  isFile: true,
                  blocks: doc.blocks,
                  count: doc.blocks.length,
                  summary: blockSummary
                });
              });
              
              // Helper function to print the tree
              const printTree = (structure: DirectoryNode, prefix = '', isLast = true): void => {
                // Sort entries - directories first, then files
                const entries = [...structure.entries()].sort((a, b) => {
                  const aIsDir = !(a[1] as FileNode).isFile;
                  const bIsDir = !(b[1] as FileNode).isFile;
                  if (aIsDir && !bIsDir) return -1;
                  if (!aIsDir && bIsDir) return 1;
                  return a[0].localeCompare(b[0]);
                });
                
                entries.forEach(([key, value], index) => {
                  const isLastEntry = index === entries.length - 1;
                  const connector = isLast ? '└── ' : '├── ';
                  const childPrefix = isLast ? '    ' : '│   ';
                  
                  if ((value as FileNode).isFile) {
                    const fileNode = value as FileNode;
                    const blockInfo = fileNode.count > 0 ? pc.cyan(` (${fileNode.count} blocks)`) : '';
                    console.log(`${prefix}${connector}${pc.bold(key)}${blockInfo}`);
                    
                    // Show summary if available
                    if (fileNode.summary) {
                      const summaryPreview = fileNode.summary.length > 60 
                        ? fileNode.summary.substring(0, 60) + '...' 
                        : fileNode.summary;
                      console.log(`${prefix}${childPrefix}${pc.dim('Summary:')} ${pc.cyan(summaryPreview)}`);
                    }
                    
                    // Show block details with prettier formatting
                    if (fileNode.count > 0) {
                      const blocksToShow = fileNode.blocks.slice(0, 3);
                      blocksToShow.forEach((block: BlockInfo, blockIndex: number) => {
                        const isLastBlock = blockIndex === blocksToShow.length - 1 && fileNode.count <= 3;
                        const blockConnector = isLastBlock ? '└── ' : '├── ';
                        let blockDesc = `${block.type}`;
                        if (block.title) blockDesc += `: ${block.title}`;
                        blockDesc += ` (lines ${block.startLine}-${block.endLine})`;
                        console.log(`${prefix}${childPrefix}${blockConnector}${blockDesc}`);
                      });
                      
                      if (fileNode.count > 3) {
                        console.log(`${prefix}${childPrefix}└── ${pc.dim(`... and ${fileNode.count - 3} more blocks`)}`);
                      }
                    }
                  } else {
                    // It's a directory
                    console.log(`${prefix}${connector}${pc.cyan(key)}`);
                    printTree(value as DirectoryNode, `${prefix}${childPrefix}`, isLastEntry);
                  }
                });
              };
              
              printTree(projectStructure as DirectoryNode);
              
              // Display project summary info if available
              if (projectSummaryInfo) {
                console.log(projectSummaryInfo);
              }
            }
          }
          
          // Get AI response with the project ID for context caching
          const response = await llmService.chatWithProject(
            messages, 
            results, 
            currentProjectId,
            // Stream callback for real-time output
            async (chunk) => {
              // Only add the answer header and debug info on the first chunk
              if (!isDisplayingResponse) {
                console.log(pc.bold(pc.cyan('\nAssistant:')));
                
                if (results.length === 0) {
                  if (hasSummary) {
                    console.log(pc.cyan('ℹ️ Using project summary as context (no specific code blocks found).'));
                  } else {
                    console.log(pc.yellow('⚠️ No relevant documents found in the project to answer your question.'));
                    console.log(pc.dim('Try reindexing the project with:'));
                    console.log(pc.cyan('  adist reindex -s'));
                  }
                }
                
                isDisplayingResponse = true;
              }
              
              // Process the chunk with syntax highlighting for code blocks
              const { processedChunk, updatedBuffer, updatedInCodeBlock } = 
                processStreamingChunk(chunk, responseBuffer, inCodeBlock);
              
              // Update state for next chunk
              responseBuffer = updatedBuffer;
              inCodeBlock = updatedInCodeBlock;
              
              // Write the processed chunk to stdout directly
              process.stdout.write(processedChunk);
            }
          );
          
          // If streaming was used, add a newline after it completes
          if (isDisplayingResponse) {
            process.stdout.write('\n');
          } else {
            // If streaming wasn't used, display the response normally with code highlighting
            console.log(pc.bold(pc.cyan('Assistant:')));
            
            if (results.length === 0) {
              if (hasSummary) {
                console.log(pc.cyan('ℹ️ Using project summary as context (no specific code blocks found).'));
              } else {
                console.log(pc.yellow('⚠️ No relevant documents found in the project to answer your question.'));
                console.log(pc.dim('Try reindexing the project with:'));
                console.log(pc.cyan('  adist reindex -s'));
              }
            }
            
            // Apply syntax highlighting to code blocks in the response
            const highlightedResponse = formatMarkdownDocument(response.summary);
            console.log(highlightedResponse);
          }
          
          // Add AI response to history
          messages.push({ role: 'assistant', content: response.summary });
          totalCost += response.cost;
          
          // Store the query for potential future comparison
          lastQuery = userInput;
          
          // Show cost and context info
          let contextInfo = '';
          if (response.usedCachedContext) {
            contextInfo = ` ${pc.green('(using cached context)')}`;
          }
          
          // Show query complexity if available
          let complexityInfo = '';
          if (response.queryComplexity) {
            const complexityColor = 
              response.queryComplexity === 'high' ? pc.yellow :
              response.queryComplexity === 'medium' ? pc.cyan : 
              pc.green;
            complexityInfo = ` · ${complexityColor(`complexity: ${response.queryComplexity}`)}`;
          }
          
          console.log(pc.dim(`\nMessage cost: $${response.cost.toFixed(4)}${contextInfo}${complexityInfo}`));
        }

        // Close chat interface
        rl.close();

        console.log(pc.bold(pc.cyan('Chat Session Ended')));
        console.log(pc.dim(`Total cost: $${totalCost.toFixed(4)}`));
      } catch (llmError) {
        console.error(pc.bold(pc.red('✘ LLM Error:')), llmError instanceof Error ? llmError.message : String(llmError));
        console.log(pc.yellow('To configure an LLM provider, run "adist llm-config"'));
        process.exit(1);
      }

      process.exit(0);
    } catch (error) {
      console.error(pc.bold(pc.red('✘ Error in chat session:')), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }); 