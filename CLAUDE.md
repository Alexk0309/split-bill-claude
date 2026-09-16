# Working in this repo

## Branch for anything that is not a small fix

A new feature or a large change is built on its own branch, never directly on
`main`.

- Branch off the current `main` before the first edit, not after.
- Name the branch for what it does, in kebab case, with a type prefix:
  `feat/apple-design-refresh`, `fix/claim-double-tap`, `refactor/split-engine`,
  `docs/deploy-guide`. `wip`, `patch-1` and initials are not names.
- One branch per change. If a second, unrelated thing needs doing, it gets its
  own branch.

Small, self-contained fixes — a typo, a comment, a one-line correction — may go
straight to `main`.

## Verify before asking for review

A change is ready when it has actually been run, not when it compiles in
principle:

```bash
npm run typecheck && npm test && npm run build
```

Anything visible in the browser is also checked in the running app
(`npm run dev`, port 3000) before review — both colour schemes, and at phone
width, because that is where this app is used.

Say plainly what was verified and what was not. A failing test is reported, not
hidden.

## Open a pull request for review — do not merge it

When the work is ready and verified, push the branch and open a pull request
against `main`, then hand the link over. The review is the user's; Claude does
not merge, squash, force-push over `main`, or enable auto-merge unless asked.

The pull request needs:

- **A title that names the change in plain language**, the way the commit log
  here already reads — `Redesign the interface on Apple's HIG principles`, not
  `Update UI` or `feat: various changes`.
- **A description that covers**: what changed and why, anything the reviewer
  should look at closely, the commands that were run and their result, and what
  was deliberately left out.

Commit messages follow the existing log: a sentence in the imperative, no
`type:` prefix, explaining the change rather than restating the diff.
