import { highlightCode } from './code-highlighter.js';

/**
 * Parses a message and applies syntax highlighting to code blocks
 * @param message The message text to parse
 * @returns The message with syntax highlighted code blocks
 */
export function parseMessageWithCodeHighlighting(message: string): string {
  // Regex to match code blocks with optional language specification
  // Format: ```language\ncode\n```
  const codeBlockRegex = /```([a-zA-Z0-9_]*)\n([\s\S]*?)```/g;
  
  return message.replace(codeBlockRegex, (match, language, code) => {
    // Apply syntax highlighting to the code block
    const highlightedCode = highlightCode(code, language || undefined);
    
    // Return the highlighted code wrapped in the original markdown format
    return '```' + (language ? language + '\n' : '\n') + highlightedCode + '```';
  });
}

/**
 * Processes a streaming chunk to handle partial code blocks
 * @param chunk Current text chunk
 * @param buffer Accumulated text buffer
 * @param inCodeBlock Whether we're currently inside a code block
 * @returns Processed chunk and updated state
 */
export function processStreamingChunk(
  chunk: string, 
  buffer: string, 
  inCodeBlock: boolean
): { 
  processedChunk: string, 
  updatedBuffer: string, 
  updatedInCodeBlock: boolean 
} {
  // Add current chunk to buffer
  const updatedBuffer = buffer + chunk;
  let updatedInCodeBlock = inCodeBlock;
  let processedChunk = chunk;
  
  // Check for code block markers
  const backtickCount = (chunk.match(/```/g) || []).length;
  
  // If we're toggling code block state
  if (backtickCount % 2 !== 0) {
    updatedInCodeBlock = !inCodeBlock;
  }
  
  // If we've completed a code block, process the entire block
  if (inCodeBlock && !updatedInCodeBlock) {
    // Extract the completed code block from the buffer
    const codeBlockRegex = /```([a-zA-Z0-9_]*)\n([\s\S]*?)```/g;
    const lastCodeBlockMatch = [...updatedBuffer.matchAll(codeBlockRegex)].pop();
    
    if (lastCodeBlockMatch) {
      const [fullMatch, language, code] = lastCodeBlockMatch;
      const highlightedCode = highlightCode(code, language || undefined);
      
      // Replace the code block in the buffer with the highlighted version
      const highlightedBlock = '```' + (language ? language + '\n' : '\n') + highlightedCode + '```';
      const startIndex = updatedBuffer.lastIndexOf(fullMatch);
      const beforeBlock = updatedBuffer.substring(0, startIndex);
      const afterBlock = updatedBuffer.substring(startIndex + fullMatch.length);
      
      // Update the buffer with the highlighted code
      const newBuffer = beforeBlock + highlightedBlock + afterBlock;
      
      // Replace the chunk with the highlighted portion
      processedChunk = chunk.replace(code, highlightedCode);
      
      return {
        processedChunk,
        updatedBuffer: newBuffer,
        updatedInCodeBlock: false
      };
    }
  }
  
  return {
    processedChunk,
    updatedBuffer,
    updatedInCodeBlock
  };
} 