# /players Route — Clarifying Questions

Please answer each question on the line below it.

---

## 1. Data & Skills Loading

The current `GET /api/players` endpoint returns basic player metadata (name, team, position, age, games_played, minutes_per_game) but **does not include skill tiers inline**. Loading skills for every player would require N+1 requests or a new bulk endpoint.

**Q1a: Should we build a new backend endpoint (e.g. `GET /api/players/with-skills`) that returns all players with their composite skill tiers in a single response?**

Answer: Yes

**Q1b: Should the players table view load lazily (basic info first, skills on demand) or all at once upfront?**

Answer: WHats the tradeoff? IOs this necessary if we build a new endpoint?

---

## 2. Skill Filtering

Skills are structured as a map of `skill_name → { final_tier, ... }` (e.g. `spot_up_shooter → Elite`).

**Q2a: When filtering by skill, do you want to filter by a specific skill + tier combination (e.g. "spot_up_shooter is Elite or higher"), or just whether a player has a skill at all (any tier > None)?**

Answer: spot_up_shooter is Elite or higher

**Q2b: Should "skill level" filtering use the tier labels (All-Time Great / Elite / Capable / None) or a numeric representation?**

Answer: tier labels, but I wantto be able to do something like cpabale or hgiher where it shows capable elite and all time

**Q2c: Should filtering by a skill automatically show that skill's tier in the table/card, or always show all skills?**

Answer: Tables should always show all skills, cards should show the top 6 skills. By top I mean All time > Elite > Capable > None. It shouldnt ever show None skills in cards unless the user expands it to show all. If a player doesnt have 6 skills above none, then show however many they do have. If they have more, prioritize additive, then threshold then zero sum

---

## 3. Filter UI & Logic

**Q3a: For OR / AND / NOT logic — should this apply between filters as a whole group rule, or should each filter individually have an operator toggle? For example:**
- **Option A (group-level):** One toggle for the whole filter set — "Match ALL filters (AND) / Match ANY filter (OR)"
- **Option B (per-filter):** Each filter chip has its own operator (AND / OR / NOT) that stacks with the previous one

Which do you prefer, or something else?

Answer: B

**Q3b: For drag-and-drop filter reordering — is this purely cosmetic (order doesn't affect logic), or does filter order affect how the boolean logic chains (e.g. left-to-right evaluation)?**

Answer: Affects order

**Q3c: Should there be a maximum number of active filters at once?**

Answer: Maybe 10? make this an easily configurable value for me the developer.

I'm thinking of something similar I did in a differenrt project where I put together filters for a Pokemon teambuilder (obviously different subject matter but same idea). Look at `/Users/cdbrooks/Games/Pokemon Fan Games/pokemon-tectonic/tectonic-tools`. Here's a little intro:
```
Filter system to borrow from: tectonic-tools (Next.js 15 / TypeScript)                                                            
                                                                                                                                    
  Key files:                                                                                                                        
                                                                                                                                    
  File: src/components/filters.ts                                                                                                 
  What it does: The core filter engine. Defines PokemonFilterType (a filter template with a label, inputMethod: "text" | "select",
    and an apply(item, value) => boolean function), plus ActiveFilter, ParenMarker, and FilterEntry union. The evalFilterEntries()
    function recursively evaluates a flat list of filter entries — handling AND/OR operator precedence (AND binds tighter) and
  nested
     parenthesis groups.                                                                                                            
  ────────────────────────────────────────
  File: src/components/FilterInput.tsx                                                                                              
  What it does: The UI for the filter system. Renders a filter-type dropdown, a value input (text or select), an AND/OR toggle,   
    Add/Clear/Parens buttons, and a horizontal row of draggable pills (using @dnd-kit/core). Each pill has a connector badge        
    (clickable to toggle AND↔OR) and a NOT toggle.                                                                                
  ────────────────────────────────────────
  File: src/components/MiniDexFilter.tsx                                                                                            
  What it does: Example of wiring it all together — shows the state management pattern (filters, nextConnector, handlers for
    add/remove/toggle/reorder/clear), how useMemo drives the filtered list, and how quick-access buttons (type icons) map to the    
  same                                                                                                                            
     pill system.

  Architecture summary: Filters are plain objects with an apply function — easy to define for any domain (players, skills, stats).  
  Active filters are stored as a flat array with stable IDs for drag ordering. The eval logic is fully decoupled from the UI. To
  adapt it: replace Pokemon with your entity type, swap AVAILABLE_FILTERS definitions, and keep the evalFilterEntries + FilterInput 
  largely as-is.
```

---

## 4. Table View

**Q4a: Which columns should be shown by default in the table? (Select all that apply or rank them)**
- Name
- Team
- Position
- Age
- Height / Weight
- Games Played / MPG
- Salary
- Individual skill tiers (as columns — one per skill = 20 columns)
- Skill summary (e.g. count of Elite+ skills)

Answer: 
- Name
- Team
- Position
- Age
- Height / Weight
- Salary
- Individual skill tiers (as columns — one per skill = 20 columns)
- Skill summary (e.g. count of Elite+ skills)

**Q4b: Should columns be hideable/toggleable by the user, or is a fixed column set fine?**

Answer: Yes, they shoudl also be able to resize columns

**Q4c: Should clicking a row in the table navigate to the player profile page (`/players/[player_id]`)?**

Answer: yes

---

## 5. Card View

**Q5a: What information should appear on each player card? For example:**
- Name + team + position header
- Photo placeholder
- Key bio stats (age, height, weight)
- Skill tiers (all 20? just highlights? only non-None skills?)
- Flag/review status

Answer: Mentioned the skill tiers earlier but yes all of this

**Q5b: Should the profile photo placeholder be a generic silhouette icon, or a colored avatar with the player's initials?**

Answer: Silhouette

**Q5c: Should clicking a card navigate to the player's profile page?**

Answer: Yes

---

## 6. Sorting

**Q6a: For sorting by skill — should it sort by a specific skill's tier (chosen from a dropdown), or by the count of skills at a certain tier level?**

Answer: If I understand you correctly then tier?

**Q6b: Should multiple sort keys be supported (e.g. primary sort by position, secondary by name)?**

Answer: Yes

---

## 7. Performance & Pagination

**Q7a: Roughly how many players are in the dataset? (The current filter is ≥15 MPG, which typically yields ~250–350 NBA players)**

Answer: 370ish

**Q7b: Should the table/card view paginate, or load all players at once with client-side filtering?**

Answer: Definitely paginate

---

## 8. Design & Polish

**Q8a: Should the view toggle (table vs. cards) persist across page reloads (localStorage), or reset to table every time?**

Answer:persist

**Q8b: Is there a preferred number of cards per row in card view (e.g. 3, 4, auto-fill)?**

Answer: auot-fill

**Q8c: Should this page have the same NavBar as the rest of the app, or a custom layout?**

Answer: Yes, this page should be what opens when you click the players option in the navbar
