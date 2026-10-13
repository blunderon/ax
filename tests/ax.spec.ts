import { expect, test } from '@playwright/test';
import { find, snapshot } from '../src/index.js';

const fixture = String.raw`
<style>.sr {position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}</style>
<main aria-label="Fixture">
  <h1>Access</h1>
  <button aria-hidden="true">Hidden ARIA</button>
  <button style="display:none">Hidden CSS</button>
  <button><span class="sr">Invisible label</span></button>
  <button disabled>Disabled</button>
  <button aria-pressed="true" onclick="this.setAttribute('aria-pressed', 'false')">Toggle</button>
  <input type="checkbox" aria-label="Check" checked>
  <input aria-label="Message" value="seed">
  <div role="status" aria-live="polite">Ready</div>
  <div role="grid" aria-label="Board"><div role="row"><button role="gridcell" aria-label="a1" aria-selected="true">Rook</button><button role="gridcell" aria-label="b1">Knight</button></div></div>
  <div id="host"></div>
</main>
<script>document.getElementById('host').attachShadow({mode:'open'}).innerHTML = '<button onclick="this.textContent=\'Shadow clicked\'">Shadow</button>'</script>`;

test('snapshots expose the real tree, including shadow DOM and semantic states', async ({
  page,
}) => {
  await page.setContent(fixture);
  const main = await find(page, { role: 'main', name: 'Fixture' });
  const tree = await snapshot(page, main);
  expect(tree).toMatchSnapshot('fixture.txt');
  expect(tree).not.toContain('Hidden');
  expect(tree).toContain('Invisible label');
  expect(tree).toContain('Shadow');
  expect(await snapshot(page, main)).toBe(tree);
  await (await find(page, { role: 'button', name: /^Shadow$/g })).click();
  expect(await snapshot(page, main)).toContain('Shadow clicked');
});

test('handles read fresh states and deliver trusted mouse and keyboard input', async ({
  page,
}) => {
  await page.setContent(fixture);
  const toggle = await find(page, { role: 'button', name: 'Toggle' });
  expect(await toggle.states()).toMatchObject({ pressed: 'true' });
  await toggle.click();
  expect(await toggle.states()).toMatchObject({
    pressed: 'false',
    focused: true,
  });
  const check = await find(page, { role: 'checkbox', name: 'Check' });
  await check.press('Space');
  expect(await check.states()).toMatchObject({ checked: 'false' });
  const input = await find(page, { role: 'textbox', name: 'Message' });
  await input.focus();
  await input.press('ControlOrMeta+A');
  await input.type('hello');
  expect(await snapshot(page, input)).toContain('value="hello"');
  await expect(
    (await find(page, { role: 'button', name: 'Disabled' })).click(),
  ).rejects.toThrow(/disabled/i);
});

test('find waits, scopes, matches states, and rejects absent or ambiguous matches', async ({
  page,
}) => {
  await page.setContent(
    '<section aria-label="First"><button>Same</button></section><section aria-label="Second"><button>Same</button></section>',
  );
  await expect(find(page, { role: 'button', name: 'Same' })).rejects.toThrow(
    /2.*match/i,
  );
  const scope = await find(page, { role: 'region', name: 'Second' });
  await (await find(page, { role: 'button', name: 'Same', scope })).click();
  await expect(
    find(page, { role: 'button', name: 'Absent', timeout: 50 }),
  ).rejects.toThrow(/Absent/);
  await page.evaluate(() => {
    setTimeout(() => {
      const button = document.createElement('button');
      button.textContent = 'Later';
      button.disabled = true;
      document.body.append(button);
      setTimeout(() => {
        button.disabled = false;
      }, 100);
    }, 100);
  });
  const later = await find(page, {
    role: 'button',
    name: /Later/g,
    states: { disabled: false },
  });
  await later.click();
});

test('excludes hidden nodes from queries and includes modal dialogs and live regions', async ({
  page,
}) => {
  await page.setContent(fixture);
  await expect(
    find(page, { role: 'button', name: 'Hidden ARIA', timeout: 0 }),
  ).rejects.toThrow(/Hidden ARIA/);
  await expect(
    find(page, { role: 'button', name: 'Hidden CSS', timeout: 0 }),
  ).rejects.toThrow(/Hidden CSS/);
  await page.evaluate(() => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Promotion');
    dialog.innerHTML =
      '<button>Queen</button><p role="alert">Choose a piece</p>';
    document.body.append(dialog);
    dialog.showModal();
  });
  const dialog = await find(page, { role: 'dialog', name: 'Promotion' });
  expect(await snapshot(page, dialog)).toMatchSnapshot('dialog.txt');
  await expect(
    find(page, { role: 'button', name: 'Toggle', timeout: 0 }),
  ).rejects.toThrow(/Toggle/);
});

test('boxes and drag use backend nodes and real pointer events', async ({
  page,
}) => {
  await page.setContent(`<style>button {width:100px;height:80px;margin:20px}</style>
    <button aria-label="Source">Source</button><button aria-label="Target">Target</button><output aria-label="Events"></output>
    <script>document.addEventListener('pointerdown', e => { document.querySelector('output').textContent = e.isTrusted ? 'down' : 'untrusted' });
    document.addEventListener('pointerup', e => { document.querySelector('output').textContent += ' ' + e.target.textContent });</script>`);
  const source = await find(page, { role: 'button', name: 'Source' });
  const target = await find(page, { role: 'button', name: 'Target' });
  expect(await source.box()).toMatchObject({ width: 100, height: 80 });
  await source.dragTo(target);
  const events = await find(page, { role: 'status', name: 'Events' });
  expect(await snapshot(page, events)).toContain('down Target');
});

test('handles survive navigation via new queries and reject detached scopes', async ({
  page,
}) => {
  await page.setContent('<button>Old</button>');
  const old = await find(page, { role: 'button', name: 'Old' });
  await page.goto('data:text/html,<button>New</button>');
  await (await find(page, { role: 'button', name: 'New' })).click();
  await expect(snapshot(page, old)).rejects.toThrow();
});

test('snapshot preserves mixed states, descriptions and escaped text without layout fragments', async ({
  page,
}) => {
  await page.setContent(
    '<main aria-label="States"><button aria-pressed="mixed" aria-description="Help">A &quot;quote&quot;</button><div role="checkbox" aria-checked="mixed" tabindex="0">Mixed</div><div role="progressbar" aria-label="Progress" aria-valuenow="25" aria-valuemin="0" aria-valuemax="100" aria-valuetext="quarter"></div><p>A long line of text that wraps across a narrow viewport but has the same semantic content.</p></main>',
  );
  const region = await find(page, { role: 'main', name: 'States' });
  const wide = await snapshot(page, region);
  expect(wide).toMatchSnapshot('states.txt');
  await page.setViewportSize({ width: 180, height: 500 });
  expect(await snapshot(page, region)).toBe(wide);
  expect(
    await (await find(page, { role: 'checkbox', name: 'Mixed' })).states(),
  ).toMatchObject({ checked: 'mixed' });
});

test('keyboard actions enter open shadow roots and disabled controls reject input', async ({
  page,
}) => {
  await page.setContent(
    '<div></div><input disabled aria-label="Disabled input">',
  );
  await page.evaluate(() => {
    document.body.firstElementChild
      ?.attachShadow({ mode: 'open' })
      .append(document.createElement('input'));
  });
  const input = await find(page, { role: 'textbox', name: '' });
  await input.type('shadow text');
  expect(await snapshot(page, input)).toContain('value="shadow text"');
  const disabled = await find(page, {
    role: 'textbox',
    name: 'Disabled input',
  });
  await expect(disabled.type('no')).rejects.toThrow(/disabled/);
  await expect(disabled.press('Space')).rejects.toThrow(/disabled/);
});

test('box centers stay in viewport CSS pixels after document and nested scrolling', async ({
  browser,
}) => {
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: { width: 600, height: 400 },
  });
  const page = await context.newPage();
  try {
    await page.setContent(
      `<div style="height:1200px"></div><div style="height:200px;overflow:auto"><div style="height:800px"></div><button style="width:100px;height:50px;transform:rotate(15deg);margin:30px" onclick="this.textContent=event.isTrusted ? 'Clicked' : 'Untrusted'">Scrolled</button></div>`,
    );
    const button = await find(page, { role: 'button', name: 'Scrolled' });
    const box = await button.box();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(400);
    await button.click();
    expect(await snapshot(page, button)).toContain('Clicked');
  } finally {
    await context.close();
  }
});

test('rejects foreign pages and detached nodes and releases failed drags', async ({
  page,
  context,
}) => {
  await page.setContent('<button>Source</button><button>Target</button>');
  const source = await find(page, { role: 'button', name: 'Source' });
  const target = await find(page, { role: 'button', name: 'Target' });
  const other = await context.newPage();
  await expect(snapshot(other, source)).rejects.toThrow(/different page/);
  await expect(find(other, { role: 'button', scope: source })).rejects.toThrow(
    /different page/,
  );
  await page.evaluate(() => {
    document.body.lastElementChild?.remove();
  });
  await expect(target.states()).rejects.toThrow();
  await expect(snapshot(page, target)).rejects.toThrow();
  await expect(source.dragTo(target)).rejects.toThrow();
  await page.evaluate(() => {
    document.addEventListener('pointermove', (event) => {
      document.title = String(event.buttons);
    });
  });
  await page.mouse.move(0, 0);
  expect(await page.title()).toBe('0');
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 720 },
]) {
  test(`injected fixture screenshot ${viewport.width}`, async ({ page }) => {
    test.skip(
      process.env.AX_SCREENSHOTS !== '1',
      'Screenshots run only in the pinned Playwright container',
    );
    await page.setViewportSize(viewport);
    await page.setContent(fixture);
    await find(page, { role: 'main', name: 'Fixture' });
    await expect(page).toHaveScreenshot(`fixture-${viewport.width}.png`, {
      animations: 'disabled',
    });
  });
}

test('retained handles cannot bypass the AX tree after becoming ignored', async ({
  page,
}) => {
  await page.setContent('<button>Source</button><button>Target</button>');
  const source = await find(page, { role: 'button', name: 'Source' });
  const target = await find(page, { role: 'button', name: 'Target' });
  await page.evaluate(() => {
    document.body.lastElementChild?.setAttribute('aria-hidden', 'true');
  });
  await expect(target.box()).rejects.toThrow(/ignored/);
  await expect(target.click()).rejects.toThrow(/ignored/);
  await expect(target.focus()).rejects.toThrow(/ignored/);
  await expect(source.dragTo(target)).rejects.toThrow(/ignored/);
});
