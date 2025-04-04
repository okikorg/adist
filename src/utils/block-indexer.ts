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
  extractKeywords?: boolean;
  maxParallelism?: number;
  cacheBlocks?: boolean;
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
      if (options.withSummaries || options.extractKeywords) {
        try {
          // This will throw if no LLM provider is available
          await LLMServiceFactory.getLLMService();
          if (options.verbose) console.log(pc.dim('LLM service successfully loaded for summarization and keyword extraction.'));
        } catch (error) {
          console.error(pc.red('LLM service failed to load:'), error);
          throw new Error('No LLM provider available. Please configure an LLM provider using "adist llm-config"');
        }
      }

      // Set up default include/exclude patterns
      const includePatterns = options.includePatterns || [
        '**/*.{js,jsx,ts,tsx,md,markdown,json,yaml,yml,toml,py,java,c,cpp,h,hpp,cs,go,rs,php,rb,html,css,scss,less}'
      ];
      
      const excludePatterns = options.excludePatterns || [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/.git/**',
        '**/coverage/**',
        '**/*.min.*',
        '**/package-lock.json',
        '**/yarn.lock'
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
      const fileErrors: {path: string, error: string}[] = [];

      // Get the LLM service if summarization is requested
      const llmService = (options.withSummaries || options.extractKeywords) ? 
        await LLMServiceFactory.getLLMService() : null;
      const fileSummaries: { path: string; summary: string }[] = [];
      const fileKeywords: { path: string; keywords: string[] }[] = [];

      // Function to process a single file
      const processFile = async (file: string): Promise<IndexedDocument | null> => {
        let document: IndexedDocument | null = null;
        try {
          const content = await fs.readFile(file, 'utf-8');
          const relativePath = path.relative(project.path, file);
          const stats = await fs.stat(file);

          // Parse document into blocks
          document = await this.parserRegistry.parse(relativePath, content, {
            size: stats.size,
            mtime: stats.mtime
          });

          // Generate summaries if requested and document exists
          if (options.withSummaries && llmService && document) {
            try {
              if (options.verbose) console.log(pc.dim(`Generating summary for ${relativePath}...`));
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

          // Extract keywords if requested and document exists
          if (options.extractKeywords && llmService && document) {
            try {
              if (options.verbose) console.log(pc.dim(`Extracting keywords for ${relativePath}...`));
              const keywords = await this.extractKeywords(llmService, content, relativePath);
              if (options.verbose) console.log(pc.dim(`Keywords extracted: ${keywords.join(', ')}`));
              fileKeywords.push({ path: relativePath, keywords });
              
              // Find the document-level block and add the keywords as tags
              for (const block of document.blocks) {
                if (block.type === 'document') {
                  block.metadata = block.metadata || {};
                  block.metadata.tags = keywords;
                  break;
                }
              }
            } catch (error) {
              console.error(pc.red(`Error extracting keywords for ${relativePath}:`), error);
            }
          }

          return document;
        } catch (error: any) {
          const relativePath = path.relative(project.path, file);
          if (error.message?.includes('Could not find the language') && error.message?.includes('mermaid')) {
            console.warn(pc.yellow(`⚠️ Skipping mermaid diagram parsing in ${relativePath}. Indexing as plain text.`));
            // Read content and stats again since we're in catch block
            const mermaidContent = await fs.readFile(file, 'utf-8');
            const stats = await fs.stat(file);
            
            // Create full IndexedDocument with required properties
            const blockId = `mermaid-${relativePath}`;
            document = {
              path: relativePath,
              title: path.basename(relativePath),
              lastModified: stats.mtime.getTime(), // Convert Date to timestamp
              size: stats.size,
              blocks: [{
                id: blockId,
                type: 'document',
                path: relativePath,
                content: mermaidContent,
                startLine: 1,
                endLine: mermaidContent.split('\n').length,
                parent: undefined,
                title: path.basename(relativePath)
              }],
              blockHierarchy: {
                root: blockId,
                blockMap: {
                  [blockId]: {
                    block: blockId,
                    children: []
                  }
                }
              }
            };
          } else {
            fileErrors.push({
              path: relativePath,
              error: error.message || 'Unknown error'
            });
            console.error(pc.red(`Error processing file ${relativePath}:`), error);
          }
          return document;
        }
      };

      // Process files in batches to control concurrency
      const maxParallelism = options.maxParallelism || 5; // Default to 5 files at a time
      const batchSize = maxParallelism;
      
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(async (file) => {
          const result = await processFile(file);
          progressBar.increment(1, { file: path.relative(project.path, file) });
          return result;
        }));
        
        // Add successful results to indexedDocuments
        for (const result of batchResults) {
          if (result) {
            indexedDocuments.push(result);
          }
        }
      }

      progressBar.stop();

      // Log any errors
      if (fileErrors.length > 0) {
        console.log(pc.yellow(`⚠️ Encountered errors in ${fileErrors.length} files during indexing.`));
        if (options.verbose) {
          fileErrors.forEach(err => {
            console.log(pc.dim(`  ${err.path}: ${err.error}`));
          });
        }
      }

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

      // Generate project-wide keyword index if requested
      if (options.extractKeywords && fileKeywords.length > 0) {
        if (options.verbose) console.log(pc.dim(`Generating project-wide keyword index from ${fileKeywords.length} files...`));
        try {
          // Create keyword to file mapping for fast search
          const keywordIndex: Record<string, string[]> = {};
          for (const fileData of fileKeywords) {
            for (const keyword of fileData.keywords) {
              keywordIndex[keyword] = keywordIndex[keyword] || [];
              keywordIndex[keyword].push(fileData.path);
            }
          }
          await config.set(`keywords.${projectId}`, keywordIndex);
          if (options.verbose) console.log(pc.green('✓ Project keyword index saved'));
        } catch (error) {
          console.error(pc.red('Error generating keyword index:'), error);
        }
      }

      // Generate code relationships graph if available
      try {
        await this.generateCodeRelationshipsGraph(projectId, indexedDocuments, options);
      } catch (error) {
        console.error(pc.yellow('Warning: Failed to generate code relationships graph:'), error);
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
   * Extract keywords from a file using LLM
   */
  private async extractKeywords(llmService: any, content: string, filename: string): Promise<string[]> {
    // Truncate content if too large
    const truncatedContent = content.length > 10000 ? content.substring(0, 10000) + '...' : content;
    
    try {
      const response = await llmService.extractKeywords(truncatedContent, filename);
      return response.keywords || [];
    } catch (error) {
      console.error(`Error extracting keywords from ${filename}:`, error);
      return [];
    }
  }

  /**
   * Generate a graph of code relationships between files
   */
  private async generateCodeRelationshipsGraph(
    projectId: string, 
    documents: IndexedDocument[],
    options: BlockIndexOptions
  ): Promise<void> {
    if (options.verbose) console.log(pc.dim('Generating code relationships graph...'));
    
    const relationships: {source: string; target: string; type: string}[] = [];
    
    // Create a map for faster document lookup
    const documentsMap = new Map<string, IndexedDocument>();
    for (const doc of documents) {
      documentsMap.set(doc.path, doc);
    }
    
    for (const document of documents) {
      // Look for imports
      const importBlocks = document.blocks.filter(block => 
        block.type === 'imports' || 
        (block.metadata?.dependencies && block.metadata.dependencies.length > 0)
      );
      
      for (const block of importBlocks) {
        const dependencies = block.metadata?.dependencies || [];
        for (const dep of dependencies) {
          // Try to resolve the dependency to a project file
          const resolvedPath = this.resolveImportPath(document.path, dep);
          if (resolvedPath && documentsMap.has(resolvedPath)) {
            relationships.push({
              source: document.path,
              target: resolvedPath,
              type: 'imports'
            });
          }
        }
      }
    }
    
    if (relationships.length > 0) {
      await config.set(`relationships.${projectId}`, relationships);
      if (options.verbose) console.log(pc.green(`✓ Generated ${relationships.length} code relationships`));
    } else {
      if (options.verbose) console.log(pc.yellow('No code relationships found'));
    }
  }
  
  /**
   * Resolves a relative import path to an absolute project path
   */
  private resolveImportPath(sourcePath: string, importPath: string): string | null {
    try {
      // If it looks like a node_modules import, skip it
      if (
        importPath.startsWith('@') || 
        !importPath.startsWith('.') ||
        importPath.includes('node_modules')
      ) {
        return null;
      }
      
      // Remove any query parameters or path fragments
      importPath = importPath.split('?')[0].split('#')[0];
      
      const sourceDir = path.dirname(sourcePath);
      let normalized = path.normalize(path.join(sourceDir, importPath));
      
      // Try with different extensions if none specified
      if (!path.extname(normalized)) {
        const exts = ['.js', '.jsx', '.ts', '.tsx', '.md', '.json'];
        for (const ext of exts) {
          const withExt = normalized + ext;
          if (withExt) {
            return withExt;
          }
        }
        
        // Also check for index files
        for (const ext of exts) {
          const indexFile = path.join(normalized, `index${ext}`);
          if (indexFile) {
            return indexFile;
          }
        }
      }
      
      return normalized;
    } catch (error) {
      console.error('Error resolving import path:', error);
      return null;
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
    const queryVector = this.vectorizeTerms(queryTerms);
    
    const results: SearchResult[] = [];

    // Check if this is a query asking for summaries
    const isSummaryQuery = 
      normalizedQuery.includes('summary') || 
      normalizedQuery.includes('overview') || 
      normalizedQuery.includes('describe') ||
      normalizedQuery.includes('what is this') ||
      normalizedQuery.includes('what does this do');

    // Check if this is a code-specific query
    const isCodeQuery = 
      normalizedQuery.includes('function') || 
      normalizedQuery.includes('class') || 
      normalizedQuery.includes('method') ||
      normalizedQuery.includes('implementation') ||
      normalizedQuery.includes('interface') ||
      normalizedQuery.includes('type');

    // Search in each document
    for (const document of documents) {
      // Build a map of blocks by id for fast lookup
      const blocksById = new Map<string, DocumentBlock>();
      for (const block of document.blocks) {
        blocksById.set(block.id, block);
      }
      
      // Score each block using TF-IDF like approach
      const scoredBlocks = document.blocks.map(block => {
        let score = this.scoreBlockWithVector(block, queryTerms, queryVector);
        
        // Adjust scores for special query types
        if (isSummaryQuery && block.type === 'document' && block.summary) {
          score += 10; // Heavily boost document blocks with summaries for summary queries
        }
        
        if (isCodeQuery && (
          block.type === 'function' || 
          block.type === 'method' || 
          block.type === 'class' || 
          block.type === 'interface' ||
          block.type === 'type'
        )) {
          score += 5; // Boost code blocks for code queries
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
            
            // Add sibling blocks for context when appropriate
            if (block.parent && ['function', 'method', 'class'].includes(block.type)) {
              const parent = blocksById.get(block.parent);
              if (parent && parent.children) {
                const siblings = parent.children
                  .filter(id => id !== block.id)
                  .map(id => blocksById.get(id))
                  .filter((b): b is DocumentBlock => b !== undefined)
                  .filter(b => ['function', 'method', 'variable'].includes(b.type))
                  .slice(0, 3); // Limit to 3 siblings for context
                
                siblings.forEach(sibling => {
                  if (!addedIds.has(sibling.id)) {
                    relevantBlocks.push(sibling);
                    addedIds.add(sibling.id);
                  }
                });
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
   * Score a block using vector-based approach
   */
  private scoreBlockWithVector(block: DocumentBlock, queryTerms: string[], queryVector: Map<string, number>): number {
    const content = block.content.toLowerCase();
    const title = (block.title || '').toLowerCase();
    let score = 0;
    
    // Create a term frequency vector for the block content
    const blockVector = this.createTermFrequencyVector(content);
    
    // Add terms from title with higher weight
    for (const term of queryTerms) {
      if (title.includes(term)) {
        blockVector.set(term, (blockVector.get(term) || 0) + 5);
        
        // Exact title match is even better
        if (title === term) {
          blockVector.set(term, (blockVector.get(term) || 0) + 10);
        }
      }
    }
    
    // Calculate cosine similarity between query vector and block vector
    score = this.calculateCosineSimilarity(queryVector, blockVector);
    
    // Add metadata-based score
    if (block.metadata) {
      for (const term of queryTerms) {
        // Match in name field (function name, class name, etc)
        if (block.metadata.name && block.metadata.name.toLowerCase().includes(term)) {
          score += 3;
        }
        
        // Match in signature
        if (block.metadata.signature && block.metadata.signature.toLowerCase().includes(term)) {
          score += 2;
        }
        
        // Match in tags
        if (block.metadata.tags && block.metadata.tags.some(tag => tag.toLowerCase().includes(term))) {
          score += 2;
        }
      }
    }
    
    // Adjust score based on block type to favor more specific blocks
    if (
      block.type === 'function' || 
      block.type === 'method' || 
      block.type === 'class' || 
      block.type === 'interface'
    ) {
      score *= 1.5;
    } else if (block.type === 'heading') {
      score *= 1.2;
    } else if (block.type === 'document') {
      score *= 0.8; // Slightly reduce document-level blocks unless they have summaries
    }
    
    return score;
  }
  
  /**
   * Create a term frequency vector for content
   */
  private createTermFrequencyVector(content: string): Map<string, number> {
    const vector = new Map<string, number>();
    const terms = this.getTermsFromContent(content);
    
    for (const term of terms) {
      vector.set(term, (vector.get(term) || 0) + 1);
    }
    
    return vector;
  }
  
  /**
   * Calculate cosine similarity between two vectors
   */
  private calculateCosineSimilarity(vecA: Map<string, number>, vecB: Map<string, number>): number {
    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;
    
    // Calculate dot product
    for (const [term, weight] of vecA.entries()) {
      if (vecB.has(term)) {
        dotProduct += weight * (vecB.get(term) || 0);
      }
      magnitudeA += weight * weight;
    }
    
    // Calculate magnitude of vector B
    for (const [, weight] of vecB.entries()) {
      magnitudeB += weight * weight;
    }
    
    // Calculate cosine similarity
    const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }
  
  /**
   * Vectorize query terms
   */
  private vectorizeTerms(terms: string[]): Map<string, number> {
    const vector = new Map<string, number>();
    
    for (const term of terms) {
      vector.set(term, (vector.get(term) || 0) + 1);
    }
    
    return vector;
  }
  
  /**
   * Extract terms from the content for vectorization
   */
  private getTermsFromContent(content: string): string[] {
    const commonWords = new Set([
      'and', 'or', 'the', 'is', 'a', 'an', 'in', 'to', 'of', 'for', 'on', 'with', 'by', 'as',
      'this', 'that', 'these', 'those', 'it', 'they', 'we', 'you', 'he', 'she'
    ]);
    
    return content
      .toLowerCase()
      .split(/\W+/)
      .filter(term => term.length > 2)
      .filter(term => !commonWords.has(term));
  }
  
  /**
   * Extract terms from the query for matching
   */
  private getQueryTerms(query: string): string[] {
    // Split query into terms, filtering out common words and short terms
    const commonWords = new Set([
      'and', 'or', 'the', 'is', 'a', 'an', 'in', 'to', 'of', 'for', 'on', 'with', 'by', 'as',
      'this', 'that', 'these', 'those', 'it', 'they', 'we', 'you', 'he', 'she'
    ]);
    
    return query
      .split(/\W+/)
      .filter(term => term.length > 2)
      .filter(term => !commonWords.has(term));
  }
} 