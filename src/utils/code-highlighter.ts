import { highlight, JsonTheme, fromJson } from 'cli-highlight';
import fs from 'fs/promises';
import path from 'path';

/**
 * Highlights code with language-specific syntax
 * @param code The code to highlight
 * @param language The programming language (optional, auto-detected if not provided)
 * @returns The highlighted code string
 */
export function highlightCode(code: string, language?: string): string {
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
        return `\x1b[90m${line}\x1b[0m`; // Gray for comments
      } 
      // Diagram types
      else if (line.match(/^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|gantt|pie|journey|erDiagram|gitGraph|timeline)/i)) {
        return `\x1b[36;1m${line}\x1b[0m`; // Bright cyan for diagram types
      } 
      // Keywords
      else if (/\b(subgraph|end|participant|actor|note|loop|alt|opt|else)\b/i.test(line)) {
        return line.replace(/\b(subgraph|end|participant|actor|note|loop|alt|opt|else)\b/gi, match => 
          `\x1b[34;1m${match}\x1b[0m`); // Bright blue for keywords
      } 
      // Connections and arrows
      else if (line.includes('-->') || line.includes('==>') || line.includes('---|') || 
               line.includes('-.-') || line.includes('===') || line.includes('---') ||
               line.includes('-.->') || line.includes('===>') || line.includes('<-->')) {
        return line.replace(/(-->|==>|---\||---|-\.->|===>|<-->|\.\.\.>)/g, match => 
          `\x1b[34m${match}\x1b[0m`); // Blue for connections
      } 
      // Labels and nodes
      else if (line.match(/\[.+?\]/)) {
        return line.replace(/(\[.+?\])/g, match => 
          `\x1b[33m${match}\x1b[0m`); // Yellow for labels
      }
      // Strings
      else if (line.match(/"[^"]*"/)) {
        return line.replace(/"([^"]*)"/g, (_, match) => 
          `\x1b[32m"${match}"\x1b[0m`); // Green for strings
      } 
      else {
        return line; // Default coloring
      }
    }).join('\n');
  }

  // Use the cli-highlight library for other languages
  try {
    return highlight(code, {
      language,
      ignoreIllegals: true,
      theme: fromJson(jsonTheme)
    });
  } catch (error) {
    // If highlighting fails, return the original code without formatting
    return code;
  }
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