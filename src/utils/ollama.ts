import pc from 'picocolors';
import fetch from 'node-fetch';
import config from '../config.js';

interface SummaryResult {
  summary: string;
  cost: number; // Always 0 for Ollama as it's free to run locally
  usedCachedContext?: boolean;
  queryComplexity?: 'low' | 'medium' | 'high';
}

// Interface for cached context
interface ContextCache {
  contextContent: string;
  relevantDocuments: { content: string; path: string }[];
  lastUsed: Date;
  topicId: string;
}

export class OllamaService {
  private baseUrl: string;
  private model: string;
  // Add a context cache to store contexts by project and topic
  private contextCache: Map<string, ContextCache> = new Map();
  // Timeout for cache items in milliseconds (default: 30 minutes)
  private cacheTimeout: number = 30 * 60 * 1000;
  // Maximum combined context length to prevent hitting token limits
  private maxContextLength: number = 30000; // Lower than Anthropic due to potential limitations in Ollama models
  
  // Markdown formatting system message
  private markdownFormatSystemMessage: string = `
You are a helpful assistant that formats text into well-structured Markdown.
Please format all responses using proper Markdown formatting:
1. Use # for main headers, ## for subheaders, and ### for sub-subheaders
2. Use *text* for italic and **text** for bold
3. Use \`\`\`language\n...\n\`\`\` for code blocks with appropriate language tags
4. Use \`code\` for inline code
5. Use bullet lists with * or - and numbered lists with 1., 2., etc.
6. Use > for blockquotes
7. Use --- for horizontal rules where appropriate
8. Use [text](url) for links

Your response MUST be consistently formatted in Markdown throughout.
`;

  constructor(baseUrl: string = 'http://localhost:11434', model: string = 'llama3') {
    this.baseUrl = baseUrl;
    this.model = model;
  }

  // Method to check if Ollama is available
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  // Method to list available models
  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
      }
      const data = await response.json() as { models: Array<{ name: string }> };
      return data.models.map(model => model.name);
    } catch (error) {
      console.error(pc.red('Error listing Ollama models:'), error);
      return [];
    }
  }

  // Method to identify the topic of a query
  private async identifyTopic(query: string): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: `Extract the main topic keyword from this query. Return ONLY the single most relevant topic word, nothing else:\n\n${query}`,
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to identify topic: ${response.statusText}`);
      }

      const data = await response.json() as { response: string };
      return data.response.trim().toLowerCase();
    } catch (error) {
      console.error(pc.red('Error identifying topic:'), error);
      // If we can't identify the topic, use the query itself as a fallback
      return query.toLowerCase().split(/\s+/)[0];
    }
  }

  // Method to generate a cache key
  private generateCacheKey(projectId: string, topicId: string): string {
    return `${projectId}:${topicId}`;
  }

  // Method to create or update cache
  private updateCache(
    projectId: string, 
    topicId: string, 
    contextContent: string, 
    relevantDocuments: { content: string; path: string }[]
  ): void {
    const cacheKey = this.generateCacheKey(projectId, topicId);
    this.contextCache.set(cacheKey, {
      contextContent,
      relevantDocuments,
      lastUsed: new Date(),
      topicId
    });
    
    // Clean up old cache entries
    this.cleanupCache();
  }

  // Method to get cached context if available
  private getCachedContext(projectId: string, topicId: string): ContextCache | null {
    const cacheKey = this.generateCacheKey(projectId, topicId);
    const cached = this.contextCache.get(cacheKey);
    
    if (!cached) return null;
    
    // Update last used timestamp
    cached.lastUsed = new Date();
    this.contextCache.set(cacheKey, cached);
    
    return cached;
  }

  // Method to clean up old cache entries
  private cleanupCache(): void {
    const now = new Date();
    
    for (const [key, value] of this.contextCache.entries()) {
      const age = now.getTime() - value.lastUsed.getTime();
      if (age > this.cacheTimeout) {
        this.contextCache.delete(key);
      }
    }
  }

  // Method to estimate query complexity
  private estimateQueryComplexity(query: string): 'low' | 'medium' | 'high' {
    // Count words and special characters
    const wordCount = query.split(/\s+/).length;
    const hasCodeSnippet = query.includes('```') || 
                           query.includes('function') || 
                           query.includes('class') ||
                           query.includes('{') && query.includes('}');
    
    // Complexity indicators
    const hasComparisonWords = query.includes(' vs ') || 
                              query.includes('difference') || 
                              query.includes('compare');
    
    const hasTechnicalTerms = query.includes('implement') || 
                             query.includes('architecture') || 
                             query.includes('design') ||
                             query.includes('pattern');
    
    // Determine complexity
    if (wordCount > 15 || hasCodeSnippet || (hasComparisonWords && hasTechnicalTerms)) {
      return 'high';
    } else if (wordCount > 8 || hasComparisonWords || hasTechnicalTerms) {
      return 'medium';
    } else {
      return 'low';
    }
  }
  
  // Method to analyze conversation history
  private analyzeConversationHistory(
    messages: { role: 'user' | 'assistant'; content: string }[]
  ): { isDeepDive: boolean; followUp: boolean } {
    // Initialize result
    const result = { isDeepDive: false, followUp: false };
    
    // Need at least 3 messages for a conversation (user, assistant, user)
    if (messages.length < 3) {
      return result;
    }
    
    // Get user messages
    const userMessages = messages.filter(m => m.role === 'user');
    
    // Check for follow-up patterns
    if (userMessages.length >= 2) {
      const lastQuery = userMessages[userMessages.length - 1].content.toLowerCase();
      const prevQuery = userMessages[userMessages.length - 2].content.toLowerCase();
      
      // Common follow-up indicators
      const followUpIndicators = [
        'why', 'how', 'what about', 'explain', 'tell me more',
        'could you', 'can you', 'please', 'show me', 'example'
      ];
      
      // Check if this looks like a follow-up question
      result.followUp = followUpIndicators.some(indicator => lastQuery.includes(indicator)) ||
                        lastQuery.length < 15 || // Short questions are often follow-ups
                        lastQuery.includes(prevQuery.split(' ')[0]); // Shares first word with previous
    }
    
    // Check if the conversation pattern indicates a deep dive
    if (messages.length >= 4) {
      // If we have consistent back-and-forth on similar topics, it's a deep dive
      result.isDeepDive = true;
    }
    
    return result;
  }

  // Method to optimize context content with dynamic adjustment
  private optimizeContextContent(
    context: { content: string; path: string }[],
    queryComplexity: 'low' | 'medium' | 'high' = 'medium',
    isFollowUp: boolean = false
  ): string {
    if (context.length === 0) {
      return "No relevant project files found. You might need more information about the project.";
    }
    
    let totalLength = 0;
    const processedContexts: string[] = [];
    
    // Adjust context limits based on query complexity and whether it's a follow-up
    let contextLimit = this.maxContextLength;
    if (queryComplexity === 'low' && !isFollowUp) {
      contextLimit = Math.floor(this.maxContextLength * 0.6); // Less context for simple questions
    } else if (queryComplexity === 'high' || isFollowUp) {
      contextLimit = this.maxContextLength; // Full context for complex questions or follow-ups
    }
    
    // Process each document, limiting content length based on relevance and complexity
    for (let i = 0; i < context.length; i++) {
      const { content, path } = context[i];
      
      // Adjust document limits based on complexity and position
      let maxDocLength;
      
      if (queryComplexity === 'high' || isFollowUp) {
        // For complex queries or follow-ups, allocate more space to each document
        maxDocLength = i === 0 ? 12000 : 
                       i === 1 ? 10000 :
                       i === 2 ? 7500 : 5000;
      } else if (queryComplexity === 'medium') {
        // Default allocation
        maxDocLength = i === 0 ? 10000 : 
                       i === 1 ? 7500 :
                       i === 2 ? 5000 : 2500;
      } else {
        // For simple queries, we can be more aggressive with truncation
        maxDocLength = i === 0 ? 7500 : 
                       i === 1 ? 5000 :
                       i === 2 ? 2500 : 1500;
      }
      
      // Truncate content if needed
      let truncatedContent = content;
      if (content.length > maxDocLength) {
        truncatedContent = content.substring(0, maxDocLength) + 
          `\n... (truncated ${content.length - maxDocLength} characters)`;
      }
      
      const docContent = `File: ${path}\nContent:\n${truncatedContent}\n`;
      
      // Check if adding this would exceed total limit
      if (totalLength + docContent.length > contextLimit) {
        // If we have at least one document, break
        if (processedContexts.length > 0) break;
        
        // Otherwise, truncate the first document even more to fit
        const remainingSpace = contextLimit - totalLength;
        if (remainingSpace > 1000) { // Only if we can fit something meaningful
          const severelyTruncatedContent = content.substring(0, remainingSpace - 100) + 
            "\n... (severely truncated due to size constraints)";
          const truncatedDocContent = `File: ${path}\nContent:\n${severelyTruncatedContent}\n`;
          processedContexts.push(truncatedDocContent);
        }
        break;
      }
      
      processedContexts.push(docContent);
      totalLength += docContent.length;
    }
    
    return processedContexts.join("\n");
  }

  async summarizeFile(content: string, filePath: string): Promise<SummaryResult> {
    try {
      const prompt = `Below is the content of a source code file. Provide a concise summary of what this file does, its main components and functionality. 
Focus on the key classes, functions, or modules and their purpose. Be specific but brief.
If there are any notable patterns, potential issues, or important details, include those too.

File: ${filePath}

Content:
${content}

Summary:`;

      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false
        })
      });

      if (!response.ok) {
        // Instead of throwing, create a fallback summary for the file
        console.warn(pc.yellow(`Warning: Failed to summarize file ${filePath}: ${response.statusText}`));
        
        // Create a basic summary from the file path
        const fileExt = filePath.split('.').pop() || '';
        const fileName = filePath.split('/').pop() || '';
        const fallbackSummary = `This appears to be a ${fileExt} file named ${fileName}. ` +
                               `Based on the file path (${filePath}), it likely contains code related to ` +
                               `${filePath.includes('test') ? 'tests' : 'application logic'}.`;
        
        return {
          summary: fallbackSummary,
          cost: 0
        };
      }

      const data = await response.json() as { response: string };
      return {
        summary: data.response.trim(),
        cost: 0 // Local Ollama models have no API cost
      };
    } catch (error) {
      console.error(pc.red(`Error summarizing file ${filePath}:`), error);
      
      // Create a fallback summary instead of throwing
      const fileExt = filePath.split('.').pop() || '';
      const fileName = filePath.split('/').pop() || '';
      const fallbackSummary = `This appears to be a ${fileExt} file named ${fileName}. ` +
                             `Based on the file path (${filePath}), it likely contains code related to ` +
                             `${filePath.includes('test') ? 'tests' : 'application logic'}.`;
      
      return {
        summary: fallbackSummary,
        cost: 0
      };
    }
  }

  async generateOverallSummary(fileSummaries: { path: string; summary: string }[]): Promise<SummaryResult> {
    try {
      // Create a combined summary text from all file summaries
      const combinedSummaries = fileSummaries.map(file => 
        `File: ${file.path}\nSummary: ${file.summary}`
      ).join('\n\n');

      const prompt = `Below are summaries of files from a code project. Generate a comprehensive overview of what this project does based on these summaries.
Focus on the main functionality, architecture, and how components work together.
Be specific but concise.

${combinedSummaries}

Overall Project Summary:`;

      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false
        })
      });

      if (!response.ok) {
        // Instead of throwing, create a fallback summary
        console.warn(pc.yellow(`Warning: Failed to generate overall summary: ${response.statusText}`));
        
        // Create a basic summary from the file summaries
        const fileTypes = new Set(fileSummaries.map(f => f.path.split('.').pop() || ''));
        const fileCount = fileSummaries.length;
        const testCount = fileSummaries.filter(f => f.path.includes('test')).length;
        
        const fallbackSummary = `This project contains ${fileCount} files, including ${Array.from(fileTypes).join(', ')} files. ` +
                              `There are ${testCount} test files. ` +
                              `The project appears to be organized into multiple components and modules based on the file structure.`;
        
        return {
          summary: fallbackSummary,
          cost: 0
        };
      }

      const data = await response.json() as { response: string };
      return {
        summary: data.response.trim(),
        cost: 0 // Local Ollama models have no API cost
      };
    } catch (error) {
      console.error(pc.red('Error generating overall summary:'), error);
      
      // Create a basic summary from the file summaries
      const fileTypes = new Set(fileSummaries.map(f => f.path.split('.').pop() || ''));
      const fileCount = fileSummaries.length;
      const testCount = fileSummaries.filter(f => f.path.includes('test')).length;
      
      const fallbackSummary = `This project contains ${fileCount} files, including ${Array.from(fileTypes).join(', ')} files. ` +
                            `There are ${testCount} test files. ` +
                            `The project appears to be organized into multiple components and modules based on the file structure.`;
      
      return {
        summary: fallbackSummary,
        cost: 0
      };
    }
  }

  async queryProject(
    query: string, 
    context: { content: string; path: string }[],
    projectId: string,
    streamCallback?: (chunk: string) => void
  ): Promise<SummaryResult> {
    try {
      // Identify the topic of the query
      const topicId = await this.identifyTopic(query);
      
      // Check if we have a cached context for this topic
      let contextContent: string;
      let usedCachedContext = false;
      
      const cachedContext = this.getCachedContext(projectId, topicId);
      if (cachedContext) {
        contextContent = cachedContext.contextContent;
        usedCachedContext = true;
      } else {
        // Estimate query complexity to optimize context
        const queryComplexity = this.estimateQueryComplexity(query);
        
        // Generate optimized context content
        contextContent = this.optimizeContextContent(context, queryComplexity);
        
        // Cache the context for future use
        this.updateCache(projectId, topicId, contextContent, context);
      }

      const prompt = `You are a helpful AI assistant with expertise in software development. Answer the following question about a code project using ONLY the context provided below.
If the answer cannot be determined from the context, say "I don't have enough information to answer this question" instead of making up an answer.
Be concise and specific in your response. Provide code examples only when directly relevant to the question.

CONTEXT:
${contextContent}

QUESTION:
${query}

ANSWER:`;

      if (streamCallback) {
        // For streaming responses
        const response = await fetch(`${this.baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            prompt,
            stream: true
          })
        });

        if (!response.ok) {
          throw new Error(`Query request failed: ${response.statusText}`);
        }

        // Get a more compatible stream implementation
        let finalResponse = '';
        
        if (!response.body) {
          throw new Error('Response body is null or undefined');
        }

        try {
          // Node.js compatible streaming approach
          // Process chunks with async iterators
          // @ts-ignore: TypeScript doesn't recognize async iterator for response.body
          for await (const chunk of response.body) {
            try {
              // Convert the chunk to text
              const chunkText = typeof chunk === 'string' 
                ? chunk 
                : Buffer.isBuffer(chunk) 
                  ? chunk.toString('utf-8')
                  : new TextDecoder().decode(chunk as Uint8Array);
              
              // Process each line in the chunk
              const lines = chunkText.split('\n').filter(line => line.trim());
              
              for (const line of lines) {
                try {
                  const data = JSON.parse(line) as { response: string };
                  streamCallback(data.response);
                  finalResponse += data.response;
                } catch (e) {
                  // Skip parsing errors - might be incomplete JSON
                  // Only log if it's not just an empty line
                  if (line && line.length > 2) {
                    console.debug(pc.dim(`Skipping non-JSON line: ${line.substring(0, 20)}...`));
                  }
                }
              }
            } catch (chunkError) {
              console.error(pc.yellow('Error processing chunk:'), chunkError);
              // Continue processing next chunks even if this one failed
            }
          }
        } catch (error) {
          console.error(pc.red('Error processing stream:'), error);
        }

        return {
          summary: finalResponse,
          cost: 0,
          usedCachedContext,
          queryComplexity: this.estimateQueryComplexity(query)
        };
      } else {
        // For non-streaming responses
        const response = await fetch(`${this.baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            prompt,
            stream: false
          })
        });

        if (!response.ok) {
          throw new Error(`Query request failed: ${response.statusText}`);
        }

        const data = await response.json() as { response: string };
        return {
          summary: data.response.trim(),
          cost: 0,
          usedCachedContext,
          queryComplexity: this.estimateQueryComplexity(query)
        };
      }
    } catch (error) {
      console.error(pc.red('Error querying project:'), error);
      return {
        summary: `Failed to query project: ${error instanceof Error ? error.message : String(error)}`,
        cost: 0
      };
    }
  }

  async chatWithProject(
    messages: { role: 'user' | 'assistant'; content: string }[],
    context: { content: string; path: string }[],
    projectId: string,
    streamCallback?: (chunk: string) => void
  ): Promise<SummaryResult> {
    try {
      if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
        throw new Error('Last message must be from the user');
      }

      // Get the latest user query
      const latestQuery = messages[messages.length - 1].content;
      
      // Analyze conversation patterns
      const { isDeepDive, followUp } = this.analyzeConversationHistory(messages);
      
      // Identify topic from the last user message
      const topicId = await this.identifyTopic(latestQuery);
      
      // Build context based on topic and conversation state
      let contextContent: string;
      let usedCachedContext = false;
      
      // For follow-ups and deep dives, try to use cached context
      if ((followUp || isDeepDive) && messages.length > 1) {
        const cachedContext = this.getCachedContext(projectId, topicId);
        if (cachedContext) {
          contextContent = cachedContext.contextContent;
          usedCachedContext = true;
        } else {
          // Generate new context with appropriate complexity
          const queryComplexity = this.estimateQueryComplexity(latestQuery);
          contextContent = this.optimizeContextContent(context, queryComplexity, followUp);
          
          // Get the project summary if available
          const overallSummary = await config.get(`summaries.${projectId}.overall`) as string | undefined;
          
          // If no search results were found or they're minimal, add the project summary
          if ((context.length === 0 || contextContent.length < 1000) && overallSummary) {
            const projectSummaryContext = `PROJECT OVERVIEW:\n${overallSummary}\n\n`;
            
            // Add the project summary to the beginning of the context
            contextContent = projectSummaryContext + contextContent;
          }
          
          this.updateCache(projectId, topicId, contextContent, context);
        }
      } else {
        // Generate new context for new topics
        const queryComplexity = this.estimateQueryComplexity(latestQuery);
        contextContent = this.optimizeContextContent(context, queryComplexity);
        
        // Get the project summary if available
        const overallSummary = await config.get(`summaries.${projectId}.overall`) as string | undefined;
        
        // If no search results were found or they're minimal, add the project summary
        if ((context.length === 0 || contextContent.length < 1000) && overallSummary) {
          const projectSummaryContext = `PROJECT OVERVIEW:\n${overallSummary}\n\n`;
          
          // Add the project summary to the beginning of the context
          contextContent = projectSummaryContext + contextContent;
        }
        
        this.updateCache(projectId, topicId, contextContent, context);
      }

      // Reformat conversation history for Ollama which uses a different format than Anthropic
      const conversationPrompt = messages.map(m => {
        return `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`;
      }).join('\n\n');

      const prompt = `You are a helpful AI assistant with expertise in software development. You are having a conversation about a code project.
Use ONLY the context provided below to answer questions. If you don't know something based on the context, say so.
Be concise and specific in your responses. Provide code examples only when directly relevant.

Format your response using proper Markdown:
1. Use # for main headers, ## for subheaders, and ### for sub-subheaders
2. Use *text* for italic and **text** for bold
3. Use \`\`\`language\n...\n\`\`\` for code blocks with language tags
4. Use \`code\` for inline code references
5. Use bullet lists with * or - and numbered lists with 1., 2., etc.

CONTEXT:
${contextContent}

CONVERSATION HISTORY:
${conversationPrompt}

ANSWER:`;

      if (streamCallback) {
        // For streaming responses
        const response = await fetch(`${this.baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            prompt,
            stream: true
          })
        });

        if (!response.ok) {
          throw new Error(`Query request failed: ${response.statusText}`);
        }

        // Get a more compatible stream implementation
        let finalResponse = '';
        
        if (!response.body) {
          throw new Error('Response body is null or undefined');
        }

        try {
          // Node.js compatible streaming approach
          // Process chunks with async iterators
          // @ts-ignore: TypeScript doesn't recognize async iterator for response.body
          for await (const chunk of response.body) {
            try {
              // Convert the chunk to text
              const chunkText = typeof chunk === 'string' 
                ? chunk 
                : Buffer.isBuffer(chunk) 
                  ? chunk.toString('utf-8')
                  : new TextDecoder().decode(chunk as Uint8Array);
              
              // Process each line in the chunk
              const lines = chunkText.split('\n').filter(line => line.trim());
              
              for (const line of lines) {
                try {
                  const data = JSON.parse(line) as { response: string };
                  streamCallback(data.response);
                  finalResponse += data.response;
                } catch (e) {
                  // Skip parsing errors - might be incomplete JSON
                  // Only log if it's not just an empty line
                  if (line && line.length > 2) {
                    console.debug(pc.dim(`Skipping non-JSON line: ${line.substring(0, 20)}...`));
                  }
                }
              }
            } catch (chunkError) {
              console.error(pc.yellow('Error processing chunk:'), chunkError);
              // Continue processing next chunks even if this one failed
            }
          }
        } catch (error) {
          console.error(pc.red('Error processing stream:'), error);
        }

        return {
          summary: finalResponse,
          cost: 0,
          usedCachedContext,
          queryComplexity: this.estimateQueryComplexity(latestQuery)
        };
      } else {
        // For non-streaming responses
        const response = await fetch(`${this.baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            prompt,
            stream: false
          })
        });

        if (!response.ok) {
          throw new Error(`Query request failed: ${response.statusText}`);
        }

        const data = await response.json() as { response: string };
        return {
          summary: data.response.trim(),
          cost: 0,
          usedCachedContext,
          queryComplexity: this.estimateQueryComplexity(latestQuery)
        };
      }
    } catch (error) {
      console.error(pc.red('Error chatting with project:'), error);
      return {
        summary: `Failed to chat with project: ${error instanceof Error ? error.message : String(error)}`,
        cost: 0
      };
    }
  }
  
  /**
   * Ensures the response is properly formatted as markdown
   * If the text is not already in markdown format, it will be converted
   * @param text The text to format as markdown
   * @returns The text formatted as markdown
   */
  async ensureMarkdownFormat(text: string): Promise<string> {
    // Check if the text already contains markdown elements
    const hasMarkdown = 
      text.includes('```') || // Code blocks
      /^#+\s+.+$/m.test(text) || // Headers
      /\*\*.+\*\*/m.test(text) || // Bold
      /\*.+\*/m.test(text) || // Italic
      /^-\s+.+$/m.test(text) || // Unordered lists
      /^\d+\.\s+.+$/m.test(text); // Ordered lists
    
    // If it already has markdown formatting, return as is
    if (hasMarkdown) {
      return text;
    }
    
    try {
      // If no markdown detected, use the model to format it
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: `${this.markdownFormatSystemMessage}

Please convert the following text to properly formatted Markdown without changing any meaning or content:

${text}`,
          stream: false
        })
      });

      if (!response.ok) {
        console.warn(pc.yellow(`Warning: Failed to format as markdown: ${response.statusText}`));
        return text;
      }

      const data = await response.json() as { response: string };
      return data.response.trim();
    } catch (error) {
      console.error(pc.yellow('Error formatting as markdown:'), error);
      // If formatting fails, return the original text
      return text;
    }
  }
} 