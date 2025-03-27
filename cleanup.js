import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Conf = require('conf');

// Initialize config
const config = new Conf({
  projectName: 'adist',
  fileExtension: 'json'
});

// Get and clean projects
const projects = config.get('projects') || {};
const cleanProjects = {};

console.log("Current projects:", Object.keys(projects).length);
console.log("Projects found:", projects);

for (const [id, project] of Object.entries(projects)) {
  if (
    project && 
    typeof project === 'object' && 
    typeof project.name === 'string' && 
    typeof project.path === 'string'
  ) {
    cleanProjects[id] = project;
    console.log(`Valid project: ${project.name} (${id})`);
  } else {
    console.log(`Removing invalid project with ID: ${id}`);
  }
}

// Save cleaned projects
config.set('projects', cleanProjects);
console.log(`Projects config cleaned up. Remaining projects: ${Object.keys(cleanProjects).length}`);

// Verify current project is valid
const currentProjectId = config.get('currentProject');
if (currentProjectId && !cleanProjects[currentProjectId]) {
  console.log(`Current project ${currentProjectId} is invalid, setting to first available project`);
  
  const firstProjectId = Object.keys(cleanProjects)[0];
  if (firstProjectId) {
    config.set('currentProject', firstProjectId);
    console.log(`Set current project to: ${cleanProjects[firstProjectId].name}`);
  } else {
    config.delete('currentProject');
    console.log('No valid projects found, clearing current project setting');
  }
} 