# @blunderon/ax

Small Chromium-only accessibility helper for Playwright. Reads Chrome's own AX
tree over CDP, including open shadow roots. Finds nodes by their AX role and
accessible name, then acts through their backend DOM node. No selectors,
attribute injection, or Playwright accessibility locators.

Install from GitHub (this package is not published to npm):

```sh
bun add --dev 'github:blunderon/ax#v0.1.0' playwright-core
# or
npm install --save-dev 'github:blunderon/ax#v0.1.0' playwright-core
```

Use the same `playwright-core` version as your `@playwright/test` version. Node
20+ and Bun are supported. Committed `dist/` contains ESM JavaScript and TypeScript
declarations; consumers do not run a build or install this repo's devDependencies.
`private: true` prevents accidental npm publication; the GitHub repository is public.

```ts
import { expect, test } from '@playwright/test';
import { find, snapshot } from '@blunderon/ax';

test('promotion', async ({ page }) => {
  // Seed the position through your app's existing fixture seam.
  await page.goto('/example?position=promotion');
  const dialog = await find(page, { role: 'dialog', name: 'Promotion' });
  expect(await snapshot(page, dialog)).toMatchSnapshot('promotion.txt');
  await (await find(page, { role: 'button', name: 'Queen', scope: dialog })).click();
});
```

## API

### `find(page, { role, name?, scope?, states?, timeout? })`

Returns an `AXHandle` for one unignored node. Roles and string names are exact,
case-sensitive Chrome AX values (for example `button`, `gridcell`, `StaticText`).
`name` also accepts a RegExp; its `lastIndex` is neither read nor changed. Omitting
`name` matches any accessible name. An empty string matches only unnamed nodes.
`scope` is another handle on the same page and includes that node and its subtree.

Queries `Accessibility.queryAXTree` immediately and every 50ms until a match or
`timeout` (default 5000ms). `timeout: 0` makes one query. Protocol calls are awaited;
the timeout bounds polling, not a stalled browser's CDP response. Multiple matches
fail immediately: refine the name or scope. Hidden/ignored nodes never match.

`states` filters Chrome's scalar AX properties. Preserve Chrome's types:
`{ selected: true }`, `{ checked: 'mixed' }`, `{ pressed: 'true' }`. A missing
property compares equal to boolean `false`, useful for `{ disabled: false }`.
A handle identifies a particular backend node, not a locator. Re-find after a
rerender that replaces the node. Detached or ignored nodes fail on state reads
and input; handles cannot be used with another page.

### `snapshot(page, scope?)`

Returns newline-terminated text from `Accessibility.getFullAXTree`. Without a
scope it starts at the document root. A scoped snapshot includes the matched node.
Tree order is Chrome's child order; nesting is two spaces. Names, descriptions,
values and scalar properties use JSON escaping; property names are sorted.

Ignored wrappers are omitted and their visible children promoted. Hidden content,
node IDs, relation IDs, URLs and layout-only `InlineTextBox` fragments are omitted.
`StaticText` is retained. Focus, selection, live-region properties and mixed states
are retained. Snapshots reflect current state immediately, without waiting for a
particular result; use `expect.poll(() => snapshot(page, scope))` for async updates.
Pin your browser version for stable baselines across Chrome releases.

### Handles

| Method | Behavior |
| --- | --- |
| `states()` | Fetch current scalar AX properties; does not return cached state. |
| `box()` | Scroll into view, return `{ x, y, width, height }` in viewport CSS pixels from `DOM.getBoxModel`. |
| `click(options?)` | Reject disabled/ignored nodes, scroll, then real mouse click at the box center. Playwright mouse click options are forwarded. |
| `focus()` | Reject disabled/ignored nodes, then `DOM.focus`. |
| `type(text, options?)` | Focus and use Playwright keyboard typing; appends to the current selection. |
| `press(key, options?)` | Focus and use Playwright keyboard press, e.g. `ControlOrMeta+A`, `ArrowRight`, `Space`. |
| `dragTo(target, { steps? }?)` | Mouse down at source center, move to target center (default 10 steps), always release the mouse. |

Input is real browser input. These methods do not dispatch synthetic DOM events,
wait for animations, retry clicks, or bypass overlays. Stabilize the injected
state before acting and assert the resulting AX state. `dragTo` covers pointer
mechanics, not a synthesized HTML `DataTransfer` payload.

For touch, long-press, or custom drags, derive coordinates from AX handles:

```ts
const square = await find(page, { role: 'gridcell', name: 'e2' });
const { x, y, width, height } = await square.box();
await page.touchscreen.tap(x + width / 2, y + height / 2);
```

One CDP session is cached per Page; Chrome closes it with the page. The helper
supports the page's main frame and its open shadow DOM. It does not traverse
iframe documents, support Firefox/WebKit, or implement screen-reader speech.

## Development

```sh
bun install --frozen-lockfile
bun run ci                 # lint, types, build, local Google Chrome semantic tests
bun run test:container     # all tests and screenshots in the pinned official image
bun run snapshots:update   # update baselines only inside that image
```

The container script prefers Podman, falls back to Docker, and copies the repo
into a disposable Linux/amd64 container, so host node_modules are never reused. CI uses
`mcr.microsoft.com/playwright:v1.64.0-noble`, matching `@playwright/test` exactly.
Phone/desktop fixtures have deterministic content and disabled screenshot
animations. Local Chrome runs skip the two screenshots. No retries are configured.

Commit source and regenerated `dist/` together (`bun run build`); CI checks that
the build leaves `dist/` unchanged. MIT licensed. Protocol reference:
[Accessibility domain](https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/)
and [DOM domain](https://chromedevtools.github.io/devtools-protocol/tot/DOM/).
