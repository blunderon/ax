const sessions = new WeakMap();
function sessionFor(page) {
    let pending = sessions.get(page);
    if (!pending) {
        pending = page
            .context()
            .newCDPSession(page)
            .then(async (session) => {
            await session.send('Accessibility.enable');
            return session;
        });
        sessions.set(page, pending);
        pending.catch(() => sessions.delete(page));
    }
    return pending;
}
async function fullTree(session) {
    return session.send('Accessibility.getFullAXTree');
}
function statesOf(node) {
    const states = {};
    for (const property of node.properties ?? []) {
        const value = property.value.value;
        if (!property.value.relatedNodes &&
            property.name !== 'url' &&
            (typeof value === 'string' ||
                typeof value === 'number' ||
                typeof value === 'boolean')) {
            states[property.name] = value;
        }
    }
    return states;
}
function checkPage(page, scope) {
    if (scope && scope.page !== page) {
        throw new Error('AX handle belongs to a different page');
    }
}
// Chrome supplies semantics; only IDs, ignored wrappers and layout fragments are removed.
export async function snapshot(page, scope) {
    checkPage(page, scope);
    const { nodes } = await fullTree(await sessionFor(page));
    const byId = new Map(nodes.map((node) => [node.nodeId, node]));
    const root = scope
        ? nodes.find((node) => node.backendDOMNodeId === scope.backendNodeId)
        : nodes[0];
    if (!root || (scope && root.ignored)) {
        throw new Error('AX snapshot scope is detached or ignored');
    }
    const lines = [];
    function visit(node, depth) {
        if (node.role?.value === 'InlineTextBox')
            return;
        if (!node.ignored) {
            let line = `${'  '.repeat(depth)}${node.role?.value ?? 'unknown'}`;
            if (node.name?.value)
                line += ` ${JSON.stringify(node.name.value)}`;
            const details = statesOf(node);
            if (node.value?.value !== undefined)
                details.value = node.value.value;
            if (node.description?.value)
                details.description = node.description.value;
            for (const key of Object.keys(details).sort()) {
                line += ` ${key}=${JSON.stringify(details[key])}`;
            }
            lines.push(line);
            depth++;
        }
        for (const id of node.childIds ?? []) {
            const child = byId.get(id);
            if (child)
                visit(child, depth);
        }
    }
    visit(root, 0);
    return `${lines.join('\n')}\n`;
}
export async function find(page, options) {
    const { role, name, scope, states = {}, timeout = 5_000 } = options;
    checkPage(page, scope);
    if (!Number.isFinite(timeout) || timeout < 0) {
        throw new Error('AX timeout must be finite and non-negative');
    }
    const deadline = performance.now() + timeout;
    const session = await sessionFor(page);
    do {
        const root = scope
            ? { backendNodeId: scope.backendNodeId }
            : { nodeId: (await session.send('DOM.getDocument')).root.nodeId };
        const { nodes } = await session.send('Accessibility.queryAXTree', {
            ...root,
            role,
            ...(typeof name === 'string' ? { accessibleName: name } : {}),
        });
        const matches = nodes.filter((node) => {
            if (node.ignored || node.role?.value !== role)
                return false;
            if (name instanceof RegExp) {
                const regex = new RegExp(name.source, name.flags);
                if (!regex.test(node.name?.value ?? ''))
                    return false;
            }
            const actual = statesOf(node);
            return Object.entries(states).every(([key, value]) => (actual[key] ?? false) === value);
        });
        if (matches.length > 1) {
            throw new Error(`AX ${role} ${String(name ?? '')}: ${matches.length} matches; use scope or a more specific name`);
        }
        const match = matches[0];
        if (match?.backendDOMNodeId !== undefined) {
            return new AXHandle(page, match.backendDOMNodeId);
        }
        const remaining = deadline - performance.now();
        if (remaining <= 0)
            break;
        await new Promise((resolve) => setTimeout(resolve, Math.min(50, remaining)));
    } while (performance.now() < deadline);
    throw new Error(`AX ${role} ${String(name ?? '')} not found within ${timeout}ms`);
}
export class AXHandle {
    page;
    backendNodeId;
    constructor(page, backendNodeId) {
        this.page = page;
        this.backendNodeId = backendNodeId;
    }
    async states() {
        const { nodes } = await (await sessionFor(this.page)).send('Accessibility.getPartialAXTree', {
            backendNodeId: this.backendNodeId,
            fetchRelatives: false,
        });
        const node = nodes.find((item) => item.backendDOMNodeId === this.backendNodeId && !item.ignored);
        if (!node)
            throw new Error('AX handle is detached or ignored');
        return statesOf(node);
    }
    // The border quad is in viewport CSS pixels, matching Playwright's mouse coordinates.
    async box() {
        await this.states();
        const session = await sessionFor(this.page);
        await session.send('DOM.scrollIntoViewIfNeeded', {
            backendNodeId: this.backendNodeId,
        });
        const { model } = await session.send('DOM.getBoxModel', {
            backendNodeId: this.backendNodeId,
        });
        const xs = model.border.filter((_, index) => index % 2 === 0);
        const ys = model.border.filter((_, index) => index % 2 === 1);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    }
    async enabled() {
        if ((await this.states()).disabled)
            throw new Error('AX node is disabled');
    }
    async click(options) {
        await this.enabled();
        const box = await this.box();
        await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, options);
    }
    async focus() {
        await this.enabled();
        await (await sessionFor(this.page)).send('DOM.focus', {
            backendNodeId: this.backendNodeId,
        });
    }
    async type(text, options) {
        await this.focus();
        await this.page.keyboard.type(text, options);
    }
    async press(key, options) {
        await this.focus();
        await this.page.keyboard.press(key, options);
    }
    async dragTo(target, options = {}) {
        checkPage(this.page, target);
        await this.enabled();
        const source = await this.box();
        await this.page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
        await this.page.mouse.down();
        try {
            const destination = await target.box();
            await this.page.mouse.move(destination.x + destination.width / 2, destination.y + destination.height / 2, { steps: options.steps ?? 10 });
        }
        finally {
            await this.page.mouse.up();
        }
    }
}
