# Contributing

## Scope
- Keep changes focused on Verdent local integration, reverse engineering notes, and the HTTP wrapper.
- Do not commit extracted proprietary application bundles or local databases.

## Development
```bash
npm start
npm run discover
npm run check
```

## Pull Requests
- Describe the Verdent version and host OS used for validation.
- Include sanitized request/response samples when adding or changing endpoints.
- Never include real tokens, JWTs, local absolute paths outside examples, or private user data.
