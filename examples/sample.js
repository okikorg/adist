/**
 * This is a sample JavaScript file to demonstrate the syntax highlighting.
 */

// A simple class for demonstration
class Person {
  constructor(name, age) {
    this.name = name;
    this.age = age;
  }
  
  greet() {
    return `Hello, my name is ${this.name} and I am ${this.age} years old.`;
  }
  
  static createPerson(name, age) {
    return new Person(name, age);
  }
}

// Arrow function example
const calculateArea = (radius) => {
  const PI = 3.14159;
  return PI * radius * radius;
};

// Async function with try/catch
async function fetchUserData(userId) {
  try {
    const response = await fetch(`https://api.example.com/users/${userId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch user: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching user data:', error);
    return null;
  }
}

// Example of array methods
const numbers = [1, 2, 3, 4, 5];
const doubled = numbers.map(num => num * 2);
const even = numbers.filter(num => num % 2 === 0);
const sum = numbers.reduce((total, num) => total + num, 0);

console.log('Doubled:', doubled);
console.log('Even numbers:', even);
console.log('Sum:', sum);

// Export the Person class
module.exports = {
  Person,
  calculateArea,
  fetchUserData
}; 