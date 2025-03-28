import fs from 'fs/promises';
import path from 'path';
import fastGlob from 'fast-glob';
import pc from 'picocolors';
import { SingleBar, Presets } from 'cli-progress';
import { ParserRegistry } from './parsers/parser-registry.js';
import { DocumentBlock, IndexedDocument, SearchResult } from '../types.js';
import config from '../config.js';
import { LLMServiceFactory } from './llm-service.js';

export interface BlockIndexOptions {
  withSummaries?: boolean;
  includePatterns?: string[];
  excludePatterns?: string[];
  verbose?: boolean;
}

/**
 * BlockIndexer - Indexes files into a hierarchical block structure
 */
export class BlockIndexer {
  private parserRegistry: ParserRegistry;

  constructor() {
    this.parserRegistry = new ParserRegistry();
  }

  /**
   * Index a project, parsing all files into blocks
   */
  async indexProject(projectId: string, options: BlockIndexOptions = {}): Promise<void> {
    try {
      console.log(pc.cyan('🔍 Indexing project...'));

      // Get project from config
      const projects = await config.get('projects') as Record<string, any>;
      const project = projects[projectId];

      if (!project) {
        throw new Error(`Project with ID ${projectId} not found`);
      }

      // Check if an LLM provider is available when summarization is requested
      if (options.withSummaries) {
        try {
          // This will throw if no LLM provider is available
          await LLMServiceFactory.getLLMService();
          if (options.verbose) console.log(pc.dim('LLM service successfully loaded for summarization.'));
        } catch (error) {
          console.error(pc.red('LLM service failed to load:'), error);
          throw new Error('No LLM provider available. Please configure an LLM provider using "adist llm-config"');
        }
      }

      // Set up default include/exclude patterns
      const includePatterns = options.includePatterns || [
        '**/*.{js,jsx,ts,tsx,md,markdown,json,yaml,yml,toml}'
      ];
      
      const excludePatterns = options.excludePatterns || [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/.git/**',
        '**/coverage/**',
        '**/*.min.*'
      ];

      // Get all files matching the patterns
      const files = await fastGlob(includePatterns, {
        cwd: project.path,
        absolute: true,
        ignore: excludePatterns
      });

      if (files.length === 0) {
        console.log(pc.yellow('⚠️ No files found to index. Check your include/exclude patterns.'));
        return;
      }

      console.log(pc.cyan(`Found ${files.length} files to index.`));

      // Set up progress bar
      const progressBar = new SingleBar({
        format: '{bar} {percentage}% | ETA: {eta}s | {value}/{total} files | {file}',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true
      }, Presets.shades_classic);

      progressBar.start(files.length, 0, { file: 'Starting...' });

      // Index all documents
      const indexedDocuments: IndexedDocument[] = [];

      // Get the LLM service if summarization is requested
      const llmService = options.withSummaries ? await LLMServiceFactory.getLLMService() : null;
      const fileSummaries: { path: string; summary: string }[] = [];

      if (options.withSummaries && llmService && options.verbose) {
        console.log(pc.dim('LLM service configured for summarization. Will summarize files.'));
      }

      for (const file of files) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          const relativePath = path.relative(project.path, file);
          const stats = await fs.stat(file);

          // Parse document into blocks
          const document = await this.parserRegistry.parse(relativePath, content, {
            size: stats.size,
            mtime: stats.mtime
          });

          // Generate summaries if requested
          if (options.withSummaries && llmService && document) {
            try {
              if (options.verbose) console.log(pc.dim(`Generating summary for ${relativePath}...`));
              // First generate a file-level summary
              const result = await llmService.summarizeFile(content, relativePath);
              if (options.verbose) console.log(pc.dim(`Summary generated: ${result.summary.substring(0, 50)}...`));
              const summary = result.summary;
              fileSummaries.push({ path: relativePath, summary });
              
              // Find the document-level block and add the summary
              let foundDocumentBlock = false;
              for (const block of document.blocks) {
                if (block.type === 'document') {
                  block.summary = summary;
                  foundDocumentBlock = true;
                  break;
                }
              }
              
              if (!foundDocumentBlock && options.verbose) {
                console.log(pc.yellow(`No document block found for ${relativePath}. Creating one.`));
                // Create a document block if none exists
                const docBlock: DocumentBlock = {
                  id: `doc-${relativePath}`,
                  type: 'document',
                  content: content,
                  startLine: 1,
                  endLine: content.split('\n').length,
                  path: relativePath,
                  title: path.basename(relativePath),
                  summary: summary
                };
                document.blocks.unshift(docBlock);
              }
            } catch (error) {
              console.error(pc.red(`Error summarizing file ${relativePath}:`), error);
            }
          }

          if (document) {
            indexedDocuments.push(document);
          }

          progressBar.increment(1, { file: relativePath });
        } catch (error) {
          console.error(pc.red(`Error processing file ${file}:`), error);
          progressBar.increment(1, { file: 'Error: ' + path.relative(project.path, file) });
        }
      }

      progressBar.stop();

      // Generate overall summary if requested
      if (options.withSummaries && llmService && fileSummaries.length > 0) {
        if (options.verbose) console.log(pc.dim(`Generating overall project summary from ${fileSummaries.length} file summaries...`));
        try {
          const result = await llmService.generateOverallSummary(fileSummaries);
          if (options.verbose) console.log(pc.dim(`Overall summary generated: ${result.summary.substring(0, 50)}...`));
          await config.set(`summaries.${projectId}.overall`, result.summary);
          if (options.verbose) console.log(pc.green('✓ Project summary saved'));
        } catch (error) {
          console.error(pc.red('Error generating overall summary:'), error);
        }
      }

      // Store the indexed documents
      await config.set(`block-indexes.${projectId}`, indexedDocuments);

      // Update project status
      project.indexed = true;
      project.lastIndexed = new Date();
      project.hasSummaries = options.withSummaries;
      await config.set(`projects.${projectId}`, project);

      console.log(pc.green('✓ Project indexed successfully!'));
      console.log(pc.dim('Run adist get "<query>" to search for documents.'));
    } catch (error) {
      console.error(pc.red('Error indexing project:'), error);
      throw error;
    }
  }

  /**
   * Index the current project
   */
  async indexCurrentProject(options: BlockIndexOptions = {}): Promise<void> {
    try {
      const currentProjectId = await config.get('currentProject') as string;
      if (!currentProjectId) {
        throw new Error('No project is currently selected');
      }

      await this.indexProject(currentProjectId, options);
    } catch (error) {
      console.error(pc.red('Error indexing current project:'), error);
      throw error;
    }
  }
}

/**
 * Block-based search engine
 */
export class BlockSearchEngine {
  /**
   * Search for blocks matching the query
   */
  async searchBlocks(query: string): Promise<SearchResult[]> {
    try {
      const currentProjectId = await config.get('currentProject') as string;
      if (!currentProjectId) {
        throw new Error('No project is currently selected');
      }

      const indexedDocuments = await config.get(`block-indexes.${currentProjectId}`) as IndexedDocument[] | undefined;
      
      if (!indexedDocuments || indexedDocuments.length === 0) {
        throw new Error('Project has not been indexed with block indexing');
      }

      // Perform the search
      const results = this.performSearch(query, indexedDocuments);

      return results;
    } catch (error) {
      console.error(pc.red('Error searching blocks:'), error);
      throw error;
    }
  }

  /**
   * Perform the search across all documents
   */
  private performSearch(query: string, documents: IndexedDocument[]): SearchResult[] {
    // Normalize query
    const normalizedQuery = query.toLowerCase();
    const queryTerms = this.getQueryTerms(normalizedQuery);
    
    const results: SearchResult[] = [];

    // Check if this is a query asking for summaries
    const isSummaryQuery = 
      normalizedQuery.includes('summary') || 
      normalizedQuery.includes('overview') || 
      normalizedQuery.includes('describe') ||
      normalizedQuery.includes('what is this') ||
      normalizedQuery.includes('what does this do');

    // Search in each document
    for (const document of documents) {
      // Build a map of blocks by id for fast lookup
      const blocksById = new Map<string, DocumentBlock>();
      for (const block of document.blocks) {
        blocksById.set(block.id, block);
      }
      
      // Score each block
      const scoredBlocks = document.blocks.map(block => {
        let score = this.scoreBlock(block, queryTerms);
        
        // Prioritize document blocks with summaries when asking for summaries
        if (isSummaryQuery && block.type === 'document' && block.summary) {
          score += 5; // Boost score for document blocks with summaries
        }
        
        return { block, score };
      }).filter(({ score }) => score > 0);

      // Sort blocks by score and take the top blocks
      scoredBlocks.sort((a, b) => b.score - a.score);
      
      if (scoredBlocks.length > 0) {
        // When we find good matches, add contextual blocks too (parent/children)
        const relevantBlocks: DocumentBlock[] = [];
        const addedIds = new Set<string>();
        
        // If this is a summary query, always include document block with summary if available
        if (isSummaryQuery) {
          const documentBlock = document.blocks.find(block => 
            block.type === 'document' && block.summary
          );
          
          if (documentBlock) {
            relevantBlocks.push(documentBlock);
            addedIds.add(documentBlock.id);
          }
        }
        
        // Add top scoring blocks
        scoredBlocks.slice(0, 5).forEach(({ block }) => {
          if (!addedIds.has(block.id)) {
            relevantBlocks.push(block);
            addedIds.add(block.id);
            
            // Add parent blocks for context
            let parentId = block.parent;
            while (parentId) {
              const parent = blocksById.get(parentId);
              if (parent && !addedIds.has(parent.id)) {
                relevantBlocks.push(parent);
                addedIds.add(parent.id);
                parentId = parent.parent;
              } else {
                break;
              }
            }
            
            // Add immediate child blocks for context
            if (block.children) {
              block.children.forEach(childId => {
                const child = blocksById.get(childId);
                if (child && !addedIds.has(child.id)) {
                  relevantBlocks.push(child);
                  addedIds.add(child.id);
                }
              });
            }
          }
        });
        
        results.push({
          document: document.path,
          blocks: relevantBlocks,
          score: scoredBlocks[0].score
        });
      }
    }
    
    // Sort results by overall score
    results.sort((a, b) => b.score - a.score);
    
    // Take top results
    return results.slice(0, 5);
  }
  
  /**
   * Score a block based on how well it matches the query
   */
  private scoreBlock(block: DocumentBlock, queryTerms: string[]): number {
    const content = block.content.toLowerCase();
    const title = (block.title || '').toLowerCase();
    let score = 0;
    
    // Higher score for blocks matching in title
    for (const term of queryTerms) {
      // Match in title is very relevant
      if (title.includes(term)) {
        score += 5;
        
        // Exact title match is even better
        if (title === term) {
          score += 10;
        }
      }
      
      // Match in content
      if (content.includes(term)) {
        score += 1;
        
        // Count frequency (but with diminishing returns)
        const termCount = (content.match(new RegExp(term, 'g')) || []).length;
        score += Math.min(termCount / 5, 1);
      }
      
      // Match in metadata (if available)
      if (block.metadata) {
        // Match in name field (function name, class name, etc)
        if (block.metadata.name && block.metadata.name.toLowerCase().includes(term)) {
          score += 3;
        }
        
        // Match in signature
        if (block.metadata.signature && block.metadata.signature.toLowerCase().includes(term)) {
          score += 2;
        }
      }
    }
    
    // Adjust score based on block type
    // Code blocks are more relevant in a code search
    if (
      block.type === 'function' || 
      block.type === 'method' || 
      block.type === 'class' || 
      block.type === 'interface'
    ) {
      score *= 1.2;
    }
    
    // Headings are more relevant in documentation searches
    if (block.type === 'heading') {
      score *= 1.1;
    }
    
    return score;
  }
  
  /**
   * Extract terms from the query for matching
   */
  private getQueryTerms(query: string): string[] {
    // Split query into terms, filtering out common words and short terms
    const commonWords = ['and', 'or', 'the', 'is', 'a', 'an', 'in', 'to', 'of', 'for'];
    
    return query
      .split(/\s+/)
      .filter(term => term.length > 2)
      .filter(term => !commonWords.includes(term));
  }
} 