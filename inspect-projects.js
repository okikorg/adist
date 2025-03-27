import Conf from 'conf';

// Initialize config
const config = new Conf({
  projectName: 'adist',
  fileExtension: 'json'
});

// Get and print projects
const projects = config.get('projects') || {};

console.log('Projects object keys:');
for (const key of Object.keys(projects)) {
  console.log(`- Key: "${key}"`);
  const project = projects[key];
  console.log(`  Type: ${typeof project}`);
  
  if (typeof project === 'object' && project !== null) {
    console.log('  Properties:');
    for (const propKey of Object.keys(project)) {
      const value = project[propKey];
      console.log(`    ${propKey}: ${typeof value} = ${value}`);
    }
  } else {
    console.log(`  Value: ${JSON.stringify(project)}`);
  }
  console.log();
}

// Get current project
const currentProject = config.get('currentProject');
console.log(`Current project: ${currentProject}`);

// Get indexes
const indexes = config.get('indexes') || {};
console.log('\nIndex keys:');
for (const key of Object.keys(indexes)) {
  console.log(`- ${key}`);
}

console.log('\nConfig path:', config.path); 