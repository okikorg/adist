import Anthropic from '@anthropic-ai/sdk';
import pc from 'picocolors';
import config from '../config.js';

interface SummaryResult {
  summary: string;
  cost: number;
  usedCachedContext?: boolean;
  queryComplexity?: 'low' | 'medium' | 'high';
}

// New interface for cached context
interface ContextCache {
  contextContent: string;
  relevantDocuments: { content: string; path: string }[];
  lastUsed: Date;
  topicId: string;
}

export class AnthropicService {
  private client: Anthropic;
  private model: string = 'claude-3-sonnet-20240229';
  // Add a context cache to store contexts by project and topic
  private contextCache: Map<string, ContextCache> = new Map();
  // Timeout for cache items in milliseconds (default: 30 minutes)
  private cacheTimeout: number = 30 * 60 * 1000;
  // Maximum combined context length to prevent hitting token limits
  private maxContextLength: number = 60000;

  constructor() {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
  }

  // Method to identify the topic of a query
  private async identifyTopic(query: string): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 50,
        messages: [{
          role: 'user',
          content: `Extract the main topic keyword from this query. Return ONLY the single most relevant topic word, nothing else:\n\n${query}`
        }]
      });
      
      return response.content[0].text.trim().toLowerCase();
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

  // New method to find related contexts
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

  // New method to merge related contexts
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

  // New method to calculate document relevance
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
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `Please provide a concise summary of the following file content. Focus on the main points and key information:\n\n${content}`
        }]
      });

      // Calculate cost based on tokens used
      // Claude 3 Sonnet: $3/million tokens
      const inputTokens = response.usage?.input_tokens || 0;
      const outputTokens = response.usage?.output_tokens || 0;
      const totalTokens = inputTokens + outputTokens;
      const cost = (totalTokens / 1_000_000) * 3;

      return {
        summary: response.content[0].text,
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

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `Please provide a high-level overview of the project based on the following file summaries:\n\n${summaryContent}`
        }]
      });

      // Calculate cost based on tokens used
      const inputTokens = response.usage?.input_tokens || 0;
      const outputTokens = response.usage?.output_tokens || 0;
      const totalTokens = inputTokens + outputTokens;
      const cost = (totalTokens / 1_000_000) * 3;

      return {
        summary: response.content[0].text,
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

      let fullResponse = '';
      let inputTokens = 0;
      let outputTokens = 0;

      // Base message parameters
      const baseParams = {
        model: this.model,
        max_tokens: 1000,
        system: `You are a helpful assistant with access to the following project context. Use this context to provide accurate and relevant answers. If the answer cannot be found in the context, say so. Be concise but informative.\n\nContext:\n${contextContent}`,
        messages: [{
          role: 'user' as const,
          content: query
        }]
      };

      // If streaming is requested, use the streaming API
      if (streamCallback) {
        // Create a streaming message
        const stream = await this.client.messages.create({
          ...baseParams,
          stream: true
        });

        // Process the stream
        for await (const chunk of stream) {
          // Extract text content from the stream
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            const text = chunk.delta.text;
            streamCallback(text);
            fullResponse += text;
          }
        }

        // For streaming, we need to make an additional non-streaming request to get token usage
        // This is because the streaming API doesn't provide usage information
        // We can do this with a minimal request to save tokens
        const usageResponse = await this.client.messages.create({
          model: this.model,
          max_tokens: 1,
          system: "Be concise.",
          messages: [{
            role: 'user' as const,
            content: query.substring(0, 100) // Just use beginning of query to estimate
          }]
        });
        
        if (usageResponse.usage) {
          // This is just an estimate, the actual usage might be different
          inputTokens = usageResponse.usage.input_tokens;
          // Scale output tokens based on response length
          outputTokens = Math.ceil(fullResponse.length / 4); // Rough estimate of tokens
        }
      } else {
        // Regular non-streaming request
        const response = await this.client.messages.create(baseParams);
        fullResponse = response.content[0].text;
        
        if (response.usage) {
          inputTokens = response.usage.input_tokens;
          outputTokens = response.usage.output_tokens;
        }
      }

      // Calculate cost based on tokens used
      const totalTokens = inputTokens + outputTokens;
      const cost = (totalTokens / 1_000_000) * 3;

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

      let fullResponse = '';
      let inputTokens = 0;
      let outputTokens = 0;

      // Make sure all messages have the correct type
      const typedMessages = messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      }));

      // Base message parameters
      const baseParams = {
        model: this.model,
        max_tokens: 1000,
        system: `You are a helpful assistant with access to the following project context. Use this context to provide accurate and relevant answers. If the answer cannot be found in the context, say so. Be concise but informative.\n\nContext:\n${contextContent}`,
        messages: typedMessages
      };

      // If streaming is requested, use the streaming API
      if (streamCallback) {
        // Create a streaming message
        const stream = await this.client.messages.create({
          ...baseParams,
          stream: true
        });

        // Process the stream
        for await (const chunk of stream) {
          // Extract text content from the stream
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            const text = chunk.delta.text;
            streamCallback(text);
            fullResponse += text;
          }
        }

        // For streaming, we need to estimate token usage
        // This is because the streaming API doesn't provide usage information
        // We're using a rough estimate based on character count
        const charCount = fullResponse.length;
        // Rough estimate of tokens (4 chars per token on average)
        outputTokens = Math.ceil(charCount / 4);
        
        // Estimate input tokens from message length
        const inputChars = typedMessages.reduce((sum, msg) => sum + msg.content.length, 0);
        inputTokens = Math.ceil(inputChars / 4) + 
                     // Add estimated tokens for system message
                     Math.ceil(contextContent.length / 4);
      } else {
        // Regular non-streaming request
        const response = await this.client.messages.create(baseParams);
        fullResponse = response.content[0].text;
        
        if (response.usage) {
          inputTokens = response.usage.input_tokens;
          outputTokens = response.usage.output_tokens;
        }
      }

      // Calculate cost based on tokens used
      const totalTokens = inputTokens + outputTokens;
      const cost = (totalTokens / 1_000_000) * 3;

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
} 