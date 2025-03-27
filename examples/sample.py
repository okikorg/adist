#!/usr/bin/env python3
"""
This is a sample Python file to demonstrate the syntax highlighting.
"""

import os
import sys
from typing import List, Dict, Optional, Union
import json
from dataclasses import dataclass


@dataclass
class Person:
    """A class representing a person with name and age."""
    name: str
    age: int
    
    def greet(self) -> str:
        """Return a greeting message."""
        return f"Hello, my name is {self.name} and I am {self.age} years old."
    
    @classmethod
    def create_person(cls, name: str, age: int) -> 'Person':
        """Factory method to create a Person instance."""
        return cls(name, age)


def calculate_area(radius: float) -> float:
    """Calculate the area of a circle with the given radius."""
    PI = 3.14159
    return PI * radius * radius


async def fetch_user_data(user_id: int) -> Optional[Dict]:
    """Fetch user data from an API."""
    try:
        # This is a placeholder for asynchronous code
        # In a real application, you would use aiohttp or httpx
        print(f"Fetching user data for ID: {user_id}")
        
        # Simulate API response
        user_data = {
            "id": user_id,
            "name": "John Doe",
            "email": f"user{user_id}@example.com"
        }
        
        return user_data
    except Exception as e:
        print(f"Error fetching user data: {e}")
        return None


# Example of list comprehensions and generators
numbers = [1, 2, 3, 4, 5]
doubled = [num * 2 for num in numbers]
even = [num for num in numbers if num % 2 == 0]
squares_generator = (x**2 for x in range(10))

print("Doubled:", doubled)
print("Even numbers:", even)
print("Sum:", sum(numbers))

# Dictionary comprehension
name_to_age = {"Alice": 30, "Bob": 25, "Charlie": 35}
age_to_name = {age: name for name, age in name_to_age.items()}


if __name__ == "__main__":
    # Create an instance of Person
    person = Person("Alice", 30)
    print(person.greet())
    
    # Calculate area of a circle
    radius = 5.0
    area = calculate_area(radius)
    print(f"Area of circle with radius {radius}: {area:.2f}")
    
    # Use dictionary with default value
    colors = {"red": "#FF0000", "green": "#00FF00", "blue": "#0000FF"}
    print(f"Yellow color code: {colors.get('yellow', 'Not found')}")
    
    # Example of error handling
    try:
        value = int("not a number")
    except ValueError as e:
        print(f"Conversion error: {e}") 