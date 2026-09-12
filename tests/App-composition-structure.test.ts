import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Source inspection only; these assertions neither import product entry points nor run output.
const source = (file: string) => ts.createSourceFile(file, readFileSync(path.resolve(file), 'utf8'), ts.ScriptTarget.Latest, true);
function nodes(root: ts.Node): ts.Node[] { const result: ts.Node[] = []; const visit = (node: ts.Node) => { result.push(node); ts.forEachChild(node, visit); }; visit(root); return result; }
const calls = (root: ts.SourceFile) => nodes(root).filter(ts.isCallExpression);

describe('App composition source ownership (static, not behavioral journeys)', () => {
  it('keeps App local state limited to inspector layout and has no host or async workflow implementation', () => {
    const app = source('src/renderer/app/App.tsx');
    expect(calls(app).filter(node => node.expression.getText(app) === 'useState')).toHaveLength(1);
    expect(nodes(app).filter(ts.isAwaitExpression)).toHaveLength(0);
    expect(nodes(app).filter(node => node.kind === ts.SyntaxKind.AsyncKeyword)).toHaveLength(0);
    expect(calls(app).filter(node => /\.(then|catch|finally)$/.test(node.expression.getText(app)))).toHaveLength(0);
    expect(nodes(app).filter(ts.isImportDeclaration).map(node => node.moduleSpecifier.getText(app))).not.toContain("'./app/desktop-client'");
    expect(calls(app).filter(node => node.expression.getText(app) === 'useEffect').map(node => node.arguments[1].getText(app))).toEqual(['[boot?.platform, active?.kind]', '[reviewOpen, active?.id]', '[]']);
  });
  it('composition connects named owners without a replacement App state, effect or mutable ref bridge', () => {
    const composition = source('src/renderer/app/useWorkspaceComposition.ts');
    const hooks = calls(composition).map(node => node.expression.getText(composition)).filter(name => name.startsWith('use'));
    expect(hooks).toEqual(['useDesktopPresentation', 'useWorkspace', 'useCommandPalette', 'useSessionInput', 'useSessionLaunchController', 'useSessionPresentation']);
    expect(nodes(composition).filter(ts.isAwaitExpression)).toHaveLength(0);
    expect(nodes(composition).filter(ts.isSpreadAssignment)).toHaveLength(0);
    expect(calls(composition).filter(node => /\.(then|catch|finally)$/.test(node.expression.getText(composition)))).toHaveLength(0);
  });
  it('retains session.id pane keys and the original terminal callback dereference/lifecycle effect seam', () => {
    const app = source('src/renderer/app/App.tsx');
    const panes = nodes(app).filter(ts.isJsxSelfClosingElement).filter(node => ['ChatPane', 'TerminalPane'].includes(node.tagName.getText(app)));
    expect(panes).toHaveLength(2);
    for (const pane of panes) expect(pane.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.getText(app) === 'key')?.getText(app)).toBe('key={session.id}');
    const terminal = source('src/renderer/features/terminal/TerminalPane.tsx');
    expect(calls(terminal).filter(node => node.expression.getText(terminal) === 'useEffect').map(node => node.arguments[1].getText(terminal))).toEqual(['[session.id]', '[theme]', '[active, fontSize]']);
    expect(terminal.text).toContain('callbacks.current = { onExit, onError, onReady };');
    expect(terminal.text).toContain('callbacks.current.onReady(id, null);');
    const chat = source('src/renderer/features/conversation/ChatPane.tsx');
    expect(chat.text).toContain('useEffect(() => onCommands(state.commands), [state.commands]);');
    expect(chat.text).toContain('draftRef.current.revision === submitted.revision');
  });
});
