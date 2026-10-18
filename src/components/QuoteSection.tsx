import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Quote, getQuoteOfDay, getRandomQuote } from '../data/quotes';
import { useLibraryStore } from '../store';
import { RefreshCw, Quote as QuoteIcon, BookOpen } from 'lucide-react';

const DAY = 86_400_000;

export default function QuoteSection() {
  const { quotes } = useLibraryStore();
  // Your own picked quotes come first; the built-in ones are only a fallback until you save some.
  const mine: Quote[] = useMemo(
    () => quotes.map((q) => ({ id: q.id, text: q.text, author: q.author || 'Unknown', book: q.book || undefined, year: q.year ?? undefined })),
    [quotes],
  );
  const [offset, setOffset] = useState(0);
  const [fallback, setFallback] = useState<Quote>(getQuoteOfDay());
  const [isAnimating, setIsAnimating] = useState(false);
  const currentQuote: Quote = mine.length ? mine[(Math.floor(Date.now() / DAY) + offset) % mine.length] : fallback;

  const handleRefresh = () => {
    setIsAnimating(true);
    setTimeout(() => {
      if (mine.length) setOffset((o) => o + 1);
      else setFallback(getRandomQuote(currentQuote.id));
      setIsAnimating(false);
    }, 300);
  };

  return (
    <div className="relative overflow-hidden rounded-md bg-gradient-to-br from-purple-900/40 via-blue-900/40 to-indigo-900/40 border border-purple-500/20 p-4 sm:p-6 md:p-8">
      {/* Decorative background elements */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl" />
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl" />
      
      {/* Content */}
      <div className="relative z-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 gap-3">
          <div className="flex items-center gap-2">
            <QuoteIcon className="w-5 h-5 text-purple-400" />
            <h3 className="text-sm font-semibold text-purple-300 uppercase tracking-wider">
              {mine.length ? 'From your quotes' : 'Daily Inspiration'}
            </h3>
          </div>
          <button
            onClick={handleRefresh}
            disabled={isAnimating || (mine.length === 1)}
            className="flex items-center justify-center w-8 h-8 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 transition-all duration-200 group"
            title="Get a new quote"
          >
            <RefreshCw className={`w-4 h-4 text-purple-300 group-hover:text-purple-200 transition-transform ${isAnimating ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Quote */}
        <div className={`transition-all duration-300 ${isAnimating ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}>
          {/* Large decorative quote mark */}
          <div className="absolute top-4 left-4 text-8xl text-purple-500/10 font-serif leading-none select-none">
            "
          </div>

          {/* Quote text */}
          <blockquote className="relative z-10 mb-4 sm:mb-6">
            <p className="text-lg sm:text-xl md:text-2xl text-gray-100 leading-relaxed font-light italic">
              {currentQuote.text}
            </p>
          </blockquote>

          {/* Attribution */}
          <div className="flex items-center justify-between flex-wrap gap-3 sm:gap-4">
            <div>
              <p className="text-base sm:text-lg font-semibold text-purple-200">
                — {currentQuote.author}
              </p>
              {currentQuote.book && (
                <div className="flex items-center gap-2 mt-1">
                  <BookOpen className="w-3.5 h-3.5 text-purple-400/60" />
                  <p className="text-sm text-purple-300/80">
                    {currentQuote.book}
                    {currentQuote.year && <span className="text-purple-400/60">, {currentQuote.year}</span>}
                  </p>
                </div>
              )}
              {!currentQuote.book && currentQuote.year && (
                <p className="text-sm text-purple-300/80 mt-1">
                  {currentQuote.year}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <Link to="/quotes" className="absolute bottom-3 right-4 text-xs text-purple-300/70 hover:text-purple-200 underline z-10">{mine.length ? 'Manage quotes' : 'Save your own quotes'}</Link>

      {/* Bottom decorative line */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-purple-500/50 to-transparent" />
    </div>
  );
}
