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

  return highlight(code, {
    language,
    ignoreIllegals: true,
    theme: fromJson(jsonTheme)
  });
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
      // Add more mappings as needed
    };
    
    language = languageMap[ext];
    
    return highlightCode(fileContent, language);
  } catch (error) {
    console.error(`Error highlighting file ${filePath}:`, error);
    throw error;
  }
} 