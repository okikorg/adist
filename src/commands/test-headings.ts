import pc from 'picocolors';
import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { MarkdownParser } from '../utils/parsers/markdown-parser.js';

/**
 * Command for testing heading extraction in markdown files
 */
export const testHeadingsCommand = new Command('test-headings')
  .description('Test heading extraction in markdown files')
  .argument('<file>', 'Path to markdown file')
  .action(async (filePath: string) => {
    try {
      // Resolve the file path
      const resolvedPath = path.resolve(filePath);
      console.log(pc.cyan(`Testing heading extraction for: ${pc.bold(resolvedPath)}`));

      // Read the file
      const content = await fs.readFile(resolvedPath, 'utf-8');
      const stats = await fs.stat(resolvedPath);

      // Parse the file
      const parser = new MarkdownParser();
      const document = await parser.parse(resolvedPath, content, {
        size: stats.size,
        mtime: stats.mtime
      });

      // Display the results
      console.log(pc.green(`Found ${document.blocks.length} blocks in the document`));
      
      // Display heading blocks
      const headingBlocks = document.blocks.filter(block => block.type === 'heading');
      console.log(pc.yellow(`${headingBlocks.length} heading blocks:`));
      
      for (const block of headingBlocks) {
        console.log(pc.bold(`\nHeading: ${block.title} (lines ${block.startLine}-${block.endLine})`));
        console.log(pc.dim('Content:'));
        console.log(block.content);
        console.log(pc.dim('---'));
      }

      process.exit(0);
    } catch (error) {
      console.error(pc.bold(pc.red('✘ Error testing headings:')), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }); 