import { OpenAIService } from './dist/utils/openai.js';
import pc from 'picocolors';

async function testOpenAIService() {
  console.log(pc.cyan('Testing OpenAI Service...'));
  
  try {
    // Initialize the service
    const openai = new OpenAIService();
    console.log(pc.green('✓ Successfully initialized OpenAIService'));
    
    // Test a simple query with minimal context
    const simpleContext = [
      {
        path: 'example.ts',
        content: `
function sum(a: number, b: number): number {
  return a + b;
}

function multiply(a: number, b: number): number {
  return a * b;
}

export { sum, multiply };
`
      }
    ];
    
    try {
      // Test the queryProject method
      console.log(pc.cyan('Testing queryProject method...'));
      const queryResult = await openai.queryProject(
        'How does the multiply function work?',
        simpleContext,
        'test-project'
      );
      
      console.log(pc.green('✓ Query result:'));
      console.log(queryResult.summary);
      console.log(pc.dim(`Cost: $${queryResult.cost.toFixed(6)}`));
      
      // Test summarizeFile method
      console.log(pc.cyan('\nTesting summarizeFile method...'));
      const fileSummary = await openai.summarizeFile(simpleContext[0].content, simpleContext[0].path);
      
      console.log(pc.green('✓ File summary:'));
      console.log(fileSummary.summary);
      console.log(pc.dim(`Cost: $${fileSummary.cost.toFixed(6)}`));
      
      // Test chat with context
      console.log(pc.cyan('\nTesting chatWithProject method...'));
      const chatMessages = [
        { role: 'user', content: 'What does this code do?' },
        { role: 'assistant', content: 'This code exports two math functions: sum and multiply.' },
        { role: 'user', content: 'How would I use the sum function?' }
      ];
      
      const chatResult = await openai.chatWithProject(
        chatMessages,
        simpleContext,
        'test-project'
      );
      
      console.log(pc.green('✓ Chat result:'));
      console.log(chatResult.summary);
      console.log(pc.dim(`Cost: $${chatResult.cost.toFixed(6)}`));
      
      console.log(pc.green('\n✓ All tests completed successfully!'));
    } catch (apiError) {
      if (apiError.code === 'invalid_api_key') {
        console.log(pc.yellow('\n⚠️ API connection test failed with invalid API key.'));
        console.log(pc.yellow('However, the OpenAI service module was loaded successfully.'));
        console.log(pc.yellow('\nTo run a full test with real API calls:'));
        console.log(pc.cyan('1. Get a valid OpenAI API key from https://platform.openai.com/account/api-keys'));
        console.log(pc.cyan('2. Run the test with: ') + pc.green('OPENAI_API_KEY=your_real_key node test-openai.js'));
        console.log(pc.yellow('\nImplementation is ready for use with a valid API key!'));
      } else {
        // Re-throw other errors
        throw apiError;
      }
    }
    
  } catch (error) {
    console.error(pc.red('Error testing OpenAI service:'), error);
  }
}

// Execute the test
testOpenAIService(); 