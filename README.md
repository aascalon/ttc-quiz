# TTC Quiz

**Play it at https://aascalon.github.io/ttc-quiz/**

Quizzes about the Toronto Transit Commission's bus and streetcar routes, in rounds of 5, 10 or 15 questions:

- **Number → name:** see a route number, pick its name from four options.
- **Name → number:** see a route's name on its sign, type its number.
- **Line → name:** see a route's line on a street map with no names (or streetcar tracks), pick its name from four. Wrong options run nearby, and never trace the same line (e.g. 29 Dufferin and 929 Dufferin Express).
- **Name → line:** see a route's name, draw it on a street map (without streetcar tracks to trace) by tapping along it. Scored 0–100 on how much of the route you covered and how much of your line was on it (full credit within 50 m, none past 200 m); 70 passes and 90+ counts towards Instant. Tunable in `src/drawScore.ts`.

You can quiz on the whole city, or draw an area on an OpenStreetMap map to only get routes that pass through it.

Progress is tracked per route and per quiz in the browser (New → Learning → Known → Instant, where Instant means three correct answers in a row, each under 2 seconds, or 3 when typing or recognising a line; for drawing, scoring 90+). Rounds use simple spaced repetition: missed routes come back soon, and routes you know rest for longer. **Learn mode** drills just the routes in the Learning stage.

Pushing to `main` runs the tests and deploys to GitHub Pages (`.github/workflows/deploy.yml`).

```sh
npm install
npm run dev       # local dev server
npm test          # unit + DOM tests (vitest)
npm run build     # static site in dist/
npm run data      # regenerate src/data/ (routes, lines, lookalike routes) from the GTFS feed (--refresh to re-download)
```

Route data comes from the [TTC Routes and Schedules](https://open.toronto.ca/dataset/ttc-routes-and-schedules/) GTFS feed, City of Toronto Open Data, under the Open Government Licence – Toronto. Only bus and streetcar routes are used (no subway/LRT lines).

Maps: [OpenStreetMap](https://www.openstreetmap.org/copyright) tiles, and for the line quizzes [OpenFreeMap](https://openfreemap.org)'s Positron style (© OpenMapTiles, data from OpenStreetMap) drawn with MapLibre, with the transit-track and (for line → name) label layers removed.
