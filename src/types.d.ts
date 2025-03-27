// Declare modules without type definitions
declare module 'fuzzy';
declare module 'ink';
declare module 'ink-spinner';
declare module 'ink-select-input';
declare module 'ink-text-input';
declare module 'fast-glob';
declare module 'picocolors';
declare module 'conf';

// Node.js modules
declare module 'fs/promises';
declare module 'path';
declare module 'fs';

declare module 'cli-highlight' {
  export type Style = 'reset' | 'bold' | 'dim' | 'italic' | 'underline' | 'inverse' | 'hidden' | 'strikethrough' | 
    'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'gray' | 
    'bgBlack' | 'bgRed' | 'bgGreen' | 'bgYellow' | 'bgBlue' | 'bgMagenta' | 'bgCyan' | 'plain';
  
  export interface Tokens<T> {
    keyword?: T;
    built_in?: T;
    type?: T;
    literal?: T;
    number?: T;
    regexp?: T;
    string?: T;
    subst?: T;
    symbol?: T;
    class?: T;
    function?: T;
    title?: T;
    params?: T;
    comment?: T;
    doctag?: T;
    meta?: T;
    'meta-keyword'?: T;
    'meta-string'?: T;
    section?: T;
    tag?: T;
    name?: T;
    'builtin-name'?: T;
    attr?: T;
    attribute?: T;
    variable?: T;
    bullet?: T;
    code?: T;
    emphasis?: T;
    strong?: T;
    formula?: T;
    link?: T;
    quote?: T;
    'selector-tag'?: T;
    'selector-id'?: T;
    'selector-class'?: T;
    'selector-attr'?: T;
    'selector-pseudo'?: T;
    'template-tag'?: T;
    'template-variable'?: T;
    addition?: T;
    deletion?: T;
    default?: T;
  }
  
  export interface JsonTheme extends Tokens<Style | Style[]> {}
  
  export interface Theme extends Tokens<(codePart: string) => string> {
    default?: (codePart: string) => string;
  }
  
  export interface HighlightOptions {
    language?: string;
    ignoreIllegals?: boolean;
    languageSubset?: string[];
    theme?: Theme | JsonTheme;
  }
  
  export function highlight(code: string, options?: HighlightOptions): string;
  export const plain: (codePart: string) => string;
  export const DEFAULT_THEME: Theme;
  export function fromJson(json: JsonTheme): Theme;
}

export interface Project {
    path: string;
    name: string;
    indexed: boolean;
    lastIndexed?: Date;
}

export interface AdistConfig {
    projects: Record<string, Project>;
    currentProject?: string;
} 