import pc from 'picocolors';
import { AnthropicService } from './anthropic.js';
import { OllamaService } from './ollama.js';
import { OpenAIService } from './openai.js';
import config from '../config.js';

// An interface that both LLM services implement
export interface LLMService {
  summarizeFile(content: string, filePath: string): Promise<{ summary: string; cost: number }>;
  generateOverallSummary(fileSummaries: { path: string; summary: string }[]): Promise<{ summary: string; cost: number }>;
  queryProject(
    query: string, 
    context: { content: string; path: string }[],
    projectId: string,
    streamCallback?: (chunk: string) => void
  ): Promise<{ 
    summary: string; 
    cost: number;
    usedCachedContext?: boolean;
    queryComplexity?: 'low' | 'medium' | 'high';
  }>;
  chatWithProject(
    messages: { role: 'user' | 'assistant'; content: string }[],
    context: { content: string; path: string }[],
    projectId: string,
    streamCallback?: (chunk: string) => void
  ): Promise<{ 
    summary: string; 
    cost: number;
    usedCachedContext?: boolean;
    queryComplexity?: 'low' | 'medium' | 'high';
  }>;
  
  // New method to ensure responses are in markdown format
  ensureMarkdownFormat(text: string): Promise<string>;
}

export enum LLMProvider {
  ANTHROPIC = 'anthropic',
  OLLAMA = 'ollama',
  OPENAI = 'openai'
}

export class LLMServiceFactory {
  private static anthropicInstance: AnthropicService | null = null;
  private static ollamaInstance: OllamaService | null = null;
  private static openaiInstance: OpenAIService | null = null;

  // Get the LLM service based on configuration or environment
  static async getLLMService(): Promise<LLMService> {
    try {
      // First check if user has configured a preferred provider
      const provider = await config.get('llmProvider') as LLMProvider | undefined;

      // If OpenAI is preferred and available, use it
      if (provider === LLMProvider.OPENAI) {
        return await this.getOpenAIService();
      }

      // If Ollama is preferred and available, use it
      if (provider === LLMProvider.OLLAMA) {
        return await this.getOllamaService();
      }

      // If Anthropic is preferred and available, use it
      if (provider === LLMProvider.ANTHROPIC) {
        return await this.getAnthropicService();
      }

      // If no preference, try Anthropic first (as it was the original implementation)
      if (process.env.ANTHROPIC_API_KEY) {
        return await this.getAnthropicService();
      }

      // If Anthropic is not available, try OpenAI
      if (process.env.OPENAI_API_KEY) {
        return await this.getOpenAIService();
      }

      // If OpenAI is not available, try Ollama
      try {
        const ollamaService = await this.getOllamaService();
        return ollamaService;
      } catch (error) {
        // If all fail, throw an error
        throw new Error('No LLM provider available. Please set up ANTHROPIC_API_KEY, OPENAI_API_KEY, or make sure Ollama is running.');
      }
    } catch (error) {
      console.error(pc.red('Error getting LLM service:'), error);
      throw error;
    }
  }

  // Get the Anthropic service
  private static async getAnthropicService(): Promise<AnthropicService> {
    if (!this.anthropicInstance) {
      const model = (await config.get('anthropicModel') as string) || 'claude-3-sonnet-20240229';
      this.anthropicInstance = new AnthropicService(model);
    }
    return this.anthropicInstance;
  }

  // Get the OpenAI service
  private static async getOpenAIService(): Promise<OpenAIService> {
    if (!this.openaiInstance) {
      const model = (await config.get('openaiModel') as string) || 'gpt-4o';
      this.openaiInstance = new OpenAIService(model);
    }
    return this.openaiInstance;
  }

  // Get the Ollama service
  private static async getOllamaService(): Promise<OllamaService> {
    if (!this.ollamaInstance) {
      const baseUrl = await config.get('ollamaBaseUrl') as string || 'http://localhost:11434';
      const model = await config.get('ollamaModel') as string || 'llama3';
      this.ollamaInstance = new OllamaService(baseUrl, model);
      
      // Verify Ollama is available
      const isAvailable = await this.ollamaInstance.isAvailable();
      if (!isAvailable) {
        this.ollamaInstance = null;
        throw new Error('Ollama service is not available. Make sure Ollama is running and accessible.');
      }
    }
    return this.ollamaInstance;
  }

  // Set the preferred LLM provider
  static async setPreferredLLMProvider(provider: LLMProvider): Promise<void> {
    await config.set('llmProvider', provider);
    
    // Reset instances to force recreation next time they're requested
    this.anthropicInstance = null;
    this.ollamaInstance = null;
    this.openaiInstance = null;
  }

  // Set Ollama configuration
  static async configureOllama(baseUrl: string, model: string): Promise<void> {
    await config.set('ollamaBaseUrl', baseUrl);
    await config.set('ollamaModel', model);
    
    // Reset Ollama instance to force recreation with new configuration
    this.ollamaInstance = null;
  }

  // Set OpenAI configuration
  static async configureOpenAI(model: string): Promise<void> {
    await config.set('openaiModel', model);
    
    // Reset OpenAI instance to force recreation with new configuration
    this.openaiInstance = null;
  }

  // Set Anthropic configuration
  static async configureAnthropic(model: string): Promise<void> {
    await config.set('anthropicModel', model);
    
    // Reset Anthropic instance to force recreation with new configuration
    this.anthropicInstance = null;
  }
} 