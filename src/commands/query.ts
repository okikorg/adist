import { Command } from 'commander';
import pc from 'picocolors';
import config from '../config.js';
import { BlockSearchEngine } from '../utils/block-indexer.js';
import { LLMServiceFactory } from '../utils/llm-service.js';
import { parseMessageWithCodeHighlighting, parseMessageWithMarkdownHighlighting, processStreamingChunk, formatMarkdownDocument } from '../utils/code-message-parser.js';

export const queryCommand = new Command('query')
  .description('Query your project with natural language')
  .argument('<question>', 'The natural language question to ask about your project')
  .option('--stream', 'Enable streaming responses (note: code highlighting may not work properly)', false)
  .action(async (question: string, options) => {
    try {
      // Get current project
      const currentProjectId = await config.get('currentProject') as string;
      if (!currentProjectId) {
        console.error(pc.bold(pc.red('✘ No project is currently selected.')));
        console.error(pc.yellow('Run "adist init" or "adist switch" first.'));
        process.exit(1);
      }

      const projects = await config.get('projects') as Record<string, { path: string; name: string; hasSummaries?: boolean }>;
      const project = projects[currentProjectId];
      if (!project) {
        console.error(pc.bold(pc.red('✘ Current project not found.')));
        process.exit(1);
      }

      // Get LLM service
      const llmService = await LLMServiceFactory.getLLMService();

      console.log(`${pc.bold('Project:')} ${pc.cyan(project.name)}`);
      console.log(`${pc.bold('Question:')} ${pc.yellow('"' + question + '"')}`);
      
      if (!options.stream) {
        console.log(pc.dim('Use "--stream" flag to enable streaming responses (may affect code highlighting)'));
      }

      // Add interface for block results
      interface BlockResult {
        document: string;
        blocks: Array<{
          type: string;
          title?: string;
          startLine: number;
          endLine: number;
          content: string;
        }>;
      }

      // Add interface for query context optimization
      interface QueryContext {
        results: { path: string; content: string }[];
        hasSummary: boolean;
        overallSummary?: string;
      }

      // Add new function to optimize query context
      const optimizeQueryContext = async (
        question: string,
        projectId: string,
        project: { hasSummaries?: boolean }
      ): Promise<QueryContext> => {
        // Check if this is a summary-related query
        const isSummaryQuery = 
          question.toLowerCase().includes('summary') || 
          question.toLowerCase().includes('overview') || 
          question.toLowerCase().includes('describe') ||
          question.toLowerCase().includes('what is') ||
          question.toLowerCase().includes("what's") ||
          question.toLowerCase().includes('what does') ||
          question.toLowerCase().includes('explain');
          
        // Check for explicit summary requests
        const isExplicitSummaryRequest = 
          question.toLowerCase() === 'summary' ||
          question.toLowerCase() === 'what is the summary' ||
          question.toLowerCase() === "what's the summary" ||
          question.toLowerCase() === 'project summary' ||
          question.toLowerCase() === 'show summary' ||
          question.toLowerCase() === 'show project summary';

        // Search for relevant documents using block-based search
        const searchEngine = new BlockSearchEngine();
        const blockResults: BlockResult[] = await searchEngine.searchBlocks(question);
        
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

        // Check if we have a project summary available
        let hasSummary = false;
        let overallSummary: string | undefined;

        // If it's a summary query or no results were found, check for project summary
        if ((isSummaryQuery || blockResults.length === 0) && project.hasSummaries) {
          overallSummary = await config.get(`summaries.${projectId}.overall`) as string | undefined;
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

        return {
          results,
          hasSummary,
          overallSummary
        };
      };

      // Inside the action handler, after getting the project:
      const queryContext = await optimizeQueryContext(question, currentProjectId, project);

      // Check if we have a project summary available
      let hasSummary = queryContext.hasSummary;
      let overallSummary = queryContext.overallSummary;
      
      console.log(pc.bold(pc.cyan('Debug Info:')));
      console.log(`Found ${queryContext.results.length} document(s) with ${queryContext.results.reduce((count: number, doc: { path: string; content: string }) => 
        count + (doc.content.match(/---/g) || []).length, 0)} relevant blocks`);
      
      if (queryContext.results.length > 0) {
        // Tree-like representation of search results
        console.log('\nDocument tree:');
        
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
        }
        
        interface DirectoryNode extends Map<string, DirectoryNode | FileNode> {}
        
        const projectStructure = new Map<string, DirectoryNode | FileNode>();
        queryContext.results.forEach(doc => {
          // Split the document path to get directories and filename
          const pathParts = doc.path.split('/');
          const fileName = pathParts.pop() || '';
          
          // Build the tree structure
          let currentLevel: DirectoryNode = projectStructure as DirectoryNode;
          pathParts.forEach(part => {
            if (!currentLevel.has(part)) {
              currentLevel.set(part, new Map<string, DirectoryNode | FileNode>());
            }
            currentLevel = currentLevel.get(part) as DirectoryNode;
          });
          
          // Add file with block info
          currentLevel.set(fileName, {
            isFile: true,
            blocks: doc.content.split('\n').map(line => ({
              type: line.includes('---') ? line.split('---')[1].trim() : '',
              title: line.includes('---') ? line.split('---')[2].trim() : '',
              startLine: 0,
              endLine: 0,
              content: line.trim()
            })),
            count: doc.content.split('\n').length
          });
        });
        
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
      }

      try {
        console.log(pc.bold(pc.cyan('Answer:')));
        
        // Setup for streaming response
        let startedStreaming = false;
        const useStreaming = options.stream === true;
        
        // For tracking code block state in streaming responses
        let responseBuffer = '';
        let inCodeBlock = false;
        
        // Create and start a loading spinner if not streaming
        let spinnerInterval: NodeJS.Timeout | null = null;
        let spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        let spinnerIdx = 0;
        
        if (!useStreaming) {
          // Show info about no results or summary
          if (queryContext.results.length === 0) {
            if (hasSummary) {
              console.log(pc.cyan('ℹ️ Using project summary as context (no specific code blocks found).'));
            } else {
              console.log(pc.yellow('⚠️ No relevant documents found in the project to answer your question.'));
              console.log(pc.dim('Try reindexing the project with:'));
              console.log(pc.cyan('  adist reindex -s'));
            }
          }
          
          // Start loading spinner
          process.stdout.write(pc.cyan(`${spinnerFrames[0]} Generating...`));
          spinnerInterval = setInterval(() => {
            spinnerIdx = (spinnerIdx + 1) % spinnerFrames.length;
            // Clear the current line and write the updated spinner
            process.stdout.write('\r' + pc.cyan(`${spinnerFrames[spinnerIdx]} Generating...`));
          }, 80);
        } else {
          // Show warning about code highlighting in streaming mode
          console.log(pc.yellow('Note: Code highlighting may not work properly in streaming mode.'));
        }
        
        // Get AI response with streaming
        const response = await llmService.queryProject(
          question,
          queryContext.results,
          currentProjectId,
          async (chunk) => {
            try {
              // Skip streaming output if streaming is not enabled
              if (!useStreaming) return;
              
              if (!startedStreaming) {
                startedStreaming = true;
                
                // Show info about no results or summary on first chunk
                if (queryContext.results.length === 0) {
                  if (hasSummary) {
                    console.log(pc.cyan('ℹ️ Using project summary as context (no specific code blocks found).'));
                  } else {
                    console.log(pc.yellow('⚠️ No relevant documents found in the project to answer your question.'));
                    console.log(pc.dim('Try reindexing the project with:'));
                    console.log(pc.cyan('  adist reindex -s'));
                  }
                }
              }
              
              // Try to detect code blocks and their language
              const isFirstChunk = responseBuffer === '';
              let detectedLanguage = null;
              
              // Check for code blocks with language indicators
              if (isFirstChunk && chunk.includes('```') && !chunk.includes('```\n```')) {
                if (chunk.includes('```go') || 
                    (chunk.includes('```') && (
                      chunk.includes('func ') || 
                      chunk.includes('type ') || 
                      chunk.includes('package ')
                    ))) {
                  detectedLanguage = 'go';
                } else if (chunk.includes('```javascript') || 
                          chunk.includes('```typescript') ||
                          (chunk.includes('```') && (
                            chunk.includes('function ') || 
                            chunk.includes('const ') || 
                            chunk.includes('let ')
                          ))) {
                  detectedLanguage = 'javascript';
                } else if (chunk.includes('```python') ||
                          (chunk.includes('```') && (
                            chunk.includes('def ') || 
                            chunk.includes('class ')
                          ))) {
                  detectedLanguage = 'python';
                }
              }
              
              // Process the chunk with syntax highlighting for code blocks
              const { processedChunk, updatedBuffer, updatedInCodeBlock } = 
                processStreamingChunk(chunk, responseBuffer, inCodeBlock);
              
              // Update state for next chunk
              responseBuffer = updatedBuffer;
              inCodeBlock = updatedInCodeBlock;
              
              // Write the processed chunk to stdout directly
              process.stdout.write(processedChunk);
            } catch (error) {
              console.error(pc.yellow('Warning: Error processing streaming chunk:'), error);
            }
          }
        );
        
        // Clear the spinner if not streaming
        if (!useStreaming && spinnerInterval) {
          clearInterval(spinnerInterval);
          // Clear the spinner line
          process.stdout.write('\r' + ' '.repeat(40) + '\r');
          
          // Apply syntax highlighting to the complete response
          try {
            // Make sure we're properly applying syntax highlighting by parsing the markdown
            const highlightedResponse = parseMessageWithMarkdownHighlighting(response.summary);
            process.stdout.write(highlightedResponse);
            console.log(); // Add an extra newline for spacing
          } catch (error) {
            // Fallback to basic formatting if parsing fails
            console.log(formatMarkdownDocument(response.summary));
            console.log(); // Add an extra newline for spacing
          }
        } else if (startedStreaming) {
          // If streaming was used, add a newline after it completes
          process.stdout.write('\n');
        }
        
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
        
        console.log(pc.dim(`\nEstimated cost: $${response.cost.toFixed(4)}${contextInfo}${complexityInfo}`));
      } catch (error) {
        console.error(pc.red('Error getting AI response:'), error);
        console.log(pc.yellow('Retrying with simplified context...'));
        
        // Retry with just the project summary if available
        if (queryContext.overallSummary) {
          try {
            const response = await llmService.queryProject(
              question,
              [{
                path: "PROJECT_SUMMARY",
                content: `--- Project Summary ---\n${queryContext.overallSummary}`
              }],
              currentProjectId
            );
            // ... handle successful retry ...
          } catch (retryError) {
            console.error(pc.red('Error in retry attempt:'), retryError);
            console.log(pc.yellow('Please try again or use a simpler query.'));
            process.exit(1);
          }
        } else {
          console.log(pc.yellow('Please try again or use a simpler query.'));
          process.exit(1);
        }
      }

      process.exit(0);
    } catch (error) {
      console.error(pc.bold(pc.red('✘ Error querying project:')), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }); 