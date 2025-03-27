import fs from 'fs/promises';
import path from 'path';
import fg from 'fast-glob';
import config from '../config.js';
import { LLMServiceFactory } from './llm-service.js';
import pc from 'picocolors';
import { createInterface } from 'readline';
import cliProgress from 'cli-progress';

interface Project {
    path: string;
    name: string;
    indexed: boolean;
    hasSummaries?: boolean;
}

interface IndexedContent {
    content: string;
    path: string;
    summary?: string;
    score?: number;
}

interface DocumentIndex {
  path: string;
  content: string;
  title: string;
  lastModified: number;
  size: number;
  summary?: string;
  score?: number;
}

interface FileStats {
    totalFiles: number;
    totalSize: number;
    totalWords: number;
}

// Store indexed documents for each project
const projectIndices: Record<string, Map<string, DocumentIndex>> = {};

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
 * Calculate file statistics and estimated costs
 */
const calculateFileStats = async (files: string[]): Promise<FileStats> => {
    let totalSize = 0;
    let totalWords = 0;

    for (const file of files) {
        const content = await fs.readFile(file, 'utf-8');
        totalSize += content.length;
        totalWords += content.split(/\s+/).length;
    }

    return {
        totalFiles: files.length,
        totalSize,
        totalWords
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
 * Index a project by its ID
 */
export const indexProject = async (projectId: string, options: { withSummaries?: boolean } = {}): Promise<void> => {
    try {
        const projects = await config.get('projects') as Record<string, Project>;
        const project = projects[projectId];

        if (!project) {
            throw new Error(`Project with ID ${projectId} not found`);
        }

        // Check if an LLM provider is available when summarization is requested
        if (options.withSummaries) {
            try {
                // This will throw if no LLM provider is available
                await LLMServiceFactory.getLLMService();
            } catch (error) {
                throw new Error('No LLM provider available. Please configure an LLM provider using "adist llm-config"');
            }
        }

        const patterns = [
            './**/*.{md,txt,js,jsx,ts,tsx,py,java,c,cpp,h,hpp,cs,go,rs,php,rb,swift,kt,scala,sql,html,css,scss,sass,less,json,yaml,yml,toml,ini,conf,sh,bash,zsh,fish,ps1,bat,cmd,r,m,mm,f90,f95,f03,f08,pl,pm,t,pod,exs,ex,erl,hrl,clj,cljc,cljs,edn,lua,tcl,v,sv,vhd,vhdl,xml,dtd,xsd,xsl,xslt,wsdl,sgml,rst,asciidoc,adoc,asc,textile,org,wiki,mediawiki,dokuwiki,tex,latex,sty,cls,bib,markdown,mdown,mkdn,mkd,mdwn,mdtxt,mdtext,text,rmd,pod6,p6,pl6,pm6,nqp,rakumod,rakudoc,rakutest,raku,pod,properties,gradle,pom,ivy,ant,make,cmake,ninja,bazel,buck,xcode,pbxproj,xcodeproj,xcworkspace,sln,csproj,vbproj,vcxproj,proj,targets,props,nuspec,config,manifest,app.config,web.config,packages.config,package.json,bower.json,composer.json,gemfile,podfile,cartfile,podspec,gradle.properties,build.gradle,settings.gradle,gradlew,gradle-wrapper.properties,mvnw,maven-wrapper.properties,pom.properties,build.xml,ivy.xml,ant.xml,makefile,cmakefile.txt,cmakelists.txt,build.ninja,bazel.build,buck.build,build.buck,xcconfig,pbxproj,xcscheme,xcworkspacedata,sln,csproj,vbproj,vcxproj,props,targets,nuspec,config,manifest,app.config,web.config,packages.config}',
            '!**/node_modules/**',
            '!**/.git/**',
            '!**/dist/**',
            '!**/build/**',
            '!**/.next/**',
            '!**/.nuxt/**',
            '!**/.output/**',
            '!**/.cache/**',
            '!**/.temp/**',
            '!**/tmp/**',
            '!**/.DS_Store',
            '!**/*.min.*',
            '!**/*.map'
        ];

        const files = await fg(patterns, {
            cwd: project.path,
            absolute: true,
            onlyFiles: true,
            followSymbolicLinks: false,
            ignore: ['../**'] // Prevent indexing parent directories
        });

        // If summarization is requested, calculate stats and show confirmation
        if (options.withSummaries) {
            const stats = await calculateFileStats(files);
            console.log(pc.bold('Project Statistics:'));
            console.log(`${pc.dim('Total Files:')} ${pc.green(stats.totalFiles)}`);
            console.log(`${pc.dim('Total Size:')} ${pc.green(formatBytes(stats.totalSize))}`);
            console.log(`${pc.dim('Total Words:')} ${pc.green(stats.totalWords.toLocaleString())}`);

            const readline = createInterface({
                input: process.stdin,
                output: process.stdout
            });

            const answer = await new Promise<string>(resolve => {
                readline.question(pc.yellow('Do you want to proceed with summarization? (y/N): '), resolve);
            });
            readline.close();

            if (answer.toLowerCase() !== 'y') {
                console.log(pc.yellow('Summarization cancelled. Proceeding with regular indexing...'));
                options.withSummaries = false;
                // Update project status to reflect that summarization was cancelled
                project.hasSummaries = false;
                await config.set(`projects.${projectId}`, project);
            }
        }

        const indexedContents: IndexedContent[] = [];
        const fileSummaries: { path: string; summary: string }[] = [];

        // Get the LLM service
        const llmService = options.withSummaries ? await LLMServiceFactory.getLLMService() : null;

        // Create progress bar for indexing
        const progressBar = new cliProgress.SingleBar({
            format: '{bar} {percentage}% | {value}/{total} Files | {file}',
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true,
            clearOnComplete: false
        }, cliProgress.Presets.shades_classic);

        progressBar.start(files.length, 0, { file: 'Starting...' });

        for (const file of files) {
            try {
                const content = await fs.readFile(file, 'utf-8');
                const relativePath = path.relative(project.path, file);
                
                let summary: string | undefined;
                if (options.withSummaries && llmService) {
                    const result = await llmService.summarizeFile(content, relativePath);
                    summary = result.summary;
                    fileSummaries.push({ path: relativePath, summary });
                }

                indexedContents.push({
                    content,
                    path: relativePath,
                    summary
                });

                progressBar.increment(1, { file: relativePath });
            } catch (error) {
                console.error(pc.red(`Error processing file ${file}:`), error);
                progressBar.increment(1, { file: 'Error: ' + path.relative(project.path, file) });
            }
        }

        progressBar.stop();

        // Generate overall summary if requested
        if (options.withSummaries && llmService && fileSummaries.length > 0) {
            console.log(pc.dim('Generating overall project summary...'));
            const result = await llmService.generateOverallSummary(fileSummaries);
            await config.set(`summaries.${projectId}.overall`, result.summary);
        }

        // Store the indexed contents
        await config.set(`indexes.${projectId}`, indexedContents);

        // Update project status
        project.indexed = true;
        project.hasSummaries = options.withSummaries;
        await config.set(`projects.${projectId}`, project);

        console.log(pc.green('✓ Project reindexed successfully!'));
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
    
    // Extract significant words from content and paths
    mainDocs.forEach(doc => {
        // Extract words from path (filenames, directories)
        const pathParts = doc.path.split(/[\/\\._-]/).filter(part => part.length > 3);
        pathParts.forEach(part => keywordsFromMainDocs.add(part.toLowerCase()));
        
        // Extract significant words from content
        // Focus on words that appear in multiple main documents
        const contentWords = doc.content
            .split(/\s+/)
            .filter(word => word.length > 4)  // Skip short words
            .slice(0, 200)                    // Limit number of words to check
            .map(word => word.toLowerCase().replace(/[^\w]/g, ''));
            
        contentWords.forEach(word => keywordsFromMainDocs.add(word));
        
        // Also add words from summary if available
        if (doc.summary) {
            const summaryWords = doc.summary
                .split(/\s+/)
                .filter(word => word.length > 4)
                .map(word => word.toLowerCase().replace(/[^\w]/g, ''));
                
            summaryWords.forEach(word => keywordsFromMainDocs.add(word));
        }
    });
    
    // Remove very common words that won't be useful for finding related documents
    const commonWords = ['const', 'function', 'return', 'export', 'import', 'class', 'interface', 'string', 'number', 'boolean'];
    commonWords.forEach(word => keywordsFromMainDocs.delete(word));
    
    // Score all other documents by relevance to the keywords
    const similarDocs = allDocs
        .filter(doc => !selectedPaths.has(doc.path))  // Exclude already selected docs
        .map(doc => {
            const contentLower = doc.content.toLowerCase();
            const pathLower = doc.path.toLowerCase();
            
            // Calculate similarity score based on keyword matches
            let score = 0;
            keywordsFromMainDocs.forEach(keyword => {
                // Check for keyword in content
                if (contentLower.includes(keyword)) {
                    score += 1;
                }
                
                // Path matches are stronger indicators
                if (pathLower.includes(keyword)) {
                    score += 3;
                }
                
                // Check summary if available
                if (doc.summary && doc.summary.toLowerCase().includes(keyword)) {
                    score += 2;
                }
            });
            
            return {
                ...doc,
                score
            };
        })
        .filter(doc => doc.score > 0)  // Only consider docs with some similarity
        .sort((a, b) => b.score - a.score)  // Sort by similarity score
        .slice(0, limit);  // Take top N similar docs
        
    // Remove the scores before returning
    return similarDocs.map(({ score, ...docWithoutScore }) => docWithoutScore);
};

/**
 * Search for documents in the current project
 */
export const searchDocuments = async (query: string): Promise<IndexedContent[]> => {
    try {
        const currentProjectId = await config.get('currentProject') as string;
        if (!currentProjectId) {
            throw new Error('No project is currently selected');
        }

        const indexes = await config.get(`indexes.${currentProjectId}`) as IndexedContent[];
        if (!indexes) {
            throw new Error('Project has not been indexed');
        }

        // Get project overall summary if it exists
        const overallSummary = await config.get(`summaries.${currentProjectId}.overall`) as string | undefined;

        const searchTerms = query.toLowerCase().split(/\s+/);
        
        // Special case for "what's this project about" type queries - return all README files
        const isProjectDescriptionQuery = 
            query.toLowerCase().includes('what') && 
            query.toLowerCase().includes('project') && 
            (query.toLowerCase().includes('about') || query.toLowerCase().includes('is'));
            
        // Score each document for relevance
        const scoredResults = indexes.map(doc => {
            const contentLower = doc.content.toLowerCase();
            const pathLower = doc.path.toLowerCase();
            const summaryLower = doc.summary?.toLowerCase() || '';
            const overallSummaryLower = overallSummary?.toLowerCase() || '';
            
            // Calculate score based on various factors
            let score = 0;
            
            // Count term occurrences - more occurrences means higher relevance
            for (const term of searchTerms) {
                // Skip very short terms that could cause noise
                if (term.length <= 2) continue;
                
                // Count occurrences in content
                const contentMatches = (contentLower.match(new RegExp(term, 'g')) || []).length;
                score += contentMatches;
                
                // Path matches are highly relevant (weighted more)
                const pathMatches = (pathLower.match(new RegExp(term, 'g')) || []).length;
                score += pathMatches * 5;
                
                // Summary matches are also more relevant than just content matches
                const summaryMatches = (summaryLower.match(new RegExp(term, 'g')) || []).length;
                score += summaryMatches * 3;
                
                // Overall summary matches can indicate project-wide relevance
                const overallMatches = (overallSummaryLower.match(new RegExp(term, 'g')) || []).length;
                score += overallMatches * 2;
            }
            
            // Penalize very large files (they might contain matches but be less focused)
            const contentLength = doc.content.length;
            if (contentLength > 10000) {
                score = score * (1 - Math.min(0.5, (contentLength - 10000) / 100000));
            }
            
            // Bonus for README and documentation files for project-related queries
            if (isProjectDescriptionQuery && 
                (pathLower.includes('readme') || 
                 pathLower.endsWith('.md') || 
                 pathLower.includes('docs/'))) {
                score += 20;
            }
            
            // Bonus for config and package files for project structure queries
            if (query.toLowerCase().includes('setup') || 
                query.toLowerCase().includes('config') || 
                query.toLowerCase().includes('dependencies')) {
                if (pathLower.includes('package.json') || 
                    pathLower.includes('config') || 
                    pathLower.endsWith('.toml') || 
                    pathLower.endsWith('.yaml') || 
                    pathLower.endsWith('.yml')) {
                    score += 15;
                }
            }
            
            return {
                ...doc,
                score
            };
        });
        
        // Filter out documents with zero score
        let results = scoredResults
            .filter(doc => doc.score > 0)
            // Sort by score in descending order
            .sort((a, b) => b.score - a.score)
            // Take top results (limited to 5 most relevant documents to avoid context overflow)
            .slice(0, 5);
        
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

            // Always include the file's summary if available
            if (result.summary) {
                contextParts.push(`File Summary:\n${result.summary}`);
            }

            // Always include the overall project summary if available
            if (overallSummary) {
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
export const reindexCurrentProject = async (options: { withSummaries?: boolean } = {}): Promise<void> => {
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
export const initializeIndices = async (options: { withSummaries?: boolean; projectId?: string } = {}): Promise<void> => {
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