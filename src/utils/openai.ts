import OpenAI from 'openai';
import pc from 'picocolors';
import config from '../config.js';

interface SummaryResult {
  summary: string;
  cost: number;
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

export class OpenAIService {
  private client: OpenAI;
  private model: string = 'gpt-4o';
  // Add a context cache to store contexts by project and topic
  private contextCache: Map<string, ContextCache> = new Map();
  // Timeout for cache items in milliseconds (default: 30 minutes)
  private cacheTimeout: number = 30 * 60 * 1000;
  // Maximum combined context length to prevent hitting token limits
  private maxContextLength: number = 50000;
  
  // Markdown formatting system message
  private markdownFormatSystemMessage: string = `
Please format your responses using proper Markdown formatting:
1. Use \`#\`, \`##\`, \`###\` for headers
2. Use \`*text*\` for italic and \`**text**\` for bold
3. Use \`\`\`language\n...\n\`\`\` for code blocks with appropriate language tags (js, python, etc.)
4. Use \`code\` for inline code
5. Use bullet lists with \`*\` or \`-\` and numbered lists with \`1.\`, \`2.\`, etc.
6. Use \`>\` for blockquotes
7. Use \`---\` for horizontal rules where appropriate
8. Use \`[text](url)\` for links

Your response MUST be consistently formatted in Markdown throughout.
`;

  constructor(model: string = 'gpt-4o') {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    this.model = model;
  }

  // Method to identify the topic of a query
  private async identifyTopic(query: string): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 50,
        messages: [{
          role: 'user',
          content: `Extract the main topic keyword from this query. Return ONLY the single most relevant topic word, nothing else:\n\n${query}`
        }]
      });
      
      return response.choices[0].message.content?.trim().toLowerCase() || query.toLowerCase().split(/\s+/)[0];
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
    
    if (!cached) {
      // Try to find related contexts
      const relatedContexts = this.findRelatedContexts(projectId, topicId);
      if (relatedContexts.length > 0) {
        // Merge related contexts
        const mergedContext = this.mergeRelatedContexts(relatedContexts);
        if (mergedContext) {
          // Update cache with merged context
          this.updateCache(projectId, topicId, mergedContext.contextContent, mergedContext.relevantDocuments);
          return mergedContext;
        }
      }
      return null;
    }
    
    // Update last used timestamp
    cached.lastUsed = new Date();
    this.contextCache.set(cacheKey, cached);
    
    return cached;
  }

  // Method to find related contexts
  private findRelatedContexts(projectId: string, topicId: string): ContextCache[] {
    const relatedContexts: ContextCache[] = [];
    const topicWords = topicId.toLowerCase().split(/\s+/);
    
    for (const [key, value] of this.contextCache.entries()) {
      if (!key.startsWith(`${projectId}:`)) continue;
      
      const cachedTopicWords = value.topicId.toLowerCase().split(/\s+/);
      
      // Calculate word overlap
      const overlap = topicWords.filter(word => 
        cachedTopicWords.includes(word) && word.length > 3
      ).length;
      
      // Calculate similarity score
      const similarity = overlap / Math.max(topicWords.length, cachedTopicWords.length);
      
      if (similarity > 0.3) { // Threshold for considering contexts related
        relatedContexts.push(value);
      }
    }
    
    return relatedContexts;
  }

  // Method to merge related contexts
  private mergeRelatedContexts(contexts: ContextCache[]): ContextCache | null {
    if (contexts.length === 0) return null;
    
    // Sort contexts by last used (most recent first)
    contexts.sort((a, b) => b.lastUsed.getTime() - a.lastUsed.getTime());
    
    // Combine documents, removing duplicates
    const uniqueDocs = new Map<string, { content: string; path: string }>();
    for (const context of contexts) {
      for (const doc of context.relevantDocuments) {
        if (!uniqueDocs.has(doc.path)) {
          uniqueDocs.set(doc.path, doc);
        }
      }
    }
    
    // Create merged context content
    const mergedContent = Array.from(uniqueDocs.values())
      .map(doc => `File: ${doc.path}\nContent:\n${doc.content}\n`)
      .join('\n');
    
    // Truncate if needed
    const truncatedContent = mergedContent.length > this.maxContextLength
      ? mergedContent.substring(0, this.maxContextLength) + '\n... (merged from multiple contexts)'
      : mergedContent;
    
    return {
      contextContent: truncatedContent,
      relevantDocuments: Array.from(uniqueDocs.values()),
      lastUsed: new Date(),
      topicId: contexts[0].topicId // Use the most recent topic ID
    };
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

    // Score and sort documents by relevance
    const scoredDocs = context.map(doc => {
      const score = this.calculateDocumentRelevance(doc.content, queryComplexity);
      return { ...doc, score };
    }).sort((a, b) => b.score - a.score);

    // Process documents in order of relevance
    for (const { content, path, score } of scoredDocs) {
      // Calculate how much of this document we can include
      const remainingSpace = contextLimit - totalLength;
      let docContent = '';
      
      // If this is a high-relevance document, try to include more of it
      const relevanceMultiplier = score > 0.8 ? 1.2 : 1.0;
      const maxDocLength = Math.min(
        content.length,
        Math.floor(remainingSpace * relevanceMultiplier)
      );
      
      if (maxDocLength > 0) {
        docContent = content.substring(0, maxDocLength);
        
        // Add file path and content with relevance score
        const docHeader = `File: ${path} (relevance: ${score.toFixed(2)})`;
        const formattedContent = `${docHeader}\nContent:\n${docContent}\n`;
        
        // Check if adding this would exceed total limit
        if (totalLength + formattedContent.length > contextLimit) {
          // If we have at least one document, break
          if (processedContexts.length > 0) break;
          
          // Otherwise, truncate the first document even more to fit
          const remainingSpace = contextLimit - totalLength;
          if (remainingSpace > 1000) { // Only if we can fit something meaningful
            const severelyTruncatedContent = content.substring(0, remainingSpace - 100) + 
              "\n... (severely truncated due to size constraints)";
            const truncatedDocContent = `${docHeader}\nContent:\n${severelyTruncatedContent}\n`;
            processedContexts.push(truncatedDocContent);
          }
          break;
        }
        
        processedContexts.push(formattedContent);
        totalLength += formattedContent.length;
      }
    }
    
    return processedContexts.join('\n');
  }

  // Method to calculate document relevance
  private calculateDocumentRelevance(content: string, queryComplexity: 'low' | 'medium' | 'high'): number {
    // Base score starts at 0.5
    let score = 0.5;
    
    // Adjust based on content characteristics
    const hasCodeBlocks = content.includes('```');
    const hasComments = content.includes('//') || content.includes('/*');
    const hasFunctionDefinitions = content.includes('function') || content.includes('=>');
    const hasClassDefinitions = content.includes('class') || content.includes('interface');
    
    // Boost score for code-related content
    if (hasCodeBlocks) score += 0.2;
    if (hasComments) score += 0.1;
    if (hasFunctionDefinitions) score += 0.15;
    if (hasClassDefinitions) score += 0.15;
    
    // Adjust based on query complexity
    if (queryComplexity === 'high') {
      // For complex queries, prefer documents with more structure
      if (hasClassDefinitions) score += 0.1;
      if (hasFunctionDefinitions) score += 0.1;
    } else if (queryComplexity === 'low') {
      // For simple queries, prefer documents with comments and examples
      if (hasComments) score += 0.1;
      if (hasCodeBlocks) score += 0.1;
    }
    
    // Ensure score stays within 0-1 range
    return Math.min(Math.max(score, 0), 1);
  }

  async summarizeFile(content: string, filePath: string): Promise<SummaryResult> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 1000,
        messages: [
          {
            role: 'system',
            content: `You are a helpful AI assistant with expertise in software development. You are analyzing a code file.
Given a file's content, provide a comprehensive summary of its purpose, key functions, and main components.
Be specific and concise. Focus on the most important aspects of the code.

Format your response using proper Markdown:
1. Use # for main headers, ## for subheaders, and ### for sub-subheaders
2. Use *text* for italic and **text** for bold
3. Use \`\`\`language\n...\n\`\`\` for code blocks with language tags
4. Use \`code\` for inline code references
5. Use bullet lists with * or - and numbered lists with 1., 2., etc.

IMPORTANT: Always use syntax highlighting by specifying the language when creating code blocks. 
For example, use \`\`\`javascript, \`\`\`python, \`\`\`typescript, etc. rather than just \`\`\`. 
This ensures proper syntax highlighting in the terminal.`
          },
          {
            role: 'user',
            content: `FILE: ${filePath}\n\nFILE CONTENT:\n${content}`
          }
        ]
      });

      // Calculate cost based on tokens used
      // GPT-4o pricing: $10/million tokens input, $30/million tokens output
      const inputTokens = response.usage?.prompt_tokens || 0;
      const outputTokens = response.usage?.completion_tokens || 0;
      const cost = ((inputTokens / 1_000_000) * 10) + ((outputTokens / 1_000_000) * 30);

      return {
        summary: response.choices[0].message.content || "Failed to generate summary",
        cost
      };
    } catch (error) {
      console.error(pc.red(`Error summarizing file ${filePath}:`), error);
      throw error;
    }
  }

  async generateOverallSummary(fileSummaries: { path: string; summary: string }[]): Promise<SummaryResult> {
    try {
      const summaryContent = fileSummaries
        .map(({ path, summary }) => `File: ${path}\nSummary: ${summary}\n`)
        .join('\n');

      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 1000,
        messages: [
          {
            role: 'system',
            content: `You are a helpful AI assistant with expertise in software development. Your task is to analyze file summaries and provide an overall project summary.`
          },
          {
            role: 'user',
            content: `Please provide a high-level overview of the project based on the following file summaries:\n\n${summaryContent}`
          }
        ]
      });

      // Calculate cost based on tokens used
      const inputTokens = response.usage?.prompt_tokens || 0;
      const outputTokens = response.usage?.completion_tokens || 0;
      const cost = ((inputTokens / 1_000_000) * 10) + ((outputTokens / 1_000_000) * 30);

      return {
        summary: response.choices[0].message.content || "Failed to generate overall summary",
        cost
      };
    } catch (error) {
      console.error(pc.red('Error generating overall summary:'), error);
      throw error;
    }
  }

  async queryProject(
    query: string, 
    context: { content: string; path: string }[],
    projectId: string,
    streamCallback?: (chunk: string) => void
  ): Promise<SummaryResult> {
    try {
      // Identify the topic for caching
      const topicId = await this.identifyTopic(query);
      
      // Estimate query complexity
      const queryComplexity = this.estimateQueryComplexity(query);
      
      // Create a meaningful context representation
      let contextContent = '';
      let usedCachedContext = false;
      
      // Check if we have cached context for this topic
      const cachedContext = this.getCachedContext(projectId, topicId);
      
      if (cachedContext) {
        console.log(pc.dim(`Using cached context for topic: ${topicId}`));
        contextContent = cachedContext.contextContent;
        usedCachedContext = true;
      } else {
        // Generate new optimized context content
        contextContent = this.optimizeContextContent(context, queryComplexity);
        
        // Get the project summary if available
        const overallSummary = await config.get(`summaries.${projectId}.overall`) as string | undefined;
        
        // If no search results were found or they're minimal, add the project summary
        if ((context.length === 0 || contextContent.length < 1000) && overallSummary) {
          const projectSummaryContext = `PROJECT OVERVIEW:\n${overallSummary}\n\n`;
          
          // Add the project summary to the beginning of the context
          contextContent = projectSummaryContext + contextContent;
        }
            
        // Cache the context for future use
        if (context.length > 0) {
          this.updateCache(projectId, topicId, contextContent, context);
        }
      }

      // System message with context and formatting instructions
      const systemMessage = `You are a helpful assistant with access to the following project context. Use this context to provide accurate and relevant answers. If the answer cannot be found in the context, say so. Be concise but informative.

Format your response using proper Markdown:
1. Use # for main headers, ## for subheaders, and ### for sub-subheaders
2. Use *text* for italic and **text** for bold text
3. Use \`\`\`language\n...\n\`\`\` for code blocks with appropriate language tags (js, python, java, etc.)
4. Use \`code\` for inline code references
5. Use bullet lists with * or - and numbered lists with 1., 2., etc.

IMPORTANT: Always use syntax highlighting by specifying the language when creating code blocks. 
For example, use \`\`\`javascript, \`\`\`python, \`\`\`typescript, etc. rather than just \`\`\`. 
This ensures proper syntax highlighting in the terminal.

Context:\n${contextContent}`;

      let fullResponse = '';
      let cost = 0;

      // If streaming is requested, use the streaming API
      if (streamCallback) {
        // Create a streaming message
        const stream = await this.client.chat.completions.create({
          model: this.model,
          max_tokens: 1000,
          stream: true,
          messages: [
            {
              role: 'system',
              content: systemMessage
            },
            {
              role: 'user',
              content: query
            }
          ]
        });

        // Track tokens for cost calculation
        let inputTokensEstimate = systemMessage.length / 4 + query.length / 4;
        let outputTokensEstimate = 0;

        // Process the stream
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            streamCallback(content);
            fullResponse += content;
            outputTokensEstimate += content.length / 4; // Rough estimate
          }
        }

        // Calculate estimated cost
        cost = ((inputTokensEstimate / 1_000_000) * 10) + ((outputTokensEstimate / 1_000_000) * 30);
      } else {
        // Regular non-streaming request
        const response = await this.client.chat.completions.create({
          model: this.model,
          max_tokens: 1000,
          messages: [
            {
              role: 'system',
              content: systemMessage
            },
            {
              role: 'user',
              content: query
            }
          ]
        });

        fullResponse = response.choices[0].message.content || "";
        
        // Calculate cost based on tokens used
        const inputTokens = response.usage?.prompt_tokens || 0;
        const outputTokens = response.usage?.completion_tokens || 0;
        cost = ((inputTokens / 1_000_000) * 10) + ((outputTokens / 1_000_000) * 30);
      }

      return {
        summary: fullResponse,
        cost,
        usedCachedContext,
        queryComplexity
      };
    } catch (error) {
      console.error(pc.red('Error querying project:'), error);
      throw error;
    }
  }

  async chatWithProject(
    messages: { role: 'user' | 'assistant'; content: string }[],
    context: { content: string; path: string }[],
    projectId: string,
    streamCallback?: (chunk: string) => void
  ): Promise<SummaryResult> {
    try {
      // Identify the topic from the last user message
      const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
      const query = lastUserMessage?.content || '';
      const topicId = await this.identifyTopic(query);
      
      // Estimate query complexity
      const queryComplexity = this.estimateQueryComplexity(query);
      
      // Analyze conversation history
      const { isDeepDive, followUp } = this.analyzeConversationHistory(messages);
      
      // Create a meaningful context representation
      let contextContent = '';
      let usedCachedContext = false;
      
      // Check if we have cached context for this topic
      const cachedContext = this.getCachedContext(projectId, topicId);
      
      if (cachedContext) {
        console.log(pc.dim(`Using cached context for topic: ${topicId}`));
        contextContent = cachedContext.contextContent;
        usedCachedContext = true;
      } else {
        // Get the project summary if available
        const overallSummary = await config.get(`summaries.${projectId}.overall`) as string | undefined;
        
        // Generate new optimized context content, taking into account conversation state
        contextContent = this.optimizeContextContent(context, queryComplexity, followUp);
            
        // If no search results were found or they're minimal, add the project summary
        if ((context.length === 0 || contextContent.length < 1000) && overallSummary) {
          const projectSummaryContext = `PROJECT OVERVIEW:\n${overallSummary}\n\n`;
          
          // Add the project summary to the beginning of the context
          contextContent = projectSummaryContext + contextContent;
        }
        
        // Cache the context for future use
        if (context.length > 0) {
          this.updateCache(projectId, topicId, contextContent, context);
        }
      }

      // Build system message with highlighting instructions
      const systemPrompt = `You are a helpful assistant with access to the following project context. Use this context to provide accurate and relevant answers. If the answer cannot be found in the context, say so. Be concise but informative.

Format your response using proper Markdown:
1. Use # for main headers, ## for subheaders, and ### for sub-subheaders
2. Use *text* for italic and **text** for bold text
3. Use \`\`\`language\n...\n\`\`\` for code blocks with appropriate language tags (js, python, java, etc.)
4. Use \`code\` for inline code references
5. Use bullet lists with * or - and numbered lists with 1., 2., etc.

IMPORTANT: Always use syntax highlighting by specifying the language when creating code blocks. 
For example, use \`\`\`javascript, \`\`\`python, \`\`\`typescript, etc. rather than just \`\`\`. 
This ensures proper syntax highlighting in the terminal.

Context:\n${contextContent}`;

      // Prepare OpenAI chat messages format
      const chatMessages = [
        { role: 'system' as const, content: systemPrompt },
        ...messages.map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content
        }))
      ];

      let fullResponse = '';
      let cost = 0;

      // If streaming is requested, use the streaming API
      if (streamCallback) {
        // Create a streaming message
        const stream = await this.client.chat.completions.create({
          model: this.model,
          stream: true,
          messages: chatMessages
        });

        // Track tokens for cost calculation (estimate)
        let inputTokensEstimate = systemPrompt.length / 4;
        messages.forEach(msg => {
          inputTokensEstimate += msg.content.length / 4; // Rough estimate
        });
        let outputTokensEstimate = 0;

        // Process the stream
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            streamCallback(content);
            fullResponse += content;
            outputTokensEstimate += content.length / 4; // Rough estimate
          }
        }

        // Calculate estimated cost
        cost = ((inputTokensEstimate / 1_000_000) * 10) + ((outputTokensEstimate / 1_000_000) * 30);
      } else {
        // Regular non-streaming request
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: chatMessages
        });

        fullResponse = response.choices[0].message.content || '';
        
        // Calculate cost based on tokens used
        const inputTokens = response.usage?.prompt_tokens || 0;
        const outputTokens = response.usage?.completion_tokens || 0;
        cost = ((inputTokens / 1_000_000) * 10) + ((outputTokens / 1_000_000) * 30);
      }

      return {
        summary: fullResponse,
        cost,
        usedCachedContext,
        queryComplexity
      };
    } catch (error) {
      console.error(pc.red('Error in chat session:'), error);
      throw error;
    }
  }

  // Utility method to get similar contexts based on a topic
  async getSimilarContexts(projectId: string, topic: string): Promise<string[]> {
    const similarTopics: string[] = [];
    
    for (const [key, value] of this.contextCache.entries()) {
      if (key.startsWith(`${projectId}:`)) {
        // Simple similarity check - if topics share words
        const topicWords = topic.toLowerCase().split(/\s+/);
        const cachedTopicWords = value.topicId.toLowerCase().split(/\s+/);
        
        const hasCommonWords = topicWords.some(word => 
          cachedTopicWords.includes(word) && word.length > 3
        );
        
        if (hasCommonWords) {
          similarTopics.push(value.topicId);
        }
      }
    }
    
    return similarTopics;
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
      // If no markdown detected, use GPT to format it
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 1500,
        messages: [
          {
            role: 'system',
            content: this.markdownFormatSystemMessage
          },
          {
            role: 'user',
            content: `Please convert the following text to properly formatted Markdown without changing any meaning or content:\n\n${text}`
          }
        ]
      });
      
      return response.choices[0].message.content || text;
    } catch (error) {
      console.error(pc.yellow('Error formatting as markdown:'), error);
      // If formatting fails, return the original text
      return text;
    }
  }
} 