import pc from 'picocolors';
import { AnthropicService } from './anthropic.js';
import { OllamaService } from './ollama.js';
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
  OLLAMA = 'ollama'
}

export class LLMServiceFactory {
  private static anthropicInstance: AnthropicService | null = null;
  private static ollamaInstance: OllamaService | null = null;

  // Get the LLM service based on configuration or environment
  static async getLLMService(): Promise<LLMService> {
    try {
      // First check if user has configured a preferred provider
      const provider = await config.get('llmProvider') as LLMProvider | undefined;

      // If Ollama is preferred and available, use it
      if (provider === LLMProvider.OLLAMA) {
        return await this.getOllamaService();
      }

      // If Anthropic is preferred and available, use it
      if (provider === LLMProvider.ANTHROPIC) {
        return this.getAnthropicService();
      }

      // If no preference, try Anthropic first (as it was the original implementation)
      if (process.env.ANTHROPIC_API_KEY) {
        return this.getAnthropicService();
      }

      // If Anthropic is not available, try Ollama
      try {
        const ollamaService = await this.getOllamaService();
        return ollamaService;
      } catch (error) {
        // If both fail, throw an error
        throw new Error('No LLM provider available. Please set up either ANTHROPIC_API_KEY or make sure Ollama is running.');
      }
    } catch (error) {
      console.error(pc.red('Error getting LLM service:'), error);
      throw error;
    }
  }

  // Get the Anthropic service
  private static getAnthropicService(): AnthropicService {
    if (!this.anthropicInstance) {
      this.anthropicInstance = new AnthropicService();
    }
    return this.anthropicInstance;
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
  }

  // Set Ollama configuration
  static async configureOllama(baseUrl: string, model: string): Promise<void> {
    await config.set('ollamaBaseUrl', baseUrl);
    await config.set('ollamaModel', model);
    
    // Reset Ollama instance to force recreation with new configuration
    this.ollamaInstance = null;
  }
} 