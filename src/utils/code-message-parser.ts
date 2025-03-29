import { highlightCode } from './code-highlighter.js';
import pc from 'picocolors';

/**
 * Escapes regex special characters in a string
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
 * Parses a message and applies syntax highlighting to both code blocks and markdown formatting
 * @param message The message text to parse
 * @returns The message with syntax highlighted code blocks and markdown
 */
export function parseMessageWithMarkdownHighlighting(message: string): string {
  // First highlight code blocks
  let result = parseMessageWithCodeHighlighting(message);
  
  // Store code blocks to prevent markdown highlighting inside them
  const codeBlocks: string[] = [];
  let codeBlockCounter = 0;
  
  // Replace code blocks with placeholders
  result = result.replace(/```[\s\S]*?```/g, (match) => {
    const placeholder = `___CODE_BLOCK_${codeBlockCounter}___`;
    codeBlocks.push(match);
    codeBlockCounter++;
    return placeholder;
  });
  
  // Apply markdown formatting
  
  // Bold text
  result = result.replace(/\*\*([^*]+)\*\*/g, (_, text) => pc.bold(text));
  
  // Italic text
  result = result.replace(/\*([^*]+)\*/g, (_, text) => pc.italic(text));
  
  // Inline code
  result = result.replace(/`([^`]+)`/g, (_, text) => pc.cyan(text));
  
  // Headers (h1-h3)
  result = result.replace(/^### (.*)$/gm, (_, text) => pc.bold(pc.cyan(text)));
  result = result.replace(/^## (.*)$/gm, (_, text) => pc.bold(pc.cyan(text)));
  result = result.replace(/^# (.*)$/gm, (_, text) => pc.bold(pc.cyan(text)));
  
  // Lists (unordered)
  result = result.replace(/^(\s*)[-*+] (.*)$/gm, (_, space, text) => 
    `${space}${pc.yellow('•')} ${text}`);
  
  // Lists (ordered)
  result = result.replace(/^(\s*)(\d+\.) (.*)$/gm, (_, space, num, text) => 
    `${space}${pc.yellow(num)} ${text}`);
  
  // Restore code blocks
  codeBlocks.forEach((block, index) => {
    const placeholder = `___CODE_BLOCK_${index}___`;
    result = result.replace(placeholder, block);
  });
  
  return result;
}

/**
 * Processes a streaming chunk to handle partial code blocks and markdown
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
  
  // If we're not in a code block, apply markdown highlighting
  if (!inCodeBlock && !updatedInCodeBlock) {
    // Apply line-based markdown formatting for easier chunking
    const lines = processedChunk.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      
      // Bold text
      line = line.replace(/\*\*([^*]+)\*\*/g, (_, text) => pc.bold(text));
      
      // Italic text 
      line = line.replace(/\*([^*]+)\*/g, (_, text) => pc.italic(text));
      
      // Inline code
      line = line.replace(/`([^`]+)`/g, (_, text) => pc.cyan(text));
      
      // Headers (h1-h3) - only apply if at the start of a line
      if (line.match(/^### /)) {
        line = line.replace(/^### (.*)$/, (_, text) => pc.bold(pc.cyan(text)));
      } else if (line.match(/^## /)) {
        line = line.replace(/^## (.*)$/, (_, text) => pc.bold(pc.cyan(text)));
      } else if (line.match(/^# /)) {
        line = line.replace(/^# (.*)$/, (_, text) => pc.bold(pc.cyan(text)));
      }
      
      // Lists (unordered)
      line = line.replace(/^(\s*)[-*+] (.*)$/, (_, space, text) => 
        `${space}${pc.yellow('•')} ${text}`);
      
      // Lists (ordered)
      line = line.replace(/^(\s*)(\d+\.) (.*)$/, (_, space, num, text) => 
        `${space}${pc.yellow(num)} ${text}`);
      
      lines[i] = line;
    }
    
    processedChunk = lines.join('\n');
  }
  
  return {
    processedChunk,
    updatedBuffer,
    updatedInCodeBlock
  };
}

/**
 * Formats a full markdown document for terminal display
 * This handles special cases like headings, lists, and code blocks more robustly
 * @param markdown The markdown document to format
 * @returns Formatted document for terminal display
 */
export function formatMarkdownDocument(markdown: string): string {
  // First, split the document into segments (code blocks and text)
  const segments: { type: 'code' | 'text'; content: string; language?: string }[] = [];
  
  // Extract code blocks first
  let remaining = markdown;
  const codeBlockRegex = /```([a-zA-Z0-9_]*)\n([\s\S]*?)```/g;
  let match;
  let lastIndex = 0;
  
  while ((match = codeBlockRegex.exec(remaining)) !== null) {
    // Add text before this code block
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        content: remaining.substring(lastIndex, match.index)
      });
    }
    
    // Add the code block
    segments.push({
      type: 'code',
      content: match[2],
      language: match[1] || undefined
    });
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text after the last code block
  if (lastIndex < remaining.length) {
    segments.push({
      type: 'text',
      content: remaining.substring(lastIndex)
    });
  }
  
  // Now format each segment appropriately
  const formattedSegments = segments.map(segment => {
    if (segment.type === 'code') {
      return '```' + (segment.language ? segment.language + '\n' : '\n') + 
             highlightCode(segment.content, segment.language) + 
             '```';
    } else {
      // Format text with markdown styles
      let text = segment.content;
      
      // Process text line by line for better handling of headers and lists
      const lines = text.split('\n');
      const formattedLines = lines.map(line => {
        // Bold text
        line = line.replace(/\*\*([^*]+)\*\*/g, (_, content) => pc.bold(content));
        
        // Italic text
        line = line.replace(/\*([^*]+)\*/g, (_, content) => pc.italic(content));
        
        // Inline code
        line = line.replace(/`([^`]+)`/g, (_, content) => pc.cyan(content));
        
        // Headers
        if (line.startsWith('# ')) {
          return pc.bold(pc.cyan(line.substring(2)));
        } else if (line.startsWith('## ')) {
          return pc.bold(pc.cyan(line.substring(3)));
        } else if (line.startsWith('### ')) {
          return pc.bold(pc.cyan(line.substring(4)));
        }
        
        // Unordered lists
        const unorderedListMatch = line.match(/^(\s*)[-*+] (.*)$/);
        if (unorderedListMatch) {
          const [_, space, content] = unorderedListMatch;
          return `${space}${pc.yellow('•')} ${content}`;
        }
        
        // Ordered lists
        const orderedListMatch = line.match(/^(\s*)(\d+\.) (.*)$/);
        if (orderedListMatch) {
          const [_, space, num, content] = orderedListMatch;
          return `${space}${pc.yellow(num)} ${content}`;
        }
        
        return line;
      });
      
      return formattedLines.join('\n');
    }
  });
  
  return formattedSegments.join('');
} 