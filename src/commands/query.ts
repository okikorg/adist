import { Command } from 'commander';
import pc from 'picocolors';
import config from '../config.js';
import { searchDocuments } from '../utils/indexer.js';
import { LLMServiceFactory } from '../utils/llm-service.js';
import { parseMessageWithCodeHighlighting, processStreamingChunk } from '../utils/code-message-parser.js';

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

      const projects = await config.get('projects') as Record<string, { path: string; name: string }>;
      const project = projects[currentProjectId];
      if (!project) {
        console.error(pc.bold(pc.red('✘ Current project not found.')));
        process.exit(1);
      }

      console.log(`${pc.bold('Project:')} ${pc.cyan(project.name)}`);
      console.log(`${pc.bold('Question:')} ${pc.yellow('"' + question + '"')}`);


      // Get relevant documents
      const results = await searchDocuments(question);
      
      console.log(pc.bold(pc.cyan('Debug Info:')));
      console.log(`Found ${results.length} relevant document(s)`);
      if (results.length > 0) {
        console.log('Document paths:');
        results.forEach((doc, index) => {
          // Check if this is a similar document (added through semantic similarity)
          const isSimilarDoc = doc.score === 0.5;
          if (isSimilarDoc) {
            console.log(` - ${doc.path} ${pc.dim('(semantically similar)')}`);
          } else {
            console.log(` - ${doc.path}`);
          }
        });
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
          const highlightedResponse = parseMessageWithCodeHighlighting(response.summary);
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