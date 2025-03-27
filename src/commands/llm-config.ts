import pc from 'picocolors';
import { Command } from 'commander';
import inquirer from 'inquirer';
import { LLMProvider, LLMServiceFactory } from '../utils/llm-service.js';
import { OllamaService } from '../utils/ollama.js';

// Command to configure LLM settings
export const llmConfigCommand = new Command('llm-config')
  .description('Configure LLM provider settings (Anthropic or Ollama)')
  .action(async () => {
    try {
      // Ask user to select a provider
      const { provider } = await inquirer.prompt([
        {
          type: 'list',
          name: 'provider',
          message: 'Select LLM provider:',
          choices: [
            { name: 'Anthropic Claude (requires API key)', value: LLMProvider.ANTHROPIC },
            { name: 'Ollama (run locally)', value: LLMProvider.OLLAMA }
          ]
        }
      ]);

      if (provider === LLMProvider.ANTHROPIC) {
        // Check if API key is set
        if (!process.env.ANTHROPIC_API_KEY) {
          console.log(pc.yellow('⚠️ ANTHROPIC_API_KEY environment variable is not set.'));
          console.log(pc.dim('Please set this environment variable to use Anthropic Claude.'));
          console.log(pc.dim('Example: export ANTHROPIC_API_KEY=your-api-key'));
          return;
        }

        // Set Anthropic as preferred provider
        await LLMServiceFactory.setPreferredLLMProvider(LLMProvider.ANTHROPIC);
        console.log(pc.green('✓ Anthropic Claude configured as LLM provider.'));
      } else if (provider === LLMProvider.OLLAMA) {
        // Try to check if Ollama is running
        const tempOllama = new OllamaService();
        const isOllamaAvailable = await tempOllama.isAvailable();

        if (!isOllamaAvailable) {
          console.log(pc.yellow('⚠️ Ollama service is not available.'));
          console.log(pc.dim('Make sure Ollama is running and accessible.'));
          console.log(pc.dim('Installation instructions: https://ollama.com/download'));
          
          // Ask if user wants to continue with configuration
          const { continueConfig } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'continueConfig',
              message: 'Do you want to configure Ollama settings anyway?',
              default: false
            }
          ]);
          
          if (!continueConfig) {
            return;
          }
        }

        // Ask for Ollama configuration
        const { baseUrl, customModel } = await inquirer.prompt([
          {
            type: 'input',
            name: 'baseUrl',
            message: 'Ollama API URL:',
            default: 'http://localhost:11434'
          },
          {
            type: 'confirm',
            name: 'customModel',
            message: 'Do you want to select a specific model?',
            default: true
          }
        ]);

        let model = 'llama3'; // Default model

        if (customModel) {
          let availableModels: string[] = [];
          
          try {
            // Try to get list of available models
            const tempOllama = new OllamaService(baseUrl);
            availableModels = await tempOllama.listModels();
          } catch (error) {
            console.log(pc.yellow('⚠️ Could not retrieve available models from Ollama.'));
          }

          // If we couldn't get models or none are available, ask user to input manually
          if (availableModels.length === 0) {
            const { manualModel } = await inquirer.prompt([
              {
                type: 'input',
                name: 'manualModel',
                message: 'Model name (e.g., llama3, mistral, etc.):',
                default: 'llama3'
              }
            ]);
            model = manualModel;
          } else {
            // Let user select from available models
            const { selectedModel } = await inquirer.prompt([
              {
                type: 'list',
                name: 'selectedModel',
                message: 'Select a model:',
                choices: availableModels
              }
            ]);
            model = selectedModel;
          }
        }

        // Configure Ollama
        await LLMServiceFactory.configureOllama(baseUrl, model);
        
        // Set Ollama as preferred provider
        await LLMServiceFactory.setPreferredLLMProvider(LLMProvider.OLLAMA);
        
        console.log(pc.green(`✓ Ollama configured as LLM provider.`));
        console.log(pc.green(`  URL: ${baseUrl}`));
        console.log(pc.green(`  Model: ${model}`));
      }
    } catch (error) {
      console.error(pc.red('Error configuring LLM provider:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }); 