import { highlightCode, terminalHighlightCode } from './code-highlighter.js';
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
  let updatedBuffer = buffer + chunk;
  let processedChunk = chunk;
  
  // Check if we've entered or exited a code block
  const codeBlockStart = '```';
  let updatedInCodeBlock = inCodeBlock;
  
  // Count backtick markers to determine if we're in a code block
  const backtickIndices = [...updatedBuffer.matchAll(/```/g)].map(match => match.index ?? 0);
  updatedInCodeBlock = backtickIndices.length % 2 !== 0;
  
  // When we transition out of a code block, process the entire block
  if (inCodeBlock && !updatedInCodeBlock) {
    // Extract and process the completed code block
    const codeBlockRegex = /```([a-zA-Z0-9_]*)\n([\s\S]*?)```/g;
    const lastCodeBlockMatch = [...updatedBuffer.matchAll(codeBlockRegex)].pop();
    
    if (lastCodeBlockMatch) {
      const [fullMatch, language, code] = lastCodeBlockMatch;
      
      // Detect language from first line if not specified in the opening backticks
      let effectiveLanguage = language;
      if (!effectiveLanguage && code.trim()) {
        // Check first line for common language patterns
        const firstLine = code.split('\n')[0].trim();
        const secondLine = code.split('\n')[1]?.trim() || '';
        const thirdLine = code.split('\n')[2]?.trim() || '';
        
        // More comprehensive Go detection
        if (firstLine.startsWith('package ') || 
            code.includes('func ') || 
            (code.includes('type ') && code.includes('struct')) ||
            firstLine.includes('import') && (secondLine.includes('"') || thirdLine.includes('"'))) {
          effectiveLanguage = 'go';
        } else if (firstLine.includes('function ') || 
                  firstLine.includes('const ') || 
                  firstLine.includes('let ') ||
                  firstLine.includes('import ')) {
          effectiveLanguage = 'javascript';
        } else if (firstLine.startsWith('def ') || 
                  firstLine.startsWith('class ') ||
                  firstLine.startsWith('import ')) {
          effectiveLanguage = 'python';
        }
      }
      
      // Apply syntax highlighting with our enhanced terminal highlighter
      const highlightedCode = terminalHighlightCode(code, effectiveLanguage || undefined);
      
      // Replace the code block in the buffer with the highlighted version
      const startIndex = updatedBuffer.lastIndexOf(fullMatch);
      const beforeBlock = updatedBuffer.substring(0, startIndex);
      const afterBlock = updatedBuffer.substring(startIndex + fullMatch.length);
      
      // Format for terminal display with enhanced styling
      const formattedBlock = '\n' + pc.dim('```' + (effectiveLanguage || '')) + '\n' + 
                            highlightedCode + 
                            '\n' + pc.dim('```') + '\n';
      
      // Update the buffer with the highlighted code
      updatedBuffer = beforeBlock + formattedBlock + afterBlock;
      
      // Calculate which part of the formatted block should be in the current chunk output
      const chunkStartInBuffer = buffer.length;
      const chunkEndInBuffer = buffer.length + chunk.length;
      
      // Extract the portion of the buffer that corresponds to the current chunk
      processedChunk = updatedBuffer.substring(chunkStartInBuffer, chunkEndInBuffer);
      
      return {
        processedChunk,
        updatedBuffer,
        updatedInCodeBlock: false
      };
    }
  }
  
  // Handle partial code blocks during streaming
  if (updatedInCodeBlock) {
    // Inside a code block, just preserve the content for later processing
    return {
      processedChunk,
      updatedBuffer,
      updatedInCodeBlock
    };
  }
  
  // If we're not in a code block, apply markdown formatting as usual
  if (!inCodeBlock && !updatedInCodeBlock) {
    // Apply line-based markdown formatting for more reliable streaming
    const lines = processedChunk.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      
      // Skip empty lines or lines that might be part of code blocks
      if (!line.trim() || line.trim().startsWith('```')) continue;
      
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
      // If language isn't specified, try to detect it from the content
      let effectiveLanguage = segment.language;
      if (!effectiveLanguage && segment.content.trim()) {
        // Check content patterns to detect common languages
        const firstLine = segment.content.split('\n')[0].trim();
        
        if (firstLine.startsWith('package ') || 
            segment.content.includes('func ') || 
            (segment.content.includes('type ') && segment.content.includes('struct'))) {
          effectiveLanguage = 'go';
        } else if (firstLine.includes('function ') || 
                  firstLine.includes('const ') || 
                  firstLine.includes('let ') ||
                  firstLine.includes('import ')) {
          effectiveLanguage = 'javascript';
        } else if (firstLine.startsWith('def ') || 
                  firstLine.startsWith('class ') ||
                  firstLine.startsWith('import ')) {
          effectiveLanguage = 'python';
        }
      }
      
      // Format code with proper syntax highlighting for terminal display
      // Use our direct highlighter for more reliable terminal output
      const highlightedCode = terminalHighlightCode(segment.content, effectiveLanguage);
      
      // Clearly mark code blocks with styled delimiters for better visibility
      const language = effectiveLanguage || segment.language || '';
      return '\n' + pc.dim('```' + language) + '\n' + 
             highlightedCode + 
             '\n' + pc.dim('```') + '\n';
    } else {
      // Format text with markdown styles
      let text = segment.content;
      
      // Process text line by line for better handling of headers and lists
      const lines = text.split('\n');
      const formattedLines = lines.map(line => {
        // Skip empty lines
        if (!line.trim()) return line;
        
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