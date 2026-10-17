# Kerb — where can I park in London?

**Live demo: https://mohsenbarzegar.github.io/kerb/**

Free, instant London parking answers from open data — the demo front-end
for the Kerb MCP server (an AI-first alternative to AppyParking+).

- Type a London place; answers come from a local snapshot of OpenStreetMap
  (Geofabrik Greater London extract, © OpenStreetMap contributors, ODbL),
  shipped with this site as data tiles — no live API calls, so it's instant.
- Verdicts (likely ok / restricted / mixed by side / unknown) are computed
  in your browser by `engine.js`, a port of the same restriction engine the
  MCP server runs, parity-tested against it.
- Open data is incomplete: **always check the sign on the street — it is
  the legal truth.**
- D-TRO (the DfT's digital Traffic Regulation Orders) joins the same engine
  once our data-consumer account is approved.
