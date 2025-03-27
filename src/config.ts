import path from 'path';
import Conf from 'conf';

interface Project {
  path: string;
  name: string;
  indexed: boolean;
  lastIndexed?: Date;
}

interface AdistConfig {
  projects: Record<string, Project>;
  currentProject?: string;
}

// Create a config instance with async operations
const config = new Conf({
    projectName: 'adist',
    defaults: {
        projects: {}
    },
    accessPropertiesByDotNotation: true,
    fileExtension: 'json'
});

// Simple in-memory cache for frequently accessed config values
const memoryCache = new Map<string, {
  value: any;
  timestamp: number;
}>();

// Cache timeout in milliseconds (5 minutes)
const CACHE_TIMEOUT = 5 * 60 * 1000;

// Get value from cache or return null if not found or expired
const getFromCache = (key: string): any | null => {
  const cached = memoryCache.get(key);
  if (!cached) return null;
  
  // Check if cache is still valid
  const now = Date.now();
  if (now - cached.timestamp > CACHE_TIMEOUT) {
    memoryCache.delete(key);
    return null;
  }
  
  return cached.value;
};

// Set value in cache with current timestamp
const setInCache = (key: string, value: any): void => {
  memoryCache.set(key, {
    value,
    timestamp: Date.now()
  });
};

// Clear cache for a specific key or key prefix
const clearCache = (keyPrefix: string): void => {
  for (const key of memoryCache.keys()) {
    if (key === keyPrefix || key.startsWith(`${keyPrefix}.`)) {
      memoryCache.delete(key);
    }
  }
};

// Wrap config operations in promises with caching
export const getConfig = async (key: string) => {
    // Check cache first
    const cachedValue = getFromCache(key);
    if (cachedValue !== null) {
        return cachedValue;
    }
    
    // If not in cache, get from disk
    const value = config.get(key);
    
    // Cache the result
    setInCache(key, value);
    
    return value;
};

export const setConfig = async (key: string, value: any) => {
    // Update disk config
    config.set(key, value);
    
    // Update cache
    setInCache(key, value);
    
    // Clear any cache entries that might depend on this key
    clearCache(key);
    
    return value;
};

export const hasConfig = async (key: string) => {
    // Check cache first for performance
    if (memoryCache.has(key)) {
        return true;
    }
    
    return config.has(key);
};

export default {
    get: getConfig,
    set: setConfig,
    has: hasConfig
}; 