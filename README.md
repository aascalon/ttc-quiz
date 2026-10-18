# TTC Quiz

**Play it at https://aascalon.github.io/ttc-quiz/**

Quizzes about the Toronto Transit Commission's bus and streetcar routes, in rounds of 5, 10 or 15 questions:

- **Number → name:** see a route number, pick its name from four options.
- **Name → number:** see a route's name on its sign, type its number.

You can quiz on the whole city, or draw an area on an OpenStreetMap map to only get routes that pass through it.

Progress is tracked per route and per direction in the browser (New → Learning → Known → Instant, where Instant means three correct answers in a row, each under 2 seconds, or 3 when typing). Rounds use simple spaced repetition: missed routes come back soon, and routes you know rest for longer. **Learn mode** drills just the routes in the Learning stage.

Pushing to `main` runs the tests and deploys to GitHub Pages (`.github/workflows/deploy.yml`).

```sh
npm install
npm run dev       # local dev server
npm test          # unit + DOM tests (vitest)
npm run build     # static site in dist/
npm run data      # regenerate src/data/routes.json from the GTFS feed (--refresh to re-download)
```

Route data comes from the [TTC Routes and Schedules](https://open.toronto.ca/dataset/ttc-routes-and-schedules/) GTFS feed, City of Toronto Open Data, under the Open Government Licence – Toronto. Only bus and streetcar routes are used (no subway/LRT lines).
