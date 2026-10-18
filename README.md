# TTC Quiz

Quizzes about the Toronto Transit Commission. The first quiz shows a route number and asks you to pick its name from four options, in rounds of 5, 10 or 15 questions. You can quiz on the whole city, or draw an area on an OpenStreetMap map to only get routes that pass through it.

Progress is tracked per route in the browser (New → Learning → Known → Instant, where Instant means three correct answers in a row, each under 2 seconds), and rounds favour the routes you don't know yet.

```sh
npm install
npm run dev       # local dev server
npm test          # unit + DOM tests (vitest)
npm run build     # static site in dist/
npm run data      # regenerate src/data/routes.json from the GTFS feed (--refresh to re-download)
```

Route data comes from the [TTC Routes and Schedules](https://open.toronto.ca/dataset/ttc-routes-and-schedules/) GTFS feed, City of Toronto Open Data, under the Open Government Licence – Toronto. Only bus and streetcar routes are used (no subway/LRT lines).
