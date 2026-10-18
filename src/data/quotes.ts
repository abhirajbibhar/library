export interface Quote {
  id: string;
  text: string;
  author: string;
  book?: string;
  year?: number;
}

export const literaryQuotes: Quote[] = [
  {
    id: '1',
    text: 'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.',
    author: 'Jane Austen',
    book: 'Pride and Prejudice',
    year: 1813,
  },
  {
    id: '2',
    text: 'All happy families are alike; each unhappy family is unhappy in its own way.',
    author: 'Leo Tolstoy',
    book: 'Anna Karenina',
    year: 1878,
  },
  {
    id: '3',
    text: 'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness.',
    author: 'Charles Dickens',
    book: 'A Tale of Two Cities',
    year: 1859,
  },
  {
    id: '4',
    text: 'In the beginning the universe was created. This has made a lot of people very angry and been widely regarded as a bad move.',
    author: 'Douglas Adams',
    book: 'The Restaurant at the End of the Universe',
    year: 1980,
  },
  {
    id: '5',
    text: 'Reader, I married him.',
    author: 'Charlotte Brontë',
    book: 'Jane Eyre',
    year: 1847,
  },
  {
    id: '6',
    text: 'We are all in the gutter, but some of us are looking at the stars.',
    author: 'Oscar Wilde',
    book: "Lady Windermere's Fan",
    year: 1892,
  },
  {
    id: '7',
    text: 'The only way out of the labyrinth of suffering is to forgive.',
    author: 'John Green',
    book: 'Looking for Alaska',
    year: 2006,
  },
  {
    id: '8',
    text: 'So we beat on, boats against the current, borne back ceaselessly into the past.',
    author: 'F. Scott Fitzgerald',
    book: 'The Great Gatsby',
    year: 1925,
  },
  {
    id: '9',
    text: 'Whatever our souls are made of, his and mine are the same.',
    author: 'Emily Brontë',
    book: 'Wuthering Heights',
    year: 1847,
  },
  {
    id: '10',
    text: 'The person, be it gentleman or lady, who has not pleasure in a good novel, must be intolerably stupid.',
    author: 'Jane Austen',
    book: 'Northanger Abbey',
    year: 1818,
  },
  {
    id: '11',
    text: 'I have not failed. I\'ve just found 10,000 ways that won\'t work.',
    author: 'Thomas A. Edison',
    year: 1879,
  },
  {
    id: '12',
    text: 'The unexamined life is not worth living.',
    author: 'Socrates',
    year: 399,
  },
  {
    id: '13',
    text: 'To be or not to be, that is the question.',
    author: 'William Shakespeare',
    book: 'Hamlet',
    year: 1603,
  },
  {
    id: '14',
    text: 'The only thing we have to fear is fear itself.',
    author: 'Franklin D. Roosevelt',
    year: 1933,
  },
  {
    id: '15',
    text: 'I think, therefore I am.',
    author: 'René Descartes',
    book: 'Discourse on the Method',
    year: 1637,
  },
  {
    id: '16',
    text: 'The spice must flow.',
    author: 'Frank Herbert',
    book: 'Dune',
    year: 1965,
  },
  {
    id: '17',
    text: 'Elementary, my dear Watson.',
    author: 'Arthur Conan Doyle',
    book: 'Sherlock Holmes',
    year: 1887,
  },
  {
    id: '18',
    text: 'Curiouser and curiouser!',
    author: 'Lewis Carroll',
    book: "Alice's Adventures in Wonderland",
    year: 1865,
  },
  {
    id: '19',
    text: 'A reader lives a thousand lives before he dies. The man who never reads lives only one.',
    author: 'George R.R. Martin',
    book: 'A Dance with Dragons',
    year: 2011,
  },
  {
    id: '20',
    text: 'There is no greater agony than bearing an untold story inside you.',
    author: 'Maya Angelou',
    book: 'I Know Why the Caged Bird Sings',
    year: 1969,
  },
  {
    id: '21',
    text: 'The world was made to be free in. Give up all the other worlds except the one to which you belong.',
    author: 'C.S. Lewis',
    book: 'The Discarded Image',
    year: 1964,
  },
  {
    id: '22',
    text: 'Not all those who wander are lost.',
    author: 'J.R.R. Tolkien',
    book: 'The Fellowship of the Ring',
    year: 1954,
  },
  {
    id: '23',
    text: 'The only limit to our realization of tomorrow will be our doubts of today.',
    author: 'Franklin D. Roosevelt',
    year: 1945,
  },
  {
    id: '24',
    text: 'It does not do to dwell on dreams and forget to live.',
    author: 'J.K. Rowling',
    book: "Harry Potter and the Sorcerer's Stone",
    year: 1997,
  },
  {
    id: '25',
    text: 'Words are, in my not-so-humble opinion, our most inexhaustible source of magic.',
    author: 'J.K. Rowling',
    book: 'Harry Potter and the Deathly Hallows',
    year: 2007,
  },
];

export function getRandomQuote(excludeId?: string): Quote {
  const available = excludeId 
    ? literaryQuotes.filter(q => q.id !== excludeId)
    : literaryQuotes;
  
  const randomIndex = Math.floor(Math.random() * available.length);
  return available[randomIndex];
}

export function getQuoteOfDay(): Quote {
  // Use date as seed for consistent daily quote
  const today = new Date();
  const dayOfYear = Math.floor(
    (today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / 86400000
  );
  const index = dayOfYear % literaryQuotes.length;
  return literaryQuotes[index];
}
