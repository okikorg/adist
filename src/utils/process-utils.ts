import { spawn } from 'child_process';

/**
 * Options for executing commands
 */
export interface ExecuteCommandOptions {
  /**
   * Working directory
   */
  cwd?: string;
  
  /**
   * Environment variables
   */
  env?: Record<string, string>;
  
  /**
   * Timeout in milliseconds
   */
  timeout?: number;
}

/**
 * Execute a command and return its output
 * 
 * @param command Command to execute
 * @param args Command arguments
 * @param options Execution options
 * @returns Promise with command output
 */
export function executeCommand(
  command: string,
  args: string[] = [],
  options: ExecuteCommandOptions = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Set defaults
    const cwd = options.cwd || process.cwd();
    const env = options.env || process.env;
    const timeout = options.timeout || 30000; // Default 30 seconds
    
    // Spawn the process
    const proc = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    // Set up timeout
    const timeoutId = setTimeout(() => {
      proc.kill();
      reject(new Error(`Command ${command} timed out after ${timeout}ms`));
    }, timeout);
    
    // Collect output
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', data => {
      stdout += data.toString();
    });
    
    proc.stderr.on('data', data => {
      stderr += data.toString();
    });
    
    // Handle completion
    proc.on('close', code => {
      clearTimeout(timeoutId);
      
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Command ${command} failed with code ${code}: ${stderr}`));
      }
    });
    
    // Handle errors
    proc.on('error', err => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}

/**
 * Check if a command is available on the system
 * 
 * @param command Command to check
 * @returns Promise<boolean> True if command is available
 */
export async function isCommandAvailable(command: string): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      // Windows
      await executeCommand('where', [command], { timeout: 1000 });
    } else {
      // Unix-like
      await executeCommand('which', [command], { timeout: 1000 });
    }
    return true;
  } catch (error) {
    return false;
  }
} 