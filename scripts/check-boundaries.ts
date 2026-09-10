import { builtinModules } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const nodeModules = new Set(builtinModules.map(name => name.replace(/^node:/, '')));
const platformModule = (name: string) => name.startsWith('node:') || nodeModules.has(name) || name === 'electron' || name.startsWith('electron/') || name === 'node-pty' || name.startsWith('node-pty/');
const reactModule = (name: string) => /^(react|react-dom)(\/|$)/.test(name);
const sourceFile = /\.[cm]?[jt]sx?$/;
const slash = (value: string) => value.split(path.sep).join('/');

/** A finite import/channel gate, not a formatter or general-purpose architecture lint. */
export function checkSource(filename: string, text: string, root: string): string[] {
  const file = path.resolve(root, filename);
  const relative = slash(path.relative(root, file));
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const errors: string[] = [];
  const renderer = relative.startsWith('src/renderer/');
  const workspaceRoot = 'src/renderer/features/workspace/';
  const workspaceSelection = relative === `${workspaceRoot}selection.ts`;
  const workspaceGlobals = ['window', 'document', 'process', 'Buffer', 'NodeJS', '__dirname', '__filename', 'setImmediate', 'clearImmediate'];
  const shared = relative.startsWith('src/shared/');
  const appMain = relative.startsWith('src/app/main/');
  const electronMain = relative.startsWith('src/platform/electron/');
  const piRuntime = /^src\/platform\/pi\/(runtime|process)\//.test(relative);
  const filesystemHome = relative === 'src/platform/filesystem/expand-home.ts';
  const filesystemProject = /^src\/platform\/filesystem\/(project-resources|session-preparation)\.ts$/.test(relative);
  const main = relative.startsWith('src/main/') || appMain || electronMain;
  const coreModule = /^src\/modules\/(sessions|conversation|change-review|preferences)\//.exec(relative)?.[1];
  const coreRoot = `src/modules/${coreModule}/`;
  const businessCore = !!coreModule && !relative.startsWith(`${coreRoot}infrastructure/`);
  const coreLabel = ({ sessions: 'Session', conversation: 'Conversation', 'change-review': 'Change Review', preferences: 'Preferences' } as Record<string, string>)[coreModule ?? ''] ?? 'business';
  const domain = relative.startsWith(`${coreRoot}domain/`);
  const application = relative.startsWith(`${coreRoot}application/`);
  const ports = relative === `${coreRoot}ports.ts`;
  const report = (node: ts.Node, message: string) => errors.push(`${relative}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${message}`);
  const checkImport = (node: ts.Node, name: string) => {
    if (workspaceSelection) report(node, `Workspace selection is dependency-free; import ${name} is forbidden`);
    if ((shared || renderer) && platformModule(name)) report(node, `platform import ${name} is forbidden`);
    if (shared && reactModule(name)) report(node, `React import ${name} is forbidden in shared`);
    const resolved = ts.resolveModuleName(name, file, { moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true }, ts.sys).resolvedModule?.resolvedFileName;
    const target = slash(path.relative(root, resolved ?? path.resolve(path.dirname(file), name)));
    const targetFeature = /^src\/renderer\/features\/([^/]+)\/(.+)$/.exec(target);
    const sourceFeature = /^src\/renderer\/features\/([^/]+)\//.exec(relative)?.[1];
    if (relative.startsWith('src/') && targetFeature && sourceFeature !== targetFeature[1] && !/^index\.[cm]?[jt]s$/.test(targetFeature[2])) report(node, `Renderer feature callers must use ${targetFeature[1]}/index.ts`);
    if (renderer && /^src\/(app|main|preload|workers|platform|modules)\//.test(target)) report(node, `renderer implementation import ${target} is forbidden`);
    if (shared && /^src\/(app|main|preload|workers|platform|renderer|modules)\//.test(target)) report(node, `shared implementation import ${target} is forbidden`);
    if (relative.startsWith('src/platform/git/') && (reactModule(name) || name === 'electron' || name.startsWith('electron/') || /^src\/(app|main|shared|renderer)\//.test(target) || target.startsWith('src/platform/electron/'))) report(node, `Git adapter import ${name} is forbidden`);
    if (relative === 'src/platform/filesystem/preferences-storage.ts' && (reactModule(name) || name === 'electron' || name.startsWith('electron/') || /^src\/(app|main|renderer)\//.test(target) || target.startsWith('src/platform/electron/'))) report(node, `Preferences storage import ${name} is forbidden`);
    if (piRuntime && (reactModule(name) || name === 'electron' || name.startsWith('electron/') || name === 'node-pty' || name.startsWith('node-pty/') || /^(node:)?(child_process|worker_threads|cluster)(\/|$)/.test(name) || /^src\/(app|main|shared|renderer|modules)\//.test(target) || target.startsWith('src/platform/electron/'))) report(node, `Pi runtime/environment import ${name} is forbidden`);
    if (filesystemHome && (reactModule(name) || name === 'electron' || name.startsWith('electron/') || /^src\/(app|main|shared|renderer|modules)\//.test(target) || /^src\/platform\/(pi|electron)\//.test(target))) report(node, `Filesystem home import ${name} is forbidden`);
    if (filesystemProject && (reactModule(name) || name === 'electron' || name.startsWith('electron/') || /^src\/(app|main|renderer|modules)\//.test(target) || /^src\/platform\/(pi|electron)\//.test(target) || (relative.endsWith('/session-preparation.ts') && target.startsWith('src/shared/')))) report(node, `Filesystem project adapter import ${name} is forbidden`);
    if (main && target.startsWith('src/renderer/')) report(node, `main composition renderer import ${target} is forbidden`);
    if (businessCore) {
      const ownDomain = target.startsWith(`${coreRoot}domain/`);
      const ownPorts = /^ports\.[cm]?[jt]s$/.test(target.slice(coreRoot.length)) && target.startsWith(coreRoot);
      const ownCore = target.startsWith(coreRoot) && /^(domain\/|application\/|ports\.)/.test(target.slice(coreRoot.length));
      if (platformModule(name) || reactModule(name) || !(domain || ports ? ownDomain : application ? ownDomain || ownPorts : ownCore)) report(node, `${coreLabel} core import ${name} is forbidden`);
    }
    const targetModule = /^src\/modules\/([^/]+)\/(.+)$/.exec(target);
    const sourceModule = /^src\/modules\/([^/]+)\//.exec(relative)?.[1];
    if (targetModule && targetModule[1] !== sourceModule && !/^index\.[cm]?[jt]s$/.test(targetModule[2])) report(node, `cross-module import must use ${targetModule[1]}/index.ts`);
    if (relative.startsWith('src/') && (target.startsWith('tests/') || /(^|\/)fixtures?\//.test(target))) report(node, `production fixture import ${target} is forbidden`);
  };
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) checkImport(node, node.moduleSpecifier.text);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)) checkImport(node, node.moduleReference.expression.text);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) checkImport(node, node.argument.literal.text);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteralLike(arg)) checkImport(node, arg.text);
      else if (shared || renderer || businessCore || piRuntime || filesystemHome || filesystemProject) report(node, `computed import cannot be checked in shared/renderer/${coreLabel} core`);
    }
    if (workspaceSelection && ts.isIdentifier(node) && workspaceGlobals.includes(node.text)) {
      const propertyName = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
      const globalProperty = propertyName && ts.isIdentifier(node.parent.expression) && ['globalThis', 'global'].includes(node.parent.expression.text);
      if (!propertyName || globalProperty) report(node, `Host global ${node.text} is forbidden in Workspace selection`);
    }
    if (workspaceSelection && ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && ['globalThis', 'global'].includes(node.expression.text)) {
      const key = node.argumentExpression;
      if (!ts.isStringLiteralLike(key) || workspaceGlobals.includes(key.text)) report(node, 'Host/computed global access is forbidden in Workspace selection');
    }
    if (businessCore && ts.isIdentifier(node) && ['process', 'Buffer', 'NodeJS'].includes(node.text)) {
      const propertyName = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
      const globalProperty = propertyName && ts.isIdentifier(node.parent.expression) && ['globalThis', 'global'].includes(node.parent.expression.text);
      if (!propertyName || globalProperty) report(node, `Node global ${node.text} is forbidden in ${coreLabel} core`);
    }
    if (businessCore && ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && ['globalThis', 'global'].includes(node.expression.text)) {
      const key = node.argumentExpression;
      if (!ts.isStringLiteralLike(key) || ['process', 'Buffer', 'NodeJS'].includes(key.text)) report(node, `Node/computed global access is forbidden in ${coreLabel} core`);
    }
    if (main && ts.isStringLiteralLike(node) && node.text.startsWith('desktop:')) report(node, 'desktop channel literal belongs in shared/ipc/channels.ts');
    ts.forEachChild(node, visit);
  };
  visit(source);
  return errors;
}

export function checkBoundaries(root: string): string[] {
  const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : sourceFile.test(file) ? [file] : [];
  });
  return files(path.join(root, 'src')).flatMap(file => checkSource(file, readFileSync(file, 'utf8'), root));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkBoundaries(process.cwd());
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('PASS import/channel boundaries (TypeScript AST; not full lint)');
}
