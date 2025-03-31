import fs from 'fs/promises';
import path from 'path';
import fg from 'fast-glob';
import config from '../config.js';
import { LLMServiceFactory } from './llm-service.js';
import pc from 'picocolors';
import { createInterface } from 'readline';
import cliProgress from 'cli-progress';
import { Worker } from 'worker_threads';
import { createHash } from 'crypto';
import os from 'os';
import zlib from 'zlib';
import { promisify } from 'util';

// Promise-based versions of zlib functions
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// File categories for better organization and filtering
const FILE_CATEGORIES = {
  CODE: [
    '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp', 
    '.cs', '.go', '.rs', '.php', '.rb', '.swift', '.kt', '.scala'
  ],
  MARKDOWN: ['.md', '.markdown', '.mdown', '.mkdn', '.mdwn', '.mdtxt', '.mdtext', '.rmd'],
  TEXT: ['.txt', '.text', '.rst', '.asciidoc', '.adoc', '.asc', '.textile', '.org'],
  CONFIG: [
    '.json', '.yaml', '.yml', '.toml', '.ini', '.conf', '.properties',
    '.gradle', '.pom', '.ivy', '.ant', '.make', '.cmake', '.ninja',
    '.bazel', '.buck', '.pbxproj', '.sln', '.csproj', '.vbproj'
  ],
  MARKUP: ['.html', '.xml', '.svg', '.dtd', '.xsd', '.xsl', '.xslt', '.wsdl', '.sgml'],
  STYLE: ['.css', '.scss', '.sass', '.less'],
  SHELL: ['.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd']
};

// Default exclusion patterns
const DEFAULT_EXCLUDE_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.output/**',
  '**/.cache/**',
  '**/.temp/**',
  '**/tmp/**',
  '**/.DS_Store',
  '**/*.min.*',
  '**/*.map',
  '**/*.bundle.*',
  '**/*.chunk.*',
  '**/vendor/**',
  '**/coverage/**',
  '**/.vscode/**',
  '**/.idea/**',
  '**/__pycache__/**',
  '**/*.pyc',
  '**/venv/**',
  '**/.env/**',
  '**/node_modules',
  '**/bin/**',
  '**/obj/**'
];

// Max content size for direct indexing (larger files will be chunked)
const MAX_CONTENT_SIZE = 1024 * 1024; // 1MB

// Binary file signature prefixes
const BINARY_SIGNATURES = [
  Buffer.from([0xFF, 0xD8, 0xFF]), // JPEG
  Buffer.from([0x89, 0x50, 0x4E, 0x47]), // PNG
  Buffer.from([0x47, 0x49, 0x46]), // GIF
  Buffer.from([0x50, 0x4B, 0x03, 0x04]), // ZIP/DOCX/XLSX
  Buffer.from([0x25, 0x50, 0x44, 0x46]), // PDF
  Buffer.from([0xD0, 0xCF, 0x11, 0xE0]), // MS Office
  Buffer.from([0x7F, 0x45, 0x4C, 0x46]), // ELF
  Buffer.from([0x4D, 0x5A]) // EXE
];

interface Project {
  path: string;
  name: string;
  indexed: boolean;
  hasSummaries?: boolean;
  lastIndexed?: number;
}

interface IndexedContent {
  content: string;
  path: string;
  summary?: string;
  score?: number;
  metadata?: DocumentMetadata;
  hash?: string;
  lastModified?: number;
}

interface DocumentIndex {
  path: string;
  content: string;
  title: string;
  lastModified: number;
  size: number;
  summary?: string;
  score?: number;
  metadata?: DocumentMetadata;
  hash?: string;
  embedding?: number[];
}

interface DocumentMetadata {
  language?: string;
  lineCount?: number;
  charCount?: number;
  wordCount?: number;
  funcCount?: number;
  classCount?: number;
  importCount?: number;
  commentRatio?: number;
  complexity?: number;
}

interface FileStats {
  totalFiles: number;
  totalSize: number;
  totalWords: number;
  fileTypes: Record<string, number>;
}

interface IndexingOptions {
  withSummaries?: boolean;
  verbose?: boolean;
  incremental?: boolean;
  concurrency?: number;
  forceReindex?: boolean;
  customPatterns?: string[];
  chunkSize?: number;
}

// Store indexed documents for each project
const projectIndices: Record<string, Map<string, DocumentIndex>> = {};

// Cache for file metadata
const fileMetadataCache = new Map<string, { hash: string, lastModified: number }>();

/**
 * Get the current project directory
 */
export const getCurrentProjectPath = async (): Promise<string | null> => {
  try {
    const currentProjectId = await config.get('currentProject') as string;
    if (!currentProjectId) {
      return null;
    }

    const projects = await config.get('projects') as Record<string, Project>;
    const currentProject = projects[currentProjectId];
    return currentProject?.path || null;
  } catch (error) {
    console.error('Error getting current project path:', error);
    return null;
  }
};

/**
 * Check if a file is likely binary by looking at its header
 */
async function isBinaryFile(filePath: string): Promise<boolean> {
  try {
    // Open the file
    const fileHandle = await fs.open(filePath, 'r');
    
    // Read the first 8 bytes
    const buffer = Buffer.alloc(8);
    const { bytesRead } = await fileHandle.read(buffer, 0, 8, 0);
    await fileHandle.close();
    
    if (bytesRead < 8) {
      // Small files are treated as non-binary
      return false;
    }
    
    // Check against known binary signatures
    for (const signature of BINARY_SIGNATURES) {
      if (buffer.subarray(0, signature.length).equals(signature)) {
        return true;
      }
    }
    
    // Check for high concentration of zeros and non-printable chars
    let nonPrintable = 0;
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0 || (buffer[i] < 32 && buffer[i] !== 9 && buffer[i] !== 10 && buffer[i] !== 13)) {
        nonPrintable++;
      }
    }
    
    // If more than 30% are non-printable, likely binary
    return nonPrintable / bytesRead > 0.3;
  } catch (error) {
    console.error(`Error checking if ${filePath} is binary:`, error);
    // Default to false if there's an error
    return false;
  }
}

/**
 * Calculate file hash for determining if content has changed
 */
async function calculateFileHash(content: string): Promise<string> {
  return createHash('md5').update(content).digest('hex');
}

/**
 * Get file language from extension
 */
function getFileLanguage(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  
  for (const [category, extensions] of Object.entries(FILE_CATEGORIES)) {
    if (extensions.includes(ext)) {
      if (category === 'CODE') {
        // Return specific language for code files
        return ext.substring(1); // Remove the dot
      }
      return category.toLowerCase();
    }
  }
  
  return 'unknown';
}

/**
 * Generate file metadata based on content and language
 */
function generateFileMetadata(content: string, filePath: string): DocumentMetadata {
  const metadata: DocumentMetadata = {
    language: getFileLanguage(filePath),
    lineCount: content.split('\n').length,
    charCount: content.length,
    wordCount: content.split(/\s+/).length,
  };
  
  const ext = path.extname(filePath).toLowerCase();
  
  // Code-specific metrics for supported languages
  if (FILE_CATEGORIES.CODE.includes(ext)) {
    // Count functions (very basic implementation)
    const funcMatches = content.match(/function\s+\w+\s*\(|^\s*(\w+)\s*\([^)]*\)\s*{|=>|def\s+\w+\s*\(|public\s+\w+\s*\(/gm);
    metadata.funcCount = funcMatches ? funcMatches.length : 0;
    
    // Count classes
    const classMatches = content.match(/class\s+\w+|interface\s+\w+/gm);
    metadata.classCount = classMatches ? classMatches.length : 0;
    
    // Count imports
    const importMatches = content.match(/import\s+|require\s*\(|from\s+|include\s+|using\s+/gm);
    metadata.importCount = importMatches ? importMatches.length : 0;
    
    // Estimate comment ratio
    const lines = content.split('\n');
    const commentLines = lines.filter(line => 
      line.trim().startsWith('//') || 
      line.trim().startsWith('#') || 
      line.trim().startsWith('/*') || 
      line.trim().startsWith('*') || 
      line.trim().startsWith('"""')
    ).length;
    
    metadata.commentRatio = commentLines / lines.length;
    
    // Very basic complexity estimation (more conditionals = more complex)
    const complexityFactors = (content.match(/if|else|for|while|switch|case|try|catch|&&|\|\||=>|function/g) || []).length;
    metadata.complexity = complexityFactors / lines.length * 10; // Scale 0-10
  }
  
  return metadata;
}

/**
 * Calculate file statistics and estimated costs
 */
const calculateFileStats = async (files: string[]): Promise<FileStats> => {
  let totalSize = 0;
  let totalWords = 0;
  const fileTypes: Record<string, number> = {};

  // Process in batches to avoid memory issues
  const BATCH_SIZE = 100;
  
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    
    await Promise.all(batch.map(async (file) => {
      try {
        const ext = path.extname(file).toLowerCase();
        fileTypes[ext] = (fileTypes[ext] || 0) + 1;
        
        // Skip binary files
        if (await isBinaryFile(file)) {
          return;
        }
        
        const content = await fs.readFile(file, 'utf-8');
        totalSize += content.length;
        totalWords += content.split(/\s+/).length;
      } catch (error) {
        // Silently skip files with errors
      }
    }));
  }

  return {
    totalFiles: files.length,
    totalSize,
    totalWords,
    fileTypes
  };
};

/**
 * Format bytes to human readable size
 */
const formatBytes = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(2)} ${units[unitIndex]}`;
};

/**
 * Process file for indexing
 */
async function processFile(
  filePath: string, 
  projectPath: string, 
  options: IndexingOptions,
  previousIndex?: Map<string, IndexedContent>
): Promise<IndexedContent | null> {
  try {
    const relativePath = path.relative(projectPath, filePath);
    
    // Skip binary files
    if (await isBinaryFile(filePath)) {
      return null;
    }
    
    const stats = await fs.stat(filePath);
    const lastModified = stats.mtimeMs;
    
    // Check if we can use cached version for incremental indexing
    if (options.incremental && previousIndex) {
      const existing = previousIndex.get(relativePath);
      
      if (existing && existing.lastModified === lastModified) {
        return existing as IndexedContent;
      }
    }
    
    // Read file content
    const content = await fs.readFile(filePath, 'utf-8');
    
    // Calculate hash for tracking changes
    const hash = await calculateFileHash(content);
    
    // Generate metadata
    const metadata = generateFileMetadata(content, filePath);
    
    // Create base indexed content
    const indexedContent: IndexedContent = {
      content,
      path: relativePath,
      hash,
      lastModified,
      metadata
    };
    
    return indexedContent;
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
    return null;
  }
}

/**
 * Process a file for summarization
 */
async function summarizeFile(
  indexedContent: IndexedContent,
  llmService: any
): Promise<IndexedContent> {
  try {
    if (!indexedContent.content) {
      return indexedContent;
    }
    
    const result = await llmService.summarizeFile(
      indexedContent.content, 
      indexedContent.path
    );
    
    return {
      ...indexedContent,
      summary: result.summary
    };
  } catch (error) {
    console.error(`Error summarizing file ${indexedContent.path}:`, error);
    return indexedContent;
  }
}

/**
 * Split large content into meaningful chunks
 */
function chunkContent(content: string, filePath: string, chunkSize: number = 4000): IndexedContent[] {
  // Skip chunking for small files
  if (content.length <= chunkSize) {
    return [{ content, path: filePath }];
  }
  
  const ext = path.extname(filePath).toLowerCase();
  const lines = content.split('\n');
  const chunks: IndexedContent[] = [];
  let currentChunk: string[] = [];
  let currentSize = 0;
  
  // Determine chunk boundaries based on file type
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineSize = line.length + 1; // +1 for newline character
    
    // If adding this line would exceed the chunk size, create a new chunk
    if (currentSize + lineSize > chunkSize && currentChunk.length > 0) {
      chunks.push({
        content: currentChunk.join('\n'),
        path: `${filePath}#chunk${chunks.length + 1}`
      });
      currentChunk = [];
      currentSize = 0;
    }
    
    // Handle special boundary cases for code files
    if (FILE_CATEGORIES.CODE.includes(ext)) {
      // Try to end chunks at function/class boundaries
      const isClassOrFuncStart = /^\s*(class|function|def|public|private|protected|async|export)\s/.test(line);
      const isImportLine = /^\s*(import|require|from|using|include)\s/.test(line);
      
      // If we're starting a significant block and the current chunk isn't empty
      if ((isClassOrFuncStart || isImportLine) && currentSize > chunkSize / 2) {
        chunks.push({
          content: currentChunk.join('\n'),
          path: `${filePath}#chunk${chunks.length + 1}`
        });
        currentChunk = [];
        currentSize = 0;
      }
    }
    
    // Add the current line to the chunk
    currentChunk.push(line);
    currentSize += lineSize;
  }
  
  // Add the final chunk if there's anything left
  if (currentChunk.length > 0) {
    chunks.push({
      content: currentChunk.join('\n'),
      path: `${filePath}#chunk${chunks.length + 1}`
    });
  }
  
  return chunks;
}

/**
 * Create file inclusion pattern based on category
 */
function buildInclusionPatterns(customPatterns?: string[]): string[] {
  if (customPatterns && customPatterns.length > 0) {
    return customPatterns;
  }
  
  // Collect all extensions from file categories
  const allExtensions: string[] = [];
  Object.values(FILE_CATEGORIES).forEach(extensions => {
    extensions.forEach(ext => {
      // Remove the leading dot
      allExtensions.push(ext.substring(1));
    });
  });
  
  // Create glob pattern
  return [`**/*.{${allExtensions.join(',')}}`];
}

/**
 * Index a project by its ID
 */
export const indexProject = async (
  projectId: string, 
  options: IndexingOptions = {}
): Promise<void> => {
  try {
    const projects = await config.get('projects') as Record<string, Project>;
    const project = projects[projectId];

    if (!project) {
      throw new Error(`Project with ID ${projectId} not found`);
    }

    // Apply default options
    const indexOptions: IndexingOptions = {
      withSummaries: options.withSummaries ?? false,
      verbose: options.verbose ?? false,
      incremental: options.incremental ?? true,
      concurrency: options.concurrency ?? Math.max(1, Math.floor(os.cpus().length / 2)),
      forceReindex: options.forceReindex ?? false,
      chunkSize: options.chunkSize ?? 8000
    };

    // Check if an LLM provider is available when summarization is requested
    if (indexOptions.withSummaries) {
      try {
        // This will throw if no LLM provider is available
        await LLMServiceFactory.getLLMService();
      } catch (error) {
        throw new Error('No LLM provider available. Please configure an LLM provider using "adist llm-config"');
      }
    }

    // Load previous index if doing incremental indexing
    let previousIndex: Map<string, IndexedContent> | undefined;
    if (indexOptions.incremental && !indexOptions.forceReindex) {
      try {
        const compressedIndex = await config.get(`indexes.${projectId}.compressed`) as Buffer;
        if (compressedIndex) {
          // Decompress and parse the index
          const decompressed = await gunzip(compressedIndex);
          const indexData = JSON.parse(decompressed.toString('utf-8')) as IndexedContent[];
          previousIndex = new Map(indexData.map(item => [item.path, item]));
          
          if (indexOptions.verbose) {
            console.log(pc.dim(`Loaded previous index with ${previousIndex.size} files`));
          }
        }
      } catch (error) {
        // If there's an error loading the previous index, continue with full indexing
        if (indexOptions.verbose) {
          console.log(pc.yellow('No previous index found or error loading it. Performing full indexing.'));
        }
      }
    }

    // Build inclusion patterns
    const includePatterns = buildInclusionPatterns(options.customPatterns);
    
    // Get all files matching the patterns
    const files = await fg([...includePatterns, ...DEFAULT_EXCLUDE_PATTERNS.map(p => `!${p}`)], {
      cwd: project.path,
      absolute: true,
      onlyFiles: true,
      followSymbolicLinks: false,
      ignore: ['../**'] // Prevent indexing parent directories
    });

    // If summarization is requested, calculate stats and show confirmation
    if (indexOptions.withSummaries) {
      const stats = await calculateFileStats(files);
      console.log(pc.bold('Project Statistics:'));
      console.log(`${pc.dim('Total Files:')} ${pc.green(stats.totalFiles.toLocaleString())}`);
      console.log(`${pc.dim('Total Size:')} ${pc.green(formatBytes(stats.totalSize))}`);
      console.log(`${pc.dim('Total Words:')} ${pc.green(stats.totalWords.toLocaleString())}`);
      
      // Show file type distribution
      console.log(pc.dim('File Types:'));
      const sortedTypes = Object.entries(stats.fileTypes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      
      for (const [ext, count] of sortedTypes) {
        console.log(`  ${pc.dim(ext)}: ${pc.green(count.toLocaleString())}`);
      }

      const readline = createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise<string>(resolve => {
        readline.question(pc.yellow(`Do you want to proceed with summarization? This will process ${stats.totalFiles.toLocaleString()} files (y/N): `), resolve);
      });
      readline.close();

      if (answer.toLowerCase() !== 'y') {
        console.log(pc.yellow('Summarization cancelled. Proceeding with regular indexing...'));
        indexOptions.withSummaries = false;
        // Update project status to reflect that summarization was cancelled
        project.hasSummaries = false;
        await config.set(`projects.${projectId}`, project);
      }
    }

    // Create progress bar for indexing
    const progressBar = new cliProgress.SingleBar({
      format: '{bar} {percentage}% | {value}/{total} Files | {file}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
      clearOnComplete: false
    }, cliProgress.Presets.shades_classic);

    progressBar.start(files.length, 0, { file: 'Starting...' });

    // Process files in parallel batches
    const indexedContents: IndexedContent[] = [];
    const fileSummaries: { path: string; summary: string }[] = [];
    const batchSize = 50; // Process 50 files at a time
    const llmService = indexOptions.withSummaries ? await LLMServiceFactory.getLLMService() : null;

    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (file) => {
          const result = await processFile(file, project.path, indexOptions, previousIndex);
          progressBar.increment(1, { file: path.relative(project.path, file) });
          return result;
        })
      );

      // Filter out nulls (failed processing)
      const validResults = batchResults.filter(r => r !== null) as IndexedContent[];
      
      // Add results to the list
      indexedContents.push(...validResults);
      
      // Process summaries if requested
      if (indexOptions.withSummaries && llmService) {
        // Process summaries in smaller batches to avoid overwhelming the LLM service
        const summaryBatchSize = 5;
        for (let j = 0; j < validResults.length; j += summaryBatchSize) {
          const summaryBatch = validResults.slice(j, j + summaryBatchSize);
          
          // Check if we already have summaries from previous index
          const toSummarize = summaryBatch.filter(item => {
            if (!previousIndex) return true;
            const existing = previousIndex.get(item.path);
            return !existing?.summary || existing.hash !== item.hash;
          });
          
          if (toSummarize.length > 0) {
            const summarizedResults = await Promise.all(
              toSummarize.map(item => summarizeFile(item, llmService))
            );
            
            // Update the items in the main array
            for (const summarized of summarizedResults) {
              const index = indexedContents.findIndex(item => item.path === summarized.path);
              if (index !== -1) {
                indexedContents[index] = summarized;
              }
              
              if (summarized.summary) {
                fileSummaries.push({ 
                  path: summarized.path, 
                  summary: summarized.summary 
                });
              }
            }
          } else {
            // Reuse existing summaries
            for (const item of summaryBatch) {
              const existing = previousIndex?.get(item.path);
              if (existing?.summary) {
                // Copy the summary to the new item
                const index = indexedContents.findIndex(i => i.path === item.path);
                if (index !== -1) {
                  indexedContents[index].summary = existing.summary;
                  fileSummaries.push({ 
                    path: item.path, 
                    summary: existing.summary 
                  });
                }
              }
            }
          }
        }
      }
    }

    progressBar.stop();

    // Generate overall summary if requested
    if (indexOptions.withSummaries && llmService && fileSummaries.length > 0) {
      console.log(pc.dim('Generating overall project summary...'));
      const result = await llmService.generateOverallSummary(fileSummaries);
      await config.set(`summaries.${projectId}.overall`, result.summary);
    }

    // Compress the indexed contents to save space
    const compressedData = await gzip(Buffer.from(JSON.stringify(indexedContents)));
    
    // Store the compressed indexed contents
    await config.set(`indexes.${projectId}.compressed`, compressedData);

    // Update project status
    project.indexed = true;
    project.hasSummaries = indexOptions.withSummaries;
    project.lastIndexed = Date.now();
    await config.set(`projects.${projectId}`, project);

    console.log(pc.green(`✓ Project indexed successfully! ${indexedContents.length} files processed.`));
    console.log(pc.dim('Run adist get "<query>" to search for documents.'));
  } catch (error) {
    console.error(pc.red('Error indexing project:'), error);
    throw error;
  }
};

/**
 * Find semantically similar documents to the provided ones
 * This helps with including related documents that might not contain the exact search terms
 */
const findSimilarDocuments = (
  mainDocs: IndexedContent[], 
  allDocs: IndexedContent[], 
  limit: number = 2
): IndexedContent[] => {
  if (mainDocs.length === 0 || allDocs.length === 0) {
    return [];
  }
  
  // Create a map of already selected documents to avoid duplicates
  const selectedPaths = new Set(mainDocs.map(doc => doc.path));
  
  // Extract keywords from the main documents to find similar ones
  const keywordsFromMainDocs = new Set<string>();
  const pathComponents = new Set<string>();
  
  // Extract significant words from content and paths
  mainDocs.forEach(doc => {
    // Extract words from path (filenames, directories)
    const pathParts = doc.path.split(/[\/\\._-]/).filter(part => part.length > 3);
    pathParts.forEach(part => {
      pathComponents.add(part.toLowerCase());
      keywordsFromMainDocs.add(part.toLowerCase());
    });
    
    // Extract file language metadata if available
    const language = doc.metadata?.language;
    if (language) {
      keywordsFromMainDocs.add(language);
    }
    
    // Extract significant words from content using more intelligent tokenization
    if (doc.content) {
      // First split by common code delimiters
      const tokens = doc.content
        .split(/[\s\{\}\(\)\[\]\;\:\"\'\=\,\<\>\.\+\-\*\/\!\?\|\&\^\%\$\#\@\~\`\\]+/)
        .filter(token => token.length > 4 && token.length < 30)  // Skip very short or long tokens
        .slice(0, 300)  // Limit number of tokens to check (performance)
        .map(token => token.toLowerCase());
        
      // Count token frequency
      const tokenFrequency: Record<string, number> = {};
      tokens.forEach(token => {
        tokenFrequency[token] = (tokenFrequency[token] || 0) + 1;
      });
      
      // Add tokens that appear multiple times (more important)
      Object.entries(tokenFrequency)
        .filter(([_, count]) => count > 1)
        .slice(0, 50) // Take the top 50 most frequent tokens
        .forEach(([token]) => keywordsFromMainDocs.add(token));
    }
    
    // Also add words from summary if available
    if (doc.summary) {
      const summaryWords = doc.summary
        .split(/\s+/)
        .filter(word => word.length > 4 && word.length < 20)
        .map(word => word.toLowerCase().replace(/[^\w]/g, ''))
        .filter(word => word.length > 2);
          
      summaryWords.forEach(word => keywordsFromMainDocs.add(word));
    }
  });
  
  // Remove very common words that won't be useful for finding related documents
  const commonWords = [
    'const', 'function', 'return', 'export', 'import', 'class', 'interface', 
    'string', 'number', 'boolean', 'public', 'private', 'static', 'async', 
    'await', 'from', 'require', 'module', 'object', 'array', 'value'
  ];
  commonWords.forEach(word => keywordsFromMainDocs.delete(word));
  
  // Score all other documents by relevance to the keywords and path components
  const similarDocs = allDocs
    .filter(doc => !selectedPaths.has(doc.path))  // Exclude already selected docs
    .map(doc => {
      const contentLower = doc.content?.toLowerCase() || '';
      const pathLower = doc.path?.toLowerCase() || '';
      
      // Calculate similarity score based on multiple factors
      let score = 0;
      
      // 1. Keyword matches in content
      keywordsFromMainDocs.forEach(keyword => {
        if (contentLower.includes(keyword)) {
          score += 1;
        }
      });
      
      // 2. Path component matches (directory/file structure similarity)
      const docPathParts = new Set(pathLower.split(/[\/\\._-]/).map(p => p.toLowerCase()));
      pathComponents.forEach(component => {
        if (docPathParts.has(component)) {
          score += 3; // Path similarity is a stronger indicator
        }
      });
      
      // 3. Metadata similarity (if available)
      if (doc.metadata && mainDocs[0]?.metadata) {
        // Same language bonus
        if (doc.metadata.language === mainDocs[0].metadata.language) {
          score += 2;
        }
        
        // Similar complexity bonus
        const complexityDiff = Math.abs(
          (doc.metadata.complexity || 0) - (mainDocs[0].metadata.complexity || 0)
        );
        if (complexityDiff < 3) {
          score += 1;
        }
      }
      
      // 4. Summary matches
      if (doc.summary) {
        keywordsFromMainDocs.forEach(keyword => {
          if (doc.summary!.toLowerCase().includes(keyword)) {
            score += 2;
          }
        });
      }
      
      // Apply file size penalty (avoid very large files)
      if (doc.content && doc.content.length > 10000) {
        score *= 0.9;
      }
      
      return {
        ...doc,
        score
      };
    })
    .filter(doc => doc.score > 1)  // Only consider docs with reasonable similarity
    .sort((a, b) => (b.score || 0) - (a.score || 0))  // Sort by similarity score
    .slice(0, limit);  // Take top N similar docs
    
  // Remove the scores before returning
  return similarDocs.map(({ score, ...docWithoutScore }) => docWithoutScore);
};

/**
 * Advanced relevance scoring function
 */
function calculateRelevanceScore(
  doc: IndexedContent, 
  searchTerms: string[], 
  query: string,
  isProjectDescriptionQuery: boolean
): number {
  const contentLower = doc.content?.toLowerCase() || '';
  const pathLower = doc.path?.toLowerCase() || '';
  const summaryLower = doc.summary?.toLowerCase() || '';
  const ext = path.extname(doc.path || '').toLowerCase();
  
  // Initialize score
  let score = 0;
  
  // 1. Term frequency scoring
  for (const term of searchTerms) {
    // Skip very short terms
    if (term.length <= 2) continue;
    
    // Count occurrences in content with intelligent weighting
    const contentMatches = (contentLower.match(new RegExp(term, 'g')) || []).length;
    
    // Apply diminishing returns for repeated terms (log scale)
    if (contentMatches > 0) {
      score += Math.log(contentMatches + 1) * 2;
    }
    
    // Path matches are highly relevant
    const pathMatches = (pathLower.match(new RegExp(term, 'g')) || []).length;
    score += pathMatches * 5;
    
    // Summary matches indicate relevance
    const summaryMatches = (summaryLower.match(new RegExp(term, 'g')) || []).length;
    score += summaryMatches * 3;
  }
  
  // 2. Metadata-based boosting
  if (doc.metadata) {
    // Boost shorter, more focused files
    if (doc.content && doc.content.length < 5000) {
      score *= 1.2;
    }
    
    // Boost files with higher comment ratio (better documented)
    if (doc.metadata.commentRatio && doc.metadata.commentRatio > 0.1) {
      score *= 1 + doc.metadata.commentRatio / 2;
    }
    
    // Language-specific boosts based on query
    const queryLower = query.toLowerCase();
    const language = doc.metadata.language;
    
    if (language && queryLower.includes(language)) {
      score *= 1.5;
    }
  }
  
  // 3. Special document type scoring
  // For project description queries, prioritize documentation
  if (isProjectDescriptionQuery) {
    if (
      pathLower.includes('readme') || 
      pathLower.includes('docs/') || 
      ext === '.md'
    ) {
      score += 20;
    }
    
    // Prioritize project configuration files
    if (
      pathLower.includes('package.json') || 
      pathLower.includes('config') || 
      pathLower.endsWith('.toml') || 
      pathLower.endsWith('.yaml') || 
      pathLower.endsWith('.yml')
    ) {
      score += 15;
    }
  }
  
  // If query mentions "config" or "setup", prioritize config files
  if (
    query.toLowerCase().includes('config') || 
    query.toLowerCase().includes('setup') ||
    query.toLowerCase().includes('dependencies')
  ) {
    if (
      pathLower.includes('config') ||
      pathLower.includes('package.json') ||
      pathLower.endsWith('.config.js') ||
      pathLower.endsWith('.conf') ||
      pathLower.endsWith('.toml') ||
      pathLower.endsWith('.yaml') ||
      pathLower.endsWith('.yml')
    ) {
      score += 15;
    }
  }
  
  // 4. Document length penalty
  // Apply penalty for very large documents (usually less focused)
  if (doc.content) {
    const contentLength = doc.content.length;
    if (contentLength > 10000) {
      score = score * (1 - Math.min(0.5, (contentLength - 10000) / 100000));
    }
  }
  
  return score;
}

/**
 * Search for documents in the current project
 */
export const searchDocuments = async (query: string): Promise<IndexedContent[]> => {
  try {
    const currentProjectId = await config.get('currentProject') as string;
    if (!currentProjectId) {
      throw new Error('No project is currently selected');
    }

    // Get compressed index
    const compressedIndex = await config.get(`indexes.${currentProjectId}.compressed`) as Buffer;
    if (!compressedIndex) {
      throw new Error('Project has not been indexed');
    }
    
    // Decompress the index
    const decompressed = await gunzip(compressedIndex);
    const indexes = JSON.parse(decompressed.toString('utf-8')) as IndexedContent[];

    // Get project overall summary if it exists
    const overallSummary = await config.get(`summaries.${currentProjectId}.overall`) as string | undefined;

    // Analyze query for better understanding
    const queryLower = query.toLowerCase();
    const searchTerms = queryLower.split(/\s+/).filter(term => term.length > 2);
    
    // Special case for "what's this project about" type queries
    const isProjectDescriptionQuery = 
      (queryLower.includes('what') && queryLower.includes('project') && 
       (queryLower.includes('about') || queryLower.includes('is'))) ||
      (queryLower.includes('describe') && queryLower.includes('project')) ||
      (queryLower.includes('explain') && queryLower.includes('project'));
      
    // Special case for architecture queries
    const isArchitectureQuery =
      (queryLower.includes('architect') || queryLower.includes('structure')) &&
      (queryLower.includes('project') || queryLower.includes('code') || queryLower.includes('application'));
    
    // Score each document for relevance using our enhanced algorithm
    const scoredResults = indexes.map(doc => ({
      ...doc,
      score: calculateRelevanceScore(doc, searchTerms, query, isProjectDescriptionQuery)
    }));
    
    // Filter out documents with zero score
    let results = scoredResults
      .filter(doc => doc.score > 0)
      // Sort by score in descending order
      .sort((a, b) => b.score - a.score)
      // Take top results (limit to 5 most relevant documents to avoid context overflow)
      .slice(0, 5);
    
    // For architecture queries, prioritize diverse file types
    if (isArchitectureQuery && results.length > 3) {
      // Group by file extension
      const byExtension: Record<string, typeof results> = {};
      results.forEach(result => {
        const ext = path.extname(result.path).toLowerCase();
        if (!byExtension[ext]) {
          byExtension[ext] = [];
        }
        byExtension[ext].push(result);
      });
      
      // Pick top file from each extension, then fill with remaining
      let diverseResults: typeof results = [];
      Object.values(byExtension).forEach(group => {
        if (group.length > 0) {
          diverseResults.push(group[0]);
          group.shift();
        }
      });
      
      // Fill remaining slots
      const remainingItems = Array.prototype.concat(...Object.values(byExtension));
      remainingItems.sort((a, b) => (b.score || 0) - (a.score || 0));
      
      results = [...diverseResults, ...remainingItems].slice(0, 5);
    }
    
    // If this is a project description query and we found no results, include README files
    if (isProjectDescriptionQuery && results.length === 0) {
      results = indexes
        .filter(({ path }) => 
          path.toLowerCase().includes('readme') || 
          path.toLowerCase().endsWith('.md'))
        .map(doc => ({ ...doc, score: 1 }));
    }
    
    // If still no results and looking for project info, include package.json
    if (isProjectDescriptionQuery && results.length === 0) {
      results = indexes
        .filter(({ path }) => path.toLowerCase().includes('package.json'))
        .map(doc => ({ ...doc, score: 1 }));
    }
    
    // Find similar documents to enhance context
    // Skip this for project description queries (we already have specialized handling)
    if (!isProjectDescriptionQuery && results.length > 0 && results.length < 4) {
      const strippedResults = results.map(({ score, ...rest }) => rest);
      const similarDocs = findSimilarDocuments(strippedResults, indexes, 2);
      
      // Add similar docs with a lower score
      const augmentedResults = [
        ...results,
        ...similarDocs.map(doc => ({ ...doc, score: 0.5 })) // Lower score to keep them at the end
      ];
      
      // Update results
      results = augmentedResults;
    }

    // Process results to include summaries when relevant
    return results.map(result => {
      const { score, ...docWithoutScore } = result;
      const contextParts = [];

      // File identification header
      contextParts.push(`File: ${result.path}`);

      // Include file metadata if available
      if (result.metadata) {
        const meta = [];
        if (result.metadata.language) meta.push(`Language: ${result.metadata.language}`);
        if (result.metadata.lineCount) meta.push(`Lines: ${result.metadata.lineCount}`);
        if (result.metadata.funcCount) meta.push(`Functions: ${result.metadata.funcCount}`);
        if (result.metadata.classCount) meta.push(`Classes: ${result.metadata.classCount}`);
        
        if (meta.length > 0) {
          contextParts.push(`Metadata: ${meta.join(' | ')}`);
        }
      }

      // Always include the file's summary if available
      if (result.summary) {
        contextParts.push(`File Summary:\n${result.summary}`);
      }

      // Include the overall project summary only for the first result or for project description queries
      if (overallSummary && (isProjectDescriptionQuery || results.indexOf(result) === 0)) {
        contextParts.push(`Project Summary:\n${overallSummary}`);
      }

      // Add the file content
      contextParts.push(`File Content:\n${docWithoutScore.content}`);

      // Combine all parts with clear separation
      return {
        ...docWithoutScore,
        content: contextParts.join('\n\n---\n\n')
      };
    });
  } catch (error) {
    console.error('Error searching documents:', error);
    return []; // Return empty array instead of throwing error
  }
};

/**
 * Reindex the current project
 */
export const reindexCurrentProject = async (options: IndexingOptions = {}): Promise<void> => {
  try {
    const currentProjectId = await config.get('currentProject') as string;
    if (!currentProjectId) {
      throw new Error('No project is currently selected');
    }

    await indexProject(currentProjectId, options);
  } catch (error) {
    console.error('Error reindexing current project:', error);
    throw error;
  }
};

/**
 * Initialize indices for all indexed projects
 */
export const initializeIndices = async (options: IndexingOptions & { projectId?: string } = {}): Promise<void> => {
  const projects = await config.get('projects') as Record<string, Project>;
  
  // If projectId is provided, only initialize that project
  if (options.projectId) {
    const project = projects[options.projectId];
    if (project) {
      try {
        await indexProject(options.projectId, options);
      } catch (error) {
        console.error(`Error loading index for project ${project.name}:`, error);
      }
    }
    return;
  }
  
  // Otherwise, initialize all indexed projects
  for (const [projectId, project] of Object.entries(projects)) {
    if (project.indexed) {
      try {
        await indexProject(projectId, options);
      } catch (error) {
        console.error(`Error loading index for project ${project.name}:`, error);
      }
    }
  }
};