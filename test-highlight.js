#!/usr/bin/env node

// Import required modules
import { parseMessageWithCodeHighlighting } from './dist/utils/code-message-parser.js';

// Example message with code blocks in different languages
const exampleMessage = `
# Testing Code Syntax Highlighting

Here's a JavaScript example:

\`\`\`javascript
// A simple class 
class Person {
  constructor(name, age) {
    this.name = name;
    this.age = age;
  }
  
  greet() {
    return \`Hello, my name is \${this.name} and I am \${this.age} years old.\`;
  }
}

// Create a new person
const john = new Person("John", 30);
console.log(john.greet());
\`\`\`

And here's a Python example:

\`\`\`python
# A simple class
class Person:
    def __init__(self, name, age):
        self.name = name
        self.age = age
    
    def greet(self):
        return f"Hello, my name is {self.name} and I am {self.age} years old."

# Create a new person
john = Person("John", 30)
print(john.greet())
\`\`\`

And finally, here's some SQL:

\`\`\`sql
-- Select all users over 30
SELECT name, age 
FROM users 
WHERE age > 30 
ORDER BY name ASC;
\`\`\`

That's it for our test!
`;

// Process the message and highlight code blocks
async function main() {
  try {
    const highlightedMessage = parseMessageWithCodeHighlighting(exampleMessage);
    console.log(highlightedMessage);
  } catch (error) {
    console.error('Error highlighting code:', error);
  }
}

// Run the main function
main(); 