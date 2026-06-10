"use client";

/**
 * PlayerSubsetPicker — reusable Player subset selector (#76).
 *
 * Name search → chip list, the pattern the skill-evaluation runner introduced
 * in #73, extracted so every pipeline stage runner shares one picker instead
 * of duplicating it. Empty selection means "all qualifying Players" by
 * convention — consumers render the scope copy.
 *
 * The selected list is controlled by the parent; search state lives here.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { searchPlayers } from "@/lib/api";
import type { Player } from "@/lib/types";

export type PlayerLite = Pick<Player, "id" | "name" | "team" | "position">;

interface PlayerSubsetPickerProps {
  /** Prefix for every element id, e.g. "pipeline-subset" → id="pipeline-subset-picker". */
  idPrefix: string;
  selected: PlayerLite[];
  onChange: (players: PlayerLite[]) => void;
  disabled?: boolean;
  /** Kicker label above the search input. */
  label?: string;
  placeholder?: string;
}

const SEARCH_DEBOUNCE_MS = 250;

export function PlayerSubsetPicker({
  idPrefix,
  selected,
  onChange,
  disabled = false,
  label = "Players",
  placeholder = "Search players by name to add a subset…",
}: PlayerSubsetPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerLite[]>([]);
  const [searching, setSearching] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced player name search.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      const res = await searchPlayers(trimmed);
      if (res.success && res.data) {
        setResults(res.data);
      } else {
        setResults([]);
      }
      setSearching(false);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query]);

  const addPlayer = useCallback(
    (player: PlayerLite) => {
      if (!selected.some((p) => p.id === player.id)) {
        onChange([...selected, player]);
      }
      setQuery("");
      setResults([]);
    },
    [selected, onChange]
  );

  const removePlayer = useCallback(
    (playerId: string) => {
      onChange(selected.filter((p) => p.id !== playerId));
    },
    [selected, onChange]
  );

  return (
    <div id={`${idPrefix}-picker`} className="mb-5">
      <span className="block text-[11px] uppercase tracking-wider font-semibold text-neutral-400 mb-2">
        {label}
      </span>
      <div className="relative">
        <input
          id={`${idPrefix}-search-input`}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          className="w-full text-sm border border-[#d9d0c9] rounded-[6px] px-3 py-2 focus:outline-none focus:border-[#ffa05c] disabled:opacity-50"
        />
        {(searching || results.length > 0) && query.trim().length >= 2 && (
          <ul
            id={`${idPrefix}-results`}
            className="absolute z-10 mt-1 w-full max-h-56 overflow-auto rounded-[6px] border border-[#d9d0c9] bg-white shadow-sm"
          >
            {searching && (
              <li className="px-3 py-2 text-xs text-neutral-400">Searching…</li>
            )}
            {!searching && results.length === 0 && (
              <li className="px-3 py-2 text-xs text-neutral-400">No matches.</li>
            )}
            {results.map((p) => (
              <li key={p.id}>
                <button
                  id={`${idPrefix}-result-${p.id}`}
                  type="button"
                  onClick={() => addPlayer(p)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[#fff8f4] flex items-center justify-between gap-2"
                >
                  <span className="text-[#0e0907]">{p.name}</span>
                  <span className="text-[11px] text-neutral-400">
                    {[p.team, p.position].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected.length > 0 && (
        <div id={`${idPrefix}-selected`} className="flex flex-wrap gap-2 mt-3">
          {selected.map((p) => (
            <span
              key={p.id}
              id={`${idPrefix}-selected-${p.id}`}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded border border-[#ffa05c]/50 bg-[#ffa05c]/20 text-[#fe6d34]"
            >
              {p.name}
              <button
                id={`${idPrefix}-remove-${p.id}`}
                type="button"
                onClick={() => removePlayer(p.id)}
                aria-label={`Remove ${p.name}`}
                className="text-[#fe6d34] hover:text-[#0e0907] leading-none"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
