import { highlight, JsonTheme, fromJson } from 'cli-highlight';
import fs from 'fs/promises';
import path from 'path';
import pc from 'picocolors';

/**
 * Direct syntax highlighting using picocolors
 * This is a simpler but more reliable approach for terminal output
 */
export function directHighlight(code: string, language?: string): string {
  if (!code || typeof code !== 'string') return '';
  
  const lines = code.split('\n');
  
  // Process line by line for better control
  return lines.map(line => {
    // Skip empty lines
    if (!line.trim()) return line;
    
    // Comments
    if (line.trim().startsWith('//') || line.trim().startsWith('#')) {
      return pc.gray(line);
    }
    
    // Multi-line comments
    if (line.trim().startsWith('/*') || line.trim().startsWith('"""') || line.trim().startsWith("'''")) {
      return pc.gray(line);
    }
    
    // Define keywords by language
    const jsKeywords = ['function', 'const', 'let', 'var', 'if', 'else', 'for', 'while', 'return', 
                       'class', 'import', 'export', 'from', 'try', 'catch', 'async', 'await'];
    const pyKeywords = ['def', 'class', 'if', 'elif', 'else', 'for', 'while', 'return', 'import', 
                        'from', 'try', 'except', 'with', 'as', 'lambda', 'pass', 'raise'];
    const goKeywords = ['func', 'type', 'struct', 'interface', 'package', 'import', 'var', 'const',
                        'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'return', 'map',
                        'chan', 'go', 'defer', 'select'];
    
    // Choose keywords based on language, or use all if language not specified
    let keywords: string[] = [];
    if (language === 'javascript' || language === 'typescript' || language === 'js' || language === 'ts') {
      keywords = jsKeywords;
    } else if (language === 'python' || language === 'py') {
      keywords = pyKeywords;
    } else if (language === 'go' || language === 'golang') {
      keywords = goKeywords;
    } else {
      keywords = [...jsKeywords, ...pyKeywords, ...goKeywords];
    }
    
    // Prepare the line for highlighting
    type PartType = 'keyword' | 'string' | 'number' | 'function' | 'comment' | 'plain';
    
    interface CodePart {
      text: string;
      type: PartType;
    }
    
    let parts: CodePart[] = [{
      text: line,
      type: 'plain'
    }];
    
    // Helper to apply text highlighting based on part types
    const applyHighlighting = (parts: CodePart[]): string => {
      return parts.map(part => {
        switch(part.type) {
          case 'keyword': return pc.blue(part.text);
          case 'string': return pc.green(part.text);
          case 'number': return pc.yellow(part.text);
          case 'function': return pc.magenta(part.text);
          case 'comment': return pc.gray(part.text);
          default: return part.text;
        }
      }).join('');
    };
    
    // If there's a comment in the line, split and handle it separately
    const commentIndex = line.indexOf('//');
    if (commentIndex >= 0) {
      parts = [
        { text: line.substring(0, commentIndex), type: 'plain' },
        { text: line.substring(commentIndex), type: 'comment' }
      ];
    }
    
    // Process each part that's not a comment
    parts = parts.flatMap(part => {
      if (part.type === 'comment') return [part];
      
      let result: typeof parts = [part];
      
      // Process keywords
      keywords.forEach(keyword => {
        result = result.flatMap(segment => {
          if (segment.type !== 'plain') return [segment];
          
          const keywordRegex = new RegExp(`\\b(${keyword})\\b`, 'g');
          const parts: CodePart[] = [];
          let lastIndex = 0;
          let match;
          
          while ((match = keywordRegex.exec(segment.text)) !== null) {
            if (match.index > lastIndex) {
              parts.push({
                text: segment.text.substring(lastIndex, match.index),
                type: 'plain'
              });
            }
            
            parts.push({
              text: match[0],
              type: 'keyword'
            });
            
            lastIndex = match.index + match[0].length;
          }
          
          if (lastIndex < segment.text.length) {
            parts.push({
              text: segment.text.substring(lastIndex),
              type: 'plain'
            });
          }
          
          return parts.length > 0 ? parts : [segment];
        });
      });
      
      // Process strings (simple version)
      result = result.flatMap(segment => {
        if (segment.type !== 'plain') return [segment];
        
        // Match double quotes
        const stringRegex = /"([^"\\]*(\\.[^"\\]*)*)"/g;
        const parts: CodePart[] = [];
        let lastIndex = 0;
        let match;
        
        while ((match = stringRegex.exec(segment.text)) !== null) {
          if (match.index > lastIndex) {
            parts.push({
              text: segment.text.substring(lastIndex, match.index),
              type: 'plain'
            });
          }
          
          parts.push({
            text: match[0],
            type: 'string'
          });
          
          lastIndex = match.index + match[0].length;
        }
        
        if (lastIndex < segment.text.length) {
          parts.push({
            text: segment.text.substring(lastIndex),
            type: 'plain'
          });
        }
        
        return parts.length > 0 ? parts : [segment];
      });
      
      // Process numbers
      result = result.flatMap(segment => {
        if (segment.type !== 'plain') return [segment];
        
        const numberRegex = /\b\d+(\.\d+)?\b/g;
        const parts: CodePart[] = [];
        let lastIndex = 0;
        let match;
        
        while ((match = numberRegex.exec(segment.text)) !== null) {
          if (match.index > lastIndex) {
            parts.push({
              text: segment.text.substring(lastIndex, match.index),
              type: 'plain'
            });
          }
          
          parts.push({
            text: match[0],
            type: 'number'
          });
          
          lastIndex = match.index + match[0].length;
        }
        
        if (lastIndex < segment.text.length) {
          parts.push({
            text: segment.text.substring(lastIndex),
            type: 'plain'
          });
        }
        
        return parts.length > 0 ? parts : [segment];
      });
      
      // Process function calls
      result = result.flatMap(segment => {
        if (segment.type !== 'plain') return [segment];
        
        const funcRegex = /\b([a-zA-Z_]\w*)\s*\(/g;
        const parts: CodePart[] = [];
        let lastIndex = 0;
        let match;
        
        while ((match = funcRegex.exec(segment.text)) !== null) {
          // Skip keywords that look like function calls
          const funcName = match[1];
          if (keywords.includes(funcName)) continue;
          
          if (match.index > lastIndex) {
            parts.push({
              text: segment.text.substring(lastIndex, match.index),
              type: 'plain'
            });
          }
          
          parts.push({
            text: funcName,
            type: 'function'
          });
          
          // Add the opening parenthesis
          parts.push({
            text: segment.text.substring(match.index + funcName.length, match.index + match[0].length),
            type: 'plain'
          });
          
          lastIndex = match.index + match[0].length;
        }
        
        if (lastIndex < segment.text.length) {
          parts.push({
            text: segment.text.substring(lastIndex),
            type: 'plain'
          });
        }
        
        return parts.length > 0 ? parts : [segment];
      });
      
      return result;
    });
    
    // Apply highlighting to all parts
    return applyHighlighting(parts);
  }).join('\n');
}

/**
 * Highlights code with language-specific syntax
 * @param code The code to highlight
 * @param language The programming language (optional, auto-detected if not provided)
 * @returns The highlighted code string
 */
export function highlightCode(code: string, language?: string): string {
  // First try our direct highlighting which works well in terminals
  try {
    return directHighlight(code, language);
  } catch (directError) {
    console.error('Direct highlighting failed, falling back to cli-highlight:', directError);
  }
  
  // Define a custom theme
  const jsonTheme: JsonTheme = {
    keyword: 'blue',
    built_in: 'cyan',
    string: 'green',
    number: 'yellow',
    function: 'magenta',
    title: ['magenta', 'bold'],
    params: 'white',
    comment: 'gray',
    tag: 'cyan',
    attr: ['cyan', 'dim'],
    default: 'white'
  };

  // Special handling for mermaid diagrams
  if (language === 'mermaid') {
    // For mermaid diagrams, we create our own syntax highlighting
    // since cli-highlight doesn't have built-in support for mermaid
    return code.split('\n').map(line => {
      // Comments
      if (line.trim().startsWith('%%')) {
        return pc.gray(line);
      } 
      // Diagram types
      else if (line.match(/^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|gantt|pie|journey|erDiagram|gitGraph|timeline)/i)) {
        return pc.cyan(pc.bold(line));
      } 
      // Keywords
      else if (/\b(subgraph|end|participant|actor|note|loop|alt|opt|else)\b/i.test(line)) {
        return line.replace(/\b(subgraph|end|participant|actor|note|loop|alt|opt|else)\b/gi, match => 
          pc.blue(pc.bold(match)));
      } 
      // Connections and arrows
      else if (line.includes('-->') || line.includes('==>') || line.includes('---|') || 
               line.includes('-.-') || line.includes('===') || line.includes('---') ||
               line.includes('-.->') || line.includes('===>') || line.includes('<-->')) {
        return line.replace(/(-->|==>|---\||---|-\.->|===>|<-->|\.\.\.>)/g, match => 
          pc.blue(match));
      } 
      // Labels and nodes
      else if (line.match(/\[.+?\]/)) {
        return line.replace(/(\[.+?\])/g, match => 
          pc.yellow(match));
      }
      // Strings
      else if (line.match(/"[^"]*"/)) {
        return line.replace(/"([^"]*)"/g, (_, match) => 
          pc.green(`"${match}"`));
      } 
      else {
        return line; // Default coloring
      }
    }).join('\n');
  }

  // Use the cli-highlight library for other languages
  try {
    // Make sure we're not trying to highlight an empty or undefined language
    const actualLanguage = (language || '').trim() || undefined;
    
    // Apply syntax highlighting without html (directly use ANSI for terminal output)
    return highlight(code, {
      language: actualLanguage,
      ignoreIllegals: true,
      theme: fromJson(jsonTheme)
    });
  } catch (error) {
    // If highlighting fails, return the original code without formatting
    console.error(`Error highlighting code with language ${language}:`, error);
    return code;
  }
}

/**
 * Enhanced version of highlightCode that strips markdown code block formatting
 * and ensures proper terminal rendering
 * @param code The code to highlight
 * @param language The programming language
 * @returns The highlighted code string for terminal display
 */
export function terminalHighlightCode(code: string, language?: string): string {
  // Remove any leading/trailing whitespace that might interfere with highlighting
  const cleanCode = code.trim();
  
  // Get the highlighted code
  const highlighted = highlightCode(cleanCode, language);
  
  // Ensure proper line breaks for terminal display
  return highlighted;
}

/**
 * Highlights code from a file with appropriate language highlighting
 * @param filePath Path to the file
 * @returns Promise resolving to highlighted code
 */
export async function highlightFile(filePath: string): Promise<string> {
  try {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const ext = path.extname(filePath).substring(1); // Remove the leading dot
    
    let language: string | undefined;
    
    // Map file extensions to languages
    const languageMap: Record<string, string> = {
      js: 'javascript',
      ts: 'typescript',
      jsx: 'javascript',
      tsx: 'typescript',
      py: 'python',
      rb: 'ruby',
      go: 'go',
      rs: 'rust',
      java: 'java',
      php: 'php',
      c: 'c',
      cpp: 'cpp',
      cs: 'csharp',
      swift: 'swift',
      kt: 'kotlin',
      sh: 'bash',
      md: 'markdown',
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
      xml: 'xml',
      html: 'html',
      css: 'css',
      scss: 'scss',
      sql: 'sql',
      graphql: 'graphql',
      mmd: 'mermaid', // Add mermaid file extension support
      // Add more mappings as needed
    };
    
    language = languageMap[ext];

    // Check for mermaid content in markdown files or codeblocks
    if (fileContent.includes('```mermaid')) {
      // Process file line by line to handle mermaid blocks
      const lines = fileContent.split('\n');
      let inMermaidBlock = false;
      let mermaidContent = '';
      let processedContent: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.trim() === '```mermaid') {
          inMermaidBlock = true;
          processedContent.push(line);
        } else if (inMermaidBlock && line.trim() === '```') {
          inMermaidBlock = false;
          if (mermaidContent.trim()) {
            // Highlight the collected mermaid content
            const highlightedMermaid = highlightCode(mermaidContent, 'mermaid');
            processedContent.push(highlightedMermaid);
          }
          processedContent.push(line);
          mermaidContent = '';
        } else if (inMermaidBlock) {
          mermaidContent += line + '\n';
        } else {
          processedContent.push(line);
        }
      }

      return processedContent.join('\n');
    }
    
    // If it's a dedicated mermaid file
    if (language === 'mermaid') {
      return highlightCode(fileContent, 'mermaid');
    }
    
    // Otherwise, highlight with detected language
    return highlightCode(fileContent, language);
  } catch (error) {
    console.error(`Error highlighting file ${filePath}:`, error);
    throw error;
  }
} 