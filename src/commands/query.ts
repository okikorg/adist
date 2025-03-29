import { Command } from 'commander';
import pc from 'picocolors';
import config from '../config.js';
import { BlockSearchEngine } from '../utils/block-indexer.js';
import { LLMServiceFactory } from '../utils/llm-service.js';
import { parseMessageWithCodeHighlighting, parseMessageWithMarkdownHighlighting, processStreamingChunk, formatMarkdownDocument } from '../utils/code-message-parser.js';

export const queryCommand = new Command('query')
  .description('Query your project with natural language')
  .argument('<question>', 'The natural language question to ask about your project')
  .action(async (question: string) => {
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

      console.log(`${pc.bold('Project:')} ${pc.cyan(project.name)}`);
      console.log(`${pc.bold('Question:')} ${pc.yellow('"' + question + '"')}`);

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
        
      // For explicit summary requests, show summary directly if available
      if (isExplicitSummaryRequest && project.hasSummaries) {
        const projectSummary = await config.get(`summaries.${currentProjectId}.overall`) as string | undefined;
        
        if (projectSummary) {
          console.log(pc.bold(pc.cyan('Project Summary:')));
          console.log('\n' + projectSummary + '\n');
          console.log(pc.dim('To view file summaries:'));
          console.log(pc.cyan('  adist summary --list'));
          process.exit(0);
        }
      }

      // Search for relevant documents using block-based search
      const searchEngine = new BlockSearchEngine();
      const blockResults = await searchEngine.searchBlocks(question);
      
      // Format results for the LLM
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
      
      console.log(pc.bold(pc.cyan('Debug Info:')));
      console.log(`Found ${blockResults.length} document(s) with ${blockResults.reduce((count, doc) => count + doc.blocks.length, 0)} relevant blocks`);
      
      if (blockResults.length > 0) {
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
          
          // Add file with block info
          currentLevel.set(fileName, {
            isFile: true,
            blocks: doc.blocks,
            count: doc.blocks.length
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
        // Get LLM service
        const llmService = await LLMServiceFactory.getLLMService();
        
        console.log(pc.bold(pc.cyan('Answer:')));
        
        // Setup for streaming response
        let startedStreaming = false;
        
        // For tracking code block state in streaming responses
        let responseBuffer = '';
        let inCodeBlock = false;
        
        // Get AI response with streaming
        const response = await llmService.queryProject(
          question, 
          results, 
          currentProjectId,
          // Stream callback
          (chunk) => {
            if (!startedStreaming) {
              startedStreaming = true;
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
        
        // Add a newline after streaming is complete
        if (startedStreaming) {
          process.stdout.write('\n');
        } else {
          // Fallback if streaming didn't work
          const highlightedResponse = formatMarkdownDocument(response.summary);
          console.log(highlightedResponse);
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
      } catch (llmError) {
        console.error(pc.bold(pc.red('✘ LLM Error:')), llmError instanceof Error ? llmError.message : String(llmError));
        console.log(pc.yellow('To configure an LLM provider, run "adist llm-config"'));
        process.exit(1);
      }

      process.exit(0);
    } catch (error) {
      console.error(pc.bold(pc.red('✘ Error querying project:')), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }); 