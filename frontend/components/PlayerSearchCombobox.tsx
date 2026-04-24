"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { listPlayers } from "@/lib/api";
import type { Player } from "@/lib/types";

interface PlayerSearchComboboxProps {
  onSelect: (player: Player) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Autocomplete combobox that searches players by name against GET /api/players.
 * Debounces input by 300ms. Shows name, team, and position in the dropdown.
 * Reused in calibration and roster builder.
 */
export function PlayerSearchCombobox({
  onSelect,
  placeholder = "Search players…",
  className,
}: PlayerSearchComboboxProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Player[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Debounced search — triggers 300ms after the user stops typing
  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const res = await listPlayers(q);
      if (res.success && res.data) {
        // Filter client-side by name since the backend may not support ?search param.
        // Strip diacritics so "jokic" matches "Jokić", "luka" matches "Lūka", etc.
        const strip = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        const normalizedQuery = strip(q);
        const filtered = res.data.filter((p) =>
          strip(p.name).includes(normalizedQuery)
        );
        setResults(filtered.slice(0, 10));
        setOpen(true);
        setHighlightedIndex(-1);
      }
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  const handleSelect = (player: Player) => {
    setQuery(player.name);
    setOpen(false);
    setResults([]);
    onSelect(player);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && highlightedIndex >= 0) {
      e.preventDefault();
      handleSelect(results[highlightedIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        inputRef.current &&
        !inputRef.current.parentElement?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={placeholder}
          autoComplete="off"
          className={cn(
            "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent",
            "placeholder:text-muted-foreground"
          )}
          id="player-search-input"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls="player-search-listbox"
          role="combobox"
          aria-autocomplete="list"
        />
        {loading && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          </span>
        )}
      </div>

      {open && results.length > 0 && (
        <ul
          ref={listRef}
          id="player-search-listbox"
          role="listbox"
          className={cn(
            "absolute z-50 mt-1 w-full rounded-md border border-border bg-background",
            "shadow-md overflow-auto max-h-60 py-1"
          )}
        >
          {results.map((player, i) => (
            <li
              key={player.id}
              role="option"
              aria-selected={i === highlightedIndex}
              onMouseDown={() => handleSelect(player)}
              onMouseEnter={() => setHighlightedIndex(i)}
              className={cn(
                "flex items-center justify-between px-3 py-2 cursor-pointer text-sm",
                i === highlightedIndex ? "bg-accent" : "hover:bg-accent/50"
              )}
            >
              <span className="font-medium">{player.name}</span>
              <span className="text-xs text-muted-foreground">
                {player.team && <span>{player.team}</span>}
                {player.position && (
                  <span className="ml-1.5 text-muted-foreground/70">{player.position}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
